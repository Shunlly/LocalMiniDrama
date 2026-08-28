<template>
  <main class="media-library-page">
    <div class="page-header">
      <div class="header-left">
        <el-button text class="back-link" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          {{ returnTo ? '返回制作台' : '项目首页' }}
        </el-button>
        <div class="title-wrap">
          <h1 class="page-title">素材中心</h1>
          <p class="page-subtitle">上传后的图片和视频会在所有项目里复用；单文件最大 100MB。</p>
        </div>
      </div>
      <div class="header-actions">
        <el-button :disabled="mediaAccessState.navigationLocked" aria-label="新建项目" @click="goNewProject">
          <el-icon><Plus /></el-icon>
          新建项目
        </el-button>
        <el-button
          :type="mediaItems.length === 0 && !loading ? 'default' : 'primary'"
          :loading="uploading"
          :disabled="mediaWriteLocked"
          @click="triggerUpload"
        >
          <el-icon><Upload /></el-icon>
          上传素材
        </el-button>
        <input ref="uploadInput" type="file" accept="image/*,video/*" multiple style="display:none" @change="onUpload" />
      </div>
    </div>

    <el-tabs v-model="libraryMode" class="library-tabs" aria-label="素材来源">
      <el-tab-pane label="本地素材" name="local" />
      <el-tab-pane label="网络素材" name="network" />
    </el-tabs>

    <section
      v-if="networkImportFeedback"
      class="upload-feedback"
      :class="`upload-feedback--${networkImportFeedback.tone}`"
      :role="networkImportFeedback.tone === 'error' ? 'alert' : 'status'"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div>
        <h2>{{ networkImportFeedback.title }}</h2>
        <p>{{ networkImportFeedback.detail }}</p>
      </div>
    </section>

    <template v-if="libraryMode === 'local'">
    <section
      v-if="loadError"
      class="data-load-state"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div class="data-load-state__content">
        <h2>{{ mediaIsStale ? '素材列表刷新失败' : '素材数据加载失败' }}</h2>
        <p>暂时无法确认服务器中的最新素材。您的素材数据没有被删除。</p>
        <p v-if="mediaIsStale" class="data-load-state__stale">下方显示上次成功加载的数据，当前内容已过期；成功重试前不能上传、选择或删除素材。</p>
        <p v-else>素材空态不会在连接恢复前显示，也不会执行任何素材写操作。</p>
        <p class="data-load-state__detail">错误详情：{{ loadError }}</p>
      </div>
      <el-button type="primary" plain :loading="loading" @click="loadMedia">
        <el-icon><Refresh /></el-icon>重试加载
      </el-button>
    </section>

    <section v-if="mediaAccessState.showEntryStrip" class="entry-strip" aria-label="素材入口说明">
      <div class="entry-item">
        <span class="entry-label">上传到素材中心</span>
        <p class="entry-description">把不超过 100MB 的图片和视频放进全局素材，后续项目可以直接复用。</p>
        <el-button text class="entry-action" :disabled="mediaWriteLocked" @click="triggerUpload">立即上传</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">网页 URL 导入</span>
        <p class="entry-description">网页 URL 导入会在选择项目后完成，本页不直接粘贴 URL。</p>
        <el-button
          type="primary"
          plain
          class="entry-action"
          :disabled="mediaAccessState.navigationLocked"
          aria-label="选择项目后导入网页 URL"
          @click="goSourceImport"
        >进入项目选择后导入网页 URL</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">角色 / 场景 / 道具入库</span>
        <p class="entry-description">在项目里点“加入素材库”后，会同步到首页里的分类素材入口。</p>
        <el-button text class="entry-action" @click="goHome">返回项目首页</el-button>
      </div>
    </section>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-radio-group v-model="mediaType" class="type-filter" aria-label="素材类型筛选" @change="applyFilters">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="image">图片</el-radio-button>
        <el-radio-button value="video">视频</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="keyword"
        placeholder="搜索素材..."
        aria-label="搜索素材"
        class="search-input"
        clearable
        @input="debouncedLoad"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>

    <!-- 上传进度 -->
    <div v-if="uploading" class="upload-progress">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在上传 {{ uploadProgress.current }}/{{ uploadProgress.total }}...</span>
    </div>

    <section
      v-if="uploadFeedback"
      class="upload-feedback"
      :class="`upload-feedback--${uploadFeedback.tone}`"
      :role="uploadFeedback.tone === 'error' ? 'alert' : 'status'"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div>
        <h2>{{ uploadFeedback.title }}</h2>
        <p>{{ uploadFeedback.detail }}</p>
      </div>
    </section>

    <!-- 媒体网格 -->
    <div v-loading="loading" class="media-grid" :aria-busy="loading">
      <article
        v-for="item in mediaItems"
        :key="item.id"
        class="media-card"
        :class="{
          selected: selectedIds.has(item.id),
          'actions-visible': isActionLayerVisible(item.id),
        }"
        :aria-labelledby="`media-name-${item.id}`"
        @mouseenter="showPointerActions(item.id)"
        @mouseleave="hidePointerActions(item.id)"
        @focusin="showKeyboardActions(item.id)"
        @focusout="hideKeyboardActions(item.id, $event)"
      >
        <div class="media-thumb">
          <video
            v-if="item.type === 'video'"
            :src="itemUrl(item)"
            :aria-label="thumbnailAlt(item)"
            class="thumb-video"
            muted
          />
          <img v-else :src="itemUrl(item)" :alt="thumbnailAlt(item)" class="thumb-img" />
          <label class="selection-control" :title="selectionLabel(item)">
            <input
              type="checkbox"
              class="selection-input"
              :checked="selectedIds.has(item.id)"
              :disabled="mediaWriteLocked"
              :aria-label="selectionLabel(item)"
              @change="setItemSelected(item, $event.target.checked)"
            />
            <span class="selection-indicator" aria-hidden="true">
              <el-icon class="selection-check"><CircleCheck /></el-icon>
            </span>
          </label>
          <div class="media-overlay" :aria-hidden="!isActionLayerVisible(item.id)">
            <div class="overlay-actions">
              <el-button
                size="small"
                plain
                class="preview-btn"
                :title="actionLabel('预览', item)"
                :aria-label="actionLabel('预览', item)"
                :tabindex="isActionLayerVisible(item.id) ? 0 : -1"
                @click="openPreview(item)"
              >
                <el-icon><ZoomIn /></el-icon>
              </el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :title="actionLabel('删除', item)"
                :aria-label="actionLabel('删除', item)"
                :disabled="mediaWriteLocked"
                :tabindex="isActionLayerVisible(item.id) ? 0 : -1"
                @click="deleteItem(item)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
        <div class="media-info">
          <span :id="`media-name-${item.id}`" class="media-name" :title="item.name">{{ item.name || '未命名' }}</span>
          <span class="media-meta">{{ formatSize(mediaItemFileSize(item)) }}</span>
          <span class="media-origin">{{ mediaOriginLabel(item) }}</span>
        </div>
      </article>

      <div v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems.length === 0" class="empty-media">
        <el-icon class="empty-icon"><Files /></el-icon>
        <h2 class="empty-title">{{ hasActiveFilters ? '没有匹配的素材' : '素材中心还是空的' }}</h2>
        <p class="empty-description">{{ hasActiveFilters ? '调整关键词或素材类型后再试。' : '上传图片或视频，后续项目可以直接复用。' }}</p>
        <div class="empty-actions">
          <template v-if="hasActiveFilters">
            <el-button @click="clearFilters">清除筛选</el-button>
            <el-button type="primary" :disabled="mediaWriteLocked" @click="triggerUpload">
              <el-icon><Upload /></el-icon>上传素材
            </el-button>
          </template>
          <template v-else>
            <el-button
              type="primary"
              :disabled="mediaWriteLocked"
              aria-label="上传图片或视频到素材中心"
              @click="triggerUpload"
            >
              <el-icon><Upload /></el-icon>上传素材
            </el-button>
          </template>
        </div>
        <template v-if="!hasActiveFilters">
          <p class="empty-note">需要把角色、场景或道具沉淀到分类素材时，请先在项目内点“加入素材库”。</p>
          <el-button
            type="primary"
            plain
            class="empty-secondary-action"
            :disabled="mediaWriteLocked"
            aria-label="选择项目后导入网页 URL"
            @click="goSourceImport"
          >进入项目选择后导入网页 URL</el-button>
        </template>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="pagination">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="loadMedia"
      />
    </div>

    <!-- 批量操作 -->
    <div v-if="selectedIds.size > 0" class="batch-bar">
      <span>已选 {{ selectedIds.size }} 项</span>
      <el-button size="small" @click="selectedIds.clear()">取消选择</el-button>
      <el-button size="small" type="danger" plain :disabled="mediaWriteLocked" @click="batchDelete">批量删除</el-button>
    </div>
    </template>

    <template v-else>
      <section class="network-search-panel" aria-labelledby="network-search-title">
        <div>
          <h2 id="network-search-title" class="section-title">搜索网络素材</h2>
          <p class="section-description">
            导入目标：<strong>{{ networkImportTargetLabel }}</strong>。只有来源和许可证据完整的素材才能导入。
          </p>
        </div>
        <div class="network-search-controls">
          <el-radio-group
            v-model="networkMediaType"
            aria-label="网络素材类型"
            @change="handleNetworkTypeChange"
          >
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="image">图片</el-radio-button>
            <el-radio-button value="video">视频</el-radio-button>
          </el-radio-group>
          <el-input
            v-model="networkKeyword"
            class="network-search-input"
            clearable
            placeholder="输入关键词搜索网络素材"
            aria-label="网络素材关键词"
            @keyup.enter="searchNetworkMedia"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button
            type="primary"
            :loading="networkLoading"
            :disabled="!networkKeyword.trim()"
            @click="searchNetworkMedia"
          >
            <el-icon><Search /></el-icon>搜索
          </el-button>
        </div>
      </section>
      <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {{ networkSearchAnnouncement }}
      </p>

      <section v-if="networkError" class="network-state network-state--error" role="alert">
        <div>
          <h2>网络素材搜索失败</h2>
          <p>{{ networkError }}</p>
        </div>
        <el-button
          plain
          :loading="networkLoading"
          :disabled="!networkKeyword.trim()"
          @click="searchNetworkMedia"
        >重试</el-button>
      </section>

      <div v-loading="networkLoading" class="network-grid" :aria-busy="networkLoading">
        <article
          v-for="(item, index) in networkItems"
          :key="networkItemKey(item, index)"
          class="network-card"
          :aria-labelledby="`network-name-${index}`"
        >
          <button
            type="button"
            class="network-thumb"
            :aria-label="`预览网络素材：${networkItemTitle(item)}`"
            @click="openNetworkPreview(item)"
          >
            <img
              v-if="networkCardImageUrl(item)"
              :src="networkCardImageUrl(item)"
              :alt="`网络素材缩略图：${networkItemTitle(item)}`"
            />
            <span v-else class="network-thumb-placeholder" aria-hidden="true">
              <el-icon><Files /></el-icon>
              <span>暂无缩略图</span>
            </span>
            <span class="network-preview-label"><el-icon><ZoomIn /></el-icon>预览</span>
          </button>
          <div class="network-info">
            <h3 :id="`network-name-${index}`" :title="networkItemTitle(item)">{{ networkItemTitle(item) }}</h3>
            <p class="network-detail">
              <span>{{ item.author || '作者未知' }}</span>
              <span>{{ networkDimensions(item) }}</span>
            </p>
            <p class="network-license" :title="item.license || '未注明许可'">许可：{{ item.license || '未注明许可' }}</p>
            <p
              v-if="!networkItemImportability(item).allowed"
              class="network-license-warning"
              role="status"
            >{{ networkItemImportability(item).reason }}</p>
            <div class="network-actions">
              <a
                v-if="safeExternalUrl(item.source_url)"
                :href="safeExternalUrl(item.source_url)"
                :aria-label="`查看来源：${networkItemTitle(item)}`"
                target="_blank"
                rel="noopener noreferrer"
              >查看来源</a>
              <span v-else class="source-unavailable">来源链接不可用</span>
              <a
                v-if="safeExternalUrl(item.license_url, true)"
                :href="safeExternalUrl(item.license_url, true)"
                :aria-label="`查看许可：${networkItemTitle(item)}`"
                target="_blank"
                rel="noopener noreferrer"
              >查看许可</a>
              <el-button
                size="small"
                type="primary"
                :loading="isNetworkImporting(item)"
                :disabled="isNetworkImporting(item) || !networkItemImportability(item).allowed"
                :title="networkItemImportability(item).reason || networkImportButtonText"
                :aria-label="`${networkImportButtonText}：${networkItemTitle(item)}`"
                @click="importNetworkItem(item)"
              >{{ networkImportButtonText }}</el-button>
            </div>
          </div>
        </article>

        <div
          v-if="!networkLoading && !networkError && networkSearched && networkItems.length === 0"
          class="network-empty"
          role="status"
        >
          <el-icon><Files /></el-icon>
          <h2>没有找到匹配的网络素材</h2>
          <p>请更换关键词或素材类型后重试。</p>
        </div>
        <div v-else-if="!networkLoading && !networkError && !networkSearched" class="network-empty">
          <el-icon><Search /></el-icon>
          <h2>搜索可导入的网络素材</h2>
          <p>结果会在这里显示，并附带来源和许可信息。</p>
        </div>
      </div>
    </template>

    <!-- 预览弹窗 -->
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
        <div class="meta-row"><span>创建时间：</span>{{ previewItem?.created_at }}</div>
        <div v-if="previewItem?.source_provider" class="meta-row"><span>来源：</span>{{ previewItem.source_provider }}</div>
        <div v-if="previewItem?.author" class="meta-row"><span>作者：</span>{{ previewItem.author }}</div>
        <div v-if="previewItem?.license" class="meta-row"><span>许可：</span>{{ previewItem.license }}</div>
        <div v-if="safeExternalUrl(previewItem?.license_url, true)" class="meta-row">
          <span>许可条款：</span>
          <a :href="safeExternalUrl(previewItem.license_url, true)" target="_blank" rel="noopener noreferrer">查看许可</a>
        </div>
        <div v-if="safeExternalUrl(sourceEvidence(previewItem, 'source_url'), true)" class="meta-row">
          <span>来源页面：</span>
          <a
            :href="safeExternalUrl(sourceEvidence(previewItem, 'source_url'), true)"
            target="_blank"
            rel="noopener noreferrer"
          >查看 Wikimedia Commons 来源</a>
        </div>
        <div v-if="sourceEvidence(previewItem, 'commons_page_id')" class="meta-row">
          <span>Commons 页面 ID：</span>{{ sourceEvidence(previewItem, 'commons_page_id') }}
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
        <el-button type="primary" @click="showPreview = false">关闭预览</el-button>
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
        <el-button type="primary" @click="showNetworkPreview = false">关闭预览</el-button>
      </template>
    </AccessibleDialog>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Upload, Search, Loading, CircleCheck,
  ZoomIn, Delete, Files, Plus, Refresh, CopyDocument
} from '@element-plus/icons-vue'
import { mediaLibraryAPI, importNetworkAssetAndConfirm } from '@/api/mediaLibrary.js'
import { uploadAPI } from '@/api/upload'
import request from '@/utils/request'
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'
import { normalizeMediaLibraryReturnTo } from '@/router'
import {
  createLatestMediaRequestGuard,
  formatMediaSize as formatSize,
  getMediaItemFileSize as mediaItemFileSize,
  buildMediaLibraryNetworkImportFeedback,
  getNetworkAssetImportability,
  getNetworkAssetCardImageUrl,
  getNetworkAssetPreviewUrl,
  getMediaLibraryDramaId,
  getVisibleSelectedMediaIds,
  hasPendingMediaLibraryOperations,
  hasActiveMediaFilters,
  mediaLibraryAccessState,
  mergeMediaLibraryNetworkRoute,
  normalizeMediaItem as normalizeItem,
  normalizeMediaLibraryNetworkRoute,
  runMediaOperationOnce,
  getMediaOriginLabel,
  describeMediaDeleteImpact,
  describeMediaBatchDeleteImpact,
  isMediaInUseError,
} from '@/utils/mediaLibrary'
import {
  MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL,
  partitionMediaLibraryUploads,
  buildMediaLibraryUploadFeedback,
} from '@/utils/mediaUploadValidation'

