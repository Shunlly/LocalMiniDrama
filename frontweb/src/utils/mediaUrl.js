/** 统一媒体 URL：优先 local_path，其次 image_url / video_url */
export function isPlaceholderMediaUrl(value) {
  const text = String(value || '').trim().toLowerCase()
  return text.startsWith('mock://') || text.startsWith('placeholder://')
}

export function isSafeImagePreviewUrl(value) {
  const text = String(value || '').trim()
  if (!text || isPlaceholderMediaUrl(text) || /[\u0000-\u001f\u007f]/.test(text)) return false
  if (/^data:/i.test(text)) {
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(text)
  }
  if (/^blob:/i.test(text)) return true
  if (/^https?:/i.test(text)) {
    try {
      const parsed = new URL(text)
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
    } catch (_) {
      return false
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return false
  return text.startsWith('/') || /[\\/]/.test(text) || /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(text)
}

export function imageHasRenderableDimensions(image) {
  return Number(image?.naturalWidth) > 0 && Number(image?.naturalHeight) > 0
}

export function probeImageSource(value, options = {}) {
  const source = String(value || '').trim()
  if (!isSafeImagePreviewUrl(source)) return Promise.resolve(false)
  const createImage = options.createImage || (() => new globalThis.Image())
  if (typeof createImage !== 'function' || (typeof globalThis.Image !== 'function' && !options.createImage)) {
    return Promise.resolve(false)
  }
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 10000)

  return new Promise((resolve) => {
    let settled = false
    const image = createImage()
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      resolve(result)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    image.onload = () => finish(imageHasRenderableDimensions(image))
    image.onerror = () => finish(false)
    image.src = source
  })
}

export function assetImageUrl(item) {
  if (!item) return ''
  const lp = item.local_path && String(item.local_path).trim()
  if (lp && !isPlaceholderMediaUrl(lp)) return '/static/' + lp.replace(/^\//, '')
  return isPlaceholderMediaUrl(item.image_url) ? '' : (item.image_url || '')
}

export function storyboardImageUrl(sb) {
  if (!sb) return ''
  const local = assetImageUrl({ local_path: sb.local_path })
  if (local) return local
  const composed = assetImageUrl({ image_url: sb.composed_image })
  if (composed) return composed
  return assetImageUrl({ image_url: sb.image_url })
}

export function storyboardVideoUrl(sb) {
  if (!sb) return ''
  const lp = sb.video_local_path && String(sb.video_local_path).trim()
  if (lp && !isPlaceholderMediaUrl(lp)) return '/static/' + lp.replace(/^\//, '')
  const remote = String(sb.video_url || '').trim()
  return isPlaceholderMediaUrl(remote) ? '' : remote
}

export function audioUrl(localPath) {
  if (!localPath) return ''
  const p = String(localPath).trim()
  if (!p) return ''
  if (isPlaceholderMediaUrl(p)) return ''
  return '/static/' + p.replace(/^\//, '')
}
