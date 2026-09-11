<template>
  <div
    class="omni-at-menu"
    :style="menuStyle"
    role="listbox"
    aria-label="插入参考图"
    @mousedown.prevent
  >
    <div v-if="!slots.length" class="omni-at-menu-empty" role="status">{{ emptyText }}</div>
    <button
      v-for="(s, i) in slots"
      :key="s.index"
      type="button"
      class="omni-at-menu-item"
      :class="{ 'omni-at-menu-item--active': menuActiveIndex === i }"
      role="option"
      :aria-selected="menuActiveIndex === i"
      @click="$emit('pick', s.index)"
      @mouseenter="$emit('hover', i)"
    >
      <span class="omni-at-menu-thumb-wrap">
        <img v-if="s.thumbUrl" :src="s.thumbUrl" class="omni-at-menu-thumb" alt="" />
        <span v-else class="omni-at-menu-thumb-ph">{{ (s.name || '?')[0] }}</span>
      </span>
      <span class="omni-at-menu-meta">
        <span class="omni-at-menu-tag" :class="'omni-at-menu-tag--' + s.kind">{{ kindLabel(s.kind) }}</span>
        <span class="omni-at-menu-name">{{ s.name }}</span>
        <span class="omni-at-menu-at">{{ menuPrimaryAt(s) }}</span>
        <span class="omni-at-menu-at-sub">提交 {{ canonicalAt(s.index) }}</span>
      </span>
    </button>
  </div>
</template>

<script setup>
import { OMNI_AT_MENU_EMPTY_TEXT } from './omniAtEditorUx.js'

defineProps({
  slots: { type: Array, default: () => [] },
  menuStyle: { type: Object, default: () => ({}) },
  menuActiveIndex: { type: Number, default: 0 },
  emptyText: { type: String, default: OMNI_AT_MENU_EMPTY_TEXT },
  kindLabel: { type: Function, required: true },
  menuPrimaryAt: { type: Function, required: true },
  canonicalAt: { type: Function, required: true },
})

defineEmits(['pick', 'hover'])
</script>

<style scoped>
.omni-at-menu {
  position: absolute;
  z-index: 5000;
  overflow-y: auto;
  padding: 8px;
  border-radius: 8px;
  background: #1e293b;
  border: 1px solid rgba(248, 250, 252, 0.18);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
html.light .omni-at-menu {
  background: #fff;
  border-color: #e2e8f0;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
}
.omni-at-menu-empty {
  font-size: 12px;
  color: #94a3b8;
  padding: 8px 6px;
  max-width: 260px;
  line-height: 1.45;
}
html.light .omni-at-menu-empty {
  color: #64748b;
}
.omni-at-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0 0 6px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #f1f5f9;
  cursor: pointer;
  text-align: left;
}
.omni-at-menu-item:last-child {
  margin-bottom: 0;
}
.omni-at-menu-item:hover,
.omni-at-menu-item--active {
  background: rgba(148, 163, 184, 0.15);
}
.omni-at-menu-item:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
html.light .omni-at-menu-item {
  color: #0f172a;
}
html.light .omni-at-menu-item:hover,
html.light .omni-at-menu-item--active {
  background: #f1f5f9;
}
.omni-at-menu-thumb-wrap {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 6px;
  overflow: hidden;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.25);
}
html.light .omni-at-menu-thumb-wrap {
  background: #f8fafc;
  border-color: #e2e8f0;
}
.omni-at-menu-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.omni-at-menu-thumb-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 16px;
  font-weight: 600;
  color: #64748b;
}
.omni-at-menu-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.omni-at-menu-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  width: fit-content;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
}
.omni-at-menu-tag--scene {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}
.omni-at-menu-tag--character {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
}
.omni-at-menu-tag--prop {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}
html.light .omni-at-menu-tag {
  color: #475569;
  background: #e2e8f0;
}
html.light .omni-at-menu-tag--scene {
  color: #166534;
  background: #dcfce7;
}
html.light .omni-at-menu-tag--character {
  color: #1e40af;
  background: #dbeafe;
}
html.light .omni-at-menu-tag--prop {
  color: #92400e;
  background: #fef3c7;
}
.omni-at-menu-name {
  font-size: 12px;
  font-weight: 500;
  color: #e2e8f0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html.light .omni-at-menu-name {
  color: #334155;
}
.omni-at-menu-at {
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: #a78bfa;
}
.omni-at-menu-at-sub {
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: #94a3b8;
}
html.light .omni-at-menu-at {
  color: #6d28d9;
}
html.light .omni-at-menu-at-sub {
  color: #64748b;
}
</style>
