// ============================================================================
// base55 adapter สำหรับ Mmusic (คัดลอกโครงจาก Mnovel แล้วปรับ)
// - ORIGIN: ใช้ same-origin เป็นค่าเริ่ม (mplus.thinkpowers.com เสิร์ฟทั้งเว็บและ api.php)
//   override ได้ด้วย window.__B55_ORIGIN (เช่น ตอน dev ชี้ไป https://mplus.thinkpowers.com)
// - DB: b55_mmusic · backend functions: /mmusicfn.php
// - กฎสำคัญ (จากกับดัก Mnovel):
//   * op:'filter' ฝั่งเซิร์ฟเวอร์ไม่กรองจริง → กรองฝั่ง client เสมอ (ดู .filter)
//   * ห้ามใช้ underscore ในชื่อ entity
//   * parse JSON เฉพาะฟิลด์ใน JSON_FIELDS เท่านั้น ห้าม parse ทุกฟิลด์
//   * เปรียบเทียบเจ้าของข้อมูลด้วย user_email เสมอ
// ============================================================================

const ORIGIN = (typeof window !== 'undefined' && window.__B55_ORIGIN) ||
  (typeof window !== 'undefined' ? window.location.origin : 'https://mplus.thinkpowers.com');
const API = ORIGIN + '/api.php';       // entities + auth
const FN  = ORIGIN + '/mmusicfn.php';  // backend functions + upload
const DB  = 'b55_mmusic';

const GOOGLE_CLIENT_ID = '707060721356-glc46c183so7jjcc62lbma0hgiug2u55.apps.googleusercontent.com';

const SHARED = {}; // entity (lowercase) ที่แชร์ข้ามผู้ใช้ (scope 'all')

// ฟิลด์ที่เก็บเป็น JSON string ในฐานข้อมูล — parse เฉพาะรายการนี้ตอนอ่าน
const JSON_FIELDS = {
  song: ['step_status'],
  storypart: ['line_idx_list'],
  shot: ['ref_ids'],
  stylelock: ['forbidden', 'references'],
  libraryasset: ['tags'],
  job: ['params', 'result'],
};
// ฟิลด์ตัวเลข/บูลีน ที่ MySQL คืนเป็น string — แปลงให้ถูกชนิด
const NUM_FIELDS = {
  song: ['duration_sec', 'images_per_min'],
  lyricline: ['idx', 'start_sec', 'end_sec'],
  storypart: ['part_no'],
  shot: ['seq_no', 'part_no', 'slot_no', 't0', 't1', 'library_asset_id', 'song_id'],
  libraryasset: ['w', 'h', 'used_count'],
  job: ['progress', 'song_id'],
  workerheartbeat: ['current_job_id'],
};
const BOOL_FIELDS = {
  song: ['is_deleted'],
  shot: ['synced_to_pc'],
  character: ['shared'],
  stylelock: ['approved'],
};

function token() {
  try { return localStorage.getItem('b55user') || localStorage.getItem('b55auth') || localStorage.getItem('token') || ''; }
  catch (e) { return ''; }
}
function setStoredToken(t) {
  try { localStorage.setItem('b55user', String(t || '')); } catch (e) {}
}
function clearToken() {
  try { localStorage.removeItem('b55user'); localStorage.removeItem('b55auth'); localStorage.removeItem('token'); localStorage.removeItem('base44_access_token'); } catch (e) {}
}

function normSort(s) {
  if (!s || typeof s !== 'string') return undefined;
  return s;
}

function parseRow(ent) {
  const jsonF = JSON_FIELDS[ent] || [];
  const numF = NUM_FIELDS[ent] || [];
  const boolF = BOOL_FIELDS[ent] || [];
  return function (r) {
    if (!r || typeof r !== 'object') return r;
    const o = {};
    for (const k in r) {
      let v = r[k];
      if (jsonF.includes(k) && typeof v === 'string') {
        try { const p = JSON.parse(v); if (p !== null && typeof p === 'object') v = p; } catch (e) {}
      } else if (numF.includes(k) && typeof v === 'string' && v !== '' && !isNaN(Number(v))) {
        v = Number(v);
      } else if (boolF.includes(k)) {
        v = (v === 1 || v === '1' || v === true) ? 1 : 0;
      }
      o[k] = v;
    }
    return o;
  };
}
// เขียนลง DB: แปลง object/array ในฟิลด์ JSON กลับเป็น string
function encodeRow(ent, data) {
  const jsonF = JSON_FIELDS[ent] || [];
  const o = {};
  for (const k in (data || {})) {
    let v = data[k];
    if (jsonF.includes(k) && v !== null && typeof v === 'object') v = JSON.stringify(v);
    o[k] = v;
  }
  return o;
}

async function entityCall(body) {
  const r = await fetch(API + '?a=entity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth': token() },
    body: JSON.stringify(body || {})
  });
  let d = null; try { d = await r.json(); } catch (e) {}
  if (!r.ok || (d && d.ok === false)) {
    const err = new Error((d && d.error) || ('HTTP ' + r.status));
    err.status = r.status; err.data = d; throw err;
  }
  return d || {};
}

