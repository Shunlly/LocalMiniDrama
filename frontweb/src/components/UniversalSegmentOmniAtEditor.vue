<template>
  <div class="omni-at-wrap" ref="wrapRef">
    <div
      ref="editorRef"
      class="omni-at-editor"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :aria-label="resolvedAriaLabel"
      :aria-expanded="menuOpen"
      aria-haspopup="listbox"
      spellcheck="false"
      data-placeholder="输入 @ 选择素材；编辑区显示 @场景名 / @角色名，保存与提交仍为 @图片N"
      @input="onInput"
      @blur="onBlur"
      @keydown="onKeydown"
      @copy="onCopyCanonicalSelection"
      @cut="onCutCanonicalSelection"
      @paste="onPaste"
      @compositionstart="composing = true"
      @compositionend="onCompositionEnd"
    />
    <teleport to="body">
      <OmniAtMentionMenu
        v-show="menuOpen"
        role="listbox"
        aria-label="插入参考图"
        :menu-style="menuStyle"
        :slots="slots"
        :menu-active-index="menuActiveIndex"
        :kind-label="kindLabel"
        :menu-primary-at="menuPrimaryAt"
        :canonical-at="canonicalAt"
        @pick="onPickSlot"
        @hover="onHoverIndex"
      />
    </teleport>
    <div class="omni-at-footer">
      <el-tooltip :content="copyDisabledReason || '复制为 @图片N 格式（与提交视频一致）'" placement="top">
        <el-button
          type="default"
          text
          size="small"
          class="omni-at-copy-btn"
          :disabled="Boolean(copyDisabledReason)"
          :title="copyDisabledReason || undefined"
          :aria-label="copyDisabledReason ? `复制提示词不可用：${copyDisabledReason}` : '复制提示词'"
          @click="onCopyCanonical"
        >
          <el-icon><DocumentCopy /></el-icon>
          复制提示词
        </el-button>
      </el-tooltip>
    </div>
  </div>
</template>

<script setup>
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { computed, ref, useAttrs, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { DocumentCopy } from '@element-plus/icons-vue'
import {
  canonicalAtToken,
  makeDisplayAtToken as buildDisplayAtToken,
  omniSlotKindLabel,
  toCanonicalOmniText,
} from '@/utils/universalSegmentOmniAt.js'
import OmniAtMentionMenu from './omniAt/OmniAtMentionMenu.vue'
import {
  applyPlainTextToOmniEditor,
  getCanonicalSelection,
  getCaretCanonicalOffset,
  OMNI_AT_CHIP_CLASS,
  refreshOmniChipLabels,
  serializeOmniEditor,
  serializeOmniSelection,
  setCaretCanonicalOffset,
  updateOmniChipDisplay,
} from './omniAt/omniAtEditorDom.js'
import {
  computeMenuPosition,
  describeCopyDisabledReason,
  insertCanonicalTokenAtAt,
  nextMenuActiveIndex,
  replaceSerializedRange,
  shouldOpenAtMenu,
} from './omniAt/omniAtEditorUx.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** { index: number, kind: 'scene'|'character'|'prop'|'free', name: string, thumbUrl: string }[] */
  slots: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'blur'])

const attrs = useAttrs()
const resolvedAriaLabel = computed(() => props.ariaLabel || attrs['aria-label'] || '全能片段描述')

const wrapRef = ref(null)
const editorRef = ref(null)
const menuOpen = ref(false)
const menuStyle = ref({ top: '0px', left: '0px' })
const menuActiveIndex = ref(0)
const composing = ref(false)

/** 'insert' at lone @ | 'replace' chip */
let menuMode = 'insert'
let insertAtOffset = 0
let replaceChipEl = null

let skipNextModelWatch = false

function kindLabel(kind) {
  return omniSlotKindLabel(kind)
}

function canonicalAt(index) {
  return canonicalAtToken(index) || ''
}

function makeDisplayAtToken(index) {
  return buildDisplayAtToken(index, props.slots)
}

function menuPrimaryAt(s) {
  return makeDisplayAtToken(s.index)
}

function bindChip(span) {
  span.addEventListener('mousedown', onChipMouseDown)
  span.addEventListener('click', onChipClick)
  span.addEventListener('keydown', onChipKeydown)
}