const route = useRoute()
const router = useRouter()
const initialNetworkRoute = normalizeMediaLibraryNetworkRoute(route.query)
const loading = ref(false)
const libraryMode = ref(initialNetworkRoute.mode)
const uploading = ref(false)
const uploadProgress = ref({ current: 0, total: 0 })
const uploadFeedback = ref(null)
const networkImportFeedback = ref(null)
const mediaItems = ref([])
const mediaType = ref('all')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(30)
const total = ref(0)
const loadError = ref('')
const hasSuccessfulMediaLoad = ref(false)
const selectedIds = reactive(new Set())
const showPreview = ref(false)
const previewItem = ref(null)
const uploadInput = ref(null)
const hoveredCardId = ref(null)
const focusedCardId = ref(null)
const networkKeyword = ref(initialNetworkRoute.keyword)
const networkMediaType = ref(initialNetworkRoute.type)
const networkItems = ref([])
const networkLoading = ref(false)
const networkError = ref('')
const networkSearched = ref(false)
const networkImportingKeys = reactive(new Set())
const showNetworkPreview = ref(false)
const networkPreviewItem = ref(null)
const hasActiveFilters = computed(() => hasActiveMediaFilters(mediaType.value, keyword.value))
const returnTo = computed(() => normalizeMediaLibraryReturnTo(route.query.returnTo))
const scopedDramaId = computed(() => getMediaLibraryDramaId(returnTo.value))
const networkImportTargetLabel = computed(() => scopedDramaId.value
  ? `当前项目（ID ${scopedDramaId.value}）`
  : '全局素材库')
