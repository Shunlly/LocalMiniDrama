import { ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { isAiConfigRoundTrip } from './sourceIntakeDraft.js'

export const SOURCE_INTAKE_LEAVE_COPY = Object.freeze({
  busyMessage: '素材正在保存、解析或启动工作流，请完成后再离开。',
  title: '离开素材编辑？',
  message: '网页地址、原始素材或待上传文件尚未保存，离开后会丢失。',
  confirmButtonText: '放弃并离开',
  cancelButtonText: '继续编辑',
})

export const SOURCE_INTAKE_CANCEL_COPY = Object.freeze({
  title: '取消处理？',
  message: '取消后当前流程会停止，已完成步骤会保留，可稍后重新启动。',
  confirmButtonText: '确认取消',
  cancelButtonText: '继续处理',
})

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
      message: SOURCE_INTAKE_LEAVE_COPY.message,
      title: SOURCE_INTAKE_LEAVE_COPY.title,
      confirmButtonText: SOURCE_INTAKE_LEAVE_COPY.confirmButtonText,
      cancelButtonText: SOURCE_INTAKE_LEAVE_COPY.cancelButtonText,
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

export async function confirmSourceIntakeCancel({
  confirmCancel,
  isConfirmationOpen,
  setConfirmationOpen,
} = {}) {
  if (isConfirmationOpen?.()) return false
  setConfirmationOpen?.(true)
  try {
    await confirmCancel({
      message: SOURCE_INTAKE_CANCEL_COPY.message,
      title: SOURCE_INTAKE_CANCEL_COPY.title,
      confirmButtonText: SOURCE_INTAKE_CANCEL_COPY.confirmButtonText,
      cancelButtonText: SOURCE_INTAKE_CANCEL_COPY.cancelButtonText,
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
  persistDraftForRoundTrip,
  clearDraft,
} = {}) {
  let leaveConfirmationOpen = false

  async function confirmSourceInputLeave(to) {
    if (sourceOperationActive.value) {
      showWorkflowMessage('warning', SOURCE_INTAKE_LEAVE_COPY.busyMessage)
      return false
    }
    if (isAiConfigRoundTrip(to)) {
      persistDraftForRoundTrip?.()
      return true
    }
    if (!hasUnsavedSourceInput.value) return true
    const allowed = await confirmUnsavedSourceIntakeLeave({
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
    if (allowed) clearDraft?.()
    return allowed
  }

  async function confirmCancelProcessing() {
    return confirmSourceIntakeCancel({
      isConfirmationOpen: () => leaveConfirmationOpen,
      setConfirmationOpen: (value) => { leaveConfirmationOpen = value },
      confirmCancel: ({ message, title, confirmButtonText, cancelButtonText, type, distinguishCancelAndClose }) => (
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

  return { confirmSourceInputLeave, confirmCancelProcessing, handleBeforeUnload }
}