function applyPlainTextToEditor(el, text) {
  applyPlainTextToOmniEditor(el, text, props.slots, { bindChip })
}

function serializeEditor(el) {
  return serializeOmniEditor(el)
}

function applyCanonicalAndEmit(el, next, caret) {
  applyPlainTextToEditor(el, next)
  const serialized = serializeEditor(el)
  skipNextModelWatch = true
  emit('update:modelValue', serialized)
  nextTick(() => {
    setCaretCanonicalOffset(el, caret)
    el.focus()
  })
}

function positionMenuNearRect(rect) {
  menuStyle.value = computeMenuPosition(rect, {
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  })
}

function positionMenuAtCaret() {
  const el = editorRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    const r = el.getBoundingClientRect()
    positionMenuNearRect({ left: r.left, top: r.top, bottom: r.top + 24, right: r.right })
    return
  }
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const rects = range.getClientRects()
  const rect = rects.length ? rects[0] : range.getBoundingClientRect()
  positionMenuNearRect(rect)
}

function closeMenu() {
  menuOpen.value = false
  menuMode = 'insert'
  replaceChipEl = null
  menuActiveIndex.value = 0
}

function openInsertMenu() {
  menuMode = 'insert'
  replaceChipEl = null
  menuActiveIndex.value = 0
  nextTick(() => {
    positionMenuAtCaret()
    menuOpen.value = true
  })
}

function maybeOpenAtMenu() {
  const el = editorRef.value
  if (!el) return
  const s = serializeEditor(el)
  const off = getCaretCanonicalOffset(el)
  if (!shouldOpenAtMenu(s, off, composing.value)) return
  insertAtOffset = off
  openInsertMenu()
}

function onInput() {
  const el = editorRef.value
  if (!el) return
  const next = serializeEditor(el)
  skipNextModelWatch = true
  emit('update:modelValue', next)
  maybeOpenAtMenu()
}

function onBlur(e) {
  const rel = e.relatedTarget
  if (rel && rel.closest?.('.omni-at-menu')) return
  closeMenu()
  emit('blur', e)
}

function onHoverIndex(index) {
  menuActiveIndex.value = index
}

function onKeydown(e) {
  if (e.key === 'Escape' && menuOpen.value) {
    e.preventDefault()
    closeMenu()
    return
  }
  if (!menuOpen.value) return
  const list = props.slots || []
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!list.length) return
    const delta = e.key === 'ArrowDown' ? 1 : -1
    menuActiveIndex.value = nextMenuActiveIndex(menuActiveIndex.value, delta, list.length)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const slot = list[menuActiveIndex.value]
    if (slot) onPickSlot(slot.index)
  }
}

function onCopyCanonicalSelection(e) {
  const el = editorRef.value
  const text = serializeOmniSelection(el)
  if (!e?.clipboardData) return
  e.clipboardData.setData('text/plain', text)
  e.preventDefault()
}

function onCutCanonicalSelection(e) {
  const el = editorRef.value
  if (!el) return
  const text = serializeOmniSelection(el)
  if (e?.clipboardData) {
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }
  const { start, end } = getCanonicalSelection(el)
  const replaced = replaceSerializedRange(serializeEditor(el), start, end, '')
  applyCanonicalAndEmit(el, replaced.next, replaced.caret)
}

function onPaste(e) {
  e.preventDefault()
  const el = editorRef.value
  if (!el) return
  const pasted = toCanonicalOmniText(e.clipboardData?.getData('text/plain') ?? '', props.slots)
  const { start, end } = getCanonicalSelection(el)
  const replaced = replaceSerializedRange(serializeEditor(el), start, end, pasted)
  applyCanonicalAndEmit(el, replaced.next, replaced.caret)
}

function onCompositionEnd() {
  composing.value = false
  maybeOpenAtMenu()
}

function onChipMouseDown(e) {
  e.preventDefault()
}

function onChipKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  onChipClick(e)
}

function onChipClick(e) {
  const chip = e.currentTarget
  if (!(chip instanceof HTMLElement) || !chip.classList.contains(OMNI_AT_CHIP_CLASS)) return
  e.preventDefault()
  e.stopPropagation()
  editorRef.value?.focus()
  menuMode = 'replace'
  replaceChipEl = chip
  menuActiveIndex.value = 0
  const r = chip.getBoundingClientRect()
  positionMenuNearRect(r)
  menuOpen.value = true
}

