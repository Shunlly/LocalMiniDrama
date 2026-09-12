import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SOURCE_INTAKE_CANCEL_COPY,
  SOURCE_INTAKE_LEAVE_COPY,
  confirmUnsavedSourceIntakeLeave,
  createSourceIntakeLeaveController,
  shouldBlockSourceIntakeUnload,
} from '../src/components/sourceIntake/sourceIntakeLeaveGuard.js'

test('未保存输入或进行中操作都会拦截离开', () => {
  assert.equal(shouldBlockSourceIntakeUnload({ hasUnsavedSourceInput: false, sourceOperationActive: false }), false)
  assert.equal(shouldBlockSourceIntakeUnload({ hasUnsavedSourceInput: true, sourceOperationActive: false }), true)
  assert.equal(shouldBlockSourceIntakeUnload({ hasUnsavedSourceInput: false, sourceOperationActive: true }), true)
})

test('未保存确认框打开中会直接拒绝，取消则留下编辑', async () => {
  let open = true
  assert.equal(await confirmUnsavedSourceIntakeLeave({
    isConfirmationOpen: () => open,
    setConfirmationOpen: (value) => { open = value },
    confirmLeave: async () => true,
  }), false)

  open = false
  const prompts = []
  const allowed = await confirmUnsavedSourceIntakeLeave({
    isConfirmationOpen: () => open,
    setConfirmationOpen: (value) => { open = value },
    confirmLeave: async (options) => { prompts.push(options); return true },
  })
  assert.equal(allowed, true)
  assert.equal(open, false)
  assert.equal(prompts[0].title, '离开素材编辑？')
  assert.match(prompts[0].message, /尚未保存/)
  assert.equal(prompts[0].confirmButtonText, '放弃并离开')
  assert.equal(prompts[0].cancelButtonText, '继续编辑')

  open = false
  const cancelled = await confirmUnsavedSourceIntakeLeave({
    isConfirmationOpen: () => open,
    setConfirmationOpen: (value) => { open = value },
    confirmLeave: async () => { throw new Error('cancel') },
  })
  assert.equal(cancelled, false)
  assert.equal(open, false)
})

function ref(value) {
  return { value }
}

test('进行中的素材操作会先拦截离开，未保存输入才弹出确认', async () => {
  const messages = []
  const controller = createSourceIntakeLeaveController({
    sourceOperationActive: ref(true),
    hasUnsavedSourceInput: ref(true),
    showWorkflowMessage: (type, message) => messages.push([type, message]),
  })
  assert.equal(await controller.confirmSourceInputLeave(), false)
  assert.equal(messages[0][0], 'warning')
  assert.match(messages[0][1], /请完成后再离开/)

  const clean = createSourceIntakeLeaveController({
    sourceOperationActive: ref(false),
    hasUnsavedSourceInput: ref(false),
    showWorkflowMessage: () => messages.push(['should-not']),
  })
  assert.equal(await clean.confirmSourceInputLeave(), true)
  const event = { preventDefault() { messages.push('prevent') }, returnValue: 'keep' }
  clean.handleBeforeUnload(event)
  assert.equal(event.returnValue, 'keep')
})

test('离开和取消处理文案都是中文', () => {
  for (const copy of [
    SOURCE_INTAKE_LEAVE_COPY.busyMessage,
    SOURCE_INTAKE_LEAVE_COPY.title,
    SOURCE_INTAKE_LEAVE_COPY.message,
    SOURCE_INTAKE_LEAVE_COPY.confirmButtonText,
    SOURCE_INTAKE_LEAVE_COPY.cancelButtonText,
    SOURCE_INTAKE_CANCEL_COPY.title,
    SOURCE_INTAKE_CANCEL_COPY.message,
    SOURCE_INTAKE_CANCEL_COPY.confirmButtonText,
    SOURCE_INTAKE_CANCEL_COPY.cancelButtonText,
  ]) {
    assert.match(copy, /[\u4e00-\u9fff]/)
    assert.doesNotMatch(copy, /\bCancel\b|\bLeave\b|\bDiscard\b/)
  }
  assert.equal(SOURCE_INTAKE_LEAVE_COPY.cancelButtonText, '继续编辑')
  assert.equal(SOURCE_INTAKE_CANCEL_COPY.cancelButtonText, '继续处理')
})
