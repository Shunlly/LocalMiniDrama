import { reactive, ref } from 'vue'

/** 分镜媒体进行中集合和 TTS 路径，一律按 storyboard id 索引 */
export function useFilmCreateInFlightMediaSets() {
  const regeneratingLayoutSbIds = reactive(new Set())
  const sbVideoErrors = ref({})
  const generatingSbImageIds = reactive(new Set())
  const generatingSbVideoIds = reactive(new Set())
  const generatingUniversalSegmentIds = reactive(new Set())
  const generatingSbFirstImageIds = reactive(new Set())
  const generatingSbLastImageIds = reactive(new Set())
  const regenSbImagesForAsset = reactive(new Set())
  const savingSbReferenceImages = reactive(new Set())
  const upscalingSbIds = reactive(new Set())
  const ttsSbIds = reactive(new Set())
  const ttsSbNarrationIds = reactive(new Set())
  const linkingTailFrameIds = reactive(new Set())
  const usingPrevTailAsFirstIds = reactive(new Set())
  const sbDialogueAudioPaths = ref({})
  const sbNarrationAudioPaths = ref({})

  return {
    regeneratingLayoutSbIds,
    sbVideoErrors,
    generatingSbImageIds,
    generatingSbVideoIds,
    generatingUniversalSegmentIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    regenSbImagesForAsset,
    savingSbReferenceImages,
    upscalingSbIds,
    ttsSbIds,
    ttsSbNarrationIds,
    linkingTailFrameIds,
    usingPrevTailAsFirstIds,
    sbDialogueAudioPaths,
    sbNarrationAudioPaths,
  }
}