const networkImportButtonText = computed(() => scopedDramaId.value ? '导入当前项目' : '导入全局素材库')
const networkSearchAnnouncement = computed(() => {
  if (networkLoading.value) return `正在搜索：${networkKeyword.value.trim()}`
  if (networkError.value) return `搜索失败：${networkError.value}`
  if (!networkSearched.value) return '尚未执行网络素材搜索'
  return networkItems.value.length > 0
    ? `搜索完成，找到 ${networkItems.value.length} 项素材`
    : '搜索完成，没有找到匹配素材'
})
const mediaIsStale = computed(() => Boolean(loadError.value) && hasSuccessfulMediaLoad.value)
const mediaAccessState = computed(() => mediaLibraryAccessState({
  loading: loading.value,
  uploading: uploading.value,
  hasSuccessfulLoad: hasSuccessfulMediaLoad.value,
  loadError: loadError.value,
  itemCount: mediaItems.value.length,
}))
const mediaWriteLocked = computed(() => mediaAccessState.value.writeLocked)
const mediaRequestGuard = createLatestMediaRequestGuard()
const networkRequestGuard = createLatestMediaRequestGuard()
let keywordTimer = null
let mediaLibraryMounted = false
let networkAbortController = null

function resolvedMediaLibraryPath(query) {
  return router.resolve({ path: route.path, query, hash: route.hash }).fullPath
}

