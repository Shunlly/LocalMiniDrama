import { ref, reactive, computed, watch } from 'vue'
import {
  buildDeliveryFilename as buildDeliveryFilenameFromParts,
  buildEpisodeVideoFilename,
  fetchVerifiedVideoBlob,
  friendlyVideoDownloadError,
  normalizeVideoDownloadFilenamePart,
  triggerBlobDownload,
  validateDeliveryBlob,
} from '@/utils/filmCreateDelivery'
import { isPlaceholderMediaUrl } from '@/utils/mediaUrl'
import { isUserFacingAbort, toUserFacingError } from '@/utils/userFacingError'

function readHttpStatus(error) {
  const status = Number(error?.status || error?.response?.status)
  return Number.isInteger(status) && status > 0 ? status : 0
}

function friendlySubtitleExportError(error) {
  if (isUserFacingAbort(error)) return '字幕下载已取消。'
  const status = readHttpStatus(error)
  const raw = String(error?.message || '')
  if (status === 404 || /没有可导出的字幕/.test(raw)) {
    return '字幕下载失败，可能是本集还没有可导出的字幕。'
  }
  if (/未返回文件|为空/.test(raw)) return '字幕文件为空，未下载任何文件。'
  if (/错误信息/.test(raw)) return '字幕接口返回了错误信息，未下载任何文件。'
  if (/超时/.test(raw) || error?.isTimeout) return '字幕下载超时，请稍后重试。'
  return toUserFacingError(error, '字幕下载失败，可能是本集还没有可导出的字幕。', {
    serviceLabel: '字幕导出',
  })
}

function friendlyProjectExportError(error) {
  if (isUserFacingAbort(error)) return '项目包导出已取消。'
  const raw = String(error?.message || '')
  if (/格式无效/.test(raw)) return '项目包格式无效，未下载任何文件。'
  if (/未返回文件|为空/.test(raw)) return '项目包为空，未下载任何文件。'
  if (/错误信息/.test(raw)) return '项目包接口返回了错误信息，未下载任何文件。'
  if (/超时/.test(raw) || error?.isTimeout) return '项目包导出超时，请稍后重试。'
  return toUserFacingError(error, '项目包导出失败，请检查本地服务后重试。', {
    serviceLabel: '项目包导出',
  })
}

