import { ElMessage } from 'element-plus'
import { exportStoryboardSheet } from '@/utils/exportStoryboardSheet'

export function useFilmCreateStoryboardExport(deps = {}) {
  const {
    store,
    currentEpisodeId,
    storyboards,
    storyboardsAPI,
    storyboardUseFirstLastFrame,
    exportingStoryboardSheet,
    getSbFirstImage,
    getSbLastImage,
    buildFirstFrameImagePrompt,
    buildLastFrameImagePrompt,
    getSbSelectedScene,
    getSbSelectedCharacters,
    getSbSelectedProps,
    getMovementLabel,
    sbTitle,
    sbLocation,
    sbTime,
    sbDuration,
    sbDialogue,
    sbNarration,
    sbAction,
    sbResult,
    sbAtmosphere,
    sbShotType,
    sbMovement,
    sbLayoutDescription,
    sbUniversalSegmentText,
  } = deps

  function formatSrtTimestamp(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const z = Math.floor(ms % 1000)
    const p2 = (n) => String(n).padStart(2, '0')
    return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`
  }

  /** 导出当前集分镜表（每镜一行；首尾帧模式含首/尾帧专用提示词） */
  async function onExportStoryboardSheet() {
    const boards = storyboards.value || []
    if (!boards.length) {
      ElMessage.warning('暂无分镜')
      return
    }
    const epNum = store.currentEpisode?.episode_number
    const dramaTitle = (store.drama?.title || 'project').replace(/[\\/:*?"<>|]/g, '_')
    const epLabel = epNum != null ? `第${epNum}集` : `ep${currentEpisodeId.value || '1'}`
    const filenameBase = `${dramaTitle}-${epLabel}-分镜表`
    const useFirstLast = !!storyboardUseFirstLastFrame.value

    exportingStoryboardSheet.value = true
    const framePromptBySbId = {}
    try {
      await Promise.all(
        boards.map(async (sb) => {
          try {
            const res = await storyboardsAPI.getFramePrompts(sb.id)
            const fps = res?.frame_prompts || []
            framePromptBySbId[sb.id] = {
              first: fps.find((r) => r.frame_type === 'first')?.prompt?.trim() || '',
              last: fps.find((r) => r.frame_type === 'last')?.prompt?.trim() || '',
            }
          } catch (_) {
            framePromptBySbId[sb.id] = { first: '', last: '' }
          }
        })
      )
    } finally {
      exportingStoryboardSheet.value = false
    }

    function resolveFirstFramePrompt(sbId) {
      const cached = framePromptBySbId[sbId]?.first
      if (cached) return cached
      const imgPrompt = getSbFirstImage(sbId)?.prompt?.trim()
      if (imgPrompt) return imgPrompt
      if (useFirstLast) return buildFirstFrameImagePrompt(sbId)
      return ''
    }

    function resolveLastFramePrompt(sbId) {
      const cached = framePromptBySbId[sbId]?.last
      if (cached) return cached
      const imgPrompt = getSbLastImage(sbId)?.prompt?.trim()
      if (imgPrompt) return imgPrompt
      if (useFirstLast) return buildLastFrameImagePrompt(sbId)
      return ''
    }

    const result = exportStoryboardSheet(
      {
        storyboards: boards,
        getScene: (sbId) => getSbSelectedScene(sbId),
        getCharacters: (sbId) => getSbSelectedCharacters(sbId),
        getProps: (sbId) => getSbSelectedProps(sbId),
        getMovementLabel,
        getFirstFramePrompt: resolveFirstFramePrompt,
        getLastFramePrompt: resolveLastFramePrompt,
        getField(sb, key) {
          const id = sb.id
          const map = {
            title: sbTitle.value[id],
            location: sbLocation.value[id],
            time: sbTime.value[id],
            duration: sbDuration.value[id] ?? sb.duration,
            dialogue: sbDialogue.value[id],
            narration: sbNarration.value[id],
            action: sbAction.value[id],
            result: sbResult.value[id],
            atmosphere: sbAtmosphere.value[id],
            shot_type: sbShotType.value[id],
            movement: sbMovement.value[id],
            layout_description: sbLayoutDescription.value[id],
            universal_segment_text: sbUniversalSegmentText.value[id],
          }
          if (Object.prototype.hasOwnProperty.call(map, key)) {
            const v = map[key]
            return v != null && v !== '' ? v : sb[key]
          }
          return sb[key]
        },
      },
      filenameBase
    )

    if (!result.ok) {
      ElMessage.warning('当前分镜没有可导出的内容')
      return
    }
    ElMessage.success(`已导出分镜表（${result.count} 个镜头）`)
  }

  function onExportNarrationSrt() {
    const boards = storyboards.value || []
    if (!boards.length) {
      ElMessage.warning('暂无分镜')
      return
    }
    let tMs = 0
    const lines = []
    let idx = 1
    for (const sb of boards) {
      const durSec = Number(sbDuration.value[sb.id] ?? sb.duration)
      const sec = Number.isFinite(durSec) && durSec > 0 ? durSec : 5
      const durMs = Math.round(sec * 1000)
      const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
      if (text) {
        const start = formatSrtTimestamp(tMs)
        const end = formatSrtTimestamp(tMs + durMs)
        lines.push(String(idx++), `${start} --> ${end}`, text, '')
      }
      tMs += durMs
    }
    if (!lines.length) {
      ElMessage.warning('当前分镜没有可导出的解说文案')
      return
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `narration-${currentEpisodeId.value || 'episode'}.srt`
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('已下载解说 SRT')
  }

  return {
    formatSrtTimestamp,
    onExportStoryboardSheet,
    onExportNarrationSrt,
  }
}