watch(
  () => route.query,
  (query) => {
    const state = normalizeMediaLibraryNetworkRoute(query)
    const changed = libraryMode.value !== state.mode
      || networkKeyword.value !== state.keyword
      || networkMediaType.value !== state.type
    libraryMode.value = state.mode
    networkKeyword.value = state.keyword
    networkMediaType.value = state.type
    if (!mediaLibraryMounted || !changed) return

    invalidateNetworkSearch()
    if (state.mode === 'network' && state.keyword) searchNetworkMedia()
  },
  { deep: true },
)

watch(
  [libraryMode, networkKeyword, networkMediaType],
  () => {
    if (libraryMode.value === 'network' && !networkKeyword.value.trim()) {
      invalidateNetworkSearch()
    }
    const nextQuery = mergeMediaLibraryNetworkRoute(route.query, {
      mode: libraryMode.value,
      keyword: networkKeyword.value,
      type: networkMediaType.value,
    })
    if (resolvedMediaLibraryPath(nextQuery) === route.fullPath) return
    router.replace({ path: route.path, query: nextQuery, hash: route.hash }).catch(() => {})
  },
  { flush: 'post' },
)

function goHome() {
  router.push('/')
}

function goBack() {
  router.push(returnTo.value || '/')
}

function goNewProject() {
  if (mediaAccessState.value.navigationLocked) return
  router.push({ path: '/', query: { new: '1' } })
}

