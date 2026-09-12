import { ref } from 'vue'

/** 分镜生成开关，与项目 id / 剧集 id 无关 */
export function useFilmCreateStoryboardGenerateSettings() {
  const storyboardCount = ref(null)
  const videoDuration = ref(null)
  const storyboardIncludeNarration = ref(false)
  const storyboardUniversalOmni = ref(false)
  const storyboardUseFirstLastFrame = ref(false)
  const exportingStoryboardSheet = ref(false)
  const lastFrameUseFirstLayoutLock = ref(true)
  const gridMode = ref('single')

  return {
    storyboardCount,
    videoDuration,
    storyboardIncludeNarration,
    storyboardUniversalOmni,
    storyboardUseFirstLastFrame,
    exportingStoryboardSheet,
    lastFrameUseFirstLayoutLock,
    gridMode,
  }
}
