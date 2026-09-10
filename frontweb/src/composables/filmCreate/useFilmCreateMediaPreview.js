import { ref } from 'vue'
import { isPlaceholderMediaUrl, isSafeImagePreviewUrl, probeImageSource } from '@/utils/mediaUrl'
import { hasRealMediaValue } from '@/utils/storyboardMedia'

export function useFilmCreateMediaPreview(deps = {}) {
  const { ElMessage } = deps

  const baseUrl = ref('')
  const previewImageUrl = ref(null)
  const previewError = ref('')
  const lastPreviewSource = ref('')
  let previewImageRequestId = 0
  function imageUrl(url) {
    if (!url) return ''
    if (url.startsWith('http')) return url
    const base = (baseUrl.value || '').replace(/\/$/, '')
    return base ? base + '/' + url.replace(/^\//, '') : url
  }
  /** 优先使用本地地址，避免远程图失效。item 为 { image_url, local_path } 或字符串 url */
  function assetImageUrl(item) {
    if (!item) return ''
    if (typeof item === 'string') return isPlaceholderMediaUrl(item) ? '' : imageUrl(item)
    const localPath = item.local_path && String(item.local_path).trim()
    if (localPath && !isPlaceholderMediaUrl(localPath)) {
      const p = localPath.replace(/^\//, '')
      return '/static/' + p
    }
    if (item.image_url && !isPlaceholderMediaUrl(item.image_url)) return imageUrl(item.image_url)
    return ''
  }
  function hasAssetImage(item) {
    if (!item) return false
    return hasRealMediaValue(item.image_url) || hasRealMediaValue(item.local_path)
  }
  function describeImagePreviewFailure(source, reason) {
    if (reason === 'empty') return '当前没有可预览的图片。'
    if (reason === 'placeholder') return '这是草稿占位图，尚无可预览的真实图片。'
    if (reason === 'unsafe') return '图片地址不可用，请检查文件是否仍存在或重新生成。'
    return '图片无法加载，请检查文件是否仍存在或重新生成。'
  }
  async function openImagePreview(url) {
    const source = String(url || '').trim()
    previewError.value = ''
    if (!source || isPlaceholderMediaUrl(source)) {
      const message = describeImagePreviewFailure(source, source ? 'placeholder' : 'empty')
      previewError.value = message
      ElMessage.info(message)
      return
    }
    lastPreviewSource.value = source
    const requestId = ++previewImageRequestId
    const renderable = await probeImageSource(source)
    if (requestId !== previewImageRequestId) return
    if (!renderable) {
      const message = describeImagePreviewFailure(
        source,
        isSafeImagePreviewUrl(source) ? 'unreadable' : 'unsafe',
      )
      previewError.value = message
      ElMessage.warning(message)
      // 仍打开预览弹窗，让失败提示落在焦点管理过的对话框里。
      previewImageUrl.value = source
      return
    }
    previewImageUrl.value = source
  }
  function closeImagePreview() {
    previewImageRequestId += 1
    previewImageUrl.value = null
    previewError.value = ''
  }
  function retryImagePreview() {
    if (!lastPreviewSource.value) return Promise.resolve()
    return openImagePreview(lastPreviewSource.value)
  }
  /** 视频地址：优先 local_path（/static/），否则 video_url */
  function assetVideoUrl(item) {
    if (!item) return ''
    const localPath = item.local_path && String(item.local_path).trim()
    if (localPath && !isPlaceholderMediaUrl(localPath)) return '/static/' + localPath.replace(/^\//, '')
    if (item.video_url && !isPlaceholderMediaUrl(item.video_url)) return imageUrl(item.video_url)
    return ''
  }
  /** 远程视频须为 http(s)，避免上游 FAILURE 时把错误文案写入 video_url */
  function isHttpVideoUrl(url) {
    if (!url || typeof url !== 'string') return false
    const t = url.trim()
    return t.startsWith('http://') || t.startsWith('https://')
  }
  /** 列表项是否具备可播放地址（避免仅有空白 local_path 时外层有卡片、内层无 <video>） */
  function recordHasPlayableVideoUrl(i) {
    if (!i) return false
    const lp = i.local_path && String(i.local_path).trim()
    if (lp && !isPlaceholderMediaUrl(lp)) return true
    return isHttpVideoUrl(i.video_url)
  }
  /** 转为视频接口可请求的绝对 URL（后端/第三方需能访问） */
  function toAbsoluteImageUrl(url) {
    if (!url || !String(url).trim()) return ''
    const s = String(url).trim()
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    const base = (baseUrl.value || '').replace(/\/$/, '') || (typeof window !== 'undefined' ? window.location.origin : '')
    return base ? base + (s.startsWith('/') ? s : '/' + s) : s
  }
  return {
    baseUrl,
    previewImageUrl,
    previewError,
    lastPreviewSource,
    imageUrl,
    assetImageUrl,
    hasAssetImage,
    openImagePreview,
    closeImagePreview,
    retryImagePreview,
    assetVideoUrl,
    isHttpVideoUrl,
    recordHasPlayableVideoUrl,
    toAbsoluteImageUrl,
  }
}
