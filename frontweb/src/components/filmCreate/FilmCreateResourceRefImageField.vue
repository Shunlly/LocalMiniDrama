<template>
  <div class="ref-image-zone">
    <button
      type="button"
      class="ref-image-box"
      :aria-label="selectAriaLabel"
      @click="$emit('pick')"
      @drop.prevent="$emit('drop', $event)"
      @dragover.prevent
    >
      <img v-if="pendingImage" :src="pendingImage.dataUrl" :alt="pendingAlt" class="ref-preview-img" />
      <img v-else-if="savedSrc" :src="savedSrc" :alt="savedAlt" class="ref-preview-img" />
      <img v-else-if="mainSrc" :src="mainSrc" :alt="mainAlt" class="ref-preview-img" style="opacity:0.5" />
      <span v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></span>
    </button>
    <div v-if="pendingImage" class="ref-actions">
      <el-button type="primary" size="small" :loading="extracting" :title="extracting ? pendingExtractTitle : undefined" :aria-label="extracting ? pendingExtractTitle : '提取特征描述'" @click="$emit('extract-pending')">提取特征描述</el-button>
      <el-button size="small" aria-label="移除待上传参考图" @click="$emit('remove-pending')">移除</el-button>
    </div>
    <div v-else-if="savedSrc" class="ref-actions">
      <el-button type="primary" size="small" :loading="extracting" :title="extracting ? savedExtractTitle : undefined" :aria-label="extracting ? savedExtractTitle : '从参考图提取描述'" @click="$emit('extract-saved')">从参考图提取描述</el-button>
      <el-button size="small" aria-label="移除参考图" @click="$emit('clear-saved')">移除参考图</el-button>
    </div>
    <div v-else-if="showMainExtract" class="ref-actions">
      <el-button size="small" :loading="extracting" :title="extracting ? mainExtractTitle : undefined" :aria-label="extracting ? mainExtractTitle : '从主图提取描述'" @click="$emit('extract-main')">从主图提取描述</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  selectAriaLabel: { type: String, required: true },
  pendingImage: { type: Object, default: null },
  pendingAlt: { type: String, default: '待上传参考图' },
  savedRefImage: { type: String, default: '' },
  savedAlt: { type: String, default: '已保存参考图' },
  mainSrc: { type: String, default: '' },
  mainAlt: { type: String, default: '主图' },
  extracting: { type: Boolean, default: false },
  pendingExtractTitle: { type: String, default: '正在提取特征描述，请稍候' },
  savedExtractTitle: { type: String, default: '正在提取描述，请稍候' },
  mainExtractTitle: { type: String, default: '正在提取描述，请稍候' },
  showMainExtract: { type: Boolean, default: false },
})

defineEmits([
  'pick',
  'drop',
  'extract-pending',
  'remove-pending',
  'extract-saved',
  'clear-saved',
  'extract-main',
])

const savedSrc = computed(() => {
  const refImage = props.savedRefImage
  if (!refImage) return ''
  return refImage.startsWith('http') ? refImage : '/static/' + refImage
})
</script>

<style scoped>
.ref-image-zone {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ref-image-box {
  width: 120px;
  height: 120px;
  border: 2px dashed #c0c4cc;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  background: #fafafa;
  flex-shrink: 0;
  transition: border-color 0.2s;
  padding: 0;
  color: inherit;
  font: inherit;
}

.ref-image-box:hover {
  border-color: #409eff;
}

.ref-image-box:focus-visible {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}
</style>
