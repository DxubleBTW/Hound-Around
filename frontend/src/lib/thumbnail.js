// Turn a picked image into a small JPEG for a saved spot. Re-drawing it on a
// canvas also drops the file's hidden metadata (EXIF, including any GPS tags).
export async function makeThumbnail(file, max = 480, quality = 0.72) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose a photo (JPEG, PNG or HEIC).')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', quality)
}
