<template>
  <main class="media-library-page">
    <MediaLibraryHeader ref="mediaLibraryHeaderRef" v-bind="headerBindings" />

    <el-tabs v-model="libraryMode" class="library-tabs" aria-label="素材来源">
      <el-tab-pane label="本地素材" name="local" />
      <el-tab-pane label="网络素材" name="network" />
    </el-tabs>

    <MediaLibraryNetworkImportFeedback
      :network-import-feedback="networkImportFeedback"
      :network-import-retry-item="networkImportRetryItem"
      :is-network-importing="isNetworkImporting"
      :network-item-importability="networkItemImportability"
      :import-network-item="importNetworkItem"
      :show-local-library="showLocalLibrary"
    />

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

    <MediaLibraryPreviewDialogs
      v-model:show-preview="showPreview"
      v-model:show-network-preview="showNetworkPreview"
      v-bind="previewDialogBindings"
    />

    <MediaLibrarySourceImportDialog
      v-model:show-picker="showSourceImportPicker"
      v-model:keyword="sourceImportKeyword"
      v-model:page="sourceImportPage"
      v-bind="sourceImportPickerBindings"
    />

  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import MediaLibraryHeader from '@/components/mediaLibrary/MediaLibraryHeader.vue'
import MediaLibraryFilterBar from '@/components/mediaLibrary/MediaLibraryFilterBar.vue'
import MediaLibraryLocalGrid from '@/components/mediaLibrary/MediaLibraryLocalGrid.vue'
import MediaLibraryNetworkPanel from '@/components/mediaLibrary/MediaLibraryNetworkPanel.vue'
import MediaLibraryPreviewDialogs from '@/components/mediaLibrary/MediaLibraryPreviewDialogs.vue'
import MediaLibraryNetworkImportFeedback from '@/components/mediaLibrary/MediaLibraryNetworkImportFeedback.vue'
import MediaLibrarySourceImportDialog from '@/components/mediaLibrary/MediaLibrarySourceImportDialog.vue'
import {
  mediaOriginLabel,
  networkItemKey,
  networkItemTitle,
  normalizeNetworkSourceQuery,
  isOpenversePreview,
  networkItemSourceLabel,
  networkCardImageUrl,
  networkPlaybackUrl,
  networkDimensions,
  networkItemImportability,
  safeExternalUrl,
  sourceEvidence,
  formatSourceTimestamp,
  itemUrl,
  thumbnailAlt,
  previewAlt,
  videoPreviewLabel,
  actionLabel,
  mediaSelectionLabel,
  describeNetworkSearchAnnouncement,
} from '@/components/mediaLibrary/mediaLibraryFormatters.js'
import { createMediaLibraryNavigation } from '@/components/mediaLibrary/mediaLibraryNavigation.js'
import { createMediaLibraryLocalLoad } from '@/components/mediaLibrary/mediaLibraryLocalLoad.js'
import {
  copySourceEvidence,
  createMediaLibraryNetworkActions,
} from '@/components/mediaLibrary/mediaLibraryNetworkActions.js'
import { createMediaLibrarySelection } from '@/components/mediaLibrary/mediaLibrarySelection.js'
import { createMediaLibrarySourceImport } from '@/components/mediaLibrary/mediaLibrarySourceImport.js'
import { mediaLibraryAPI } from '@/api/mediaLibrary.js'
import { dramaAPI } from '@/api/drama'
import { uploadAPI } from '@/api/upload'
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
  getMediaLibraryDramaId,
  getVisibleSelectedMediaIds,
  hasActiveMediaFilters,
  mediaLibraryAccessState,
  mergeMediaLibraryNetworkRoute,
  normalizeMediaLibraryNetworkRoute,
} from '@/utils/mediaLibrary'
import {
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
const networkSearchAnnouncement = computed(() => describeNetworkSearchAnnouncement({
  loading: networkLoading.value,
  keyword: networkKeyword.value,
  error: networkError.value,
  searched: networkSearched.value,
  count: networkItems.value.length,
}))
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

const mediaRequestGuard = createLatestMediaRequestGuard()
const networkRequestGuard = createLatestMediaRequestGuard()
let mediaLibraryMounted = false

const { goBack } = createMediaLibraryNavigation({ router, returnTo })

const {
  applyFilters,
  clearFilters,
  debouncedLoad,
  loadMedia,
  abortMediaListRequest,
} = createMediaLibraryLocalLoad({
  page,
  pageSize,
  mediaType,
  keyword,
  loading,
  mediaItems,
  selectedIds,
  total,
  hasSuccessfulMediaLoad,
  loadError,
  mediaRequestGuard,
  mediaLibraryAPI,
})

const {
  clearNetworkSearch,
  cancelNetworkSearch,
  invalidateNetworkSearch,
  searchNetworkMedia,
  handleNetworkTypeChange,
  handleNetworkSourceChange,
  importNetworkItem,
} = createMediaLibraryNetworkActions({
  networkKeyword,
  networkMediaType,
  networkSource,
  networkItems,
  networkLoading,
  networkError,
  networkNotice,
  networkSearched,
  networkRequestGuard,
  networkImportFeedback,
  networkImportRetryItem,
  networkImportingKeys,
  scopedDramaId,
  loadMedia,
  mediaLibraryAPI,
})

const {
  deleteItem,
  batchDelete,
  confirmMediaLibraryLeave,
  handleBeforeUnload,
} = createMediaLibrarySelection({
  mediaWriteLocked,
  selectedIds,
  mediaItems,
  uploading,
  networkImportingKeys,
  loadMedia,
})

const {
  showPicker: showSourceImportPicker,
  loading: sourceImportLoading,
  loadError: sourceImportLoadError,
  projects: sourceImportProjects,
  total: sourceImportTotal,
  page: sourceImportPage,
  pageSize: sourceImportPageSize,
  keyword: sourceImportKeyword,
  hasSuccessfulLoad: sourceImportHasSuccessfulLoad,
  goSourceImport,
  loadProjects: loadSourceImportProjects,
  scheduleSearch: scheduleSourceImportSearch,
  loadProjectPage: loadSourceImportProjectPage,
  selectProject: selectSourceImportProject,
  createProjectFromPicker: createSourceImportProject,
  resetPicker: resetSourceImportPicker,
  dispose: disposeSourceImportPicker,
} = createMediaLibrarySourceImport({
  router,
  dramaAPI,
  openWorkspaceNavItem,
  scopedDramaId,
  returnTo,
  navigationLocked: computed(() => mediaAccessState.value.navigationLocked),
})

function goNewProject() {
  if (mediaAccessState.value.navigationLocked) return
  openWorkspaceNavItem(router, 'list', { query: { new: '1' } })
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
      if (isMediaLibraryUserAbort(err)) continue
      failedNames.push(file.name)
      const detail = describeMediaLibraryUserError(err, { serviceLabel: '素材服务', fallback: '请稍后重试' })
      ElMessage.warning(detail ? `${file.name} 上传失败：${detail}` : `${file.name} 上传失败，请稍后重试`)
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

function resolvedMediaLibraryPath(query) {
  return router.resolve({ path: route.path, query, hash: route.hash }).fullPath
}

function selectionLabel(item) {
  return mediaSelectionLabel(item, selectedIds.has(item.id))
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

function openNetworkPreview(item) {
  networkPreviewItem.value = item
  showNetworkPreview.value = true
}

function isNetworkImporting(item) {
  return networkImportingKeys.has(networkItemKey(item))
}

function showLocalLibrary() {
  libraryMode.value = 'local'
  loadMedia()
}

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
  goBack,
  returnTo: returnTo.value,
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
  cancelNetworkSearch,
}))

