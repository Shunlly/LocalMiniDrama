import { ref } from 'vue'

/** 全能片段润色进度和成片错误文案 */
export function useFilmCreateOmniPolishState() {
  const universalOmniPolishRunning = ref(false)
  const universalOmniPolishAbort = ref(false)
  const universalOmniPolishProgress = ref({ current: 0, total: 0, label: '' })
  const sbTruncatedWarning = ref(false)
  const sbTruncatedDismissed = ref(false)
  const videoErrorMsg = ref('')

  return {
    universalOmniPolishRunning,
    universalOmniPolishAbort,
    universalOmniPolishProgress,
    sbTruncatedWarning,
    sbTruncatedDismissed,
    videoErrorMsg,
  }
}
