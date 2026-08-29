const MAX_EDGE = 1920
const QUALITY = 0.8

export function isImageFile(file) {
  return file instanceof File && file.type.startsWith('image/')
}

export function scaledDimensions(width, height, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const ratio = maxEdge / longest
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

// createImageBitmap is fastest, but some mobile browsers reject formats
// (e.g. HEIC) there that they can still decode via an <img> element.
async function decodeImage(file) {
  try {
    return await createImageBitmap(file)
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } catch {
      throw new Error('not-an-image')
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

// Resize to maxEdge on the longest side and re-encode as JPEG.
export async function compressImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  if (!isImageFile(file)) throw new Error('not-an-image')

  const source = await decodeImage(file)
  try {
    const srcW = source.naturalWidth ?? source.width
    const srcH = source.naturalHeight ?? source.height
    const { width, height } = scaledDimensions(srcW, srcH, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(source, 0, 0, width, height)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('compress-failed'))),
        'image/jpeg',
        quality,
      )
    })
    return blob
  } finally {
    source.close?.()
  }
}
