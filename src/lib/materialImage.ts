import { validateMaterialImage } from '../model/appearance';

/** Decode and re-encode locally: discard EXIF, bound GPU size, reject disguised SVG. */
export async function importMaterialImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10_000_000 || file.size === 0) throw new Error('בחרו PNG/JPEG/WebP עד 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64_000_000) throw new Error('התמונה גדולה מדי לפענוח בטוח.');
    const canvas = document.createElement('canvas'), ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('לא ניתן לעבד תמונה בדפדפן.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.85, .65, .45, .25]) {
      const image = canvas.toDataURL('image/webp', quality);
      if (image.length <= 240_000) return validateMaterialImage(image);
    }
    throw new Error('התמונה מפורטת מדי; הקטינו אותה ונסו שוב.');
  } finally { bitmap.close(); }
}