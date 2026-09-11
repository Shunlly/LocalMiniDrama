<template>
  <div class="film-list">
    <FilmListHeader
      ref="headerRef"
      v-model:show-ai-config-dialog="showAiConfigDialog"
      :is-dark="isDark"
      :list-write-locked="listWriteLocked"
      :list-write-lock-reason="listWriteLockReason"
      :list-error="listError"
      :backup-nav-item="backupNavItem"
      :importing="importing"
      :go-material-center="goMaterialCenter"
      :open-semantic-library="openSemanticLibrary"
      :go-free-create="goFreeCreate"
      :open-trash="openTrash"
      :toggle-theme="toggleTheme"
      :go-backup="goBackup"
      :trigger-import="triggerImport"
      :go-new-project="goNewProject"
    />
    <input ref="importFileInput" type="file" accept=".zip" style="display:none" @change="onImportFile" />

    <main class="main">
      <section v-if="sourceImportIntent" class="source-import-intent" role="status" aria-live="polite">
        <span>选择已有项目后导入网页 URL，或新建项目后继续。</span>
        <el-button type="primary" size="small" :disabled="listWriteLocked" aria-label="新建项目" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listError ? 'project-list-load-error' : undefined" @click="openSourceImportProject">
          <el-icon><Plus /></el-icon>新建项目
        </el-button>
      </section>
      <div v-loading="loading" class="projects-wrap" :aria-busy="loading">
        <FilmListFailureBanners
          :list-error="listError"
          :list-is-stale="listIsStale"
          :loading="loading"
          :export-failure="exportFailure"
          :exporting-id="exportingId"
          :import-failure="importFailure"
          :importing="importing"
          :list-write-locked="listWriteLocked"
          :list-write-lock-reason="listWriteLockReason"
          :load-list="loadList"
          :on-export="onExport"
          :trigger-import="triggerImport"
          :dismiss-import-failure="dismissImportFailure"
        />

        <FilmListWorkspaceToolbar
          v-model:project-search="projectSearch"
          v-model:project-status-filter="projectStatusFilter"
          v-model:project-sort="projectSort"
          :loading="loading"
          :has-successful-list-load="hasSuccessfulListLoad"
          :list-error="listError"
          :dramas="dramas"
          :filtered-dramas="filteredDramas"
          :has-project-filters="hasProjectFilters"
          :project-list-count-label="projectListCountLabel"
          :list-write-locked="listWriteLocked"
          :list-write-lock-reason="listWriteLockReason"
          :importing="importing"
          :example-list="exampleList"
          :importing-example="importingExample"
          :go-new-project="goNewProject"
          :trigger-import="triggerImport"
          :go-material-center="goMaterialCenter"
          :open-trash="openTrash"
          :on-import-example="onImportExample"
          :clear-project-filters="clearProjectFilters"
        />

        <FilmListProjectGrid
          :filtered-dramas="filteredDramas"
          :source-import-intent="sourceImportIntent"
          :project-list-return-to="projectListReturnTo"
          :exporting-id="exportingId"
          :list-write-locked="listWriteLocked"
          :list-write-lock-reason="listWriteLockReason"
          :project-card-destination="projectCardDestination"
          :project-cover-url="projectCoverUrl"
          :project-cover-alt="projectCoverAlt"
          :mark-project-cover-error="markProjectCoverError"
          :format-status="formatStatus"
          :format-date="formatDate"
          :format-style="formatStyle"
          :format-genre="formatGenre"
          :total-storyboards="totalStoryboards"
          :handle-project-action="handleProjectAction"
        />
        <FilmListPagination
          v-model:current-page="projectPage"
          v-model:page-size="projectPageSize"
          :loading="loading"
          :has-successful-list-load="hasSuccessfulListLoad"
          :list-error="listError"
          :total="total"
          :load-project-page="loadProjectPage"
          :handle-project-page-size-change="handleProjectPageSizeChange"
        />
      </div>
    </main>

    <FilmListTrashDialog
      v-model:show-trash-dialog="showTrashDialog"
      v-model:trash-page="trashPage"
      :trash-loading="trashLoading"
      :trash-error="trashError"
      :trash-items="trashItems"
      :trash-total="trashTotal"
      :trash-page-size="trashPageSize"
      :trash-announcement="trashAnnouncement"
      :restoring-id="restoringId"
      :format-date="formatDate"
      :describe-trash-live-status="describeTrashLiveStatus"
      :describe-trash-restore-busy-reason="describeTrashRestoreBusyReason"
      :load-trash="loadTrash"
      :restore-from-trash="restoreFromTrash"
    />

    <!-- 新建项目：先填标题和描述 -->
    <AccessibleDialog
      v-model="showNewDialog"
      title="新建项目"
      width="480px"
      :close-on-click-modal="false"
      @closed="resetNewForm"
    >
      <el-form :model="newForm" label-width="80px" label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="newForm.title" autofocus aria-label="项目标题" placeholder="输入项目标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newForm.description" type="textarea" :rows="3" aria-label="项目描述" placeholder="输入项目描述（选填）" />
        </el-form-item>
        <el-form-item label="画面比例">
          <el-select v-model="newForm.aspect_ratio" aria-label="画面比例" style="width: 100%">
            <el-option label="16:9 横屏（默认）" value="16:9" />
            <el-option label="9:16 竖屏（短视频）" value="9:16" />
            <el-option label="3:4 竖版" value="3:4" />
            <el-option label="1:1 方形" value="1:1" />
            <el-option label="4:3 传统横屏" value="4:3" />
            <el-option label="21:9 宽银幕" value="21:9" />
          </el-select>
          <p style="margin: 4px 0 0; font-size: 12px; color: #71717a;">影响分镜图和视频的生成比例，短视频选 9:16</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewDialog = false">取消</el-button>
        <el-button type="primary" :loading="newSaving" :disabled="Boolean(newSubmitDisabledReason)" :title="newSubmitDisabledReason || undefined" @click="submitNew">确定</el-button>
      </template>
    </AccessibleDialog>

    <!-- AI 配置弹窗 -->
    <AccessibleDialog
      v-model="showAiConfigDialog"
      title="AI 配置"
      width="90%"
      destroy-on-close
      :close-on-click-modal="false"
      :before-close="confirmAiConfigWorkspaceClose"
    >
      <AIConfigContent ref="aiConfigContentRef" v-if="showAiConfigDialog" />
    </AccessibleDialog>

    <FilmListLibraryDialogs
      v-model:show-char-library="showCharLibrary"
      v-model:show-scene-library="showSceneLibrary"
      v-model:show-prop-library="showPropLibrary"
      :list-write-locked="listWriteLocked"
      :list-write-lock-reason="listWriteLockReason"
    />

    <!-- 编辑项目：修改标题和故事 -->
    <AccessibleDialog
      v-model="showEditDialog"
      title="编辑项目"
      width="480px"
      :close-on-click-modal="false"
      @closed="resetEditForm"
    >
      <el-form :model="editForm" label-width="80px" label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="editForm.title" autofocus aria-label="项目标题" placeholder="输入项目标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="故事">
          <el-input v-model="editForm.description" type="textarea" :rows="3" aria-label="故事梗概" placeholder="输入故事梗概（选填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" :disabled="Boolean(editSubmitDisabledReason)" :title="editSubmitDisabledReason || undefined" @click="submitEdit">保存</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { Plus } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import { projectCardDestination } from '@/utils/sourceImportNavigation.js'
