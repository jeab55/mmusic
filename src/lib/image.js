// สร้างภาพย่อ 480px (ด้านกว้าง) จากไฟล์ภาพ ฝั่ง browser — คืน { blob, width, height, orientation }
export async function makeThumb(file, maxW = 480) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  const ratio = bmp.width / bmp.height;
  const orientation = ratio > 1.1 ? 'แนวนอน' : ratio < 0.9 ? 'แนวตั้ง' : 'จัตุรัส';
  return { blob, width: bmp.width, height: bmp.height, orientation, ratio };
}

// ภาพเป็นแนวนอน 16:9 หรือใกล้เคียงไหม (ห่างเกิน 15% ถือว่าเตือน)
export function isLandscape169(ratio) {
  return Math.abs(ratio - 16 / 9) / (16 / 9) <= 0.15 && ratio > 1;
}
