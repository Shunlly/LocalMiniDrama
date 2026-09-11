<template>
  <AccessibleDialog v-model="showPreview" title="素材预览" width="800px" destroy-on-close :close-on-click-modal="true" :close-on-press-escape="true">
    <div class="preview-content">
      <video
        v-if="previewItem?.type === 'video'"
        :src="itemUrl(previewItem)"
        :aria-label="videoPreviewLabel(previewItem)"
        controls
        class="preview-video"
        tabindex="0"
        autoplay
      />
      <img
        v-else-if="previewItem"
        :src="itemUrl(previewItem)"
        :alt="previewAlt(previewItem)"
        class="preview-image"
        tabindex="0"
      />
    </div>
    <div class="preview-meta">
      <div class="meta-row"><span>名称：</span>{{ previewItem?.name || '未命名' }}</div>
      <div class="meta-row"><span>大小：</span>{{ formatSize(mediaItemFileSize(previewItem)) }}</div>
      <div class="meta-row"><span>创建时间：</span>{{ formatSourceTimestamp(previewItem?.created_at) || '未知时间' }}</div>
      <div v-if="previewItem?.source_provider" class="meta-row"><span>来源：</span>{{ networkItemSourceLabel(previewItem) }}</div>
      <div v-if="previewItem?.author" class="meta-row"><span>作者：</span>{{ previewItem.author }}</div>
      <div v-if="previewItem?.license" class="meta-row"><span>许可：</span>{{ previewItem.license }}</div>
      <div v-if="safeExternalUrl(previewItem?.license_url, true)" class="meta-row">
        <span>许可条款：</span>
        <a :href="safeExternalUrl(previewItem.license_url, true)" target="_blank" rel="noopener noreferrer">查看许可</a>
      </div>
      <div v-if="safeExternalUrl(sourceEvidence(previewItem, 'source_url'), true)" class="meta-row">
        <span>来源页面：</span>
        <a
          v-if="isOpenversePreview(previewItem)"
          :href="safeExternalUrl(sourceEvidence(previewItem, 'source_url'), true)"
          target="_blank"
          rel="noopener noreferrer"
        >查看 Openverse 来源</a>
        <a
          v-else
          :href="safeExternalUrl(sourceEvidence(previewItem, 'source_url'), true)"
          target="_blank"
          rel="noopener noreferrer"
        >查看 Wikimedia Commons 来源</a>
      </div>
      <div v-if="safeExternalUrl(sourceEvidence(previewItem, 'landing_page'), true)" class="meta-row">
        <span>原始发布页：</span>
        <a
          :href="safeExternalUrl(sourceEvidence(previewItem, 'landing_page'), true)"
          target="_blank"
          rel="noopener noreferrer"
        >查看原始发布页</a>
      </div>
      <div v-if="sourceEvidence(previewItem, 'commons_page_id')" class="meta-row">
        <span>Commons 页面编号：</span>{{ sourceEvidence(previewItem, 'commons_page_id') }}
      </div>
      <div v-if="sourceEvidence(previewItem, 'commons_revision_timestamp')" class="meta-row">
        <span>来源修订时间：</span>{{ formatSourceTimestamp(sourceEvidence(previewItem, 'commons_revision_timestamp')) }}
      </div>
      <div v-if="sourceEvidence(previewItem, 'commons_sha1')" class="meta-row meta-row--hash">
        <span>Commons SHA-1：</span>
        <code>{{ sourceEvidence(previewItem, 'commons_sha1') }}</code>
        <el-button
          class="hash-copy-button"
          text
          size="small"
          title="复制 Commons SHA-1"
          aria-label="复制 Commons SHA-1"
          @click="copySourceEvidence(sourceEvidence(previewItem, 'commons_sha1'), 'Commons SHA-1')"
        >
          <el-icon><CopyDocument /></el-icon>
        </el-button>
      </div>
      <div v-if="sourceEvidence(previewItem, 'content_sha256')" class="meta-row meta-row--hash">
        <span>本地内容 SHA-256：</span>
        <code>{{ sourceEvidence(previewItem, 'content_sha256') }}</code>
        <el-button
          class="hash-copy-button"
          text
          size="small"
          title="复制本地内容 SHA-256"
          aria-label="复制本地内容 SHA-256"
          @click="copySourceEvidence(sourceEvidence(previewItem, 'content_sha256'), '本地内容 SHA-256')"
        >
          <el-icon><CopyDocument /></el-icon>
        </el-button>
      </div>
    </div>
    <template #footer>
      <el-button type="primary" aria-label="关闭预览" @click="showPreview = false">关闭预览</el-button>
    </template>
  </AccessibleDialog>

  <AccessibleDialog v-model="showNetworkPreview" title="网络素材预览" width="800px" destroy-on-close :close-on-click-modal="true" :close-on-press-escape="true">
    <div class="preview-content">
      <video
        v-if="networkPreviewItem?.media_type === 'video'"
        :src="networkPlaybackUrl(networkPreviewItem)"
        :aria-label="`网络视频预览：${networkItemTitle(networkPreviewItem)}`"
        controls
        class="preview-video"
        tabindex="0"
      />
      <img
        v-else-if="networkPreviewItem"
        :src="networkPlaybackUrl(networkPreviewItem)"
        :alt="`网络素材预览图：${networkItemTitle(networkPreviewItem)}`"
        class="preview-image"
        tabindex="0"
      />
    </div>
    <div class="preview-meta">
      <div class="meta-row"><span>名称：</span>{{ networkItemTitle(networkPreviewItem) }}</div>
      <div class="meta-row"><span>作者：</span>{{ networkPreviewItem?.author || '未知' }}</div>
      <div class="meta-row"><span>来源：</span>{{ networkItemSourceLabel(networkPreviewItem) }}</div>
      <div class="meta-row"><span>许可：</span>{{ networkPreviewItem?.license || '未注明许可' }}</div>
      <div v-if="safeExternalUrl(networkPreviewItem?.license_url, true)" class="meta-row">
        <span>许可条款：</span>
        <a
          :href="safeExternalUrl(networkPreviewItem.license_url, true)"
          :aria-label="`查看许可：${networkItemTitle(networkPreviewItem)}`"
          target="_blank"
          rel="noopener noreferrer"
        >查看许可</a>
      </div>
    </div>
    <template #footer>
      <el-button type="primary" aria-label="关闭网络预览" @click="showNetworkPreview = false">关闭预览</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
