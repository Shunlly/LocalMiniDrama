export function useFilmCreateTtsDisableReason(deps = {}) {
  const {
    ttsSbIds,
    ttsSbNarrationIds,
    ttsCapabilityReason,
  } = deps
  function ttsGenerationDisabledReason(storyboardId, kind = 'dialogue') {
    const running = kind === 'narration'
      ? ttsSbNarrationIds.has(storyboardId)
      : ttsSbIds.has(storyboardId)
    if (running) return '正在生成配音，请等待完成'
    return ttsCapabilityReason.value
  }
  return {
    ttsGenerationDisabledReason,
  }
}