import { dramaAPI } from '@/api/drama'
import AIConfigContent from '@/components/AIConfigContent.vue'
import FilmListHeader from '@/components/filmList/FilmListHeader.vue'
import FilmListFailureBanners from '@/components/filmList/FilmListFailureBanners.vue'
import FilmListWorkspaceToolbar from '@/components/filmList/FilmListWorkspaceToolbar.vue'
import FilmListProjectGrid from '@/components/filmList/FilmListProjectGrid.vue'
import FilmListPagination from '@/components/filmList/FilmListPagination.vue'
import FilmListLibraryDialogs from '@/components/filmList/FilmListLibraryDialogs.vue'
import FilmListTrashDialog from '@/components/filmList/FilmListTrashDialog.vue'
import { aiAPI } from '@/api/ai'
import { filterProjectList } from '@/utils/projectList'
import {
  projectSearchText,
  projectCoverAlt,
  projectListCountLabel as resolveProjectListCountLabel,
  formatDate,
  formatStatus,
  formatStyle,
  formatGenre,
  totalStoryboards,
  describeTrashLiveStatus,
  describeTrashRestoreBusyReason,
} from '@/components/filmList/filmListFormatters.js'
import { mergeProjectListFilters, normalizeProjectListFilters, normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { useFilmListLoad } from '@/components/filmList/useFilmListLoad.js'
import { useFilmListTrash } from '@/components/filmList/useFilmListTrash.js'
import { useFilmListProjectForms } from '@/components/filmList/useFilmListProjectForms.js'
import { useFilmListImportExport } from '@/components/filmList/useFilmListImportExport.js'
import { useFilmListNavigation } from '@/components/filmList/useFilmListNavigation.js'

const router = useRouter()
const route = useRoute()
const { isDark, toggle: toggleTheme } = useTheme()

const showCharLibrary = ref(false)
const showSceneLibrary = ref(false)
const showPropLibrary = ref(false)

function openSemanticLibrary(type) {
  if (listWriteLocked.value) return
  if (type === 'character') showCharLibrary.value = true
  if (type === 'scene') showSceneLibrary.value = true
  if (type === 'prop') showPropLibrary.value = true
}

let projectListMounted = false
const initialProjectListFilters = normalizeProjectListFilters(route.query)
const projectSearch = ref(initialProjectListFilters.q)
const projectSort = ref(initialProjectListFilters.sort)
const projectStatusFilter = ref(initialProjectListFilters.status)
const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.fullPath) || '/')
const sourceImportIntent = computed(() => route.query.intent === 'source-import')
const normalizedProjectSearch = computed(() => projectSearch.value.trim().toLowerCase())
const hasProjectFilters = computed(() => Boolean(normalizedProjectSearch.value) || projectStatusFilter.value !== 'all')