// 仅展示素材预览弹层；复制证据和关闭仍由素材中心页提供的状态处理。
import { CopyDocument } from '@element-plus/icons-vue'

const showPreview = defineModel('showPreview', { type: Boolean, required: true })
const showNetworkPreview = defineModel('showNetworkPreview', { type: Boolean, required: true })

defineProps({
  previewItem: { default: null },
  networkPreviewItem: { default: null },
  itemUrl: { type: Function, required: true },
  videoPreviewLabel: { type: Function, required: true },
  previewAlt: { type: Function, required: true },
  formatSize: { type: Function, required: true },
  mediaItemFileSize: { type: Function, required: true },
  formatSourceTimestamp: { type: Function, required: true },
  networkItemSourceLabel: { type: Function, required: true },
  safeExternalUrl: { type: Function, required: true },
  sourceEvidence: { type: Function, required: true },
  isOpenversePreview: { type: Function, required: true },
  copySourceEvidence: { type: Function, required: true },
  networkPlaybackUrl: { type: Function, required: true },
  networkItemTitle: { type: Function, required: true },
})
</script>

<style scoped>
.preview-content {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}

.preview-video {
  max-width: 100%;
  max-height: 60vh;
}

.preview-meta {
  margin-top: 16px;
}

.meta-row {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 4px;
  overflow-wrap: anywhere;
}

.meta-row span {
  font-weight: 500;
  color: #374151;
}

.meta-row--hash code {
  min-width: 0;
  flex: 1 1 240px;
  padding: 2px 5px;
  border-radius: 4px;
  background: #f3f4f6;
  color: #374151;
  font-family: Consolas, monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.meta-row--hash {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.meta-row--hash > span,
.hash-copy-button {
  flex: 0 0 auto;
}

.hash-copy-button {
  min-width: 28px;
  min-height: 28px;
  margin: -4px 0 0;
  padding: 4px;
}

@media (max-width: 520px) {
  .meta-row--hash {
    flex-wrap: wrap;
  }

  .meta-row--hash code {
    flex-basis: calc(100% - 40px);
  }
}
</style>
