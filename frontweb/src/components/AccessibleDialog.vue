<template>
  <el-dialog
    ref="dialogRef"
    class="accessible-dialog"
    v-bind="$attrs"
    :model-value="modelValue"
    :close-on-click-modal="closeOnClickModal"
    :close-on-press-escape="closeOnPressEscape"
    :data-accessible-dialog-id="instanceId"
    append-to="body"
    :append-to-body="true"
    @update:model-value="handleModelValueUpdate"
    @open="handleOpen"
    @opened="handleOpened"
    @close="handleClose"
    @closed="handleClosed"
    @open-auto-focus="handleOpenAutoFocus"
    @close-auto-focus="handleCloseAutoFocus"
  >
    <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </el-dialog>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, unref, watch } from 'vue'
import { dialogAccessibility } from '@/utils/dialogAccessibility.js'

defineOptions({
  name: 'AccessibleDialog',
  inheritAttrs: false,
})

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 默认禁止点遮罩关闭，避免表单弹窗被非语义点击丢掉。
  closeOnClickModal: { type: Boolean, default: false },
  // 默认保留 Esc，交给 Element Plus 焦点陷阱退出，而不是锁死在弹窗里。
  closeOnPressEscape: { type: Boolean, default: true },
})

const emit = defineEmits([
  'update:modelValue',
  'open',
  'opened',
  'close',
  'closed',
  'openAutoFocus',
  'closeAutoFocus',
])