function goSourceImport() {
  if (mediaAccessState.value.navigationLocked) return
  router.push({ path: '/', query: { intent: 'source-import' } })
}

function triggerUpload() {
  if (mediaWriteLocked.value) return
  uploadInput.value?.click()
}

async function onUpload(e) {
  if (mediaWriteLocked.value) {
    if (e.target) e.target.value = ''
    return
  }
  const selectedFiles = Array.from(e.target.files || [])
  if (!selectedFiles.length) return
  const { accepted: files, oversized } = partitionMediaLibraryUploads(selectedFiles)
  const oversizedNames = oversized.map((file) => file.name)
  uploadFeedback.value = null
  if (!files.length) {
    uploadFeedback.value = buildMediaLibraryUploadFeedback({
      succeeded: 0,
      failedNames: [],
      oversizedNames,
      acceptedCount: 0,
    })
    e.target.value = ''
    return
  }
  uploading.value = true
  uploadProgress.value = { current: 0, total: files.length }
  let succeeded = 0
  const failedNames = []
  for (const file of files) {
    try {
      await uploadAPI.uploadAsset(file, { suppressErrorToast: true })
      succeeded++
    } catch (err) {
      failedNames.push(file.name)
      ElMessage.warning(`${file.name} 上传失败：${describeServiceLoadError(err, { serviceLabel: '素材服务', fallback: err.message || '请稍后重试' })}`)
    } finally {
      uploadProgress.value.current++
    }
  }
  uploading.value = false
  e.target.value = ''
  uploadFeedback.value = buildMediaLibraryUploadFeedback({
    succeeded,
    failedNames,
    oversizedNames,
    acceptedCount: files.length,
  })
  if (succeeded === files.length && oversized.length === 0) ElMessage.success(`${succeeded} 个素材上传完成`)
  else if (succeeded > 0) {
    ElMessage.warning(uploadFeedback.value.detail)
  }
  loadMedia()
}

function debouncedLoad() {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(applyFilters, 400)
}

function applyFilters() {
  page.value = 1
  loadMedia()
}

function clearFilters() {
  mediaType.value = 'all'
  keyword.value = ''
  applyFilters()
}

function describeMediaLoadError(error) {
  return describeServiceLoadError(error, { serviceLabel: '素材服务' })
}

let mediaListAbortController = null

async function loadMedia() {
  mediaListAbortController?.abort()
  const controller = new AbortController()
  mediaListAbortController = controller
  const requestId = mediaRequestGuard.begin()
  loading.value = true
  try {
    const params = {
      page: page.value,
      page_size: pageSize.value,
    }
    if (mediaType.value !== 'all') params.type = mediaType.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    const res = await withRequestRetry(
      () => mediaLibraryAPI.list(params, { suppressErrorToast: true, signal: controller.signal }),
      { maxAttempts: 2, delayMs: 400, signal: controller.signal },
    )
    const applied = mediaRequestGuard.commit(requestId, () => {
      const nextItems = (res?.items || []).map(normalizeItem)
      const visibleSelectedIds = getVisibleSelectedMediaIds(selectedIds, nextItems)
      mediaItems.value = nextItems
      selectedIds.clear()
      visibleSelectedIds.forEach((id) => selectedIds.add(id))
      total.value = res?.pagination?.total ?? res?.total ?? 0
      hasSuccessfulMediaLoad.value = true
      loadError.value = ''
    })
    return { status: applied ? 'applied' : 'stale', data: applied ? [...mediaItems.value] : null }
  } catch (err) {
    if (isRequestCanceled(err)) {
      return { status: 'stale', error: err }
    }
    const applied = mediaRequestGuard.commit(requestId, () => {
      loadError.value = describeMediaLoadError(err)
    })
    return { status: applied ? 'failed' : 'stale', error: err }
  } finally {
    mediaRequestGuard.commit(requestId, () => {
      loading.value = false
    })
  }
}

function describeNetworkError(error, fallback) {
  return describeServiceLoadError(error, { serviceLabel: '网络素材服务', fallback })
}

