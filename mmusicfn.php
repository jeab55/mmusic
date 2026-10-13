<?php
/* ============================================================================
   mmusicfn.php — base55 backend สำหรับ "Mmusic" (วิดีโอเพลงแบบนิยายภาพ)
   วางไฟล์บนโฮสต์ mplus.thinkpowers.com ที่ public_html/mmusicfn.php
   (อัปผ่าน hPanel File Manager เท่านั้น — มี SQL, การเขียนไฟล์ผ่าน API โดน WAF บล็อก)
   - ตรวจ base55 token (X-Auth) · dispatch ด้วย ?fn=<name>
   - entity ของแอปอยู่ DB b55_mmusic (ไฟล์นี้สร้างตารางให้เองถ้ายังไม่มี)
   - URL ของไฟล์อัปโหลดคำนวณจากตำแหน่งสคริปต์เอง (ไม่ผูกกับโดเมน)

   functions:
     me · uploadFile · invokeLLM · importManifest            (เฟส 1)
     libraryUpsert                                            (เฟส 2)
     heartbeat · jobPoll · jobUpdate · shotsForPull · markSynced  (เฟส 3 — ฝั่ง worker)
============================================================================ */
$cfg = __DIR__ . '/config.php';
if (file_exists($cfg)) { require $cfg; }
// ค่าสำรองถ้า config.php ไม่มี (ปกติ mplus มี config.php ของ base55 อยู่แล้ว)
if (!defined('DB_HOST')) { http_response_code(500); echo json_encode(['error' => 'missing config.php']); exit; }

@ignore_user_abort(true);
@set_time_limit(300);
header('Content-Type: application/json; charset=utf-8');

$APP_SLUG = 'mmusic';
$APP_DB   = 'b55_mmusic';
$AUTH_DB  = 'b55_base55';   // ฐาน users/tokens ของ base55 บนโฮสต์นี้

// เจ้าของระบบ (ใช้กับ fn ฝั่ง worker เท่านั้น) — ไม่ใช่ข้อมูลลับ เป็นตัวระบุบัญชี
$OWNER_EMAILS = ['taweesak.tur@gmail.com'];

/* ---------- origin ของสคริปต์ตัวเอง (สำหรับ URL ไฟล์อัปโหลด) ---------- */
function self_origin() {
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  return ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}
$SCRIPT_BASE = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/');   // '' ถ้าอยู่ docroot
$UPLOAD_DIR = __DIR__ . '/uploads/' . $APP_SLUG;
$UPLOAD_URL = self_origin() . $SCRIPT_BASE . '/uploads/' . $APP_SLUG;
$AIAPI = self_origin() . $SCRIPT_BASE . '/aiapi.php';

/* ---------- CORS (*.thinkpowers.com / *.thinkpowers.site + apex) ---------- */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (preg_match('#^https://([a-z0-9-]+\.)*thinkpowers\.(com|site)$#', $origin)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Access-Control-Allow-Headers: Content-Type, X-Auth');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') exit;

function jout($x, $code = 200) { http_response_code($code); echo json_encode($x, JSON_UNESCAPED_UNICODE); exit; }
function jerr($msg, $code = 400) { jout(['error' => $msg], $code); }