const sourceImportPickerBindings = computed(() => ({
  loading: sourceImportLoading.value,
  loadError: sourceImportLoadError.value,
  projects: sourceImportProjects.value,
  total: sourceImportTotal.value,
  pageSize: sourceImportPageSize.value,
  hasSuccessfulLoad: sourceImportHasSuccessfulLoad.value,
  navigationLocked: mediaAccessState.value.navigationLocked,
  navigationLockReason: mediaNavigationLockReason.value,
  loadProjects: loadSourceImportProjects,
  scheduleSearch: scheduleSourceImportSearch,
  loadProjectPage: loadSourceImportProjectPage,
  selectProject: selectSourceImportProject,
  createProjectFromPicker: createSourceImportProject,
  resetPicker: resetSourceImportPicker,
}))

const previewDialogBindings = computed(() => ({
  previewItem: previewItem.value,
  networkPreviewItem: networkPreviewItem.value,
  itemUrl,
  videoPreviewLabel,
  previewAlt,
  formatSize,
  mediaItemFileSize,
  formatSourceTimestamp,
  networkItemSourceLabel,
  safeExternalUrl,
  sourceEvidence,
  isOpenversePreview,
  copySourceEvidence,
  networkPlaybackUrl,
  networkItemTitle,
}))

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

onBeforeRouteLeave(() => confirmMediaLibraryLeave())

onMounted(() => {
  mediaLibraryMounted = true
  window.addEventListener('beforeunload', handleBeforeUnload)
  loadMedia()
  if (libraryMode.value === 'network' && networkKeyword.value) searchNetworkMedia()
})

onBeforeUnmount(() => {
  mediaLibraryMounted = false
  abortMediaListRequest()
  invalidateNetworkSearch()
  disposeSourceImportPicker()
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

@media (max-width: 840px) {
  .media-library-page {
    padding: 16px;
  }
}

</style>