function mediaOriginLabel(item) {
  return getMediaOriginLabel(item)
}

function invalidateNetworkSearch() {
  networkRequestGuard.begin()
  networkAbortController?.abort()
  networkAbortController = null
  networkItems.value = []
  networkError.value = ''
  networkSearched.value = false
  networkLoading.value = false
}

function networkItemKey(item, index = 0) {
  return item?.source_url || item?.download_url || `${item?.title || 'network'}-${index}`
}

function networkItemTitle(item) {
  return item?.title?.trim() || '未命名网络素材'
}

function networkCardImageUrl(item) {
  if (item?.media_type === 'video') return String(item?.thumbnail_url || '').trim()
  return getNetworkAssetCardImageUrl(item)
}

function networkPlaybackUrl(item) {
  return getNetworkAssetPreviewUrl(item)
}

function networkDimensions(item) {
  return item?.width && item?.height ? `${item.width} × ${item.height}` : item?.media_type === 'video' ? '视频' : '图片'
}

function networkItemImportability(item) {
  return getNetworkAssetImportability(item)
}

function safeExternalUrl(value, requireHttps = false) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return ''
    const allowed = requireHttps ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)
    return allowed ? url.href : ''
  } catch (_) {
    return ''
  }
}

function sourceEvidence(item, key) {
  if (!item || !key) return ''
  return item.source_metadata?.[key] ?? item[key] ?? ''
}

async function copySourceEvidence(value, label) {
  const text = String(value || '').trim()
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`${label} 已复制`)
    return true
  } catch (_) {
    ElMessage.error(`${label} 复制失败，请手动选择复制`)
    return false
  }
}

function formatSourceTimestamp(value) {
  const timestamp = Date.parse(String(value || ''))
  if (!Number.isFinite(timestamp)) return String(value || '')
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp))
}

async function searchNetworkMedia() {
  const query = networkKeyword.value.trim()
  if (!query) {
    networkError.value = '请输入关键词后再搜索'
    return
  }
  networkAbortController?.abort()
  const abortController = new AbortController()
  networkAbortController = abortController
  const requestId = networkRequestGuard.begin()
  networkLoading.value = true
  networkError.value = ''
  try {
    const params = { keyword: query }
    if (networkMediaType.value !== 'all') params.type = networkMediaType.value
    const result = await mediaLibraryAPI.searchNetwork(params, {
      suppressErrorToast: true,
      signal: abortController.signal,
    })
    networkRequestGuard.commit(requestId, () => {
      networkItems.value = result?.items || []
      networkSearched.value = true
    })
  } catch (error) {
    if (isRequestCanceled(error)) return
    networkRequestGuard.commit(requestId, () => {
      networkItems.value = []
      networkSearched.value = true
      networkError.value = describeNetworkError(error, '暂时无法搜索网络素材，请稍后重试')
    })
  } finally {
    networkRequestGuard.commit(requestId, () => {
      networkLoading.value = false
    })
    if (networkAbortController === abortController) networkAbortController = null
  }
}

function handleNetworkTypeChange() {
  invalidateNetworkSearch()
  if (networkKeyword.value.trim()) searchNetworkMedia()
}

function openNetworkPreview(item) {
  networkPreviewItem.value = item
  showNetworkPreview.value = true
}

function isNetworkImporting(item) {
  return networkImportingKeys.has(networkItemKey(item))
}

async function importNetworkItem(item) {
  const key = networkItemKey(item)
  const importability = networkItemImportability(item)
  if (!importability.allowed) {
    ElMessage.warning(importability.reason)
    return
  }
  await runMediaOperationOnce(networkImportingKeys, key, async () => {
    networkImportFeedback.value = null
    try {
      const result = await importNetworkAssetAndConfirm({
        item,
        dramaId: scopedDramaId.value,
        api: mediaLibraryAPI,
        reload: loadMedia,
      })
      if (result.confirmed) {
        ElMessage.success(`已导入：${networkItemTitle(item)}`)
      } else {
        networkImportFeedback.value = buildMediaLibraryNetworkImportFeedback({
          status: 'unconfirmed',
          item,
        })
        ElMessage.error(networkImportFeedback.value.detail)
      }
    } catch (error) {
      networkImportFeedback.value = buildMediaLibraryNetworkImportFeedback({
        status: 'failed',
        item,
        detail: describeNetworkError(error, '网络素材导入失败'),
      })
      ElMessage.error(networkImportFeedback.value.detail)
    }
  })
}

function itemUrl(item) {
  if (!item) return ''
  const lp = item.local_path || item.image_local_path || item.video_local_path
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return item.url || item.image_url || item.video_url || ''
}

function accessibleItemName(item) {
  return item?.name?.trim() || '未命名素材'
}

function thumbnailAlt(item) {
  return `素材缩略图：${accessibleItemName(item)}`
}

function previewAlt(item) {
  return `素材预览图：${accessibleItemName(item)}`
}

function videoPreviewLabel(item) {
  return `素材视频预览：${accessibleItemName(item)}`
}