function onPickSlot(index) {
  const el = editorRef.value
  if (!el) return
  const token = canonicalAt(index)
  if (!token) {
    closeMenu()
    return
  }
  if (menuMode === 'replace' && replaceChipEl) {
    updateOmniChipDisplay(replaceChipEl, {
      index,
      display: makeDisplayAtToken(index),
      canonical: token,
    })
    const next = serializeEditor(el)
    skipNextModelWatch = true
    emit('update:modelValue', next)
    closeMenu()
    return
  }
  const inserted = insertCanonicalTokenAtAt(serializeEditor(el), insertAtOffset, token)
  if (!inserted) {
    closeMenu()
    return
  }
  applyCanonicalAndEmit(el, inserted.next, inserted.caret)
  closeMenu()
}

watch(
  () => props.modelValue,
  (v) => {
    if (skipNextModelWatch) {
      skipNextModelWatch = false
      return
    }
    const el = editorRef.value
    if (!el) return
    const next = v == null ? '' : String(v)
    const cur = serializeEditor(el)
    if (cur === next) return
    const hadFocus = document.activeElement === el
    applyPlainTextToEditor(el, next)
    if (hadFocus) {
      setCaretCanonicalOffset(el, next.length)
    }
  },
)

watch(
  () => props.slots,
  () => {
    refreshOmniChipLabels(editorRef.value, props.slots)
  },
  { deep: true },
)

function onDocClick(ev) {
  if (!menuOpen.value) return
  const t = ev.target
  if (wrapRef.value?.contains(t)) return
  if (t.closest?.('.omni-at-menu')) return
  closeMenu()
}

const copyDisabledReason = computed(() => describeCopyDisabledReason(props.modelValue, props.slots))

async function onCopyCanonical() {
  if (copyDisabledReason.value) return
  const el = editorRef.value
  const text = serializeEditor(el)
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制（@图片N 格式，与提交视频一致）')
  } catch (_) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      ElMessage.success('已复制（@图片N 格式）')
    } catch (e2) {
      if (isUserFacingAbort(e2)) return
      ElMessage.error(toUserFacingError(e2, '复制失败'))
    }
  }
}

onMounted(() => {
  const el = editorRef.value
  if (el) applyPlainTextToEditor(el, props.modelValue == null ? '' : String(props.modelValue))
  document.addEventListener('click', onDocClick, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
})
</script>

<style scoped>
.omni-at-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.omni-at-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 6px 2px 0;
  flex-shrink: 0;
}
.omni-at-copy-btn {
  color: #a78bfa !important;
}
.omni-at-copy-btn:hover {
  color: #c4b5fd !important;
}
html.light .omni-at-copy-btn {
  color: #6d28d9 !important;
}
.omni-at-editor {
  flex: 1;
  min-height: 220px;
  max-height: 520px;
  overflow-y: auto;
  padding: 8px 11px;
  font-size: 13px;
  line-height: 1.55;
  color: #e5e7eb;
  background: var(--omni-editor-bg, #141414);
  border: 1px solid #4c4d4f;
  border-radius: 4px;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
}
.omni-at-editor:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.25) inset;
}
.omni-at-editor:empty::before {
  content: attr(data-placeholder);
  color: #6b7280;
  pointer-events: none;
}
:deep(.omni-at-chip) {
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
  margin: 0 1px;
  padding: 0 5px;
  border-radius: 4px;
  font-weight: 600;
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.22);
  border: 1px solid rgba(167, 139, 250, 0.45);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
:deep(.omni-at-chip:hover) {
  background: rgba(139, 92, 246, 0.38);
  border-color: #a78bfa;
}
:deep(.omni-at-chip:focus-visible) {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
html.light .omni-at-editor {
  color: #1f2937;
  background: var(--el-fill-color-blank, #fff);
  border-color: var(--el-border-color, #dcdfe6);
}
html.light .omni-at-editor:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.2) inset;
}
html.light :deep(.omni-at-chip) {
  color: #5b21b6;
  background: rgba(124, 58, 237, 0.12);
  border-color: rgba(124, 58, 237, 0.35);
}
html.light :deep(.omni-at-chip:hover) {
  background: rgba(124, 58, 237, 0.2);
}
</style>
