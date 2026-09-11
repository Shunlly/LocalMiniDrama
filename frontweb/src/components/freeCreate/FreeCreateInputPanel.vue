<template>
<div class="input-panel">
        <el-tabs v-model="mode" class="mode-tabs">
          <el-tab-pane name="image">
            <template #label>
              <span class="mode-tab-label"><el-icon><Picture /></el-icon>生成图片</span>
            </template>
          </el-tab-pane>
          <el-tab-pane name="video">
            <template #label>
              <span class="mode-tab-label"><el-icon><VideoCamera /></el-icon>生成视频</span>
            </template>
          </el-tab-pane>
        </el-tabs>

        <div
          class="service-readiness"
          :class="`is-${generationCapability.status}`"
          role="status"
          aria-live="polite"
        >
          <el-icon aria-hidden="true">
            <Loading v-if="generationCapability.status === 'loading'" class="is-loading" />
            <CircleCheck v-else-if="generationCapability.ready" />
            <Warning v-else />
          </el-icon>
          <span>{{ generationCapability.message }}</span>
          <el-button
            v-if="generationCapability.status === 'error'"
            link
            type="primary"
            @click="loadServiceConfigs"
          >
            重新检查
          </el-button>
          <el-button
            v-if="generationCapability.status !== 'loading' && !generationCapability.ready"
            link
            type="primary"
            @click="openAiConfig"
          >
            配置{{ activeServiceLabel }}服务
          </el-button>
        </div>

        <div class="form-section">
          <div class="form-label">提示词 <span class="required">*</span></div>
          <el-input
            v-model="prompt"
            type="textarea"
            :rows="5"
            aria-label="提示词"
            placeholder="描述你想要生成的画面内容..."
            class="prompt-input"
          />
        </div>

        <div v-if="mode === 'video'" class="form-section">
          <div class="form-label">参考图（可选）</div>
          <div
            class="ref-image-zone"
            :class="`is-${refImageUploadStatus}`"
            :aria-busy="refImageUploadStatus === 'uploading'"
            @dragover.prevent
            @drop.prevent="onRefImageDrop"
          >
            <button
              type="button"
              class="ref-image-trigger"
              :aria-label="refImageTriggerLabel"
              :aria-describedby="refImageUploadStatus === 'idle' ? undefined : 'ref-image-upload-status'"
              :disabled="refImageUploadStatus === 'uploading'"
              :title="refImageUploadStatus === 'uploading' ? '正在上传参考图，请稍候' : undefined"
              @click="triggerRefImageUpload"
            >
              <template v-if="refImageUploadStatus === 'success' && refImageDataUrl">
                <img :src="refImageDataUrl" class="ref-preview" alt="当前视频参考图" />
              </template>
              <template v-else-if="refImageUploadStatus === 'uploading'">
                <el-icon class="upload-icon is-loading" aria-hidden="true"><Loading /></el-icon>
                <span class="upload-tip">正在上传 {{ refImageFileName }}</span>
              </template>
              <template v-else-if="refImageUploadStatus === 'error'">
                <el-icon class="upload-icon is-error" aria-hidden="true"><CircleClose /></el-icon>
                <span class="upload-tip is-error">参考图上传失败</span>
              </template>
              <template v-else>
                <el-icon class="upload-icon" aria-hidden="true"><Picture /></el-icon>
                <span class="upload-tip">点击或拖拽上传参考图</span>
              </template>
            </button>
          </div>
        </div>

        <div
          v-if="refImageUploadStatus !== 'idle'"
          id="ref-image-upload-status"
          ref="refImageUploadStatusRef"
          class="ref-upload-status"
          :class="`is-${refImageUploadStatus}`"
          :role="refImageUploadStatus === 'error' ? 'alert' : 'status'"
          :aria-live="refImageUploadStatus === 'error' ? 'assertive' : 'polite'"
          :tabindex="refImageUploadStatus === 'error' ? -1 : undefined"
        >
          <el-icon aria-hidden="true">
            <Loading v-if="refImageUploadStatus === 'uploading'" class="is-loading" />
            <CircleCheck v-else-if="refImageUploadStatus === 'success'" />
            <CircleClose v-else />
          </el-icon>
          <span class="ref-upload-message">{{ refImageUploadMessage }}</span>
          <div class="ref-actions">
            <el-button
              v-if="refImageUploadStatus === 'error'"
              size="small"
              type="primary"
              plain
              @click="retryRefImageUpload"
            >
              重试上传
            </el-button>
            <el-button
              v-if="refImageUploadStatus !== 'uploading'"
              size="small"
              type="danger"
              plain
              @click="clearRefImage"
            >
              移除
            </el-button>
            <el-button v-else size="small" plain @click="clearRefImage">取消上传</el-button>
          </div>
        </div>
        <input
          ref="refImageInput"
          class="visually-hidden"
          type="file"
          accept="image/*"
          :disabled="refImageUploadStatus === 'uploading'"
          :title="refImageUploadStatus === 'uploading' ? '正在上传参考图，请稍候' : undefined"
          @change="onRefImageChange"
        />

        <div class="form-section form-row">
          <div class="form-item">
            <div class="form-label">风格</div>
            <el-input v-model="style" aria-label="风格" placeholder="例如：电影感 cinematic、日式动漫 anime…" />
          </div>
          <div class="form-item">
            <div class="form-label">{{ mode === 'video' ? '视频比例' : '画面比例' }}</div>
            <el-radio-group
              v-if="mode === 'video'"
              v-model="aspectRatio"
              aria-label="视频画面比例"
              class="aspect-ratio-group"
            >
              <el-radio-button
                v-for="option in aspectRatioOptions"
                :key="option.value"
                :label="option.value"
              >
                {{ option.label }}
              </el-radio-button>
            </el-radio-group>
            <el-select v-else v-model="aspectRatio" aria-label="画面比例">
              <el-option
                v-for="option in aspectRatioOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>
          <div v-if="mode === 'video'" class="form-item">
            <div class="form-label">时长</div>
            <el-select v-model="duration" aria-label="视频时长">
              <el-option label="3秒" :value="3" />
              <el-option label="5秒" :value="5" />
              <el-option label="8秒" :value="8" />
              <el-option label="10秒" :value="10" />
            </el-select>
          </div>
        </div>

        <div
          class="generate-action"
          :tabindex="generateDisabledReason ? 0 : undefined"
          :aria-label="generateDisabledReason ? `${mode === 'image' ? '生成图片' : '生成视频'}不可用：${generateDisabledReason}` : undefined"
        >
          <el-button
            type="primary"
            size="large"
            :loading="generating"
            :disabled="generateDisabled"
            :title="(generating ? resultBusyDisabledReason : generateDisabledReason) || undefined"
            :aria-describedby="generateDisabledReason ? 'free-create-generate-reason' : undefined"
            class="generate-btn"
            @click="generate"
          >
            {{ generating ? '生成中...' : (mode === 'image' ? '生成图片' : '生成视频') }}
          </el-button>
          <p
            v-if="generateDisabledReason"
            id="free-create-generate-reason"
            class="generate-disabled-reason"
            data-testid="generate-disabled-reason"
            role="status"
          >
            {{ generateDisabledReason }}
          </p>
        </div>
      </div>
