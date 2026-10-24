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
    // On-phone blur/blank check on the shrunk canvas. Skipped where getImageData
    // is unavailable; no pixels leave the device for this measurement.
    const sharpness = typeof context.getImageData === 'function' ? laplacianVariance(context, w, h) : null
    // Re-encoding through a canvas also drops EXIF metadata (incl. any GPS tags) from the upload.
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((out) => {
        if (!out?.size) reject(new Error('We could not prepare this photo. Take another photo and try again.'))
        else resolve(out)
      }, 'image/jpeg', quality)
    })
    // Attach the measurement so callers (Snap) can warn on blurry/blank photos
    // without a second decode. The return is still a Blob, so uploads are unchanged.
    try { blob.sharpness = sharpness } catch { /* some Blob impls are frozen; ignore */ }
    return blob
  } finally {
    bitmap.close?.()
  }
}

// Variance of the Laplacian on the 512px grayscale canvas: a cheap on-phone blur/blank
// detector. Low values mean the photo is out of focus or featureless (blank wall), so we
// ask the user to retry instead of uploading something that cannot match. No pixels leave
// the device for this check.
export function laplacianVariance(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h)
  const gray = new Float64Array(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const lap = gray[p - 1] + gray[p + 1] + gray[p - w] + gray[p + w] - 4 * gray[p]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

// Below this variance the 512px photo is too blurry or too blank to match reliably.
export const BLUR_THRESHOLD = 12
