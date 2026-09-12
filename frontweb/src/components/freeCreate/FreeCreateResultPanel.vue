<template>
<div class="result-panel">
        <div class="result-header">
          <span class="result-title">生成结果</span>
          <el-button
            v-if="results.length > 0"
            size="small"
            plain
            :loading="cancelling"
            :disabled="cancelling"
            :title="cancelling ? resultBusyDisabledReason : undefined"
            :aria-label="generating ? '取消并清空生成结果' : '清空生成结果'"
            @click="clearResults"
          >
            {{ generating ? '取消并清空' : '清空' }}
          </el-button>
        </div>

        <div v-if="results.length === 0 && !generating" class="empty-result" role="status" aria-live="polite">
          <el-icon class="empty-icon">
            <Picture v-if="mode === 'image'" />
            <VideoCamera v-else />
          </el-icon>
          <p>{{ emptyResultCopy }}</p>
          <div
            v-if="generationCapability.status !== 'loading' && !generationCapability.ready"
            class="empty-result-actions"
            role="group"
            aria-label="空结果下一步"
          >
            <el-button
              v-if="generationCapability.status === 'error'"
              size="small"
              type="primary"
              plain
              aria-label="重新检查服务" @click="loadServiceConfigs"
            >
              重新检查服务
            </el-button>
            <el-button
              size="small"
              type="primary"
              :plain="generationCapability.status === 'error'"
              aria-label="前往 AI 配置" @click="openAiConfig"
            >
              前往 AI 配置
            </el-button>
          </div>
        </div>

        <div v-if="generating" class="generating-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>{{ cancelling ? '正在取消生成…' : '正在生成，请稍候…' }}</span>
          <el-button
            type="danger"
            size="small"
            plain
            :loading="cancelling"
            :disabled="cancelling"
            :title="cancelling ? resultBusyDisabledReason : undefined"
            aria-label="取消生成"
            @click="cancelGeneration"
          >
            <el-icon v-if="!cancelling"><CircleClose /></el-icon>
            <span>取消生成</span>
          </el-button>
        </div>

        <div class="result-grid">
          <div v-for="(item, idx) in results" :key="idx" class="result-item">
            <div class="result-media">
              <video
                v-if="item.type === 'video' && item.url"
                :src="item.url"
                controls
                class="result-video"
                loop
                :aria-label="`第 ${idx + 1} 个生成视频`"
              />
              <button
                v-else-if="item.type === 'image' && item.url"
                type="button"
                class="result-image-button"
                :aria-label="`预览${resultImageAlt(item, idx)}`"
                @click="openImagePreview(item, idx)"
              >
                <img :src="item.url" class="result-image" :alt="resultImageAlt(item, idx)" />
              </button>
              <div v-else-if="item.status === 'pending' || item.status === 'processing'" class="media-loading">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>{{ item.status === 'processing' ? '生成中…' : '排队中…' }}</span>
              </div>
              <div v-else-if="item.status === 'failed'" class="media-error" role="alert">
                <el-icon><CircleClose /></el-icon>
                <span :id="`free-create-result-error-${idx}`">{{ item.error || '生成失败' }}</span>
                <el-button
                  v-if="canRetryItem(item)"
                  size="small"
                  type="primary"
                  plain
                  :disabled="generating || cancelling"
                  :title="resultBusyDisabledReason || undefined"
                  :aria-describedby="`free-create-result-error-${idx}`"
                  :aria-label="(generating || cancelling) ? (resultBusyDisabledReason || '正在处理') : '重试生成'" @click="retryGeneration(item)"
                >
                  重试
                </el-button>
              </div>
              <div v-else-if="item.status === 'cancelled'" class="media-cancelled" role="status">
                <el-icon><CircleClose /></el-icon>
                <span :id="`free-create-result-cancel-${idx}`">{{ item.error || '生成已取消' }}</span>
                <el-button
                  v-if="canRetryItem(item)"
                  size="small"
                  type="primary"
                  plain
                  :disabled="generating || cancelling"
                  :title="resultBusyDisabledReason || undefined"
                  :aria-describedby="`free-create-result-cancel-${idx}`"
                  :aria-label="(generating || cancelling) ? (resultBusyDisabledReason || '正在处理') : '重试生成'" @click="retryGeneration(item)"
                >
                  重试
                </el-button>
              </div>
              <div v-else class="media-error" role="alert">
                <el-icon><CircleClose /></el-icon>
                <span>{{ item.error || '暂无生成结果' }}</span>
                <el-button
                  v-if="canRetryItem(item)"
                  size="small"
                  type="primary"
                  plain
                  :disabled="generating || cancelling"
                  :title="resultBusyDisabledReason || undefined"
                  :aria-label="(generating || cancelling) ? (resultBusyDisabledReason || '正在处理') : '重试生成'" @click="retryGeneration(item)"
                >
                  重试
                </el-button>
              </div>
            </div>
            <div class="result-meta">
              <span class="result-prompt">{{ item.prompt }}</span>
              <div class="result-actions">
                <el-button
                  v-if="item.url"
                  size="small"
                  plain
                  :disabled="generating || cancelling"
                  :title="resultBusyDisabledReason || undefined"
                  :aria-label="(generating || cancelling) ? (resultBusyDisabledReason || '正在处理') : '下载结果'" @click="downloadItem(item)"
                >下载</el-button>
                <el-button
                  v-if="item.url"
                  size="small"
                  type="primary"
                  plain
                  :loading="item.savingAsset"
                  :disabled="Boolean(saveItemDisabledReason(item))"
                  :title="saveItemDisabledReason(item) || undefined"
                  :aria-label="saveItemAriaLabel(item)"
                  @click="saveItemToAssets(item)"
                >{{ item.assetId ? '已保存' : (item.assetSaveError ? '重试保存' : '保存到素材中心') }}</el-button>
              </div>
              <p
                v-if="item.assetSaveError"
                class="result-save-error"
                role="alert"
              >{{ item.assetSaveError }}</p>
            </div>
          </div>
        </div>
      </div>
