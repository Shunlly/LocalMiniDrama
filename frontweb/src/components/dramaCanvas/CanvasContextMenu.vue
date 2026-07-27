<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="canvas-context-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      tabindex="-1"
      aria-label="画布操作菜单"
      @mousedown.stop
      @contextmenu.prevent
      @keydown.esc.prevent="close"
    >
      <template v-if="!freeMode">
        <div class="ctx-title">在此添加</div>
        <button type="button" class="ctx-item" @click="pick('storyboard')">分镜</button>
        <button type="button" class="ctx-item" @click="pick('character')">角色</button>
        <button type="button" class="ctx-item" @click="pick('scene')">场景</button>
        <button type="button" class="ctx-item" @click="pick('prop')">道具</button>
        <div class="ctx-divider" />
        <button type="button" class="ctx-item" @click="pick('episode')">新集</button>
      </template>
      <template v-if="freeMode">
        <div class="ctx-divider" />
        <div class="ctx-title">自由节点</div>
        <button type="button" class="ctx-item" @click="pickFree('text')">文本</button>
        <button type="button" class="ctx-item" @click="pickFree('image')">图片</button>
        <button type="button" class="ctx-item" @click="pickFree('video')">视频</button>
        <button type="button" class="ctx-item" @click="pickFree('config')">配置</button>
        <button type="button" class="ctx-item" @click="pickFree('reference')">引用</button>
      </template>
    </div>
    <div v-if="visible" class="canvas-context-backdrop" @mousedown="close" @contextmenu.prevent="close" />
  </Teleport>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  freeMode: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'free-node', 'close'])
const menuRef = ref(null)
let returnFocus = null

watch(() => props.visible, async (visible, wasVisible) => {
  if (visible) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    menuRef.value?.focus()
    return
  }
  if (wasVisible) {
    returnFocus?.focus()
    returnFocus = null
  }
})

function pick(type) {
  emit('select', type)
  emit('close')
}

function pickFree(type) {
  emit('free-node', type)
  emit('close')
}

function close() {
  emit('close')
}
</script>

<style scoped>
.canvas-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2999;
}
.canvas-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 140px;
  padding: 6px 0;
  border-radius: 8px;
  border: 1px solid var(--border-muted, #3f3f46);
  background: var(--bg-card, #18181b);
  box-shadow: var(--shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
}
.canvas-context-menu:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}
.ctx-title {
  padding: 4px 12px 6px;
  font-size: 10px;
  color: var(--text-subtle, #71717a);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ctx-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary, #e4e4e7);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.ctx-item:hover {
  background: rgba(129, 140, 248, 0.15);
  color: #c7d2fe;
}
.ctx-item:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: -2px;
}
.ctx-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--border-muted, #3f3f46);
}

:global(html.light) .ctx-item:hover,
:global(html.light) .ctx-item:focus-visible {
  color: #4338ca;
}

:global(html.light) .ctx-item:focus-visible {
  outline-color: #6d28d9;
}
</style>
