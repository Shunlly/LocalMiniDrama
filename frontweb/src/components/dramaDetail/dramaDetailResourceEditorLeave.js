/**
 * 剧集详情角色/场景/道具编辑弹窗的脏检查与未保存关闭确认。
 * 只接收页面已有的 ref，不自己创建弹窗状态。
 */

export const DRAMA_DETAIL_RESOURCE_EDITOR_FIELDS = {
  dramaChar: ['name', 'role', 'description', 'personality', 'appearance'],
  dramaScene: ['location', 'time', 'description', 'prompt'],
  dramaProp: ['name', 'type', 'description', 'prompt'],
  char: ['name', 'category', 'description', 'tags'],
  scene: ['location', 'time', 'category', 'description', 'tags'],
  prop: ['name', 'category', 'description', 'tags'],
}

export function snapshotResourceEdit(form, keys) {
  if (!form) return ''
  const snapshot = {}
  for (const key of keys) snapshot[key] = form[key] ?? ''
  return JSON.stringify(snapshot)
}

export function isResourceEditDirty(visible, form, baseline, keys) {
  if (!visible || !form) return false
  if (form.imgUploading || form.imgGenerating) return true
  return snapshotResourceEdit(form, keys) !== baseline
}

export function createDramaDetailResourceEditorLeave({
  editors = {},
  ElMessageBox,
  messageBoxKeyboard = {},
} = {}) {
  function getResourceEditor(kind) {
    const editor = editors[kind]
    if (!editor) return null
    return {
      visible: editor.visible,
      form: editor.form,
      baseline: editor.baseline,
      keys: DRAMA_DETAIL_RESOURCE_EDITOR_FIELDS[kind],
    }
  }

  function captureResourceEditorBaseline(kind) {
    const editor = getResourceEditor(kind)
    if (!editor) return
    editor.baseline.value = snapshotResourceEdit(editor.form.value, editor.keys)
  }

  function hasUnsavedResourceEditor(kind) {
    const editor = getResourceEditor(kind)
    if (!editor) return false
    return isResourceEditDirty(
      editor.visible.value,
      editor.form.value,
      editor.baseline.value,
      editor.keys,
    )
  }

  function hasUnsavedResourceEdits() {
    return hasUnsavedResourceEditor('dramaChar')
      || hasUnsavedResourceEditor('dramaScene')
      || hasUnsavedResourceEditor('dramaProp')
      || hasUnsavedResourceEditor('char')
      || hasUnsavedResourceEditor('scene')
      || hasUnsavedResourceEditor('prop')
  }

  let resourceEditConfirmOpen = false

  async function confirmResourceEditDiscard() {
    await ElMessageBox.confirm(
      '当前角色、场景或道具尚未保存，关闭后本次修改会丢失。',
      '放弃未保存修改？',
      {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        type: 'warning',
        ...messageBoxKeyboard,
      },
    )
  }

  async function confirmDiscardIfNeeded(hasUnsaved) {
    if (!hasUnsaved()) return true
    if (resourceEditConfirmOpen) return false
    resourceEditConfirmOpen = true
    try {
      await confirmResourceEditDiscard()
      return true
    } catch {
      return false
    } finally {
      resourceEditConfirmOpen = false
    }
  }

  async function confirmResourceEditLeave() {
    return confirmDiscardIfNeeded(() => hasUnsavedResourceEdits())
  }

  async function requestResourceEditorClose(kind, done) {
    if (!await confirmDiscardIfNeeded(() => hasUnsavedResourceEditor(kind))) return false
    if (typeof done === 'function') {
      done()
      return true
    }
    const editor = getResourceEditor(kind)
    if (editor) editor.visible.value = false
    return true
  }

  return {
    getResourceEditor,
    captureResourceEditorBaseline,
    hasUnsavedResourceEditor,
    hasUnsavedResourceEdits,
    confirmResourceEditDiscard,
    confirmDiscardIfNeeded,
    confirmResourceEditLeave,
    requestResourceEditorClose,
  }
}