// api.php จำกัด 500 แถวต่อครั้ง — วนหน้าด้วย offset จนครบ
const SERVER_PAGE_MAX = 500;
async function pagedList(base, opBody, limit) {
  const want = (limit && limit > 0) ? limit : Infinity;
  const out = [];
  let offset = 0;
  while (out.length < want) {
    const pageLimit = Math.min(SERVER_PAGE_MAX, want - out.length);
    const d = await entityCall(base(Object.assign({}, opBody, { limit: pageLimit, offset: offset })));
    const rows = (d && d.rows) || [];
    for (let i = 0; i < rows.length; i++) out.push(rows[i]);
    if (rows.length < pageLimit) break;
    offset += rows.length;
    if (offset > 200000) break;
  }
  return out;
}

function emptyOnMissing(e, fallback) {
  const msg = (e && (e.message || (e.data && e.data.error))) || '';
  if (/exist|unknown table|no such table|doesn't exist|not found|1146/i.test(msg) || e.status === 404) {
    return fallback;
  }
  throw e;
}

// เปรียบเทียบค่าแบบหลวม ๆ สำหรับ client-side filter (int จาก DB อาจเป็น string)
function looseEq(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}
function matchWhere(row, where) {
  for (const k in (where || {})) {
    if (!looseEq(row[k], where[k])) return false;
  }
  return true;
}
function sortRows(rows, sort) {
  if (!sort) return rows;
  const neg = sort.charAt(0) === '-';
  const f = neg ? sort.slice(1) : sort;
  return rows.slice().sort((a, b) => {
    const x = a[f], y = b[f];
    if (x === y) return 0;
    const cmp = (x === null || x === undefined) ? -1 : (y === null || y === undefined) ? 1 : (x > y ? 1 : -1);
    return neg ? -cmp : cmp;
  });
}

function makeEntity(Name) {
  const ent = Name.toLowerCase();
  const scope = SHARED[ent] ? 'all' : 'user';
  const base = (extra) => Object.assign({ entity: ent, database: DB, scope: scope }, extra || {});
  const parse = parseRow(ent);
  return {
    list: async function (sort, limit) {
      try {
        const rows = await pagedList(base, { op: 'list', sort: normSort(sort) }, limit);
        return rows.map(parse);
      } catch (e) { return emptyOnMissing(e, []); }
    },
    // ⚠️ op:'filter' ของ base55 ไม่กรองจริง → ดึงมาแล้วกรองฝั่ง client เสมอ
    filter: async function (where, sort, limit) {
      try {
        const rows = await pagedList(base, { op: 'list' }, 0);
        let out = rows.filter((r) => matchWhere(r, where || {}));
        out = sortRows(out, normSort(sort));
        if (limit && limit > 0) out = out.slice(0, limit);
        return out.map(parse);
      } catch (e) { return emptyOnMissing(e, []); }
    },
    get: async function (id) {
      const d = await entityCall(base({ op: 'get', id: id }));
      return d.row ? parse(d.row) : null;
    },
    create: async function (data) {
      const d = await entityCall(base({ op: 'create', data: encodeRow(ent, data) }));
      return d.row ? parse(d.row) : { id: d.id };
    },
    bulkCreate: async function (items) {
      const d = await entityCall(base({ op: 'create', items: (items || []).map((it) => encodeRow(ent, it)) }));
      return d.ids || (d.rows ? d.rows.map(parse) : []);
    },
    update: async function (id, data) {
      const d = await entityCall(base({ op: 'update', id: id, data: encodeRow(ent, data) }));
      return d.row ? parse(d.row) : { id: id };
    },
    delete: async function (id) {
      const d = await entityCall(base({ op: 'delete', id: id }));
      return (d.affected || 0) > 0;
    },
    count: async function (where) {
      try {
        if (where && Object.keys(where).length) {
          const rows = await this.filter(where);
          return rows.length;
        }
        const d = await entityCall(base({ op: 'count' }));
        return d.count || 0;
      } catch (e) { return emptyOnMissing(e, 0); }
    },
    schema: async function () {
      const d = await entityCall(base({ op: 'schema' }));
      return d.columns || [];
    }
  };
}

// ห้ามใช้ underscore ในชื่อ entity (base55 จะสร้างเป็นตารางใหม่ว่างเปล่า)
const ENTITY_NAMES = [
  'Song', 'LyricLine', 'StoryPart', 'Shot', 'Character', 'StyleLock',
  'LibraryAsset', 'Job', 'WorkerHeartbeat'
];
const entities = {};
ENTITY_NAMES.forEach(function (n) { entities[n] = makeEntity(n); });

