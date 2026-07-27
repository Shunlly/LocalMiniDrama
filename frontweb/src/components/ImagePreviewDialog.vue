<template>
  <AccessibleDialog
    :model-value="modelValue"
    class="image-preview-dialog"
    :title="title"
    width="min(960px, calc(100vw - 48px))"
    append-to-body
    align-center
    destroy-on-close
    :show-close="true"
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    :aria-label="title"
    @update:model-value="updateVisible"
    @closed="emit('closed')"
  >
    <div class="image-preview-stage">
      <div v-if="loadState === 'loading'" class="image-preview-status" role="status" aria-live="polite">
        正在验证图片…
      </div>
      <div v-else-if="loadState === 'error'" class="image-preview-status is-error" role="alert">
        图片无法加载，请检查文件是否仍存在或重新生成。
      </div>
      <img
        v-if="src && loadState !== 'error'"
        class="image-preview-media"
        :class="{ 'is-checking': loadState === 'loading' }"
        :src="src"
        :alt="resolvedAlt"
        @load="handleImageLoad"
        @error="handleImageError"
      />
    </div>
    <template #footer>
      <el-button type="primary" @click="close">关闭预览</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { imageHasRenderableDimensions, isSafeImagePreviewUrl } from '@/utils/mediaUrl.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  title: { type: String, default: '图片预览' },
})

const emit = defineEmits(['update:modelValue', 'closed'])

const resolvedAlt = computed(() => props.alt.trim() || props.title)
const loadState = ref('loading')

watch(
  () => [props.modelValue, props.src],
  ([visible, source]) => {
    if (!visible) return
    loadState.value = isSafeImagePreviewUrl(source) ? 'loading' : 'error'
  },
  { immediate: true },
)

function updateVisible(visible) {
  emit('update:modelValue', visible)
}

function close() {
  updateVisible(false)
}

function handleImageLoad(event) {
  loadState.value = imageHasRenderableDimensions(event.currentTarget) ? 'ready' : 'error'
}

function handleImageError() {
  loadState.value = 'error'
}
</script>

<style scoped>
.image-preview-stage {
  min-height: 240px;
  max-height: calc(100vh - 210px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  background: #09090b;
}

.image-preview-status {
  padding: 20px;
  color: #d4d4d8;
  font-size: 14px;
  line-height: 1.5;
  text-align: center;
}

.image-preview-status.is-error {
  color: #fecaca;
}

.image-preview-media {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 210px);
  object-fit: contain;
}

.image-preview-media.is-checking {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
