import { ref } from 'vue'
import { getSbImagesList, hasRealMediaValue } from '@/utils/storyboardMedia'
import { isPlaceholderMediaUrl, storyboardImageUrl } from '@/utils/mediaUrl'

export function useFilmCreateStoryboardAccessors(deps = {}) {
  const {
    store,
    sbImages,
    sbVideos,
    sbVideoErrors,
    storyboardUseFirstLastFrame,
    isSbUniversalMode,
    storyboardsAPI,
    imagesAPI,
    ElMessage,
    ElMessageBox,
    refreshStoryboardMediaForCurrentContext,
    assetImageUrl,
    assetVideoUrl,
    recordHasPlayableVideoUrl,
    toAbsoluteImageUrl,
    userFacingVideoGenerationError,
    sbVideoReferenceImageId,
  } = deps

  const sbSelectedImgId = ref({})
  const sbSelectedLastImgId = ref({})
  const sbSelectedVideoId = ref({})
  const sbImageUploadSlotById = ref({})
  function uploadingSbImageSlot(sbId) {
    return sbImageUploadSlotById.value[sbId] || null
  }

  function frameTypeForSlot(slot) {
    return slot === 'last' ? 'storyboard_last' : 'storyboard_first'
  }

  function resolveSbImageById(storyboardId, imageId) {
    if (imageId == null) return null
    const images = getSbAllImages(storyboardId)
    return images.find((i) => i.id === imageId) || null
  }

  /** 首帧图（首尾帧模式下严格优先服务器绑定的 first_frame_image_id） */
  function getSbFirstImage(storyboardId) {
    const images = getSbAllImages(storyboardId)
    const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

    // 最高权威：服务器已绑定的首帧
    if (sb?.first_frame_image_id != null) {
      const bound = resolveSbImageById(storyboardId, sb.first_frame_image_id)
      if (bound) return bound
    }

    const sel = sbSelectedImgId.value[storyboardId]
    if (sel != null) {
      const found = images.find((i) => i.id === sel)
      if (found) return found
    }

    const typed = images.find((i) => i.frame_type === 'storyboard_first')
    if (typed) return typed
    // 不再回退到 images[0]，避免把尾帧图片误显示为首帧
    return null
  }

  /** 尾帧图（首尾帧模式下严格优先服务器绑定的 last_frame_image_id） */
  function getSbLastImage(storyboardId) {
    const images = getSbAllImages(storyboardId)
    const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

    // 最高权威：服务器已绑定的尾帧（后端 bindStoryboardFrameImage 正确写入的 last_frame_image_id）
    if (sb?.last_frame_image_id != null) {
      const bound = resolveSbImageById(storyboardId, sb.last_frame_image_id)
      if (bound) return bound
    }

    // 仅在没有服务器绑定时才考虑手动选择（首尾帧生成后我们会主动清除手动选择）
    const sel = sbSelectedLastImgId.value[storyboardId]
    if (sel != null) {
      const found = images.find((i) => i.id === sel)
      if (found) return found
    }

    const typed = images.find((i) => i.frame_type === 'storyboard_last')
    if (typed) return typed

    if (hasRealMediaValue(sb?.last_frame_image_url) || hasRealMediaValue(sb?.last_frame_local_path)) {
      return {
        id: sb.last_frame_image_id,
        image_url: sb.last_frame_image_url,
        local_path: sb.last_frame_local_path,
        frame_type: 'storyboard_last',
      }
    }
    return null
  }

  /** 该分镜是否有图（接口拉取的或 composed_image） */
  function hasSbImage(sb) {
    if (storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)) {
      return !!(
        getSbFirstImage(sb.id)
        || hasRealMediaValue(sb?.composed_image)
        || hasRealMediaValue(sb?.image_url)
        || hasRealMediaValue(sb?.local_path)
      )
    }
    return !!(
      getSbImage(sb.id)
      || hasRealMediaValue(sb?.composed_image)
      || hasRealMediaValue(sb?.image_url)
      || hasRealMediaValue(sb?.local_path)
    )
  }

  function hasSbFirstLastPair(sb) {
    return !!(getSbFirstImage(sb.id) && getSbLastImage(sb.id))
  }
  /** 取该分镜下所有已完成的非四宫格图片列表 */
  function getSbAllImages(storyboardId) {
    return getSbImagesList(sbImages.value, storyboardId)
  }
  function hasSbDraftImagePlaceholder(sb) {
    const directValues = [sb?.image_url, sb?.local_path, sb?.composed_image]
    if (directValues.some((value) => isPlaceholderMediaUrl(value))) return true
    const records = sbImages.value[sb?.id]
    return Array.isArray(records) && records.some((record) => (
      isPlaceholderMediaUrl(record?.image_url) || isPlaceholderMediaUrl(record?.local_path)
    ))
  }
  /** 取当前主图（首尾帧模式下等同首帧） */
  function getSbImage(storyboardId) {
    if (storyboardUseFirstLastFrame.value) return getSbFirstImage(storyboardId)
    const images = getSbAllImages(storyboardId)
    if (!images.length) return null
    const selectedId = sbSelectedImgId.value[storyboardId]
    if (selectedId != null) {
      const found = images.find((i) => i.id === selectedId)
      if (found) return found
    }
    return images[0]
  }
  /** 取该分镜下的四宫格整图记录 */
  /** 取该分镜下的四宫格整图记录 */
  function getQuadGridImage(storyboardId) {
    const list = sbImages.value[storyboardId]
    if (!Array.isArray(list)) return null
    return list.find((i) => (
      i.status === 'completed'
      && (i.frame_type === 'quad_grid' || i.frame_type === 'nine_grid')
      && (hasRealMediaValue(i.image_url) || hasRealMediaValue(i.local_path))
    )) || null
  }
  /** 取该分镜所有已完成的视频记录 */
  function getSbAllVideos(storyboardId) {
    const list = sbVideos.value[storyboardId]
    if (!Array.isArray(list)) return []
    return list.filter((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
  }
  /** 取该分镜当前选中的视频（尊重 sbSelectedVideoId，否则默认第一条） */
  function getSbVideo(storyboardId) {
    const all = getSbAllVideos(storyboardId)
    if (all.length === 0) return null
    const selectedId = sbSelectedVideoId.value[storyboardId]
    if (selectedId != null) {
      const found = all.find((v) => v.id === selectedId)
      if (found) return found
    }
    return all[0]
  }
  /** 取下一个分镜（按 storyboard_number 顺序） */
  function getNextStoryboard(storyboardId) {
    const list = store.storyboards || []
    const idx = list.findIndex((s) => s.id === storyboardId)
    if (idx === -1 || idx === list.length - 1) return null
    return list[idx + 1]
  }

  /** 取上一个分镜（按 storyboard_number 顺序，用于“上镜尾帧”快速衔接） */
  function getPrevStoryboard(storyboardId) {
    const list = store.storyboards || []
    const idx = list.findIndex((s) => s.id === storyboardId)
    if (idx === -1 || idx === 0) return null
    return list[idx - 1]
  }

  /** 辅助判断：当前分镜是否有“上一镜尾帧”可用于快速替换首帧 */
  function canUsePrevTailAsFirst(sb) {
    const p = getPrevStoryboard(sb?.id)
    return !!(p && getSbLastImage(p.id))
  }

  /** 视频历史条：返回非当前选中的已完成视频列表 */
  function getVideoStripItems(storyboardId) {
    const all = getSbAllVideos(storyboardId)
    const current = getSbVideo(storyboardId)
    return all
      .filter((v) => !current || v.id !== current.id)
      .map((v, idx) => ({
        key: `vid-${v.id}`,
        video: v,
        src: assetVideoUrl(v),
        label: `历史${idx + 2}`,
      }))
  }
  /** 选中某条历史视频为当前视频，并持久化到分镜记录供合成视频使用 */
  function onSelectSbMainVideo(sb, video) {
    sbSelectedVideoId.value = { ...sbSelectedVideoId.value, [sb.id]: video.id }
    storyboardsAPI.update(sb.id, {
      video_url: video.video_url || null,
      video_local_path: video.local_path || null,
    }).catch(e => console.warn('[主视频] 保存后端失败', e))
  }
  /** 取该分镜最近一次视频生成的错误信息（从 API 返回的记录或本地即时错误） */
  function getSbVideoError(storyboardId) {
    if (sbVideoErrors.value[storyboardId]) {
      return userFacingVideoGenerationError(sbVideoErrors.value[storyboardId])
    }
    const list = sbVideos.value[storyboardId]
    if (!Array.isArray(list) || list.length === 0) return ''
    const hasCompleted = list.some((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
    if (hasCompleted) return ''
    const bogusCompleted = list.find(
      (i) => i.status === 'completed' && i.video_url && !recordHasPlayableVideoUrl(i)
    )
    if (bogusCompleted) {
      const u = String(bogusCompleted.video_url || '').trim()
      if (u) return userFacingVideoGenerationError(u)
      if (bogusCompleted.error_msg) return userFacingVideoGenerationError(bogusCompleted.error_msg)
    }
    const failed = list.filter((i) => i.status === 'failed' && i.error_msg)
    if (failed.length === 0) return ''
    return userFacingVideoGenerationError(failed[0].error_msg)
  }
  /** 主播放器强制随记录/地址重建，避免重新生成后 <video> 仍缓存旧 src */
  function sbMainVideoPlayerKey(sbId) {
    const v = getSbVideo(sbId)
    if (!v) return ''
    const src = assetVideoUrl(v)
    return `${v.id}:${v.updated_at || ''}:${src.slice(0, 160)}`
  }
  /**
   * 从后端 storyboard.image_url / local_path 恢复主图选择状态。
   * 与 image_generation 记录比对，找到匹配的记录并恢复 sbSelectedImgId。
   */
  function restoreSelectionsFromBackend() {
    const boards = store.storyboards || []
    for (const sb of boards) {
      const images = getSbAllImages(sb.id)
      if (sbSelectedImgId.value[sb.id] == null) {
        if (sb.first_frame_image_id != null) {
          sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: sb.first_frame_image_id }
        } else {
          const sbPath = (sb.local_path || '').trim()
          const sbUrl = (sb.image_url || '').trim()
          if (sbPath || sbUrl) {
            const matched = images.find(
              (img) =>
                (sbPath && img.local_path && img.local_path === sbPath) ||
                (sbUrl && img.image_url && img.image_url === sbUrl)
            )
            if (matched) {
              sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: matched.id }
            }
          }
        }
      }
      if (sbSelectedLastImgId.value[sb.id] == null && sb.last_frame_image_id != null) {
        sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: sb.last_frame_image_id }
      }
    }
  }

  /** 获取缩略图条数据：已绑定首尾帧以外的历史图 */
  function getStripItems(storyboardId) {
    const allImgs = getSbAllImages(storyboardId)
    const firstImg = storyboardUseFirstLastFrame.value ? getSbFirstImage(storyboardId) : getSbImage(storyboardId)
    const lastImg = storyboardUseFirstLastFrame.value ? getSbLastImage(storyboardId) : null
    const boundIds = new Set([firstImg?.id, lastImg?.id].filter((x) => x != null))
    return allImgs
      .filter((img) => !boundIds.has(img.id))
      .map((img) => ({
        key: `img-${img.id}`,
        src: assetImageUrl(img),
        type: 'img',
        img,
        label: quadPanelLabel(img.frame_type),
        frameBadge: img.frame_type === 'storyboard_first' ? '首' : img.frame_type === 'storyboard_last' ? '尾' : null,
        prompt: img.prompt || '',
      }))
  }

  function historyImageLabel(sb, storyboardIndex, item, historyIndex) {
    const storyboardNumber = sb?.storyboard_number || storyboardIndex + 1
    const panelLabel = item?.label ? `${item.label}` : ''
    return `分镜${storyboardNumber}${panelLabel}历史图${historyIndex + 1}`
  }

  function stripItemTitle(sbId, item, accessibleLabel = '') {
    const lines = [accessibleLabel, item.label, item.prompt].filter(Boolean)
    if (storyboardUseFirstLastFrame.value) {
      lines.unshift('点击：设为首帧或尾帧')
    } else {
      lines.unshift('点击设为主图')
    }
    return lines.join('\n\n')
  }

  async function onStripItemClick(sb, item) {
    if (!storyboardUseFirstLastFrame.value) {
      onSelectStripItem(sb, item)
      return
    }
    try {
      await ElMessageBox.confirm('将此图绑定到哪个槽位？', '设置参考帧', {
        confirmButtonText: '设为首帧',
        cancelButtonText: '设为尾帧',
        distinguishCancelAndClose: true,
        type: 'info',
      })
      onSelectSbFrameImage(sb, item.img, 'first')
      ElMessage.success('已设为首帧')
    } catch (action) {
      if (action === 'cancel') {
        onSelectSbFrameImage(sb, item.img, 'last')
        ElMessage.success('已设为尾帧')
      }
    }
  }

  /** 宫格子图位置标签 */
  function quadPanelLabel(frameType) {
    const map = {
      quad_panel_0: '左上', quad_panel_1: '右上', quad_panel_2: '左下', quad_panel_3: '右下',
      nine_panel_0: '左上', nine_panel_1: '中上', nine_panel_2: '右上',
      nine_panel_3: '左中', nine_panel_4: '中间', nine_panel_5: '右中',
      nine_panel_6: '左下', nine_panel_7: '中下', nine_panel_8: '右下',
    }
    return map[frameType] || null
  }

  /** 点击缩略图条中的图片切换为主图 */
  function onSelectStripItem(sb, item) {
    onSelectSbMainImage(sb, item.img)
  }

  /** 选定首帧或尾帧参考图（持久化到后端） */
  function onSelectSbFrameImage(sb, img, slot) {
    if (!sb?.id || !img) return
    const isLast = slot === 'last'

    // 本地选中状态（用于部分回退逻辑）
    if (isLast) {
      sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: img.id }
    } else {
      sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: img.id }
    }

    // 关键：乐观更新 store 里分镜的权威绑定字段（storyboards 数组是 getSbFirst/LastImage 的主要数据源）
    // 这样点击后立即生效，无需刷新页面；getStripItems 也会立即把这张图从历史条里过滤掉
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) {
        const now = new Date().toISOString()
        if (isLast) {
          row.last_frame_image_id = img.id
          row.last_frame_image_url = img.image_url || null
          row.last_frame_local_path = img.local_path || null
        } else {
          row.first_frame_image_id = img.id
          row.image_url = img.image_url || null
          row.local_path = img.local_path || null
        }
        row.updated_at = now
      }
    }

    // 发送到后端持久化（静默，调用方按需提示）
    const patch = { updated_at: new Date().toISOString() }
    if (isLast) {
      patch.last_frame_image_id = img.id
      patch.last_frame_image_url = img.image_url || null
      patch.last_frame_local_path = img.local_path || undefined
    } else {
      patch.image_url = img.image_url || null
      patch.local_path = img.local_path || undefined
      patch.first_frame_image_id = img.id
    }

    storyboardsAPI.update(sb.id, patch).catch((e) => console.warn('[参考帧] 保存失败', e))
  }

  /** 选定某张 API 图为主图（持久化到后端） */
  function onSelectSbMainImage(sb, img) {
    onSelectSbFrameImage(sb, img, 'first')
  }

  /** 删除分镜历史参考图（strip 中的未绑定历史图，类似资源 extra 图的移除） */
  async function onRemoveSbHistoryImage(storyboardId, imageGenId) {
    if (!storyboardId || !imageGenId) return
    try {
      await ElMessageBox.confirm('确定删除这张历史参考图？此操作不可恢复。', '删除历史图', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        distinguishCancelAndClose: true,
      })
      await imagesAPI.delete(imageGenId)
      await refreshStoryboardMediaForCurrentContext(storyboardId)
      ElMessage.success('历史图已删除')
    } catch (err) {
      if (err !== 'cancel' && err !== 'close') {
        ElMessage.error(err?.message || '删除失败')
      }
    }
  }
  function getSbGridImages(storyboardId) {
    const list = sbImages.value[storyboardId]
    if (!Array.isArray(list)) return []
    return list.filter((image) => (
      image.status === 'completed' &&
      (image.frame_type === 'quad_grid' || image.frame_type === 'nine_grid') &&
      (hasRealMediaValue(image.image_url) || hasRealMediaValue(image.local_path))
    ))
  }

  function getSbVideoReferenceGrid(sb) {
    if (!sb?.id) return null
    const selectedId = Number(sbVideoReferenceImageId.value[sb.id] || sb.video_reference_image_id)
    if (!Number.isFinite(selectedId) || selectedId <= 0) return null
    return getSbGridImages(sb.id).find((image) => Number(image.id) === selectedId) || null
  }
  function getSbFirstFrameUrl(sb) {
    const img = storyboardUseFirstLastFrame.value ? getSbFirstImage(sb.id) : getSbImage(sb.id)
    if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
    return storyboardImageUrl(sb)
  }

  function getSbLastFrameUrl(sb) {
    const img = getSbLastImage(sb.id)
    if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
    if (hasRealMediaValue(sb.last_frame_image_url) || hasRealMediaValue(sb.last_frame_local_path)) {
      return assetImageUrl({ image_url: sb.last_frame_image_url, local_path: sb.last_frame_local_path })
    }
    return ''
  }

  /** 经典模式视频：首帧 URL（连贯帧可覆盖首帧）+ 可选尾帧 */
  function sbVideoFirstLastUrls(sb, universal, contiguityFirstFrameUrl) {
    let first =
      contiguityFirstFrameUrl ||
      (universal ? '' : toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || ''))
    if (!first && !universal) {
      first = toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || '')
    }
    let last = undefined
    if (storyboardUseFirstLastFrame.value && !universal) {
      const lu = getSbLastFrameUrl(sb)
      if (lu) last = toAbsoluteImageUrl(lu)
    }
    return { first: first || undefined, last }
  }

  /** 获取分镜主图的本地路径（用于超分辨率判断） */
  function getSbLocalImage(sb) {
    const img = getSbImage(sb.id)
    return img?.local_path || sb.local_path || null
  }
  return {
    sbSelectedImgId,
    sbSelectedLastImgId,
    sbSelectedVideoId,
    sbImageUploadSlotById,
    uploadingSbImageSlot,
    frameTypeForSlot,
    resolveSbImageById,
    getSbFirstImage,
    getSbLastImage,
    hasSbImage,
    hasSbFirstLastPair,
    getSbAllImages,
    hasSbDraftImagePlaceholder,
    getSbImage,
    getQuadGridImage,
    getSbAllVideos,
    getSbVideo,
    getNextStoryboard,
    getPrevStoryboard,
    canUsePrevTailAsFirst,
    getVideoStripItems,
    onSelectSbMainVideo,
    getSbVideoError,
    sbMainVideoPlayerKey,
    restoreSelectionsFromBackend,
    getStripItems,
    historyImageLabel,
    stripItemTitle,
    onStripItemClick,
    quadPanelLabel,
    onSelectStripItem,
    onSelectSbFrameImage,
    onSelectSbMainImage,
    onRemoveSbHistoryImage,
    getSbGridImages,
    getSbVideoReferenceGrid,
    getSbFirstFrameUrl,
    getSbLastFrameUrl,
    sbVideoFirstLastUrls,
    getSbLocalImage,
  }
}
