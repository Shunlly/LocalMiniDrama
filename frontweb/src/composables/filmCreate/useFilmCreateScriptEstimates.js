import { computed } from 'vue'
import {
  buildScriptStoryboardEstimate,
  clipSecondsForStoryboardEstimate as resolveClipSeconds,
  estimateVideoDurationSecFromCharLen,
  shotCountEstimateFromDurationSec as resolveShotCountEstimate,
} from '@/utils/filmCreateEstimates'

export function useFilmCreateScriptEstimates(deps = {}) {
  const {
    videoClipDuration,
    scriptContent,
    storyboardCount,
    videoDuration,
  } = deps
  // ── 剧本长度 → 估算总时长；自动分镜数与项目「每段秒数」(videoClipDuration) 对齐 ──

  /** 用于估算的每段时长（秒），与一键成片处「X秒/段」一致 */
  function clipSecondsForStoryboardEstimate() {
    return resolveClipSeconds(videoClipDuration.value)
  }

  function shotCountEstimateFromDurationSec(sec) {
    return resolveShotCountEstimate(sec, clipSecondsForStoryboardEstimate())
  }

  const scriptStoryboardEstimate = computed(() => (
    buildScriptStoryboardEstimate(scriptContent.value, clipSecondsForStoryboardEstimate())
  ))

  const scriptEstimateVideoDurationHint = computed(() => {
    const e = scriptStoryboardEstimate.value
    if (!e) return ''
    return `（约 ${e.sec}s）`
  })

  const scriptEstimateVideoDurationTitle = computed(() => {
    const e = scriptStoryboardEstimate.value
    if (!e) return ''
    return `按当前剧本文本约 ${e.len} 个字符（含标点；常见汉字在浏览器里一字一算，并非按 UTF-8 字节翻倍）、短剧公式 round(10+(字符/600)×60) 粗估总时长约 ${e.sec} 秒；未填输入框时该值会作为约束传给生成接口。仅供参考`
  })

  const scriptEstimateStoryboardHint = computed(() => {
    const e = scriptStoryboardEstimate.value
    if (!e) return ''
    if (e.range && e.range.min !== e.range.max) {
      return `（约 ${e.locked} 镜，参考 ${e.range.min}–${e.range.max}）`
    }
    return `（约 ${e.locked} 镜）`
  })

  const scriptEstimateStoryboardTitle = computed(() => {
    const e = scriptStoryboardEstimate.value
    if (!e) return ''
    return `按估算时长 ${e.sec}s ÷ 项目「每段 ${e.clip} 秒」四舍五入粗估约 ${e.locked} 镜；旁注区间为 ±1 镜供参考。切换「X秒/段」会同步改变本估算。`
  })

  function scriptTextTrimmedForEstimate() {
    return (scriptContent.value || '').toString().trim()
  }

  function userFilledStoryboardCount() {
    const v = storyboardCount.value
    return v != null && Number.isFinite(Number(v)) && Number(v) >= 1
  }

  function userFilledVideoDuration() {
    const v = videoDuration.value
    return v != null && Number.isFinite(Number(v)) && Number(v) >= 10
  }

  /** 请求后端的视频总时长：仅未手动填时传剧本估算 */
  function getVideoDurationForApi() {
    if (userFilledVideoDuration()) return Math.round(Number(videoDuration.value))
    const len = scriptTextTrimmedForEstimate().length
    if (len < 1) return undefined
    return estimateVideoDurationSecFromCharLen(len) ?? undefined
  }

  /** 请求后端的分镜数量：仅未手动填时按「估算总时长 ÷ 每段秒数」推算，与项目 X秒/段 一致 */
  function getStoryboardCountForApi() {
    if (userFilledStoryboardCount()) return Math.round(Number(storyboardCount.value))
    const sec = getVideoDurationForApi()
    if (sec == null || !Number.isFinite(sec)) return undefined
    return shotCountEstimateFromDurationSec(sec).locked
  }
  return {
    clipSecondsForStoryboardEstimate,
    shotCountEstimateFromDurationSec,
    scriptStoryboardEstimate,
    scriptEstimateVideoDurationHint,
    scriptEstimateVideoDurationTitle,
    scriptEstimateStoryboardHint,
    scriptEstimateStoryboardTitle,
    scriptTextTrimmedForEstimate,
    userFilledStoryboardCount,
    userFilledVideoDuration,
    getVideoDurationForApi,
    getStoryboardCountForApi,
  }
}
