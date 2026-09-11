<template>
  <main class="media-library-page">
    <MediaLibraryHeader ref="mediaLibraryHeaderRef" v-bind="headerBindings" />

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
      <el-button
        v-if="networkImportRetryItem"
        type="primary"
        plain
        :loading="isNetworkImporting(networkImportRetryItem)"
        :disabled="isNetworkImporting(networkImportRetryItem) || !networkItemImportability(networkImportRetryItem).allowed"
        :title="isNetworkImporting(networkImportRetryItem) ? MEDIA_LIBRARY_DISABLE_REASON.importing : (networkItemImportability(networkImportRetryItem).reason || undefined)"
        aria-label="重试导入该网络素材"
        @click="importNetworkItem(networkImportRetryItem)"
      >
        <el-icon><Refresh /></el-icon>重试导入
      </el-button>
    </section>

    <MediaLibraryLocalGrid
      v-if="libraryMode === 'local'"
      v-model:page="page"
      v-bind="localGridBindings"
    >
      <!-- 筛选栏 -->
      <MediaLibraryFilterBar
        v-model:media-type="mediaType"
        v-model:keyword="keyword"
        :apply-filters="applyFilters"
        :debounced-load="debouncedLoad"
      />
    </MediaLibraryLocalGrid>
    <MediaLibraryNetworkPanel
      v-else
      v-model:network-source="networkSource"
      v-model:network-media-type="networkMediaType"
      v-model:network-keyword="networkKeyword"
      v-bind="networkPanelBindings"
    />

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
        <el-button type="primary" @click="showNetworkPreview = false">关闭预览</el-button>
      </template>
    </AccessibleDialog>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { Refresh, CopyDocument } from '@element-plus/icons-vue'
