// ตัวช่วยแปลงเวลา/ตัวเลขของ Mmusic

// 7.78 → "0:07.8"
export function fmtSec(sec) {
  if (sec === null || sec === undefined || isNaN(Number(sec))) return '-';
  const s = Number(sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}

// 354.02 → "5:54"
export function fmtDuration(sec) {
  if (!sec || isNaN(Number(sec))) return '-';
  const s = Math.round(Number(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// "01_04" จากชื่อไฟล์ เช่น "01_04.png" หรือ "01_04 (1).png" → "01_04" (คืน null ถ้าไม่ตรง)
export function fileKeyFromName(name) {
  if (!name) return null;
  const m = String(name).match(/^(\d{2}_\d{2})\b/);
  return m ? m[1] : null;
}

export function partTitleTh(n) {
  return 'ภาค ' + n;
}