</template>

<script setup>
import { ref } from 'vue'
import { CircleCheck, CircleClose, Loading, Picture, VideoCamera, Warning } from '@element-plus/icons-vue'

defineOptions({ inheritAttrs: false })

const mode = defineModel('mode', { type: String, default: 'image' })
const prompt = defineModel('prompt', { type: String, default: '' })
const style = defineModel('style', { type: String, default: '' })
const aspectRatio = defineModel('aspectRatio', { type: String, default: '16:9' })
const duration = defineModel('duration', { type: Number, default: 5 })

defineProps({
  generationCapability: {
    type: Object,
    default: () => ({ status: 'loading', ready: false, message: '', issue: '' }),
  },
  activeServiceLabel: { type: String, default: '图片' },
  aspectRatioOptions: { type: Array, default: () => [] },
  refImageUploadStatus: { type: String, default: 'idle' },
  refImageDataUrl: { default: null },
  refImageFileName: { type: String, default: '参考图' },
  refImageTriggerLabel: { type: String, default: '上传视频参考图' },
  refImageUploadMessage: { type: String, default: '' },
  generating: { type: Boolean, default: false },
  generateDisabled: { type: Boolean, default: false },
  generateDisabledReason: { type: String, default: '' },
  resultBusyDisabledReason: { type: String, default: '' },
})

