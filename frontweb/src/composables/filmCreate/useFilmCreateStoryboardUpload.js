import { ElMessage } from 'element-plus'

export function useFilmCreateStoryboardUpload(deps = {}) {
  const {
    dramaId,
    store,
    uploadAPI,
    imagesAPI,
    storyboardUseFirstLastFrame,
    sbImageUploadForId,
    sbImageUploadSlotById,
    uploadingSbImageId,
    sbSelectedImgId,
    frameTypeForSlot,
    onSelectSbFrameImage,
    refreshStoryboardMediaForCurrentContext,
    restoreSelectionsFromBackend,
  } = deps

  function onUploadSbImageClick(sb, slot = 'first') {
    if (!sb?.id) return
    sbImageUploadForId.value = sb.id
    sbImageUploadSlotById.value = { ...sbImageUploadSlotById.value, [sb.id]: slot }
    if (!storyboardUseFirstLastFrame.value) {
      uploadingSbImageId.value = sb.id
    }
    
  }

  async function doUploadSbImage(sbId, file, slot = 'first') {
    if (!file || !sbId || !dramaId.value) return
    const useSlot = storyboardUseFirstLastFrame.value ? slot : 'first'
    if (storyboardUseFirstLastFrame.value) {
      sbImageUploadSlotById.value = { ...sbImageUploadSlotById.value, [sbId]: useSlot }
    } else {
      uploadingSbImageId.value = sbId
    }
    try {
      const res = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
      const url = res?.url || res?.path
      const localPath = res?.local_path
      if (!url && !localPath) {
        ElMessage.error('上传未返回地址')
        return
      }
      const uploaded = await imagesAPI.upload({
        storyboard_id: sbId,
        drama_id: dramaId.value,
        image_url: url || '',
        local_path: localPath || undefined,
        frame_type: storyboardUseFirstLastFrame.value ? frameTypeForSlot(useSlot) : undefined,
      })
      ElMessage.success(useSlot === 'last' ? '尾帧上传成功' : '首帧上传成功')
      if (uploaded?.id) {
        const sb = (store.storyboards || []).find((b) => b.id === sbId)
        if (sb) onSelectSbFrameImage(sb, uploaded, useSlot)
      } else if (!storyboardUseFirstLastFrame.value) {
        const { [sbId]: _r, ...rest } = sbSelectedImgId.value
        sbSelectedImgId.value = rest
      }
      await refreshStoryboardMediaForCurrentContext(sbId)
      restoreSelectionsFromBackend()
    } catch (e) {
      ElMessage.error(e.message || '上传失败')
    } finally {
      uploadingSbImageId.value = null
      const next = { ...sbImageUploadSlotById.value }
      delete next[sbId]
      sbImageUploadSlotById.value = next
    }
  }

  function onSbImageFileChange(ev) {
    const file = ev.target?.files?.[0]
    const sid = sbImageUploadForId.value
    if (!file || !sid) {
      ev.target.value = ''
      return
    }
    const slot = sbImageUploadSlotById.value[sid] || 'first'
    doUploadSbImage(sid, file, slot).finally(() => {
      sbImageUploadForId.value = null
      ev.target.value = ''
    })
  }

  return {
    onUploadSbImageClick,
    doUploadSbImage,
    onSbImageFileChange,
  }
}