export function useFilmCreateDeliveryActions(deps = {}) {
  const {
    store,
    ElMessage,
    dramaId,
    currentEpisode,
    currentEpisodeId,
    storyboards,
    videoStatus,
    videoProgress,
    timelinesAPI,
    dramaAPI,
  } = deps
  /** 当前集合成视频的播放地址（用于按钮下方预览） */
  const currentEpisodeVideoUrl = computed(() => {
    const url = currentEpisode.value?.video_url
    if (!url || !String(url).trim()) return ''
    const s = String(url).trim()
    if (isPlaceholderMediaUrl(s)) return ''
    if (s.startsWith('http://') || s.startsWith('https://')) return s
    if (s.startsWith('/static/')) return s
    return '/static/' + s.replace(/^\//, '')
  })
  const deliveryCompositeStatusLabel = computed(() => {
    if (videoStatus.value === 'generating') return `${videoProgress.value}%`
    if (currentEpisodeVideoUrl.value) return '已就绪'
    if (videoStatus.value === 'error') return '合成失败'
    return '待合成'
  })
  const deliverySubtitleAvailable = computed(() => storyboards.value.some((storyboard) => (
    [storyboard?.dialogue, storyboard?.narration, storyboard?.action]
      .some((value) => Boolean(String(value || '').trim()))
  )))
  const deliveryFileCount = computed(() => (
    1 + (deliverySubtitleAvailable.value ? 1 : 0) + (currentEpisodeVideoUrl.value ? 1 : 0)
  ))

  const videoDownloadStatus = ref('idle')
  const videoDownloadError = ref('')

  async function downloadCurrentEpisodeVideo() {
    if (videoDownloadStatus.value === 'downloading') return
    videoDownloadStatus.value = 'downloading'
    videoDownloadError.value = ''
    try {
      const blob = await fetchVerifiedVideoBlob(currentEpisodeVideoUrl.value)
      const filename = buildEpisodeVideoFilename(
        store.drama?.title,
        currentEpisode.value?.episode_number,
        blob,
      )
      triggerBlobDownload(blob, filename)
      videoDownloadStatus.value = 'success'
      ElMessage.success('成片下载已完成')
    } catch (error) {
      videoDownloadError.value = friendlyVideoDownloadError(error)
      videoDownloadStatus.value = 'error'
      ElMessage.error(videoDownloadError.value)
    }
  }

  const deliveryExportStatus = reactive({ subtitle: 'idle', project: 'idle' })
  const deliveryExportError = ref('')
  const deliveryExportHasError = computed(() => (
    deliveryExportStatus.subtitle === 'error' || deliveryExportStatus.project === 'error'
  ))
  const deliveryExportFeedback = computed(() => {
    if (deliveryExportHasError.value) return deliveryExportError.value
    if (deliveryExportStatus.subtitle === 'success') return '字幕下载已完成。'
    if (deliveryExportStatus.project === 'success') return '项目包导出已完成。'
    return ''
  })

  function buildDeliveryFilename(suffix, extension) {
    return buildDeliveryFilenameFromParts(
      store.drama?.title,
      currentEpisode.value?.episode_number,
      suffix,
      extension,
    )
  }

  async function downloadCurrentEpisodeSubtitle() {
    if (!currentEpisodeId.value || deliveryExportStatus.subtitle === 'downloading') return
    deliveryExportStatus.subtitle = 'downloading'
    deliveryExportStatus.project = 'idle'
    deliveryExportError.value = ''
    try {
      const blob = await validateDeliveryBlob(
        await timelinesAPI.getEpisodeSrt(currentEpisodeId.value),
        { label: '字幕文件' },
      )
      const filename = buildDeliveryFilename('字幕', 'srt')
      triggerBlobDownload(blob, filename)
      deliveryExportStatus.subtitle = 'success'
      ElMessage.success('字幕下载已完成')
    } catch (error) {
      deliveryExportError.value = friendlySubtitleExportError(error)
      deliveryExportStatus.subtitle = 'error'
      ElMessage.error(deliveryExportError.value)
    }
  }

  async function exportCurrentProjectPackage() {
    if (!dramaId.value || deliveryExportStatus.project === 'downloading') return
    deliveryExportStatus.project = 'downloading'
    deliveryExportStatus.subtitle = 'idle'
    deliveryExportError.value = ''
    try {
      const blob = await validateDeliveryBlob(await dramaAPI.exportDrama(dramaId.value), { label: '项目包', kind: 'zip' })
      const title = normalizeVideoDownloadFilenamePart(store.drama?.title, 'LocalMiniDrama')
      const filename = `${title}-项目包.zip`
      triggerBlobDownload(blob, filename)
      deliveryExportStatus.project = 'success'
      ElMessage.success('项目包导出已完成')
    } catch (error) {
      deliveryExportError.value = friendlyProjectExportError(error)
      deliveryExportStatus.project = 'error'
      ElMessage.error(deliveryExportError.value)
    }
  }

  watch([currentEpisodeId, currentEpisodeVideoUrl], () => {
    videoDownloadStatus.value = 'idle'
    videoDownloadError.value = ''
    deliveryExportStatus.subtitle = 'idle'
    deliveryExportStatus.project = 'idle'
    deliveryExportError.value = ''
  })
  return {
    currentEpisodeVideoUrl,
    deliveryCompositeStatusLabel,
    deliverySubtitleAvailable,
    deliveryFileCount,
    videoDownloadStatus,
    videoDownloadError,
    deliveryExportStatus,
    deliveryExportError,
    deliveryExportHasError,
    deliveryExportFeedback,
    buildDeliveryFilename,
    downloadCurrentEpisodeVideo,
    downloadCurrentEpisodeSubtitle,
    exportCurrentProjectPackage,
  }
}