const loadDeps = {
  normalizedProjectSearch,
  projectStatusFilter,
  projectSort,
  onLoaded: () => {},
}

const {
  loading,
  dramas,
  total,
  projectPage,
  projectPageSize,
  listError,
  hasSuccessfulListLoad,
  listIsStale,
  listWriteLocked,
  listWriteLockReason,
  scheduleProjectListReload,
  loadList,
  loadProjectPage,
  handleProjectPageSizeChange,
  projectCoverUrl,
  markProjectCoverError,
} = useFilmListLoad(loadDeps)

const filteredDramas = computed(() => {
  return filterProjectList(dramas.value, {
    keyword: normalizedProjectSearch.value,
    status: projectStatusFilter.value,
    sort: 'server',
    getSearchText: projectSearchText,
  })
})
const projectListCountLabel = computed(() => resolveProjectListCountLabel({
  total: total.value,
  page: projectPage.value,
  pageSize: projectPageSize.value,
  filteredCount: filteredDramas.value.length,
  hasFilters: hasProjectFilters.value,
}))

let applyingProjectListRoute = false

function resolvedProjectListPath(query) {
  return router.resolve({ path: route.path, query, hash: route.hash }).fullPath
}

watch(
  () => route.query,
  (query) => {
    const filters = normalizeProjectListFilters(query)
    applyingProjectListRoute = true
    projectSearch.value = filters.q
    projectStatusFilter.value = filters.status
    projectSort.value = filters.sort

    const nextQuery = mergeProjectListFilters(query, filters)
    if (resolvedProjectListPath(nextQuery) !== route.fullPath) {
      router.replace({ path: route.path, query: nextQuery, hash: route.hash }).catch(() => {})
    } else if (projectListMounted) {
      scheduleProjectListReload()
    }
    nextTick(() => {
      applyingProjectListRoute = false
    })
  },
  { deep: true, immediate: true },
)

watch(
  [projectSearch, projectStatusFilter, projectSort],
  () => {
    if (applyingProjectListRoute) return
    const nextQuery = mergeProjectListFilters(route.query, {
      q: projectSearch.value,
      status: projectStatusFilter.value,
      sort: projectSort.value,
    })
    if (resolvedProjectListPath(nextQuery) === route.fullPath) return
    router.replace({ path: route.path, query: nextQuery, hash: route.hash }).catch(() => {})
  },
  { flush: 'post' },
)