import MediaLibraryHeader from '@/components/mediaLibrary/MediaLibraryHeader.vue'
import MediaLibraryFilterBar from '@/components/mediaLibrary/MediaLibraryFilterBar.vue'
import MediaLibraryLocalGrid from '@/components/mediaLibrary/MediaLibraryLocalGrid.vue'
import MediaLibraryNetworkPanel from '@/components/mediaLibrary/MediaLibraryNetworkPanel.vue'
import { mediaLibraryAPI, importNetworkAssetAndConfirm } from '@/api/mediaLibrary.js'
import { uploadAPI } from '@/api/upload'
import request from '@/utils/request'
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'
import {
  describeMediaLibraryUserError,
  isMediaLibraryUserAbort,
  describeMediaLibraryWriteLockReason,
  describeMediaLibraryUploadDisableReason,
  describeMediaLibraryNetworkSearchDisableReason,
  describeMediaLibraryBatchDeleteDisableReason,
  describeMediaLibrarySourceImportDisableReason,
  MEDIA_LIBRARY_DISABLE_REASON,
} from '@/utils/mediaLibraryUserError'
import { normalizeMediaLibraryReturnTo } from '@/router'
import { openWorkspaceNavItem } from '@/layouts/AppWorkspaceNav.js'
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
const networkImportRetryItem = ref(null)
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
const mediaLibraryHeaderRef = ref(null)
const hoveredCardId = ref(null)
const focusedCardId = ref(null)
const networkKeyword = ref(initialNetworkRoute.keyword)
const networkMediaType = ref(initialNetworkRoute.type)
const networkSource = ref(normalizeNetworkSourceQuery(initialNetworkRoute.source || route.query.network_source))
const networkItems = ref([])
const networkLoading = ref(false)
const networkError = ref('')
const networkNotice = ref('')
const networkSearched = ref(false)
const networkImportingKeys = reactive(new Set())
const showNetworkPreview = ref(false)
const networkPreviewItem = ref(null)
const hasActiveFilters = computed(() => hasActiveMediaFilters(mediaType.value, keyword.value))
const returnTo = computed(() => normalizeMediaLibraryReturnTo(route.query.returnTo))
const scopedDramaId = computed(() => getMediaLibraryDramaId(returnTo.value))
const networkImportTargetLabel = computed(() => scopedDramaId.value
  ? `当前项目（编号 ${scopedDramaId.value}）`
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
const mediaWriteLockReason = computed(() => describeMediaLibraryWriteLockReason({
  loading: loading.value,
  loadError: loadError.value,
  isStale: mediaIsStale.value,
  hasSuccessfulLoad: hasSuccessfulMediaLoad.value,
}))
const mediaNavigationLockReason = computed(() => (
  uploading.value ? MEDIA_LIBRARY_DISABLE_REASON.uploading : ''
))
const mediaUploadDisableReason = computed(() => describeMediaLibraryUploadDisableReason({
  writeLocked: mediaWriteLocked.value,
  writeLockReason: mediaWriteLockReason.value,
  uploading: uploading.value,
}))
const mediaRetryLoadDisableReason = computed(() => (
  loading.value ? MEDIA_LIBRARY_DISABLE_REASON.retryLoading : ''
))
const networkSearchDisableReason = computed(() => describeMediaLibraryNetworkSearchDisableReason({
  keyword: networkKeyword.value,
  searching: networkLoading.value,
}))
const visibleSelectedMediaCount = computed(() => (
  getVisibleSelectedMediaIds(selectedIds, mediaItems.value).length
))
const mediaBatchDeleteDisableReason = computed(() => describeMediaLibraryBatchDeleteDisableReason({
  writeLocked: mediaWriteLocked.value,
  writeLockReason: mediaWriteLockReason.value,
  visibleSelectedCount: visibleSelectedMediaCount.value,
}))
const mediaSourceImportDisableReason = computed(() => describeMediaLibrarySourceImportDisableReason({
  writeLocked: mediaWriteLocked.value,
  writeLockReason: mediaWriteLockReason.value,
  navigationLocked: mediaAccessState.value.navigationLocked,
  navigationLockReason: mediaNavigationLockReason.value,
}))

const headerBindings = computed(() => ({
  returnTo: returnTo.value,
  mediaAccessState: mediaAccessState.value,
  mediaNavigationLockReason: mediaNavigationLockReason.value,
  mediaItems: mediaItems.value,
  loading: loading.value,
  uploading: uploading.value,
  mediaWriteLocked: mediaWriteLocked.value,
  mediaUploadDisableReason: mediaUploadDisableReason.value,
  goBack,
  goNewProject,
  triggerUpload,
  onUpload,
}))

const localGridBindings = computed(() => ({
  loadError: loadError.value,
  mediaIsStale: mediaIsStale.value,
  loading: loading.value,
  mediaRetryLoadDisableReason: mediaRetryLoadDisableReason.value,
  mediaAccessState: mediaAccessState.value,
  mediaWriteLocked: mediaWriteLocked.value,
  uploading: uploading.value,
  mediaUploadDisableReason: mediaUploadDisableReason.value,
  mediaNavigationLockReason: mediaNavigationLockReason.value,
  mediaSourceImportDisableReason: mediaSourceImportDisableReason.value,
  mediaWriteLockReason: mediaWriteLockReason.value,
  uploadProgress: uploadProgress.value,
  uploadFeedback: uploadFeedback.value,
  mediaItems: mediaItems.value,
  selectedIds,
  hasSuccessfulMediaLoad: hasSuccessfulMediaLoad.value,
  hasActiveFilters: hasActiveFilters.value,
  total: total.value,
  pageSize: pageSize.value,
  visibleSelectedMediaCount: visibleSelectedMediaCount.value,
  mediaBatchDeleteDisableReason: mediaBatchDeleteDisableReason.value,
  loadMedia,
  triggerUpload,
  goSourceImport,
  goHome,
  itemUrl,
  thumbnailAlt,
  formatSize,
  mediaItemFileSize,
  mediaOriginLabel,
  isActionLayerVisible,
  showPointerActions,
  hidePointerActions,
  showKeyboardActions,
  hideKeyboardActions,
  selectionLabel,
  setItemSelected,
  actionLabel,
  openPreview,
  deleteItem,
  clearFilters,
  batchDelete,
}))

const networkPanelBindings = computed(() => ({
  networkImportTargetLabel: networkImportTargetLabel.value,
  networkSearchAnnouncement: networkSearchAnnouncement.value,
  networkLoading: networkLoading.value,
  networkSearchDisableReason: networkSearchDisableReason.value,
  networkError: networkError.value,
  networkNotice: networkNotice.value,
  networkItems: networkItems.value,
  networkSearched: networkSearched.value,
  networkImportButtonText: networkImportButtonText.value,
  handleNetworkSourceChange,
  handleNetworkTypeChange,
  searchNetworkMedia,
  networkItemKey,
  networkItemTitle,
  networkCardImageUrl,
  openNetworkPreview,
  networkDimensions,
  networkItemSourceLabel,
  networkItemImportability,
  safeExternalUrl,
  isNetworkImporting,
  importNetworkItem,
  clearNetworkSearch,
}))
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
    const nextSource = normalizeNetworkSourceQuery(query?.network_source)
    const changed = libraryMode.value !== state.mode
      || networkKeyword.value !== state.keyword
      || networkMediaType.value !== state.type
      || networkSource.value !== nextSource
    libraryMode.value = state.mode
    networkKeyword.value = state.keyword
    networkMediaType.value = state.type
    networkSource.value = nextSource
    if (!mediaLibraryMounted || !changed) return

    invalidateNetworkSearch()
    if (state.mode === 'network' && state.keyword) searchNetworkMedia()
  },
  { deep: true },
)

