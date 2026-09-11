import { ElMessageBox } from '@/utils/elementPlusFeedback.js'

export function shouldBlockSourceIntakeUnload({
  hasUnsavedSourceInput,
  sourceOperationActive,
} = {}) {
  return Boolean(hasUnsavedSourceInput || sourceOperationActive)
}

export async function confirmUnsavedSourceIntakeLeave({
  confirmLeave,
  isConfirmationOpen,
  setConfirmationOpen,
} = {}) {
  if (isConfirmationOpen?.()) return false
  setConfirmationOpen?.(true)
  try {
    await confirmLeave({
      message: '网页地址、原始素材或待上传文件尚未保存，离开后会丢失。',
      title: '离开素材编辑？',
      confirmButtonText: '放弃并离开',
      cancelButtonText: '继续编辑',
      type: 'warning',
      distinguishCancelAndClose: true,
    })
    return true
  } catch (_) {
    return false
  } finally {
    setConfirmationOpen?.(false)
  }
}

export function createSourceIntakeLeaveController({
  sourceOperationActive,
  hasUnsavedSourceInput,
  showWorkflowMessage,
} = {}) {
  let leaveConfirmationOpen = false

  async function confirmSourceInputLeave() {
    if (sourceOperationActive.value) {
      showWorkflowMessage('warning', '素材正在保存、解析或启动工作流，请完成后再离开。')
      return false
    }
    if (!hasUnsavedSourceInput.value) return true
    return confirmUnsavedSourceIntakeLeave({
      isConfirmationOpen: () => leaveConfirmationOpen,
      setConfirmationOpen: (value) => { leaveConfirmationOpen = value },
      confirmLeave: ({ message, title, confirmButtonText, cancelButtonText, type, distinguishCancelAndClose }) => (
        ElMessageBox.confirm(message, title, {
          confirmButtonText,
          cancelButtonText,
          type,
          distinguishCancelAndClose,
        })
      ),
    })
  }

  function handleBeforeUnload(event) {
    if (!hasUnsavedSourceInput.value && !sourceOperationActive.value) return
    event.preventDefault()
    event.returnValue = ''
  }

  return { confirmSourceInputLeave, handleBeforeUnload }
}