const showAiConfigDialog = ref(false)
const aiConfigContentRef = ref(null)
const vendorLockEnabled = ref(false)

async function confirmAiConfigWorkspaceClose(done) {
  const canClose = (await aiConfigContentRef.value?.requestClose?.()) !== false
  if (canClose) done()
}

const headerRef = ref(null)
const importFileInput = ref(null)

const {
  showNewDialog,
  newForm,
  newSaving,
  showEditDialog,
  editForm,
  editSaving,
  newSubmitDisabledReason,
  editSubmitDisabledReason,
  resetNewForm,
  submitNew,
  openEditDialog,
  resetEditForm,
  submitEdit,
} = useFilmListProjectForms({
  listWriteLocked,
  listWriteLockReason,
  loadList,
  sourceImportIntent,
  projectListReturnTo,
  router,
})

function maybeOpenNewDialogFromRoute() {
  if (listWriteLocked.value) return
  if (route.query.new !== '1') return
  showNewDialog.value = true
  const nextQuery = { ...route.query }
  delete nextQuery.new
  router.replace({ path: route.path, query: nextQuery })
}
loadDeps.onLoaded = maybeOpenNewDialogFromRoute

const {
  showTrashDialog,
  trashItems,
  trashLoading,
  trashError,
  trashAnnouncement,
  trashPage,
  trashPageSize,
  trashTotal,
  restoringId,
  openTrash,
  loadTrash,
  restoreFromTrash,
  moveToTrash,
} = useFilmListTrash({
  listWriteLocked,
  loadList,
})

const {
  exportingId,
  exportFailure,
  importing,
  importFailure,
  onExport,
  triggerImport,
  onImportFile,
  openSourceImportProject,
  dismissImportFailure,
} = useFilmListImportExport({
  listWriteLocked,
  loadList,
  showNewDialog,
  headerRef,
  importFileInput,
})

const exampleList = ref([])
const importingExample = ref(null)

function loadExamples() {
  dramaAPI.listExamples()
    .then(res => { exampleList.value = Array.isArray(res) ? res : (res?.data ?? []) })
    .catch(() => { exampleList.value = [] })
}

async function onImportExample(ex) {
  if (listWriteLocked.value) return
  importingExample.value = ex.filename
  try {
    const data = await dramaAPI.importExample(ex.filename)
    ElMessage.success(`示例导入成功：${data?.title || ex.name}`)
    loadList()
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '导入失败'))
  } finally {
    importingExample.value = null
  }
}

const {
  backupNavItem,
  goNewProject,
  goMaterialCenter,
  goFreeCreate,
  goBackup,
  requestFilmListNavigation,
  handleBeforeUnload,
} = useFilmListNavigation({
  router,
  listWriteLocked,
  showNewDialog,
  projectListReturnTo,
  importing,
  importingExample,
  exportingId,
  showAiConfigDialog,
  aiConfigContentRef,
})

onBeforeRouteLeave(requestFilmListNavigation)

function handleProjectAction(action, drama) {
  if (action === 'export') return onExport(drama)
  if (action === 'edit') return openEditDialog(drama)
  if (action === 'trash') return moveToTrash(drama)
}

function clearProjectFilters() {
  projectSearch.value = ''
  projectStatusFilter.value = 'all'
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  projectListMounted = true
  loadList()
  loadExamples()
  try {
    const lock = await aiAPI.getVendorLock()
    vendorLockEnabled.value = !!lock?.enabled
  } catch (_) {}
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  projectListMounted = false
})
</script>

<style scoped>
.film-list {
  min-height: 100vh;
  background: #08080d;
  color: #e4e4e7;
}
.source-import-intent {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  margin: 16px 0 0;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}
.page-title {
  color: #a1a1aa;
  font-size: 0.95rem;
}

.main {
  max-width: min(1400px, 96vw);
  margin: 0 auto;
  padding: 24px 16px 48px;
}
.projects-wrap {
  min-height: 200px;
}
html.light .film-list {
  background: #f7f8fa;
  color: #20242c;
}
html.light .badge-status--draft {
  background: rgba(107, 114, 128, 0.1);
  color: #4b5563;
  border-color: rgba(107, 114, 128, 0.25);
}


</style>
