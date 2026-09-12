export function useFilmCreateFirstLastFrameSetting(deps = {}) {
  const {
    storyboardUseFirstLastFrame,
    gridMode,
    ElMessage,
    saveProjectSettings,
  } = deps
  function onStoryboardUseFirstLastFrameChange() {
    if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
      gridMode.value = 'single'
      ElMessage.info('首尾帧模式已开启，序列图已切换为单张')
    }
    saveProjectSettings(false)
  }
  return {
    onStoryboardUseFirstLastFrameChange,
  }
}