async function fnPost(name, body) {
  const r = await fetch(FN + '?fn=' + encodeURIComponent(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth': token() },
    body: JSON.stringify(body || {})
  });
  let data = null; try { data = await r.json(); } catch (e) {}
  if (!r.ok && !data) { const err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
  if (data && data.error) { const err = new Error(data.error); err.status = r.status; err.data = data; throw err; }
  return { data };
}

function stripFences(t) {
  if (typeof t !== 'string') return t;
  return t.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
}
const integrations = {
  Core: {
    InvokeLLM: async function (params) {
      params = params || {};
      const { data } = await fnPost('invokeLLM', params);
      if (params.response_json_schema) {
        if (data && data.json !== undefined && data.json !== null) return data.json;
        try { return JSON.parse(stripFences((data && data.text) || '')); } catch (e) { return (data && data.text) || {}; }
      }
      if (data && typeof data.text === 'string') return data.text;
      if (data && data.json !== undefined) return data.json;
      return '';
    },
    UploadFile: async function (args) {
      const file = args && args.file;
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(FN + '?fn=uploadFile', { method: 'POST', headers: { 'X-Auth': token() }, body: fd });
      let d = null; try { d = await r.json(); } catch (e) {}
      if (!r.ok || !d || !d.file_url) { const err = new Error((d && d.error) || 'upload failed'); err.status = r.status; throw err; }
      return { file_url: d.file_url };
    }
  }
};

async function me() {
  const r = await fetch(API + '?a=me', { headers: { 'X-Auth': token() } });
  let d = null; try { d = await r.json(); } catch (e) {}
  if (!r.ok || !d || d.ok === false) { const e = new Error((d && d.error) || 'unauthorized'); e.status = r.status; throw e; }
  const u = d.user || d;
  // isOwner อยู่ระดับบนสุดของผลตอบ ?a=me ไม่ได้อยู่ใน user
  return Object.assign({
    id: u.id || u.email,
    email: u.email,
    full_name: u.full_name || u.name || u.display_name || u.email,
    name: u.name || u.full_name,
    role: u.role,
    is_owner: d.isOwner || u.isOwner || false,
    picture: u.picture
  }, u, { id: u.id || u.email });
}
async function authCall(action, body) {
  const r = await fetch(API + '?a=' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth': token() },
    body: JSON.stringify(body || {})
  });
  let d = null; try { d = await r.json(); } catch (e) {}
  if (!r.ok || !d || d.ok === false) { const e = new Error((d && d.error) || ('error ' + r.status)); e.status = r.status; e.data = d; throw e; }
  return d;
}

function googleCredential() {
  return new Promise(function (resolve, reject) {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    function start() {
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: function (resp) { resp && resp.credential ? resolve(resp.credential) : reject(new Error('ยกเลิกการเข้าสู่ระบบ Google')); }
        });
        window.google.accounts.id.prompt();
      } catch (e) { reject(e); }
    }
    if (window.google && window.google.accounts && window.google.accounts.id) return start();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = start;
    s.onerror = function () { reject(new Error('โหลด Google Sign-In ไม่สำเร็จ')); };
    document.head.appendChild(s);
  });
}

const auth = {
  me: me,
  isAuthenticated: async function () { if (!token()) return false; try { await me(); return true; } catch (e) { return false; } },
  setToken: function (t) { setStoredToken(t); },
  register: async function (arg) {
    const email = (arg && arg.email) || '';
    const password = (arg && arg.password) || '';
    const name = (arg && (arg.name || arg.full_name)) || '';
    return await authCall('register', { email: email, password: password, name: name });
  },
  verifyOtp: async function (arg) {
    const email = (arg && arg.email) || '';
    const code = (arg && (arg.otpCode || arg.code || arg.otp)) || '';
    const d = await authCall('verify', { email: email, code: code });
    if (d.token) setStoredToken(d.token);
    return Object.assign({ access_token: d.token }, d);
  },
  loginViaEmailPassword: async function (email, password) {
    const d = await authCall('login', { email: email, password: password });
    if (d.token) setStoredToken(d.token);
    return Object.assign({ access_token: d.token }, d);
  },
  loginWithProvider: async function (provider, redirect) {
    if (provider !== 'google') throw new Error('รองรับเฉพาะ Google');
    const credential = await googleCredential();
    const d = await authCall('google', { credential: credential });
    if (d.token) setStoredToken(d.token);
    if (typeof window !== 'undefined') {
      const base = (import.meta && import.meta.env && import.meta.env.BASE_URL) || '/';
      window.location.href = base.replace(/\/$/, '') + (redirect && redirect !== '/' ? redirect : '/');
    }
    return d;
  },
  // base55 ไม่มี reset password — ห้ามแสดงลิงก์ลืมรหัสผ่านใน UI
  logout: function () {
    clearToken();
    if (typeof window !== 'undefined') {
      const base = (import.meta && import.meta.env && import.meta.env.BASE_URL) || '/';
      window.location.href = base;
    }
  },
  redirectToLogin: function () {
    if (typeof window !== 'undefined') {
      const base = (import.meta && import.meta.env && import.meta.env.BASE_URL) || '/';
      window.location.href = base.replace(/\/$/, '') + '/login';
    }
  }
};

export const base44 = {
  entities: entities,
  functions: { invoke: function (name, body) { return fnPost(name, body || {}); } },
  integrations: integrations,
  auth: auth
};

export default base44;
