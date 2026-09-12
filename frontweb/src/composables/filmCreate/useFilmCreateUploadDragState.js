import { ref } from 'vue'

/** 分镜和资源上传/拖拽目标，不把 dramaId 当成上传 id */
export function useFilmCreateUploadDragState() {
  const uploadingSbImageId = ref(null)
  const sbImageFileInput = ref(null)
  const sbImageUploadForId = ref(null)
  const resourceImageFileInput = ref(null)
  const resourceUploadType = ref(null)
  const resourceUploadId = ref(null)
  const uploadingResourceId = ref(null)
  const dragOverResourceKey = ref(null)
  const dragOverSbId = ref(null)

  return {
    uploadingSbImageId,
    sbImageFileInput,
    sbImageUploadForId,
    resourceImageFileInput,
    resourceUploadType,
    resourceUploadId,
    uploadingResourceId,
    dragOverResourceKey,
    dragOverSbId,
  }
}