const instanceId = `accessible-dialog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const dialogRef = ref(null)
let accessibilityToken = null
let pendingOpener = null
let focusApplied = false
let focusScheduled = false
let focusScheduleVersion = 0
let lastFocusedElement = null
let disposed = false

function currentActiveElement() {
  return globalThis.document?.activeElement || null
}

function firstElementNode(candidates) {
  for (const candidate of candidates) {
    if (candidate?.nodeType === 1) return candidate
  }
  return null
}

function resolveDialogElement() {
  const contentRef = unref(dialogRef.value?.dialogContentRef)
  const fromRef = firstElementNode([
    contentRef?.$el,
    unref(contentRef?.dialogRef),
    contentRef,
    unref(dialogRef.value?.dialogRef),
    dialogRef.value?.$el,
  ])
  if (fromRef) return fromRef
  // Element Plus 只对外暴露 resetPosition，必须按实例 data-id 回查真实 DOM。
  return globalThis.document?.querySelector?.(`[data-accessible-dialog-id="${instanceId}"]`) || null
}

function ensureRegistered() {
  if (accessibilityToken) {
    applyDialogAccessibleName()
    return accessibilityToken
  }
  const element = resolveDialogElement()
  if (!element) return null
  accessibilityToken = dialogAccessibility.register(element, pendingOpener)
  applyDialogAccessibleName()
  return accessibilityToken
}

function resolveLabelledDialogElement() {
  const dialog = resolveDialogElement()
  if (!dialog) return null
  if (typeof dialog.closest === 'function') {
    return dialog.closest('[role="dialog"]') || dialog
  }
  return dialog
}

function dialogCloseButtonAccessibleName(titleText) {
  const title = String(titleText || '').replace(/\s+/g, ' ').trim()
  if (!title || title.startsWith('关闭')) return '关闭此对话框'
  return /^[\u4e00-\u9fff]/.test(title) ? `关闭${title}` : `关闭 ${title}`
}

function applyDialogCloseButtonName(root) {
  if (!root || typeof root.querySelector !== 'function') return
  const closeBtn = root.querySelector('.el-dialog__headerbtn')
  if (!closeBtn || typeof closeBtn.setAttribute !== 'function') return
  const titleEl = root.querySelector('.el-dialog__title')
  closeBtn.setAttribute('aria-label', dialogCloseButtonAccessibleName(titleEl?.textContent))
}

function applyDialogAccessibleName() {
  const labelled = resolveLabelledDialogElement()
  if (!labelled || typeof labelled.querySelector !== 'function') return
  applyDialogCloseButtonName(labelled)
  if (typeof labelled.setAttribute !== 'function') return
  const titleEl = labelled.querySelector('.el-dialog__title')
  if (!titleEl) return
  if (!titleEl.id) {
    const titleId = `${instanceId}-title`
    if (typeof titleEl.setAttribute === 'function') titleEl.setAttribute('id', titleId)
    else titleEl.id = titleId
  }
  labelled.setAttribute('aria-labelledby', titleEl.id)
  const ariaLabel = typeof labelled.getAttribute === 'function' ? labelled.getAttribute('aria-label') : ''
  const titleText = String(titleEl.textContent || '').replace(/\s+/g, ' ').trim()
  if (ariaLabel && titleText && ariaLabel === titleText) {
    labelled.removeAttribute?.('aria-label')
  }
}

function classNameOf(element) {
  const value = element?.className
  if (typeof value === 'string') return value
  if (typeof value?.baseVal === 'string') return value.baseVal
  return ''
}

function isLikelyCloseControl(element) {
  let current = element
  while (current) {
    const className = classNameOf(current)
    if (className.includes('el-dialog__headerbtn') || className.includes('el-dialog__close')) {
      return true
    }
    current = current.parentElement
  }
  return false
}

function markFocusApplied(element) {
  lastFocusedElement = element || currentActiveElement()
  focusApplied = true
}

function hasRetainedFocus() {
  if (!focusApplied) return false
  const active = currentActiveElement()
  if (!active) return false
  if (lastFocusedElement && active === lastFocusedElement && !isLikelyCloseControl(active)) {
    return true
  }
  const dialog = resolveDialogElement()
  if (!dialog) return false
  if (active === dialog) return true
  if (typeof dialog.contains === 'function' && dialog.contains(active)) {
    return !isLikelyCloseControl(active)
  }
  return false
}

function focusDialogFallback() {
  // 没有可聚焦字段时，把焦点放到对话框容器，避免焦点留在已被 inert 的页面上。
  const dialog = resolveDialogElement()
  if (!dialog) return false
  if (typeof dialog.setAttribute === 'function' && typeof dialog.hasAttribute === 'function' && !dialog.hasAttribute('tabindex')) {
    dialog.setAttribute('tabindex', '-1')
  }
  if (typeof dialog.focus !== 'function') return false
  try {
    dialog.focus({ preventScroll: true })
  } catch {
    dialog.focus()
  }
  const active = currentActiveElement()
  if (active && active !== dialog) return false
  markFocusApplied(dialog)
  return true
}

function applyInitialFocus(allowDialogFallback = false) {
  if (!props.modelValue || disposed) return false
  if (hasRetainedFocus()) return true
  const token = ensureRegistered()
  if (!token) return false
  if (dialogAccessibility.focus(token)) {
    const active = currentActiveElement()
    if (!isLikelyCloseControl(active)) {
      markFocusApplied(active)
      return true
    }
  }
  if (!allowDialogFallback) return false
  return focusDialogFallback()
}

function cancelScheduledFocus() {
  focusScheduleVersion += 1
  focusScheduled = false
}

function scheduleInitialFocus() {
  if (focusApplied || focusScheduled) return
  focusScheduled = true
  const scheduleVersion = ++focusScheduleVersion
  nextTick(() => {
    nextTick(() => {
      if (disposed || scheduleVersion !== focusScheduleVersion) return
      focusScheduled = false
      if (props.modelValue) applyInitialFocus()
    })
  })
}

function unregister() {
  if (!accessibilityToken) return
  dialogAccessibility.unregister(accessibilityToken)
  accessibilityToken = null
}

function handleModelValueUpdate(value) {
  emit('update:modelValue', value)
}

function handleOpen(...args) {
  if (!ensureRegistered()) {
    nextTick(() => {
      if (!disposed && props.modelValue) ensureRegistered()
    })
  }
  emit('open', ...args)
}

function handleOpenAutoFocus(event, ...args) {
  event?.preventDefault?.()
  scheduleInitialFocus()
  emit('openAutoFocus', event, ...args)
}

function handleOpened(...args) {
  applyDialogAccessibleName()
  if (!hasRetainedFocus()) {
    focusApplied = false
    lastFocusedElement = null
    if (!applyInitialFocus(true)) {
      nextTick(() => {
        if (disposed || !props.modelValue || hasRetainedFocus()) return
        focusApplied = false
        applyInitialFocus(true)
      })
    }
  }
  nextTick(() => {
    if (!disposed && props.modelValue) applyDialogAccessibleName()
  })
  emit('opened', ...args)
}

function handleClose(...args) {
  emit('close', ...args)
}

function handleCloseAutoFocus(event, ...args) {
  event?.preventDefault?.()
  emit('closeAutoFocus', event, ...args)
}

function handleClosed(...args) {
  cancelScheduledFocus()
  unregister()
  pendingOpener = null
  lastFocusedElement = null
  focusApplied = false
  emit('closed', ...args)
}

watch(
  () => props.modelValue,
  (visible, wasVisible) => {
    if (!visible) {
      cancelScheduledFocus()
      return
    }
    if (wasVisible) return
    cancelScheduledFocus()
    pendingOpener = currentActiveElement()
    lastFocusedElement = null
    focusApplied = false
  },
  { immediate: true, flush: 'sync' },
)

onBeforeUnmount(() => {
  disposed = true
  cancelScheduledFocus()
  unregister()
})
</script>

<style>
.accessible-dialog.el-dialog {
  box-sizing: border-box;
  max-width: calc(100vw - 24px);
}

.accessible-dialog.el-dialog:focus-visible {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: 2px;
}

@media (max-width: 520px) {
  .accessible-dialog.el-dialog {
    display: flex;
    width: calc(100vw - 24px) !important;
    max-height: calc(100dvh - 24px);
    flex-direction: column;
    margin-top: 12px !important;
    margin-bottom: 12px !important;
  }

  .accessible-dialog.el-dialog > .el-dialog__header,
  .accessible-dialog.el-dialog > .el-dialog__body,
  .accessible-dialog.el-dialog > .el-dialog__footer {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }

  .accessible-dialog.el-dialog > .el-dialog__body {
    min-height: 0;
    flex: 1 1 auto;
    overflow-x: auto;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
}
</style>