watch(
  [libraryMode, networkKeyword, networkMediaType, networkSource],
  () => {
    if (libraryMode.value === 'network' && !networkKeyword.value.trim()) {
      invalidateNetworkSearch()
    }
    const nextQuery = mergeMediaLibraryNetworkRoute(route.query, {
      mode: libraryMode.value,
      keyword: networkKeyword.value,
      type: networkMediaType.value,
    })
    if (networkSource.value && networkSource.value !== 'all') nextQuery.network_source = networkSource.value
    else delete nextQuery.network_source
    if (resolvedMediaLibraryPath(nextQuery) === route.fullPath) return
    router.replace({ path: route.path, query: nextQuery, hash: route.hash }).catch(() => {})
  },
  { flush: 'post' },
)

function goHome() {
  openWorkspaceNavItem(router, 'list')
}

function goBack() {
  if (returnTo.value) router.push(returnTo.value)
  else openWorkspaceNavItem(router, 'list')
}

function goNewProject() {
  if (mediaAccessState.value.navigationLocked) return
  openWorkspaceNavItem(router, 'list', { query: { new: '1' } })
}

function goSourceImport() {
  if (mediaAccessState.value.navigationLocked) return
  openWorkspaceNavItem(router, 'list', { query: { intent: 'source-import' } })
}

function triggerUpload() {
  if (mediaWriteLocked.value || uploading.value) return
  mediaLibraryHeaderRef.value?.uploadInput?.click()
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
      ElMessage.warning(`${file.name} 上传失败：${describeMediaLibraryUserError(err, { serviceLabel: '素材服务', fallback: '请稍后重试' })}`)
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
  return describeMediaLibraryUserError(error, { serviceLabel: '网络素材服务', fallback })
}

function mediaOriginLabel(item) {
  return getMediaOriginLabel(item)
}

function clearNetworkSearch() {
  networkKeyword.value = ''
  networkMediaType.value = 'all'
  networkSource.value = 'all'
  invalidateNetworkSearch()
}

function invalidateNetworkSearch() {
  networkRequestGuard.begin()
  networkAbortController?.abort()
  networkAbortController = null
  networkItems.value = []
  networkError.value = ''
  networkNotice.value = ''
  networkSearched.value = false
  networkLoading.value = false
}

function networkItemKey(item, index = 0) {
  return item?.source_url || item?.download_url || `${item?.title || 'network'}-${index}`
}

function networkItemTitle(item) {
  return item?.title?.trim() || '未命名网络素材'
}

function normalizeNetworkSourceQuery(value) {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'commons' || raw === 'openverse' || raw === 'all' ? raw : 'all'
}

function isOpenversePreview(item) {
  return item?.source === 'openverse'
    || item?.source_provider === 'Openverse'
    || item?.source_metadata?.kind === 'openverse'
    || Boolean(item?.openverse_id)
}

function networkItemSourceLabel(item) {
  if (!item) return '未知来源'
  if (item.source_site && (item.source === 'openverse' || item.source_provider === 'Openverse' || item.source_metadata?.kind === 'openverse')) {
    return `Openverse · ${item.source_site}`
  }
  return item.source_provider || item.source_site || (isOpenversePreview(item) ? 'Openverse' : 'Wikimedia Commons')
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
  if (!Number.isFinite(timestamp)) return ''
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
  networkNotice.value = ''
  try {
    const params = { keyword: query, source: networkSource.value }
    if (networkMediaType.value !== 'all') params.type = networkMediaType.value
    const result = await mediaLibraryAPI.searchNetwork(params, {
      suppressErrorToast: true,
      signal: abortController.signal,
    })
    networkRequestGuard.commit(requestId, () => {
      networkItems.value = result?.items || []
      networkNotice.value = result?.notice || ''
      networkSearched.value = true
    })
  } catch (error) {
    if (isMediaLibraryUserAbort(error)) return
    networkRequestGuard.commit(requestId, () => {
      networkItems.value = []
      networkNotice.value = ''
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

function handleNetworkSourceChange() {
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
    networkImportRetryItem.value = null
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
      if (isMediaLibraryUserAbort(error)) return
      networkImportRetryItem.value = item
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
    if (isMediaLibraryUserAbort(err)) return
    ElMessage.error(describeMediaLibraryUserError(err, { serviceLabel: '素材服务', fallback: '删除失败' }))
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

.library-tabs {
  margin-bottom: 18px;
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

.upload-feedback > .el-button {
  flex-shrink: 0;
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
