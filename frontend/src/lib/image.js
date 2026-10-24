// Shrink a camera photo to ~512px on the long side before upload (brief: keeps uploads fast on event Wi-Fi).
// Honors EXIF orientation. Never reads location; the photo is the only input.
export async function shrinkImage(file, maxSide = 512, quality = 0.85) {
  if (!file || !file.size) throw new Error('This photo is empty. Take another photo.')
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('We could not open this photo. Try another photo or a JPEG or PNG file.')
  }
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('This photo has no image. Take another photo.')
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Photo preparation is unavailable. Try again or use another browser.')
    context.drawImage(bitmap, 0, 0, w, h)
    // Re-encoding through a canvas also drops EXIF metadata (incl. any GPS tags) from the upload.
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob?.size) reject(new Error('We could not prepare this photo. Take another photo and try again.'))
        else resolve(blob)
      }, 'image/jpeg', quality)
    })
  } finally {
    bitmap.close?.()
  }
}
