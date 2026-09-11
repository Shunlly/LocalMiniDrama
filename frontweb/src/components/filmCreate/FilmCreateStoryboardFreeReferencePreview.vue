<template>
  <div class="vp-reference-panel">
    <div class="vp-reference-toolbar">
      <el-button size="small" @click="openGlobalMediaPicker(videoParamsTarget, 'reference-primary')" aria-label="设为视频主参考">设为视频主参考</el-button>
      <el-button size="small" plain aria-label="添加自由参考图" @click="openGlobalMediaPicker(videoParamsTarget, 'reference')">添加自由参考图</el-button>
    </div>
    <div v-if="getSbFreeReferenceItems(videoParamsTarget).length" class="vp-reference-list">
      <div
        v-for="(item, index) in getSbFreeReferenceItems(videoParamsTarget)"
        :key="item.asset_id || item.local_path || item.image_url || index"
        class="vp-reference-item"
      >
        <button
          type="button"
          class="vp-reference-thumb"
          :aria-label="`预览自由参考图 ${item.name || index + 1}`"
          @click="openImagePreview(assetImageUrl(item))"
        >
          <img :src="assetImageUrl(item)" :alt="item.name || `自由参考图 ${index + 1}`" />
        </button>
        <div class="vp-reference-body">
          <div class="vp-reference-title-row">
            <span class="vp-reference-title">{{ item.name || `自由参考图 ${index + 1}` }}</span>
            <el-tag v-if="index === 0" size="small" effect="plain" type="success">主参考</el-tag>
          </div>
          <div class="vp-reference-meta">{{ item.source_drama_title || '全局上传' }}</div>
          <div class="vp-reference-actions">
            <el-button
              v-if="index !== 0"
              size="small"
              link
              type="primary"
              :aria-label="`将${item.name || ('自由参考图 ' + (index + 1))}设为主参考`" @click="onPromoteSbFreeReferenceImage(videoParamsTarget, item)"
            >
              设为主参考
            </el-button>
            <el-button
              size="small"
              link
              type="danger"
              :aria-label="`移除${item.name || ('自由参考图 ' + (index + 1))}`" @click="onRemoveSbFreeReferenceImage(videoParamsTarget, index)"
            >
              移除
            </el-button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="vp-reference-empty">当前分镜还没有从素材中心挂载自由参考图。</div>
  </div>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  videoParamsTarget: { type: Object, default: null },
  assetImageUrl: { type: Function, required: true },
  getSbFreeReferenceItems: { type: Function, required: true },
  onPromoteSbFreeReferenceImage: { type: Function, required: true },
  onRemoveSbFreeReferenceImage: { type: Function, required: true },
  openGlobalMediaPicker: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
})
</script>

<style scoped>
.vp-reference-panel {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vp-reference-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.vp-reference-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  width: 100%;
  max-height: 176px;
  overflow-y: auto;
}
.vp-reference-item {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-fill-color-light);
}
.vp-reference-thumb {
  width: 64px;
  height: 64px;
  min-width: 64px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-dark);
  cursor: pointer;
}
.vp-reference-thumb:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.vp-reference-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.vp-reference-body {
  min-width: 0;
}
.vp-reference-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.vp-reference-title {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vp-reference-meta {
  margin-top: 3px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vp-reference-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
.vp-reference-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.vp-reference-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