function selectionLabel(item) {
  const action = selectedIds.has(item.id) ? '取消选择' : '选择'
  return `${action}素材：${accessibleItemName(item)}`
}

function actionLabel(action, item) {
  return `${action}素材：${accessibleItemName(item)}`
}

function setItemSelected(item, selected) {
  if (mediaWriteLocked.value) return
  if (selected) selectedIds.add(item.id)
  else selectedIds.delete(item.id)
}

function isActionLayerVisible(itemId) {
  return selectedIds.has(itemId) || hoveredCardId.value === itemId || focusedCardId.value === itemId
}

function showPointerActions(itemId) {
  hoveredCardId.value = itemId
}

function hidePointerActions(itemId) {
  if (hoveredCardId.value === itemId) hoveredCardId.value = null
}

function showKeyboardActions(itemId) {
  focusedCardId.value = itemId
}

function hideKeyboardActions(itemId, event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (focusedCardId.value === itemId) focusedCardId.value = null
}

function openPreview(item) {
  previewItem.value = item
  showPreview.value = true
}

async function deleteItem(item) {
  if (mediaWriteLocked.value) return
  try {
    await ElMessageBox.confirm(`${describeMediaDeleteImpact(item)}确定删除？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch (_) {
    return
  }
  try {
    await request.delete(`/assets/${item.id}`, { suppressErrorToast: true })
    ElMessage.success('已删除')
    loadMedia()
  } catch (err) {
    ElMessage.error(describeServiceLoadError(err, { serviceLabel: '素材服务', fallback: err.message || '删除失败' }))
  }
}

async function batchDelete() {
  if (mediaWriteLocked.value) return
  const idsToDelete = getVisibleSelectedMediaIds(selectedIds, mediaItems.value)
  const count = idsToDelete.length
  if (count <= 0) {
    selectedIds.clear()
    return
  }
  try {
    await ElMessageBox.confirm(`${describeMediaBatchDeleteImpact(count)}确定继续？`, '批量删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch (_) {
    return
  }
  let failed = 0
  let inUse = 0
  for (const id of idsToDelete) {
    try {
      await request.delete(`/assets/${id}`, { suppressErrorToast: true })
    } catch (err) {
      failed += 1
      if (isMediaInUseError(err)) inUse += 1
    }
  }
  selectedIds.clear()
  if (failed > 0) {
    const inUseHint = inUse ? `，其中 ${inUse} 个仍被分镜或画布引用` : ''
    ElMessage.warning(`${count - failed} 个删除成功，${failed} 个失败${inUseHint}`)
  }
  else ElMessage.success(`${count} 个素材已删除`)
  loadMedia()
}

function confirmMediaLibraryLeave() {
  if (!hasPendingMediaLibraryOperations(uploading.value, networkImportingKeys)) return true
  const message = uploading.value
    ? '素材正在上传，请完成后再离开。'
    : '网络素材正在导入，请完成后再离开。'
  ElMessage.warning(message)
  return false
}

function handleBeforeUnload(event) {
  if (!hasPendingMediaLibraryOperations(uploading.value, networkImportingKeys)) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => confirmMediaLibraryLeave())

onMounted(() => {
  mediaLibraryMounted = true
  window.addEventListener('beforeunload', handleBeforeUnload)
  loadMedia()
  if (libraryMode.value === 'network' && networkKeyword.value) searchNetworkMedia()
})

onBeforeUnmount(() => {
  mediaLibraryMounted = false
  clearTimeout(keywordTimer)
  invalidateNetworkSearch()
  mediaListAbortController?.abort()
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<style scoped>
.media-library-page {
  min-height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
  padding: 24px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border-color);
  gap: 20px;
}

.header-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.back-link {
  padding-left: 0;
}

.title-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-bright);
  margin: 0;
}

.page-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.library-tabs {
  margin-bottom: 18px;
}

.network-search-panel {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border-color);
}

.section-title {
  margin: 0;
  color: var(--text-bright);
  font-size: 18px;
  line-height: 1.4;
}

.section-description {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.network-search-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}

.network-search-input {
  width: min(320px, 32vw);
}

.network-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--el-color-danger);
  border-radius: 8px;
  background: var(--bg-card);
}

.network-state h2,
.network-state p {
  margin: 0;
}

.network-state h2 {
  color: var(--text-bright);
  font-size: 15px;
}

.network-state p {
  margin-top: 4px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.network-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  min-height: 260px;
}

.network-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow);
}

.network-thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: var(--bg-inner);
  color: #fff;
  cursor: pointer;
}

.network-thumb img,
.network-thumb video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.network-thumb-placeholder {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.network-thumb-placeholder .el-icon {
  font-size: 28px;
}

.network-thumb:focus-visible {
  outline: 3px solid var(--el-color-primary);
  outline-offset: -3px;
}

.network-preview-label {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(17, 24, 39, .78);
  font-size: 12px;
}

.network-info {
  min-width: 0;
  padding: 12px;
}

.network-info h3 {
  margin: 0;
  overflow: hidden;
  color: var(--text-bright);
  font-size: 14px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-detail {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 7px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.network-detail span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-license {
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--text-subtle);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-license-warning {
  margin: 6px 0 0;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.45;
}

.network-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
}

.network-actions a,
.source-unavailable {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.network-actions a {
  color: var(--el-color-primary);
}

.source-unavailable {
  color: var(--text-subtle);
}

.network-empty {
  grid-column: 1 / -1;
  display: flex;
  min-height: 260px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-subtle);
  text-align: center;
}

.network-empty .el-icon {
  font-size: 42px;
}

.network-empty h2,
.network-empty p {
  margin: 0;
}

.network-empty h2 {
  color: var(--text-bright);
  font-size: 17px;
}

.data-load-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
  padding: 16px 18px;
  border: 1px solid var(--el-color-danger-light-5);
  border-left: 4px solid var(--el-color-danger);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: var(--shadow);
}

.data-load-state__content {
  min-width: 0;
}

.data-load-state h2 {
  margin: 0 0 5px;
  color: var(--text-bright);
  font-size: 16px;
  line-height: 1.4;
}

.data-load-state p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.data-load-state .data-load-state__stale {
  color: #d97706;
}

.data-load-state .data-load-state__detail {
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}

.entry-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1px;
  margin-bottom: 20px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--border-color);
  box-shadow: var(--shadow);
}

.entry-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  padding: 18px;
  background: var(--bg-card);
}

.entry-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
}

.entry-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.entry-action {
  padding-left: 0;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.search-input {
  width: 240px;
}

.upload-feedback {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--el-color-warning);
  border-radius: 8px;
  background: var(--bg-card);
}

.upload-feedback--error {
  border-left-color: var(--el-color-danger);
}

.upload-feedback h2,
.upload-feedback p {
  margin: 0;
}

.upload-feedback h2 {
  color: var(--text-bright);
  font-size: 15px;
}

.upload-feedback p {
  margin-top: 4px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--el-color-primary);
  font-size: 14px;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  min-height: 200px;
}

.media-card {
  background: var(--bg-card);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  cursor: default;
  transition: all .2s;
  box-shadow: var(--shadow);
}

.media-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}

.media-card.selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary), var(--shadow);
}

.media-thumb {
  aspect-ratio: 1;
  background: var(--bg-inner);
  overflow: hidden;
  position: relative;
}

.thumb-img,
.thumb-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-card.actions-visible .media-overlay {
  opacity: 1;
  pointer-events: auto;
}

.selection-control {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  cursor: pointer;
}

.selection-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.selection-indicator {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: transparent;
  background: rgba(255, 255, 255, .92);
  border: 2px solid rgba(31, 41, 55, .55);
  border-radius: 50%;
  transition: border-color .2s, box-shadow .2s, color .2s;
}

.selection-check {
  font-size: 20px;
}

.selection-input:checked + .selection-indicator {
  color: var(--el-color-primary);
  border-color: #fff;
}

.selection-input:focus-visible + .selection-indicator {
  outline: 3px solid var(--el-color-primary);
  outline-offset: 2px;
}

.selection-input:disabled + .selection-indicator {
  cursor: not-allowed;
  opacity: 0.5;
}

.overlay-actions {
  display: flex;
  gap: 6px;
}

.media-info {
  padding: 8px;
}

.media-name {
  display: block;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-meta {
  font-size: 11px;
  color: var(--text-subtle);
}

.media-origin {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-media {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 340px;
  color: var(--text-subtle);
  gap: 10px;
}

.empty-icon {
  font-size: 48px;
}

.empty-title {
  margin: 4px 0 0;
  color: var(--text-bright);
  font-size: 18px;
}

.empty-description {
  margin: 0 0 8px;
  color: var(--text-subtle);
  font-size: 14px;
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.empty-note {
  max-width: 560px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-subtle);
  text-align: center;
}

.empty-secondary-action {
  min-height: 28px;
  margin-top: -2px;
  padding: 0 4px;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.batch-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a2e;
  color: #fff;
  padding: 10px 20px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(0,0,0,.2);
}

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

@media (max-width: 840px) {
  .media-library-page {
    padding: 16px;
  }

  .page-header,
  .network-search-panel {
    align-items: stretch;
    flex-direction: column;
  }

  .header-actions,
  .network-search-controls {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .network-search-input {
    width: 100%;
    flex: 1 1 240px;
  }
}

@media (max-width: 520px) {
  .header-actions > .el-button,
  .network-search-controls > .el-button {
    margin-left: 0;
  }

  .network-search-controls > .el-radio-group,
  .network-search-input {
    flex-basis: 100%;
  }

  .network-grid {
    grid-template-columns: 1fr;
  }

  .network-state {
    align-items: stretch;
    flex-direction: column;
  }

  .meta-row--hash {
    flex-wrap: wrap;
  }

  .meta-row--hash code {
    flex-basis: calc(100% - 40px);
  }
}
</style>
