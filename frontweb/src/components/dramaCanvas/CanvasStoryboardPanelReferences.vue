<template>
  <div class="reference-row">
    <span class="reference-label">参考图 {{ referenceSlots.length }}/10</span>
    <div class="reference-list">
      <p v-if="!referenceDisplaySlots.length" class="reference-empty" role="status">
        尚未加入参考图。绑定带图的场景、角色或道具后会自动出现，也可从素材中心添加或上传自由参考图。
      </p>
      <div
        v-for="slot in referenceDisplaySlots"
        :key="`${slot.kind}-${slot.index}-${slot.url || slot.name}`"
        class="reference-thumb"
        :class="{ pending: !slot.url }"
        :title="canvasReferenceSourceLabel(slot)"
      >
        <img v-if="slot.url" :src="slot.url" :alt="canvasReferenceSourceLabel(slot)" />
        <div v-else class="reference-missing">暂无图</div>
        <span class="reference-kind">{{ canvasReferenceKindLabel(slot.kind) }}</span>
        <el-button
          v-if="slot.kind === 'free' && slot.freeIndex != null"
          class="reference-remove"
          :icon="Close"
          circle
          size="small"
          title="移除自由参考图"
          :aria-label="storyboardControlLabel(`移除自由参考图${slot.freeIndex + 1}`)"
          @click.stop="removeFreeReference(slot.freeIndex)"
        />
      </div>
      <el-tooltip content="从素材中心添加自由参考图" placement="top">
        <el-button
          class="reference-upload"
          :icon="FolderOpened"
          circle
          :disabled="referenceSlots.length >= 10 || uploadingReference"
          :title="referenceSlots.length >= 10 ? '每个分镜最多保存 10 张自由参考图' : undefined"
          :aria-label="storyboardControlLabel('从素材中心添加自由参考图')"
          @click.stop="openReferenceLibrary"
        />
      </el-tooltip>
      <el-tooltip content="上传自由参考图" placement="top">
        <el-button
          class="reference-upload"
          :icon="Upload"
          circle
          :loading="uploadingReference"
          :disabled="referenceSlots.length >= 10"
          :title="referenceSlots.length >= 10 ? '每个分镜最多保存 10 张自由参考图' : undefined"
          :aria-label="storyboardControlLabel('上传自由参考图')"
          @click.stop="openReferenceUpload"
        />
      </el-tooltip>
    </div>
    <input
      ref="referenceFileInput"
      class="reference-file-input"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="onReferenceFiles"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Close, FolderOpened, Upload } from '@element-plus/icons-vue'
import {
  canvasReferenceKindLabel,
  canvasReferenceSourceLabel,
} from '@/composables/useCanvasReferenceDisplay'

const props = defineProps({
  referenceSlots: { type: Array, default: () => [] },
  referenceDisplaySlots: { type: Array, default: () => [] },
  uploadingReference: { type: Boolean, default: false },
  storyboardControlLabel: { type: Function, required: true },
  onReferenceFiles: { type: Function, required: true },
  removeFreeReference: { type: Function, required: true },
  openReferenceLibrary: { type: Function, default: () => {} },
})

const referenceFileInput = ref(null)

function openReferenceLibrary() {
  if (props.referenceSlots.length >= 10 || props.uploadingReference) return
  props.openReferenceLibrary?.()
}

function openReferenceUpload() {
  if (props.referenceSlots.length >= 10 || props.uploadingReference) return
  if (referenceFileInput.value) {
    referenceFileInput.value.value = ''
    referenceFileInput.value.click()
  }
}
</script>

<style scoped>
.reference-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 8px 36px;
}
.reference-label {
  flex: 0 0 auto;
  padding-top: 14px;
  font-size: 10px;
  color: var(--canvas-text-subtle, #71717a);
}
.reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.reference-thumb,
.reference-upload {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
}
.reference-empty {
  flex: 1 1 100%;
  margin: 0;
  padding-top: 10px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--canvas-text-muted, #a1a1aa);
}
.reference-thumb {
  position: relative;
  overflow: visible;
  border: 1px solid var(--canvas-divider-strong, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-media-well, #09090b);
}
.reference-thumb.pending {
  border-style: dashed;
}
.reference-missing {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--canvas-text-subtle, #71717a);
  font-size: 9px;
}
.reference-thumb img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 5px;
}
.reference-kind {
  position: absolute;
  left: 2px;
  bottom: 2px;
  min-width: 22px;
  height: 16px;
  padding: 0 3px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 9px;
  line-height: 16px;
  text-align: center;
}
.reference-remove {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  z-index: 1;
}
.reference-file-input {
  display: none;
}
</style>
