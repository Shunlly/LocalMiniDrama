import { ref } from 'vue'

/** 批量生图/生视频进度和视频参数弹窗，不按 dramaId 索引 */
export function useFilmCreateBatchMediaState() {
  const regenSbImagesProgress = ref({})
  const batchImageRunning = ref(false)
  const batchImageStopping = ref(false)
  const batchImageProgress = ref({ current: 0, total: 0, failed: 0 })
  const inferringParams = ref(false)
  const showVideoParamsDialog = ref(false)
  const videoParamsTarget = ref(null)
  const videoParamsSaving = ref(false)
  const splitByAudioLoading = ref(false)
  const batchImageErrors = ref([])
  const batchVideoRunning = ref(false)
  const batchVideoStopping = ref(false)
  const batchVideoProgress = ref({ current: 0, total: 0, failed: 0 })
  const batchVideoErrors = ref([])
  const videoFrameContiguity = ref(false)

  return {
    regenSbImagesProgress,
    batchImageRunning,
    batchImageStopping,
    batchImageProgress,
    inferringParams,
    showVideoParamsDialog,
    videoParamsTarget,
    videoParamsSaving,
    splitByAudioLoading,
    batchImageErrors,
    batchVideoRunning,
    batchVideoStopping,
    batchVideoProgress,
    batchVideoErrors,
    videoFrameContiguity,
  }
}
