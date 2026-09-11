<template>
  <button
    v-if="variant === 'drama' && imageUrl"
    type="button"
    class="drama-res-cover"
    :aria-label="previewLabel"
    @click="openPreview(imageUrl)"
  >
    <img :src="imageUrl" :alt="imageAlt" />
  </button>
  <div
    v-else-if="variant === 'drama'"
    class="drama-res-cover drama-res-cover--empty"
    role="img"
    :aria-label="emptyLabel"
  >
    <span class="library-placeholder">暂无图</span>
  </div>
  <button
    v-else-if="imageUrl"
    type="button"
    class="library-item-cover"
    :aria-label="previewLabel"
    @click="openPreview(imageUrl)"
  >
    <img :src="imageUrl" :alt="imageAlt" />
  </button>
  <div
    v-else
    class="library-item-cover library-item-cover--empty"
    role="img"
    :aria-label="emptyLabel"
  >
    <span class="library-placeholder">暂无图</span>
  </div>
</template>

<script setup>
// 资源封面只负责预览入口和无图占位，点击预览仍交给页面处理
defineOptions({ inheritAttrs: false })

defineProps({
  variant: { type: String, default: 'library' },
  imageUrl: { type: String, default: '' },
  previewLabel: { type: String, default: '' },
  imageAlt: { type: String, default: '' },
  emptyLabel: { type: String, default: '' },
  openPreview: { type: Function, required: true },
})
</script>

<style scoped>
.library-item-cover { width: 72px; height: 72px; flex-shrink: 0; padding: 0; border: 0; border-radius: 6px; overflow: hidden; background: #27272a; color: inherit; font: inherit; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.library-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-item-cover--empty { cursor: default; }
.library-placeholder { font-size: 0.8rem; color: #71717a; }
.drama-res-cover { width: 72px; height: 72px; padding: 0; border: 0; border-radius: 6px; overflow: hidden; flex-shrink: 0; cursor: zoom-in; background: var(--bg-page, #0f0f12); color: inherit; font: inherit; display: flex; align-items: center; justify-content: center; }
.drama-res-cover img { width: 100%; height: 100%; object-fit: cover; }
.drama-res-cover--empty { cursor: default; }
.library-item-cover:focus-visible,
.drama-res-cover:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.library-item-cover:disabled,
.library-item-cover--empty,
.drama-res-cover:disabled,
.drama-res-cover--empty { cursor: default; }
</style>