const emit = defineEmits([
  'load-service-configs',
  'open-ai-config',
  'generate',
  'trigger-ref-image-upload',
  'ref-image-drop',
  'ref-image-change',
  'retry-ref-image-upload',
  'clear-ref-image',
])

const refImageInput = ref(null)
const refImageUploadStatusRef = ref(null)
// 页面仍负责上传协议，这里只暴露参考图节点给原有脚本使用

function loadServiceConfigs() {
  emit('load-service-configs')
}
function openAiConfig() {
  emit('open-ai-config')
}
function generate() {
  emit('generate')
}
function triggerRefImageUpload() {
  emit('trigger-ref-image-upload')
}
function onRefImageDrop(event) {
  emit('ref-image-drop', event)
}
function onRefImageChange(event) {
  emit('ref-image-change', event)
}
function retryRefImageUpload() {
  emit('retry-ref-image-upload')
}
function clearRefImage() {
  emit('clear-ref-image')
}

defineExpose({ refImageInput, refImageUploadStatusRef })
</script>

<style scoped>
.input-panel {
  width: 380px;
  max-width: 100%;
  flex-shrink: 0;
  background: var(--bg-card);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow);
}

.mode-tabs {
  margin-bottom: 16px;
}

.mode-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.service-readiness {
  min-height: 40px;
  margin: -6px 0 16px;
  padding: 9px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
}

.service-readiness span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}

.service-readiness.is-ready {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.service-readiness.is-missing,
.service-readiness.is-error {
  border-color: #fcd34d;
  background: #fffbeb;
  color: #92400e;
}

.form-section {
  margin-bottom: 16px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.required {
  color: #ef4444;
}

.prompt-input :deep(.el-textarea__inner) {
  font-size: 14px;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.form-item {
  flex: 1;
  min-width: 100px;
}

.form-item .el-select {
  width: 100%;
}

.aspect-ratio-group {
  display: flex;
  width: 100%;
}

.aspect-ratio-group :deep(.el-radio-button) {
  flex: 1 1 0;
}

.aspect-ratio-group :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 8px 0;
}

.ref-image-zone {
  border: 2px dashed var(--border-muted);
  border-radius: 8px;
  padding: 0;
  text-align: center;
  transition: border-color .2s;
  min-height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
}

.ref-image-zone:hover,
.ref-image-zone:focus-within {
  border-color: #409eff;
}

.ref-image-zone.is-error {
  border-color: #f87171;
  background: #fef2f2;
}

.ref-image-zone.is-success {
  border-color: #86efac;
}

.ref-image-trigger {
  width: 100%;
  min-height: 96px;
  padding: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

.ref-image-trigger:disabled {
  cursor: wait;
}

.ref-image-trigger:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: -4px;
}

.ref-preview {
  max-width: 100%;
  max-height: 150px;
  border-radius: 6px;
}

.upload-icon {
  font-size: 28px;
  color: var(--text-faint);
}

.upload-icon.is-error,
.upload-tip.is-error {
  color: #b91c1c;
}

.upload-tip {
  font-size: 12px;
  color: var(--text-faint);
  max-width: 100%;
  overflow-wrap: anywhere;
}

.ref-upload-status {
  min-height: 40px;
  margin: -8px 0 16px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.ref-upload-status.is-success {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.ref-upload-status.is-error {
  border-color: #f87171;
  background: #fef2f2;
  color: #991b1b;
}

.ref-upload-status:focus-visible {
  outline: 2px solid #b91c1c;
  outline-offset: 2px;
}

.ref-upload-message {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}

.ref-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.generate-action {
  width: 100%;
  margin-top: 4px;
}

.generate-action:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.generate-btn {
  width: 100%;
}

.generate-disabled-reason {
  margin: 8px 0 0;
  color: #b45309;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .input-panel {
    width: 100%;
  }
}
</style>
