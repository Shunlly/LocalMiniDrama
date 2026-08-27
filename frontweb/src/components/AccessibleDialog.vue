<template>
  <el-dialog
    ref="dialogRef"
    class="accessible-dialog"
    v-bind="$attrs"
    :model-value="modelValue"
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

const dialogRef = ref(null)
let accessibilityToken = null
let pendingOpener = null
let focusApplied = false
let focusScheduled = false
let focusScheduleVersion = 0
let disposed = false

function currentActiveElement() {
  return globalThis.document?.activeElement || null
}

function resolveDialogElement() {
  const contentRef = unref(dialogRef.value?.dialogContentRef)
  const element = contentRef?.$el || unref(contentRef?.dialogRef) || contentRef
  return element?.nodeType === 1 ? element : null
}

function ensureRegistered() {
  if (accessibilityToken) return accessibilityToken
  const element = resolveDialogElement()
  if (!element) return null
  accessibilityToken = dialogAccessibility.register(element, pendingOpener)
  return accessibilityToken
}

function applyInitialFocus() {
  if (focusApplied) return
  const token = ensureRegistered()
  if (!token) return
  dialogAccessibility.focus(token)
  focusApplied = true
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

function handleOpenAutoFocus(...args) {
  scheduleInitialFocus()
  emit('openAutoFocus', ...args)
}

function handleOpened(...args) {
  if (!focusScheduled) applyInitialFocus()
  emit('opened', ...args)
}

function handleClose(...args) {
  emit('close', ...args)
}

function handleCloseAutoFocus(...args) {
  emit('closeAutoFocus', ...args)
}

function handleClosed(...args) {
  cancelScheduledFocus()
  unregister()
  pendingOpener = null
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