/* ---------- DB ---------- */
function cdb($db) {
  static $pools = [];
  if (isset($pools[$db])) return $pools[$db];
  $pools[$db] = new PDO('mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . $db . ';charset=utf8mb4', DB_USER, DB_PASS,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
  return $pools[$db];
}
function mdb() {
  global $APP_DB;
  static $c = null;
  if ($c) return $c;
  $root = new PDO('mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';charset=utf8mb4', DB_USER, DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
  $root->exec('CREATE DATABASE IF NOT EXISTS `' . $APP_DB . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  $c = cdb($APP_DB);
  ensure_tables($c);
  return $c;
}
function qi($name) { return '`' . preg_replace('/[^a-zA-Z0-9_]/', '', (string)$name) . '`'; }

/* ---------- สคีมาตาราง (ตรงกับ adapter ฝั่งเว็บ) ---------- */
function ensure_tables($db) {
  static $done = false;
  if ($done) return;
  $done = true;
  $base = 'id INT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(190) DEFAULT "",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP';
  $tables = [
    'song' => 'title VARCHAR(500), story_title VARCHAR(500), duration_sec DOUBLE, audio_url TEXT, lyrics_raw MEDIUMTEXT,
      images_per_min INT DEFAULT 20, drive_folder VARCHAR(500), cover_url TEXT, step_status TEXT,
      video_16x9_url TEXT, video_9x16_url TEXT, is_deleted TINYINT DEFAULT 0',
    'lyricline' => 'song_id INT, idx INT, section VARCHAR(100), text_roman TEXT, text_th TEXT, start_sec DOUBLE, end_sec DOUBLE',
    'storypart' => 'song_id INT, part_no INT, title VARCHAR(500), story_text MEDIUMTEXT, line_idx_list TEXT',
    'shot' => 'song_id INT, seq_no INT, part_no INT, slot_no INT, file_key VARCHAR(20), t0 DOUBLE, t1 DOUBLE,
      lyric_text TEXT, beat_th TEXT, source VARCHAR(20), library_asset_id INT, library_path TEXT,
      scene_en MEDIUMTEXT, generation_prompt MEDIUMTEXT, ref_ids TEXT, image_url TEXT, thumb_url TEXT,
      status VARCHAR(30), qa_note TEXT, synced_to_pc TINYINT DEFAULT 0',
    'character' => 'song_id INT, name VARCHAR(300), role VARCHAR(300), appearance_th TEXT, lock_en TEXT,
      ref_key VARCHAR(50), ref_image_url TEXT, shared TINYINT DEFAULT 0',
    'stylelock' => 'song_id INT, rendering TEXT, forbidden TEXT, `references` TEXT, approved TINYINT DEFAULT 0, approved_at VARCHAR(40)',
    'libraryasset' => 'path VARCHAR(500), folder VARCHAR(300), name_th VARCHAR(500), w INT, h INT,
      orientation VARCHAR(30), thumb_url TEXT, license VARCHAR(200), credit TEXT, used_count INT DEFAULT 0, tags TEXT',
    'job' => 'type VARCHAR(30), song_id INT, params TEXT, status VARCHAR(20), progress DOUBLE DEFAULT 0,
      log_tail MEDIUMTEXT, result TEXT, worker_id VARCHAR(100), started_at VARCHAR(40), finished_at VARCHAR(40)',
    'workerheartbeat' => 'worker_id VARCHAR(100), last_seen VARCHAR(40), gpu VARCHAR(200), state VARCHAR(20), current_job_id INT',
    'mmusic_user_keys' => null, // สร้างแยกใน keys_table() (มี PK ของตัวเอง)
  ];
  foreach ($tables as $t => $cols) {
    if ($cols === null) continue;
    $db->exec('CREATE TABLE IF NOT EXISTS ' . qi($t) . " ($base, $cols) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  }
}

/* ---------- auth ---------- */
$auth = $_SERVER['HTTP_X_AUTH'] ?? '';
function b55_user($token) {
  global $AUTH_DB;
  if (!$token) return null;
  try {
    $st = cdb($AUTH_DB)->prepare('SELECT u.email, u.name FROM tokens t JOIN users u ON u.email = t.email WHERE t.token = ? LIMIT 1');
    $st->execute([$token]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
  } catch (Exception $e) { return null; }
}
$USER = b55_user($auth);
$EMAIL = $USER['email'] ?? '';

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) $in = [];
$fn = $_GET['fn'] ?? ($in['fn'] ?? '');

function require_login() { global $USER; if (!$USER) jerr('กรุณาเข้าสู่ระบบก่อน', 401); }
function require_owner() {
  global $USER, $EMAIL, $OWNER_EMAILS;
  require_login();
  $isOwner = in_array($EMAIL, $OWNER_EMAILS, true);
  if (!$isOwner) {
    try { // เผื่อ users มีคอลัมน์ role
      $st = cdb('b55_base55')->prepare('SELECT role FROM users WHERE email = ? LIMIT 1');
      $st->execute([$EMAIL]);
      $r = $st->fetch(PDO::FETCH_ASSOC);
      if ($r && ($r['role'] === 'owner' || $r['role'] === 'admin')) $isOwner = true;
    } catch (Exception $e) {}
  }
  if (!$isOwner) jerr('ฟังก์ชันนี้สำหรับเจ้าของระบบเท่านั้น', 403);
}

/* ---------- per-user OpenAI key (โหมดเดียวกับ Mnovel) ---------- */
function keys_table() {
  $db = mdb();
  $db->exec('CREATE TABLE IF NOT EXISTS `mmusic_user_keys` (
    user_email VARCHAR(190) PRIMARY KEY,
    openai_api_key TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4');
  return $db;
}
function get_user_openai_key($email) {
  if (!$email) return '';
  try {
    $st = keys_table()->prepare('SELECT openai_api_key FROM mmusic_user_keys WHERE user_email = ? LIMIT 1');
    $st->execute([$email]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return $r ? (string)$r['openai_api_key'] : '';
  } catch (Exception $e) { return ''; }
}

/* ---------- HTTP helper ---------- */
function http_json($url, $payload, $headers = [], $timeout = 180) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => $timeout,
    CURLOPT_SSL_VERIFYPEER => false,
  ]);
  $res = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  return ['code' => $code, 'body' => $res, 'err' => $err, 'json' => json_decode($res ?? '', true)];
}

/* ---------- InvokeLLM (user key → OpenAI ตรง · ไม่มี key → aiapi.php?a=appai) ---------- */
function strip_fences($t) {
  if (!is_string($t)) return $t;
  $t = preg_replace('/^```[a-zA-Z]*\s*/', '', trim($t));
  return trim(preg_replace('/```$/', '', trim($t)));
}
function map_openai_model($m) {
  $m = strtolower((string)$m);
  if ($m === '') return 'gpt-4o';
  if (strpos($m, 'mini') !== false || strpos($m, 'flash') !== false || strpos($m, 'turbo') !== false || strpos($m, 'haiku') !== false) return 'gpt-4o-mini';
  return 'gpt-4o';
}
function invoke_llm($params, $email, $authToken) {
  global $AIAPI;
  $prompt = (string)($params['prompt'] ?? '');
  $schema = $params['response_json_schema'] ?? null;
  $temperature = isset($params['temperature']) ? floatval($params['temperature']) : 0.7;
  $maxTok = intval($params['max_tokens'] ?? 4096);
  if ($maxTok < 256) $maxTok = 4096;

  $sys = 'You are a helpful assistant for Thai music-video storyboarding (นิยายภาพประกอบเพลง). Respond in the same language as the prompt.';
  $userPrompt = $prompt;
  if ($schema) {
    $sys .= ' You must respond with ONLY valid minified JSON that conforms to the given JSON schema. No markdown, no explanation.';
    $userPrompt .= "\n\n[JSON SCHEMA]\n" . json_encode($schema, JSON_UNESCAPED_UNICODE) . "\n\nตอบเป็น JSON ที่ถูกต้องตาม schema เท่านั้น";
  }

  $userKey = get_user_openai_key($email);
  $text = '';
  if ($userKey) {
    $body = [
      'model' => map_openai_model($params['model'] ?? ''),
      'messages' => [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $userPrompt]],
      'temperature' => $temperature,
      'max_tokens' => $maxTok,
    ];
    if ($schema) $body['response_format'] = ['type' => 'json_object'];
    $r = http_json('https://api.openai.com/v1/chat/completions', $body, ['Authorization: Bearer ' . $userKey], 200);
    if ($r['code'] >= 200 && $r['code'] < 300 && isset($r['json']['choices'][0]['message']['content'])) {
      $text = $r['json']['choices'][0]['message']['content'];
    } else {
      return ['error' => ($r['json']['error']['message'] ?? ('OpenAI error ' . $r['code']))];
    }
  } else {
    $r = http_json($AIAPI . '?a=appai', [
      'prompt' => $userPrompt, 'system' => $sys,
      'app_id' => 'mmusic', 'max_tokens' => $maxTok, 'temperature' => $temperature,
    ], ['X-Auth: ' . $authToken], 200);
    if (isset($r['json']['ok']) && $r['json']['ok'] && isset($r['json']['text'])) {
      $text = $r['json']['text'];
    } else {
      return ['error' => ($r['json']['error'] ?? ('AI error ' . $r['code']))];
    }
  }

  $out = ['text' => $text];
  if ($schema) {
    $parsed = json_decode(strip_fences($text), true);
    if ($parsed === null && preg_match('/\{[\s\S]*\}/', $text, $m)) $parsed = json_decode($m[0], true);
    $out['json'] = $parsed;
  }
  return $out;
}

/* ---------- helper: insert แถวพร้อม user_email ---------- */
function insert_row($table, $data, $email) {
  $data['user_email'] = $email;
  $cols = array_keys($data);
  $sql = 'INSERT INTO ' . qi($table) . ' (' . implode(',', array_map('qi', $cols)) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')';
  $vals = array_map(function ($v) {
    if (is_array($v) || is_object($v)) return json_encode($v, JSON_UNESCAPED_UNICODE);
    if (is_bool($v)) return $v ? 1 : 0;
    return $v;
  }, array_values($data));
  mdb()->prepare($sql)->execute($vals);
  return intval(mdb()->lastInsertId());
}

/* =====================================================================
   DISPATCH
   ===================================================================== */
switch ($fn) {

  case 'me':
    require_login();
    jout(['user' => ['id' => $EMAIL, 'email' => $EMAIL, 'full_name' => $USER['name'] ?? $EMAIL, 'name' => $USER['name'] ?? '']]);

  /* --- UploadFile (multipart) → { file_url } --- */
  case 'uploadFile': {
    require_login();
    if (empty($_FILES['file'])) jerr('ไม่มีไฟล์');
    if (!is_dir($UPLOAD_DIR)) @mkdir($UPLOAD_DIR, 0755, true);
    $f = $_FILES['file'];
    if ($f['size'] > 40 * 1024 * 1024) jerr('ไฟล์ใหญ่เกิน 40MB');
    $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
    $ext = preg_replace('/[^a-z0-9]/', '', $ext);
    $allowed = ['png','jpg','jpeg','webp','mp3','wav','json','md','txt'];
    if (!in_array($ext, $allowed)) jerr('ไฟล์ชนิด .' . $ext . ' ไม่ได้รับอนุญาต');
    $name = 'up_' . date('Ymd_His') . '_' . substr(md5($f['name'] . mt_rand()), 0, 8) . '.' . $ext;
    if (!@move_uploaded_file($f['tmp_name'], $UPLOAD_DIR . '/' . $name)) jerr('อัปโหลดไม่สำเร็จ', 500);
    jout(['file_url' => $UPLOAD_URL . '/' . $name]);
  }

  /* --- invokeLLM (เฟส 4) --- */
  case 'invokeLLM': {
    require_login();
    jout(invoke_llm($in, $EMAIL, $auth));
  }

  /* --- importManifest: สร้าง Song + StoryPart + Shot (+Character/StyleLock) ใน transaction เดียว --- */
  case 'importManifest': {
    require_login();
    $song = $in['song'] ?? null;
    $shots = $in['shots'] ?? [];
    if (!$song || !is_array($shots) || count($shots) === 0) jerr('ข้อมูลนำเข้าไม่ครบ');
    $db = mdb();
    $db->beginTransaction();
    try {
      $songId = insert_row('song', $song, $EMAIL);
      $nParts = 0;
      foreach (($in['parts'] ?? []) as $p) {
        insert_row('storypart', [
          'song_id' => $songId, 'part_no' => intval($p['part_no'] ?? 0),
          'title' => (string)($p['title'] ?? ''), 'story_text' => (string)($p['story_text'] ?? ''),
          'line_idx_list' => json_encode($p['line_idx_list'] ?? [], JSON_UNESCAPED_UNICODE),
        ], $EMAIL);
        $nParts++;
      }
      foreach ($shots as $s) {
        $s['song_id'] = $songId;
        insert_row('shot', $s, $EMAIL);
      }
      $nChars = 0;
      foreach (($in['characters'] ?? []) as $c) {
        insert_row('character', [
          'song_id' => $songId,
          'name' => (string)($c['name'] ?? ''), 'role' => (string)($c['role'] ?? ''),
          'appearance_th' => (string)($c['appearance_th'] ?? ''), 'lock_en' => (string)($c['lock_en'] ?? ''),
          'ref_key' => (string)($c['id'] ?? ''), 'ref_image_url' => '',
          'shared' => !empty($c['shared']) ? 1 : 0,
        ], $EMAIL);
        $nChars++;
      }
      $sl = $in['styleLock'] ?? null;
      if ($sl && is_array($sl)) {
        $past = $sl['past'] ?? [];
        insert_row('stylelock', [
          'song_id' => $songId,
          'rendering' => (string)($past['rendering'] ?? ''),
          'forbidden' => json_encode($past['forbidden'] ?? [], JSON_UNESCAPED_UNICODE),
          'references' => json_encode($sl['references'] ?? [], JSON_UNESCAPED_UNICODE),
          'approved' => 0, 'approved_at' => '',
        ], $EMAIL);
      }
      $db->commit();
      jout(['song_id' => $songId, 'shots' => count($shots), 'parts' => $nParts, 'characters' => $nChars]);
    } catch (Exception $e) {
      $db->rollBack();
      jerr('นำเข้าไม่สำเร็จ: ' . $e->getMessage(), 500);
    }
  }

  /* --- libraryUpsert (worker ส่งทีละ ~100) --- */
  case 'libraryUpsert': {
    require_owner();
    $items = $in['items'] ?? [];
    if (!is_array($items)) jerr('items ต้องเป็น array');
    $db = mdb();
    $sel = $db->prepare('SELECT id FROM `libraryasset` WHERE path = ? LIMIT 1');
    $ins = 0; $upd = 0;
    foreach ($items as $it) {
      $path = (string)($it['path'] ?? '');
      if ($path === '') continue;
      $sel->execute([$path]);
      $row = $sel->fetch(PDO::FETCH_ASSOC);
      $data = [
        'path' => $path, 'folder' => (string)($it['folder'] ?? ''), 'name_th' => (string)($it['name_th'] ?? ''),
        'w' => intval($it['w'] ?? 0), 'h' => intval($it['h'] ?? 0), 'orientation' => (string)($it['orientation'] ?? ''),
        'thumb_url' => (string)($it['thumb_url'] ?? ''), 'license' => (string)($it['license'] ?? ''),
        'credit' => (string)($it['credit'] ?? ''),
        'tags' => is_string($it['tags'] ?? null) ? $it['tags'] : json_encode($it['tags'] ?? [], JSON_UNESCAPED_UNICODE),
      ];
      if ($row) {
        $sets = implode(',', array_map(function ($k) { return qi($k) . '=?'; }, array_keys($data)));
        $db->prepare('UPDATE `libraryasset` SET ' . $sets . ' WHERE id = ?')
           ->execute(array_merge(array_values($data), [$row['id']]));
        $upd++;
      } else {
        $data['used_count'] = 0;
        insert_row('libraryasset', $data, $EMAIL);
        $ins++;
      }
    }
    jout(['inserted' => $ins, 'updated' => $upd]);
  }

  /* --- heartbeat (worker ทุก 30 วิ) --- */
  case 'heartbeat': {
    require_owner();
    $wid = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($in['worker_id'] ?? ''));
    if (!$wid) jerr('missing worker_id');
    $db = mdb();
    $sel = $db->prepare('SELECT id FROM `workerheartbeat` WHERE worker_id = ? LIMIT 1');
    $sel->execute([$wid]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    $data = [
      'worker_id' => $wid,
      'last_seen' => gmdate('c'),
      'gpu' => (string)($in['gpu'] ?? ''),
      'state' => (string)($in['state'] ?? 'idle'),
      'current_job_id' => intval($in['current_job_id'] ?? 0),
    ];
    if ($row) {
      $db->prepare('UPDATE `workerheartbeat` SET last_seen=?, gpu=?, state=?, current_job_id=? WHERE id=?')
         ->execute([$data['last_seen'], $data['gpu'], $data['state'], $data['current_job_id'], $row['id']]);
    } else {
      insert_row('workerheartbeat', $data, $EMAIL);
    }
    jout(['ok' => true]);
  }

  /* --- jobPoll: จองงานแบบ atomic --- */
  case 'jobPoll': {
    require_owner();
    $wid = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($in['worker_id'] ?? ''));
    $types = $in['types'] ?? [];
    if (!$wid || !is_array($types) || !count($types)) jerr('missing worker_id/types');
    $types = array_values(array_filter(array_map(function ($t) { return preg_replace('/[^a-z_]/', '', (string)$t); }, $types)));
    $inSql = implode(',', array_fill(0, count($types), '?'));
    $db = mdb();
    $claim = $db->prepare(
      "UPDATE `job` SET status='running', worker_id=?, started_at=? WHERE id = (
        SELECT id FROM (SELECT id FROM `job` WHERE status='queued' AND type IN ($inSql) ORDER BY id LIMIT 1) x
      )"
    );
    $claim->execute(array_merge([$wid, gmdate('c')], $types));
    if ($claim->rowCount() === 0) jout(['job' => null]);
    $st = $db->prepare("SELECT * FROM `job` WHERE worker_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1");
    $st->execute([$wid]);
    $job = $st->fetch(PDO::FETCH_ASSOC);
    if ($job && isset($job['params'])) { $p = json_decode($job['params'], true); if ($p !== null) $job['params'] = $p; }
    jout(['job' => $job ?: null]);
  }

  /* --- jobUpdate --- */
  case 'jobUpdate': {
    require_owner();
    $id = intval($in['id'] ?? 0);
    if (!$id) jerr('missing id');
    $sets = []; $vals = [];
    foreach (['progress', 'log_tail', 'status'] as $k) {
      if (array_key_exists($k, $in)) { $sets[] = qi($k) . '=?'; $vals[] = $in[$k]; }
    }
    if (array_key_exists('result', $in)) { $sets[] = 'result=?'; $vals[] = is_string($in['result']) ? $in['result'] : json_encode($in['result'], JSON_UNESCAPED_UNICODE); }
    if (in_array($in['status'] ?? '', ['done', 'error', 'cancelled'])) { $sets[] = 'finished_at=?'; $vals[] = gmdate('c'); }
    if (!$sets) jerr('nothing to update');
    $vals[] = $id;
    mdb()->prepare('UPDATE `job` SET ' . implode(',', $sets) . ' WHERE id = ?')->execute($vals);
    jout(['ok' => true]);
  }

  /* --- shotsForPull: Shot ที่มี image_url แต่ยังไม่ลง PC --- */
  case 'shotsForPull': {
    require_owner();
    $sid = intval($in['song_id'] ?? 0);
    if (!$sid) jerr('missing song_id');
    $st = mdb()->prepare("SELECT id, file_key, part_no, image_url FROM `shot` WHERE song_id = ? AND image_url != '' AND synced_to_pc = 0");
    $st->execute([$sid]);
    jout(['shots' => $st->fetchAll(PDO::FETCH_ASSOC)]);
  }

  /* --- markSynced --- */
  case 'markSynced': {
    require_owner();
    $ids = $in['ids'] ?? [];
    if (!is_array($ids) || !count($ids)) jerr('missing ids');
    $ids = array_map('intval', $ids);
    mdb()->prepare('UPDATE `shot` SET synced_to_pc = 1 WHERE id IN (' . implode(',', $ids) . ')')->execute();
    jout(['ok' => true, 'count' => count($ids)]);
  }

  default:
    jerr('unknown function: ' . $fn, 404);
}
