import { computed } from 'vue'

export function useFilmCreateMediaPickerCopy({
  globalMediaPickerMode,
  globalMediaPickerTarget,
  currentEpisode,
  store,
} = {}) {
  const globalMediaPickerAccept = computed(() => 'image')
  const globalMediaPickerTitle = computed(() => (
    globalMediaPickerMode.value === 'reference-primary'
      ? '从素材中心选择视频主参考图'
      : '从素材中心添加自由参考图'
  ))
  const globalMediaPickerContext = computed(() => {
    const storyboard = globalMediaPickerTarget.value
    const episodeNumber = currentEpisode.value?.episode_number
    return {
      projectTitle: store.drama?.title || '未命名项目',
      episodeLabel: episodeNumber != null ? `第${episodeNumber}集` : '',
      storyboardLabel: storyboard?.storyboard_number != null ? `分镜 #${storyboard.storyboard_number}` : '',
      usageLabel: globalMediaPickerMode.value === 'reference-primary'
        ? '将放到自由参考图首位，作为无主图时的视频主参考'
        : '将追加到当前分镜的自由参考图',
    }
  })
  return {
    globalMediaPickerAccept,
    globalMediaPickerTitle,
    globalMediaPickerContext,
  }
}