</template>

<script setup>
import { CircleClose, Loading, Picture, VideoCamera } from '@element-plus/icons-vue'

defineProps({
  results: { type: Array, default: () => [] },
  generating: { type: Boolean, default: false },
  cancelling: { type: Boolean, default: false },
  mode: { type: String, default: 'image' },
  emptyResultCopy: { type: String, default: '' },
  generationCapability: {
    type: Object,
    default: () => ({ status: 'loading', ready: false, message: '', issue: '' }),
  },
  resultBusyDisabledReason: { type: String, default: '' },
  resultImageAlt: { type: Function, required: true },
  canRetryItem: { type: Function, required: true },
  saveItemDisabledReason: { type: Function, default: () => '' },
  saveItemAriaLabel: { type: Function, default: () => '保存到素材中心' },
})

const emit = defineEmits([
  'clear-results',
  'load-service-configs',
  'cancel-generation',
  'retry-generation',
  'download-item',
  'preview-image',
  'save-item',
  'open-ai-config',
])

function clearResults() {
  emit('clear-results')
}
function loadServiceConfigs() {
  emit('load-service-configs')
}
function cancelGeneration() {
  emit('cancel-generation')
}
function retryGeneration(item) {
  emit('retry-generation', item)
}
function downloadItem(item) {
  emit('download-item', item)
}
function openImagePreview(item, idx) {
  emit('preview-image', item, idx)
}
function saveItemToAssets(item) {
  emit('save-item', item)
}
function openAiConfig() {
  emit('open-ai-config')
}
</script>

<style scoped>
.empty-result p {
  margin: 0;
  max-width: 22em;
  text-align: center;
  overflow-wrap: anywhere;
}

.empty-result-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.result-panel {
  flex: 1;
  min-width: 0;
  background: var(--bg-card);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow);
  min-height: 400px;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.result-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-bright);
}

.empty-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-faint);
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
}

.generating-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-color-primary);
  font-size: 14px;
  margin-bottom: 12px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.result-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.result-media {
  background: var(--bg-inner);
  aspect-ratio: 16/9;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.result-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.result-image-button {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.result-image-button:focus-visible {
  outline: 3px solid #2563eb;
  outline-offset: -3px;
}

.result-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-loading,
.media-error,
.media-cancelled {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.media-error {
  color: #ef4444;
}

.media-cancelled {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.media-cancelled {
  color: var(--text-muted);
}

.result-meta {
  padding: 8px 10px;
}

.result-prompt {
  font-size: 12px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.result-save-error {
  margin: 6px 0 0;
  color: #ef4444;
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
