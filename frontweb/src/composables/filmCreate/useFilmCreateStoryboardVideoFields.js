export function useFilmCreateStoryboardVideoFields(deps = {}) {
  const {
    store,
    storyboardsAPI,
    ElMessage,
    upscalingSbIds,
    refreshStoryboardMediaForCurrentContext,
    sbNarration,
    sbCreationMode,
    sbUniversalSegmentText,
    sbDuration,
    videoClipDuration,
    getSbFirstFrameUrl,
    storyboardMediaActionReason,
    isSbVideoGenerating,
    videoCapabilityReason,
  } = deps
  /**
   * P0-1: 从视频 URL 捕获末帧（浏览器 canvas 方案）
   * 返回 Blob（JPEG），失败返回 null
   */
  async function captureVideoLastFrame(videoUrl) {
    return new Promise((resolve) => {
      if (!videoUrl) return resolve(null)
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.preload = 'metadata'
      let captured = false
      const timeout = setTimeout(() => { if (!captured) resolve(null) }, 12000)
      video.addEventListener('error', () => { clearTimeout(timeout); if (!captured) resolve(null) })
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.max(0, video.duration - 0.5)
      })
      video.addEventListener('seeked', () => {
        if (captured) return
        captured = true
        clearTimeout(timeout)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth || 512
          canvas.height = video.videoHeight || 288
          const ctx = canvas.getContext('2d')
          ctx.drawImage(video, 0, 0)
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
        } catch (_) {
          resolve(null)
        }
      })
      video.src = videoUrl
    })
  }

  /** P0-3: 对分镜图执行超分辨率（2x） */
  async function onUpscaleSbImage(sb) {
    if (!sb?.id || upscalingSbIds.has(sb.id)) return
    upscalingSbIds.add(sb.id)
    try {
      await storyboardsAPI.upscale(sb.id)
      ElMessage.success('超分完成，图片已更新为高清版本')
      await refreshStoryboardMediaForCurrentContext(sb.id)
    } catch (e) {
      ElMessage.error(e.message || '超分辨率失败')
    } finally {
      upscalingSbIds.delete(sb.id)
    }
  }
  async function onSaveSbNarrationField(sb) {
    if (!sb?.id) return
    const next = (sbNarration.value[sb.id] || '').toString().trim()
    const prev = (sb.narration || '').toString().trim()
    if (next === prev) return
    try {
      await storyboardsAPI.update(sb.id, { narration: next || null })
      const list = store.currentEpisode?.storyboards
      if (Array.isArray(list)) {
        const row = list.find((x) => Number(x.id) === Number(sb.id))
        if (row) row.narration = next || null
      }
    } catch (_) { /* 静默失败，避免打断输入 */ }
  }

  function isSbUniversalMode(sbId) {
    return sbCreationMode.value[sbId] === 'universal'
  }

  function setSbCreationModeId(sbId, mode) {
    if (sbId == null) return
    const m = mode === 'universal' ? 'universal' : 'classic'
    sbCreationMode.value = { ...sbCreationMode.value, [sbId]: m }
  }

  async function onToggleSbUniversalMode(sb) {
    if (!sb?.id) return
    const cur = isSbUniversalMode(sb.id) ? 'universal' : 'classic'
    const next = cur === 'universal' ? 'classic' : 'universal'
    sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: next }
    try {
      await storyboardsAPI.update(sb.id, { creation_mode: next })
      const list = store.currentEpisode?.storyboards
      if (Array.isArray(list)) {
        const row = list.find((x) => Number(x.id) === Number(sb.id))
        if (row) row.creation_mode = next
      }
    } catch (e) {
      sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: cur }
      ElMessage.error(e.message || '保存失败')
    }
  }

  async function onSaveUniversalSegmentField(sb) {
    if (!sb?.id) return
    const next = (sbUniversalSegmentText.value[sb.id] || '').toString()
    const prev = (sb.universal_segment_text || '').toString()
    if (next === prev) return
    try {
      await storyboardsAPI.update(sb.id, { universal_segment_text: next.trim() || null })
      const list = store.currentEpisode?.storyboards
      if (Array.isArray(list)) {
        const row = list.find((x) => Number(x.id) === Number(sb.id))
        if (row) row.universal_segment_text = next.trim() || null
      }
    } catch (_) { /* 静默失败，避免打断输入 */ }
  }

  function universalSegmentDurationSecForSb(sb) {
    const dUi = Number(sbDuration.value[sb?.id])
    const dRow = Number(sb?.duration)
    const dProj = Number(videoClipDuration.value)
    return Number.isFinite(dUi) && dUi > 0
      ? dUi
      : Number.isFinite(dRow) && dRow > 0
        ? dRow
        : Number.isFinite(dProj) && dProj > 0
          ? dProj
          : 5
  }

  /** 提交视频 API 时使用的时长：优先本分镜配置，其次项目「每段秒数」 */
  function getSbVideoDurationForApi(sb) {
    const perSb = Number(sbDuration.value[sb?.id] ?? sb?.duration)
    if (Number.isFinite(perSb) && perSb > 0) return perSb
    const clip = Number(videoClipDuration.value)
    if (Number.isFinite(clip) && clip > 0) return clip
    return undefined
  }
  /** 为视频生成获取参考图的真实 URL */
  async function getMainImageUrlForVideo(sb) {
    return getSbFirstFrameUrl(sb)
  }


  function sbUniversalSegmentTrimmed(sb) {
    if (!sb?.id) return ''
    return (sbUniversalSegmentText.value[sb.id] ?? sb.universal_segment_text ?? '').toString().trim()
  }

  function sbCanSubmitVideo(sb) {
    if (!sb) return false
    const vp = (sb.video_prompt || '').toString().trim()
    if (vp) return true
    if (isSbUniversalMode(sb.id)) return !!sbUniversalSegmentTrimmed(sb)
    return false
  }

  function sbVideoGenerationDisabledReason(sb) {
    if (storyboardMediaActionReason.value) return storyboardMediaActionReason.value
    if (isSbVideoGenerating(sb?.id)) return '正在生成分镜视频，请等待完成'
    if (videoCapabilityReason.value) return videoCapabilityReason.value
    if (sbCanSubmitVideo(sb)) return ''
    return isSbUniversalMode(sb?.id)
      ? '请先填写视频提示词或全能片段描述'
      : '请先填写视频提示词'
  }

  /** 提交给视频 API 的文案：全能模式有片段描述时仅提交该段（不拼接 video_prompt，避免动作/旁白盖过 @图片 等编排） */
  function buildSbVideoPromptForApi(sb, { preferClassicPrompt = false } = {}) {
    const vp = (sb.video_prompt || '').toString().trim()
    const seg = sbUniversalSegmentTrimmed(sb)
    if (preferClassicPrompt) return vp || seg
    if (isSbUniversalMode(sb.id)) {
      if (seg) return seg
      return vp
    }
    return vp
  }
  return {
    captureVideoLastFrame,
    onUpscaleSbImage,
    onSaveSbNarrationField,
    isSbUniversalMode,
    setSbCreationModeId,
    onToggleSbUniversalMode,
    onSaveUniversalSegmentField,
    universalSegmentDurationSecForSb,
    getSbVideoDurationForApi,
    getMainImageUrlForVideo,
    sbUniversalSegmentTrimmed,
    sbCanSubmitVideo,
    sbVideoGenerationDisabledReason,
    buildSbVideoPromptForApi,
  }
}
