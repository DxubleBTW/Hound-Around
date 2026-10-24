// Shrink a camera photo to ~512px on the long side before upload (brief: keeps uploads fast on event Wi-Fi).
// Honors EXIF orientation. Never reads location; the photo is the only input.
export async function shrinkImage(file, maxSide = 512, quality = 0.85) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  // Re-encoding through a canvas also drops EXIF metadata (incl. any GPS tags) from the upload.
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}
