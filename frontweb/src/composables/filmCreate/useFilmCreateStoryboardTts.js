import { ElMessage } from 'element-plus'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

export function useFilmCreateStoryboardTts(deps = {}) {
  const {
    ttsSbIds,
    ttsSbNarrationIds,
    sbDialogueAudioPaths,
    sbNarrationAudioPaths,
    sbNarration,
    ttsGenerationDisabledReason,
    projectLifecycle,
  } = deps

  let sbTtsPreviewAudio = null

  function normalizeAudioRelPath(raw) {
    const s = String(raw != null ? raw : '').trim().replace(/^\//, '')
    return s
  }

  /** 对白 TTS 相对路径 */
  function sbDialogueAudioRelPath(sb) {
    if (!sb?.id) return ''
    const fromCache = sbDialogueAudioPaths.value[sb.id]
    const fromRow = sb.audio_local_path
    const raw = (fromCache != null && String(fromCache).trim() !== '') ? fromCache : (fromRow != null ? fromRow : '')
    return normalizeAudioRelPath(raw)
  }

  /** 解说旁白 TTS 相对路径 */
  function sbNarrationAudioRelPath(sb) {
    if (!sb?.id) return ''
    const fromCache = sbNarrationAudioPaths.value[sb.id]
    const fromRow = sb.narration_audio_local_path
    const raw = (fromCache != null && String(fromCache).trim() !== '') ? fromCache : (fromRow != null ? fromRow : '')
    return normalizeAudioRelPath(raw)
  }

  function playSbTtsFromRel(rel) {
    if (!rel) return
    const url = `/static/${rel}`
    try {
      if (sbTtsPreviewAudio) {
        sbTtsPreviewAudio.pause()
        sbTtsPreviewAudio = null
      }
      const a = new Audio(url)
      sbTtsPreviewAudio = a
      a.addEventListener('ended', () => {
        if (sbTtsPreviewAudio === a) sbTtsPreviewAudio = null
      })
      a.play().catch(() => {
        ElMessage.warning('无法播放音频，请检查文件是否存在')
        if (sbTtsPreviewAudio === a) sbTtsPreviewAudio = null
      })
    } catch (_) {
      ElMessage.warning('无法播放音频')
    }
  }

  function playSbDialogueTts(sb) {
    playSbTtsFromRel(sbDialogueAudioRelPath(sb))
  }

  function playSbNarrationTts(sb) {
    playSbTtsFromRel(sbNarrationAudioRelPath(sb))
  }

  /** P2-4: 为分镜对白生成 TTS 配音 */
  async function onTtsSbDialogue(sb) {
    if (!sb?.id || ttsSbIds.has(sb.id)) return
    if (!sb.dialogue?.trim()) {
      ElMessage.warning('该分镜没有对白内容')
      return
    }
    const disabledReason = ttsGenerationDisabledReason(sb.id, 'dialogue')
    if (disabledReason) {
      ElMessage.warning(disabledReason)
      return
    }
    ttsSbIds.add(sb.id)
    try {
      const { res, data } = await projectLifecycle.execute(async () => {
        const response = await fetch('/api/v1/audio/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyboard_id: sb.id, text: sb.dialogue, tts_kind: 'dialogue' }),
        })
        return { res: response, data: await response.json() }
      })
      const businessOk = data.success === true || Number(data.code) === 200
      if (!res.ok || !businessOk) {
        throw new Error(data.error?.message || data.message || '配音失败')
      }
      if (data.data?.local_path) {
        sbDialogueAudioPaths.value = { ...sbDialogueAudioPaths.value, [sb.id]: data.data.local_path }
        sb.audio_local_path = data.data.local_path
        ElMessage.success('配音已生成')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '对白配音失败'))
    } finally {
      ttsSbIds.delete(sb.id)
    }
  }

  /** 为分镜解说旁白生成 TTS（与对白共用接口，文本不同） */
  async function onTtsSbNarration(sb) {
    if (!sb?.id || ttsSbNarrationIds.has(sb.id)) return
    const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
    if (!text) {
      ElMessage.warning('该分镜没有解说旁白内容')
      return
    }
    const disabledReason = ttsGenerationDisabledReason(sb.id, 'narration')
    if (disabledReason) {
      ElMessage.warning(disabledReason)
      return
    }
    ttsSbNarrationIds.add(sb.id)
    try {
      const { res, data } = await projectLifecycle.execute(async () => {
        const response = await fetch('/api/v1/audio/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyboard_id: sb.id, text, tts_kind: 'narration' }),
        })
        return { res: response, data: await response.json() }
      })
      const businessOk = data.success === true || Number(data.code) === 200
      if (!res.ok || !businessOk) {
        throw new Error(data.error?.message || data.message || '解说配音失败')
      }
      if (data.data?.local_path) {
        sbNarrationAudioPaths.value = { ...sbNarrationAudioPaths.value, [sb.id]: data.data.local_path }
        sb.narration_audio_local_path = data.data.local_path
        ElMessage.success('解说配音已生成')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '解说配音失败'))
    } finally {
      ttsSbNarrationIds.delete(sb.id)
    }
  }

  return {
    normalizeAudioRelPath,
    sbDialogueAudioRelPath,
    sbNarrationAudioRelPath,
    playSbTtsFromRel,
    playSbDialogueTts,
    playSbNarrationTts,
    onTtsSbDialogue,
    onTtsSbNarration,
  }
}
