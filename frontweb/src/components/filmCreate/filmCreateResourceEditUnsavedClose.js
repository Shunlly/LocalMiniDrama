/**
 * 制作页场景/道具编辑弹窗的未保存关闭确认文案与草稿比对。
 */

export const RESOURCE_EDIT_UNSAVED_CLOSE_TITLE = '放弃未保存修改？'
export const RESOURCE_EDIT_UNSAVED_CLOSE_CONFIRM_TEXT = '放弃修改'
export const RESOURCE_EDIT_UNSAVED_CLOSE_CANCEL_TEXT = '继续编辑'
export const RESOURCE_EDIT_UNSAVED_CLOSE_OPTIONS = {
  type: 'warning',
  confirmButtonText: RESOURCE_EDIT_UNSAVED_CLOSE_CONFIRM_TEXT,
  cancelButtonText: RESOURCE_EDIT_UNSAVED_CLOSE_CANCEL_TEXT,
  distinguishCancelAndClose: true,
}

export const SCENE_EDIT_UNSAVED_CLOSE_MESSAGE = '场景编辑还没有保存，关闭会丢失这些修改。'
export const PROP_EDIT_UNSAVED_CLOSE_MESSAGE = '道具编辑还没有保存，关闭会丢失这些修改。'

export function captureResourceEditDraft(form, refImage) {
  return JSON.stringify({
    form: form ?? null,
    refImageDataUrl: refImage?.dataUrl ?? '',
    refImageFilename: refImage?.filename ?? '',
  })
}

/** 未打开的编辑弹窗不能算未保存，否则制作页同步剧集 query 也会弹出离开确认。 */
export function isVisibleEditorDraftDirty(isOpen, currentDraft, baseline) {
  if (!isOpen) return false
  return currentDraft !== baseline
}

export function createResourceEditUnsavedCloser({ message, confirmBox }) {
  if (typeof confirmBox !== 'function') {
    throw new Error('场景/道具未保存关闭确认缺少 confirmBox')
  }
  let pending = null

  async function confirmClose(hasUnsaved) {
    if (!hasUnsaved()) return true
    if (pending) return pending
    pending = (async () => {
      try {
        await confirmBox(
          message,
          RESOURCE_EDIT_UNSAVED_CLOSE_TITLE,
          RESOURCE_EDIT_UNSAVED_CLOSE_OPTIONS,
        )
        return true
      } catch {
        return false
      }
    })()
    try {
      return await pending
    } finally {
      pending = null
    }
  }

  async function handleBeforeClose(hasUnsaved, done) {
    if (typeof done !== 'function') return
    if (await confirmClose(hasUnsaved)) done()
  }

  async function requestClose(hasUnsaved, close) {
    if (await confirmClose(hasUnsaved)) close()
  }

  return { confirmClose, handleBeforeClose, requestClose }
}
