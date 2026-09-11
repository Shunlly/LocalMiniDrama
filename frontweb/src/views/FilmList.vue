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

        <div class="project-grid">
          <article
            v-for="d in filteredDramas"
            :key="d.id"
            class="project-card"
          >
            <RouterLink
              class="project-card-link"
              :to="projectCardDestination(d, sourceImportIntent, projectListReturnTo)"
              :aria-label="`打开项目「${d.title || '未命名项目'}」`"
            >
              <div class="project-card-body">
                <div class="project-card-layout">
                  <div class="project-card-cover" :class="{ 'project-card-cover--empty': !projectCoverUrl(d) }">
                    <img
                      v-if="projectCoverUrl(d)"
                      :src="projectCoverUrl(d)"
                      :alt="projectCoverAlt(d)"
                      loading="lazy"
                      @error="markProjectCoverError(d)"
                    />
                    <div v-else class="project-card-cover-placeholder" aria-hidden="true">
                      <el-icon><PictureFilled /></el-icon>
                      <span>{{ totalStoryboards(d) > 0 ? '待生成画面' : '尚无画面' }}</span>
                    </div>
                  </div>
                  <div class="project-card-content">
                    <div class="project-card-topline">
                      <span class="badge badge-status" :class="'badge-status--' + (d.status || 'draft')">{{ formatStatus(d.status) }}</span>
                      <span class="project-updated">更新于 {{ formatDate(d.updated_at || d.created_at) }}</span>
                    </div>
                    <div class="project-card-header">
                      <h3 class="project-title" :title="d.title || '未命名项目'">{{ d.title || '未命名项目' }}</h3>
                    </div>
                    <p class="project-desc">{{ d.description || '暂无描述' }}</p>
                    <div class="project-card-stats" aria-label="项目概览">
                      <span class="project-stat">
                        <strong>{{ d.episodes?.length || 0 }}</strong>
                        <span>集</span>
                      </span>
                      <span class="project-stat">
                        <strong>{{ totalStoryboards(d) }}</strong>
                        <span>分镜</span>
                      </span>
                      <span v-if="d.metadata?.aspect_ratio" class="project-stat project-stat--compact">{{ d.metadata.aspect_ratio }}</span>
                    </div>
                    <div class="project-badges">
                      <span v-if="d.style" class="badge badge-style">{{ formatStyle(d.style) }}</span>
                      <span v-if="d.genre" class="badge badge-genre">{{ formatGenre(d.genre) }}</span>
                    </div>
                    <div class="project-card-footer">
                      <p class="project-meta">创建于 {{ formatDate(d.created_at) || '未知时间' }}</p>
                      <span class="project-card-continue">{{ sourceImportIntent ? '导入网页 URL' : '继续制作' }} <el-icon aria-hidden="true"><ArrowRight /></el-icon></span>
                    </div>
                  </div>
                </div>
              </div>
            </RouterLink>
            <RouterLink
              class="project-card-assets"
              :to="{ name: 'drama-detail', params: { id: d.id }, query: { returnTo: projectListReturnTo }, hash: '#source-intake-workflow' }"
              :aria-label="`打开项目「${d.title || '未命名项目'}」的故事素材流程`"
              @click.stop
            >
              <el-icon><Files /></el-icon>故事素材
            </RouterLink>
            <el-dropdown
              class="project-card-menu"
              trigger="click"
              placement="bottom-end"
              popper-class="project-actions-dropdown"
              @click.stop
              @command="handleProjectAction($event, d)"
            >
              <el-button
                class="project-menu-button"
                text
                circle
                :loading="exportingId === d.id"
                title="项目操作"
                :aria-label="`打开项目「${d.title || '未命名项目'}」操作菜单`"
              >
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="export" :disabled="exportingId === d.id" :title="exportingId === d.id ? '正在导出该项目，请稍候' : undefined">
                    <el-icon><Download /></el-icon>导出项目
                  </el-dropdown-item>
                  <el-dropdown-item command="edit" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined"><el-icon><Edit /></el-icon>编辑项目</el-dropdown-item>
                  <el-dropdown-item command="trash" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" divided>
                    <el-icon><Delete /></el-icon>移入回收站
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </article>
        </div>
        <div
          v-if="!loading && hasSuccessfulListLoad && !listError && total > projectPageSize"
          class="project-pagination"
          aria-label="项目列表分页"
        >
          <el-pagination
            v-model:current-page="projectPage"
            v-model:page-size="projectPageSize"
            :total="total"
            :page-sizes="[12, 24, 48]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadProjectPage"
            @size-change="handleProjectPageSizeChange"
          />
        </div>
      </div>
    </main>

    <AccessibleDialog
      v-model="showTrashDialog"
      title="项目回收站"
      width="680px"
      :style="{ maxWidth: 'calc(100vw - 32px)' }"
      destroy-on-close
      @open="loadTrash"
    >
      <div class="trash-policy" role="note">
        <el-icon class="trash-policy-icon" aria-hidden="true"><FolderOpened /></el-icon>
        <div>
          <strong>移除后仍可恢复</strong>
          <p>项目内容、剧集、分镜和关联素材会完整保留。恢复项目后可继续编辑和生成。</p>
        </div>
      </div>
      <div v-loading="trashLoading" class="trash-dialog-content">
        <div v-if="trashError" class="trash-error" role="alert">
          <p>{{ trashError }}</p>
          <el-button type="primary" plain size="small" :loading="trashLoading" @click="loadTrash">
            <el-icon><RefreshLeft /></el-icon>重试
          </el-button>
        </div>
        <div
          v-if="!trashLoading && !trashError && trashItems.length === 0"
          class="trash-empty"
          role="status"
        >
          <el-icon aria-hidden="true"><Delete /></el-icon>
          <p>回收站中没有项目</p>
        </div>
        <ul v-if="trashItems.length > 0" class="trash-list" aria-label="已移除项目">
          <li v-for="item in trashItems" :key="item.id" class="trash-list-item">
            <div class="trash-item-main">
              <h3 class="trash-item-title">{{ item.title || '未命名项目' }}</h3>
              <p class="trash-item-meta">
                移入时间：<time :datetime="item.removed_at || ''">{{ formatDate(item.removed_at) }}</time>
              </p>
              <p class="trash-item-retention">内容与关联素材已保留</p>
            </div>
            <el-button
              class="trash-restore-button"
              type="primary"
              plain
              :loading="restoringId === item.id"
              :disabled="restoringId !== null && restoringId !== item.id"
              :title="restoringId !== null && restoringId !== item.id ? '正在恢复其他项目，请稍候' : undefined"
              :aria-label="`恢复项目「${item.title || '未命名项目'}」`"
              @click="restoreFromTrash(item)"
            >
              <el-icon><RefreshLeft /></el-icon>恢复
            </el-button>
          </li>
        </ul>
        <p class="trash-live-status" role="status" aria-live="polite">
          {{ trashAnnouncement || (trashLoading ? '正在加载回收站' : `回收站中共有 ${trashTotal} 个项目`) }}
        </p>
      </div>
      <el-pagination
        v-if="trashTotal > trashPageSize"
        v-model:current-page="trashPage"
        :page-size="trashPageSize"
        :total="trashTotal"
        layout="total, prev, pager, next"
        class="trash-pagination"
        aria-label="回收站分页"
        @current-change="loadTrash"
      />
      <template #footer>
        <el-button @click="showTrashDialog = false">关闭</el-button>
      </template>
    </AccessibleDialog>

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
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { Edit, Delete, Plus, PictureFilled, Download, FolderOpened, Files, MoreFilled, RefreshLeft, ArrowRight } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import { newProjectDestination, projectCardDestination } from '@/utils/sourceImportNavigation.js'
import { dramaAPI } from '@/api/drama'
import AIConfigContent from '@/components/AIConfigContent.vue'
import FilmListHeader from '@/components/filmList/FilmListHeader.vue'
import FilmListFailureBanners from '@/components/filmList/FilmListFailureBanners.vue'
import FilmListWorkspaceToolbar from '@/components/filmList/FilmListWorkspaceToolbar.vue'
import FilmListLibraryDialogs from '@/components/filmList/FilmListLibraryDialogs.vue'
import { aiAPI } from '@/api/ai'
import { filterProjectList, getProjectCover } from '@/utils/projectList'
import { mergeProjectListFilters, normalizeProjectListFilters, normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import { createOperationId, logOperation } from '@/utils/operationLog'
import { describeServiceLoadError, isRequestCanceled, withRequestRetry } from '@/utils/requestError'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { sanitizeExportFilename, validateExportBlob, resolveExportFailureMessage } from '@/utils/projectExport'
import { normalizeBackupReturnTo } from '@/composables/useBackupSettings.js'
import { listWorkspaceNavItems, openWorkspaceNavItem } from '@/layouts/AppWorkspaceNav.js'

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

const loading = ref(false)
const dramas = ref([])
const total = ref(0)
const projectPage = ref(1)
const projectPageSize = ref(24)
const listError = ref('')
const hasSuccessfulListLoad = ref(false)
const listIsStale = computed(() => Boolean(listError.value) && hasSuccessfulListLoad.value)
const listWriteLocked = computed(() => loading.value || !hasSuccessfulListLoad.value || Boolean(listError.value))
const listWriteLockReason = computed(() => {
  if (loading.value) return '项目列表正在加载，请稍候'
  if (listError.value) {
    return listIsStale.value
      ? '项目列表刷新失败，成功重试前不能新增或导入'
      : '项目数据加载失败，成功重试前不能新增或导入'
  }
  if (!hasSuccessfulListLoad.value) return '项目列表尚未就绪'
  return ''
})
let listRequestSequence = 0
let projectReloadTimer = null
let projectListMounted = false
const initialProjectListFilters = normalizeProjectListFilters(route.query)
const projectSearch = ref(initialProjectListFilters.q)
const projectSort = ref(initialProjectListFilters.sort)
const projectStatusFilter = ref(initialProjectListFilters.status)
const projectCoverErrors = ref(new Set())
const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.fullPath) || '/')
const sourceImportIntent = computed(() => route.query.intent === 'source-import')
const normalizedProjectSearch = computed(() => projectSearch.value.trim().toLowerCase())
const hasProjectFilters = computed(() => Boolean(normalizedProjectSearch.value) || projectStatusFilter.value !== 'all')
const filteredDramas = computed(() => {
  return filterProjectList(dramas.value, {
    keyword: normalizedProjectSearch.value,
    status: projectStatusFilter.value,
    sort: 'server',
    getSearchText: projectSearchText,
  })
})
const projectListCountLabel = computed(() => {
  const projectTotal = Number(total.value) || 0
  if (projectTotal === 0) return hasProjectFilters.value ? '0 个项目' : '暂无项目'
  if (projectTotal <= projectPageSize.value) return `${filteredDramas.value.length} / ${projectTotal} 个项目`
  const start = (projectPage.value - 1) * projectPageSize.value + 1
  const end = Math.min(projectTotal, start + projectPageSize.value - 1)
  return `${start}-${end} / ${projectTotal} 个项目`
})

let applyingProjectListRoute = false

function scheduleProjectListReload() {
  projectPage.value = 1
  listRequestSequence += 1
  if (projectReloadTimer) clearTimeout(projectReloadTimer)
  projectReloadTimer = setTimeout(() => {
    projectReloadTimer = null
    loadList({ page: 1 })
  }, 240)
}

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

function hasPendingProjectPackageWork() {
  return importing.value || Boolean(importingExample.value) || exportingId.value !== null
}

function describePendingProjectPackageWork() {
  if (importing.value || importingExample.value) return '项目包正在导入，请完成后再离开。'
  if (exportingId.value !== null) return '项目包正在导出，请完成后再离开。'
  return ''
}

async function requestFilmListNavigation() {
  if (hasPendingProjectPackageWork()) {
    ElMessage.warning(describePendingProjectPackageWork())
    return false
  }
  if (!showAiConfigDialog.value) return true
  return (await aiConfigContentRef.value?.requestClose?.()) !== false
}

function handleBeforeUnload(event) {
  const hasUnsavedAiConfig = showAiConfigDialog.value
    && aiConfigContentRef.value?.hasUnsavedChanges?.()
  if (!hasUnsavedAiConfig && !hasPendingProjectPackageWork()) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(requestFilmListNavigation)

const showNewDialog = ref(false)
const newForm = ref({ title: '', description: '', aspect_ratio: '16:9' })
const newSaving = ref(false)
const exportingId = ref(null)
const exportFailure = ref(null)
const importing = ref(false)
const importFailure = ref(null)
const importFileInput = ref(null)
const headerRef = ref(null)

const showTrashDialog = ref(false)
const trashItems = ref([])
const trashLoading = ref(false)
const trashError = ref('')
const trashAnnouncement = ref('')
const trashPage = ref(1)
const trashPageSize = ref(10)
const trashTotal = ref(0)
const restoringId = ref(null)

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

const showEditDialog = ref(false)
const editForm = ref({ id: null, title: '', description: '' })
const editSaving = ref(false)
const newSubmitDisabledReason = computed(() => {
  if (listWriteLocked.value) return listWriteLockReason.value
  if (!newForm.value.title?.trim()) return '请先填写项目标题'
  return ''
})
const editSubmitDisabledReason = computed(() => {
  if (listWriteLocked.value) return listWriteLockReason.value
  if (!editForm.value.title?.trim()) return '请先填写项目标题'
  return ''
})

function describeProjectLoadError(error) {
  return describeServiceLoadError(error, { serviceLabel: '项目服务' })
}

let listAbortController = null

async function loadList(options = {}) {
  const requestedPage = Math.max(1, Number(options.page ?? projectPage.value) || 1)
  const requestedPageSize = Math.max(1, Number(options.pageSize ?? projectPageSize.value) || 24)
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestId = ++listRequestSequence
  const operationId = createOperationId('project_list_load')
  loading.value = true
  let loaded = false
  logOperation({
    operation: 'project_list_load',
    operationId,
    phase: 'start',
    page: requestedPage,
    pageSize: requestedPageSize,
  })
  const startedAt = Date.now()
  try {
    const res = await withRequestRetry(
      () => dramaAPI.list({
        page: requestedPage,
        page_size: requestedPageSize,
        keyword: normalizedProjectSearch.value || undefined,
        status: projectStatusFilter.value !== 'all' ? projectStatusFilter.value : undefined,
        sort: projectSort.value,
      }, { signal: controller.signal }),
      { maxAttempts: 2, delayMs: 400, signal: controller.signal },
    )
    if (requestId !== listRequestSequence) {
      logOperation({
        operation: 'project_list_load',
        operationId,
        phase: 'cancel',
        status: 'stale',
        durationMs: Date.now() - startedAt,
      })
      return false
    }
    const pagination = res?.pagination ?? {}
    const nextTotal = Number(pagination.total ?? 0) || 0
    const nextPageSize = Number(pagination.page_size ?? requestedPageSize) || requestedPageSize
    const lastPage = Math.max(1, Math.ceil(nextTotal / nextPageSize))
    if (nextTotal > 0 && requestedPage > lastPage) {
      projectPage.value = lastPage
      return await loadList({ page: lastPage, pageSize: nextPageSize })
    }
    dramas.value = res?.items ?? []
    total.value = nextTotal
    projectPage.value = Math.min(Math.max(1, Number(pagination.page ?? requestedPage) || requestedPage), lastPage)
    projectPageSize.value = nextPageSize
    projectCoverErrors.value = new Set()
    hasSuccessfulListLoad.value = true
    listError.value = ''
    loaded = true
  } catch (error) {
    if (isRequestCanceled(error) || requestId !== listRequestSequence) {
      return false
    }
    if (requestId === listRequestSequence) {
      listError.value = describeProjectLoadError(error)
      logOperation({
        operation: 'project_list_load',
        operationId,
        phase: 'error',
        durationMs: Date.now() - startedAt,
        error: listError.value,
      })
    }
  } finally {
    if (requestId === listRequestSequence) loading.value = false
  }
  if (loaded) {
    logOperation({
      operation: 'project_list_load',
      operationId,
      phase: 'success',
      durationMs: Date.now() - startedAt,
      page: projectPage.value,
      total: total.value,
    })
    maybeOpenNewDialogFromRoute()
  }
  return loaded
}

function loadProjectPage(page) {
  return loadList({ page })
}

function handleProjectPageSizeChange(pageSize) {
  projectPage.value = 1
  return loadList({ page: 1, pageSize })
}

function projectSearchText(drama) {
  return [
    drama?.title,
    drama?.description,
    formatStatus(drama?.status),
    formatStyle(drama?.style),
    formatGenre(drama?.genre),
    drama?.metadata?.aspect_ratio,
  ].filter(Boolean).join(' ').toLowerCase()
}

function projectCoverUrl(drama) {
  const id = String(drama?.id ?? '')
  if (projectCoverErrors.value.has(id)) return ''
  return getProjectCover(drama)?.url || ''
}

function projectCoverAlt(drama) {
  const title = drama?.title || '未命名项目'
  return `项目「${title}」画面预览`
}

function markProjectCoverError(drama) {
  const id = String(drama?.id ?? '')
  if (!id) return
  const next = new Set(projectCoverErrors.value)
  next.add(id)
  projectCoverErrors.value = next
}

function clearProjectFilters() {
  projectSearch.value = ''
  projectStatusFilter.value = 'all'
}

function formatDate(val) {
  if (!val) return ''
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatStatus(status) {
  const map = { draft: '草稿', published: '已发布', archived: '已归档', generating: '生成中' }
  return map[status] || status || '草稿'
}

function formatStyle(style) {
  const map = {
    // 写实 / 影视
    realistic: '写实',
    cinematic: '电影感',
    documentary: '纪录片',
    noir: '黑色电影',
    'retro film': '复古胶片',
    horror: '恐怖',
    // 动漫 / 卡通
    'anime style': '日本动漫',
    anime: '日本动漫',
    'comic style': '欧美漫画',
    cartoon: '卡通',
    // 中国风格
    'ink wash': '国画水墨',
    'chinese style': '中国风',
    historical: '古装',
    wuxia: '武侠',
    // 绘画艺术
    watercolor: '水彩',
    'oil painting': '油画',
    sketch: '素描',
    'woodblock print': '版画',
    impressionist: '印象派',
    // 幻想 / 科幻
    fantasy: '奇幻',
    'dark fantasy': '暗黑奇幻',
    'sci-fi': '科幻',
    sci_fi: '科幻',
    cyberpunk: '赛博朋克',
    steampunk: '蒸汽朋克',
    'post-apocalyptic': '末世废土',
    // 数字 / 现代
    '3d render': '3D渲染',
    'pixel art': '像素风',
    'low poly': '低多边形',
    minimalist: '极简',
    dreamy: '唯美梦幻',
  }
  return map[style] || style
}

function formatGenre(genre) {
  const map = { drama: '剧情', comedy: '喜剧', adventure: '冒险', romance: '爱情', thriller: '悬疑', action: '动作', horror: '恐怖' }
  return map[genre] || genre
}

function totalStoryboards(d) {
  return (d.episodes || []).reduce((sum, ep) => sum + (ep.storyboards?.length || 0), 0)
}

function goNewProject() {
  if (listWriteLocked.value) return
  showNewDialog.value = true
}

function openTrash() {
  trashError.value = ''
  trashAnnouncement.value = ''
  showTrashDialog.value = true
}

async function loadTrash() {
  trashLoading.value = true
  trashError.value = ''
  try {
    const res = await dramaAPI.listTrash({
      page: trashPage.value,
      page_size: trashPageSize.value,
    })
    trashItems.value = res?.items ?? []
    trashTotal.value = res?.pagination?.total ?? 0
    if (res?.pagination?.page != null) trashPage.value = res.pagination.page
  } catch (error) {
    trashError.value = toUserFacingError(error, '回收站加载失败，请重试')
  } finally {
    trashLoading.value = false
  }
}

async function restoreFromTrash(item) {
  if (restoringId.value !== null) return
  restoringId.value = item.id
  trashError.value = ''
  trashAnnouncement.value = ''
  try {
    await dramaAPI.restore(item.id)
    if (trashItems.value.length === 1 && trashPage.value > 1) trashPage.value -= 1
    await loadTrash()
    loadList()
    const title = item.title || '未命名项目'
    trashAnnouncement.value = `项目「${title}」已恢复，内容与关联素材保持不变。`
    ElMessage.success('项目已恢复')
  } catch (error) {
    trashError.value = toUserFacingError(error, '恢复失败，请重试')
  } finally {
    restoringId.value = null
  }
}

function goMaterialCenter() {
  openWorkspaceNavItem(router, 'media-library')
}

function goFreeCreate() {
  openWorkspaceNavItem(router, 'free-create')
}

const backupNavItem = listWorkspaceNavItems().find((item) => item.id === 'backup') || null

function goBackup() {
  if (!backupNavItem) return
  const returnTo = normalizeBackupReturnTo(projectListReturnTo.value) || '/'
  openWorkspaceNavItem(router, backupNavItem.id, { query: { returnTo } })
}

function maybeOpenNewDialogFromRoute() {
  if (listWriteLocked.value) return
  if (route.query.new !== '1') return
  showNewDialog.value = true
  const nextQuery = { ...route.query }
  delete nextQuery.new
  router.replace({ path: route.path, query: nextQuery })
}

function resetNewForm() {
  newForm.value = { title: '', description: '', aspect_ratio: '16:9' }
}

async function submitNew() {
  if (listWriteLocked.value) return
  const title = newForm.value.title?.trim()
  if (!title) return
  newSaving.value = true
  try {
    const drama = await dramaAPI.create({ title, description: newForm.value.description?.trim() || undefined, metadata: { aspect_ratio: newForm.value.aspect_ratio || '16:9' } })
    showNewDialog.value = false
    ElMessage.success('项目已创建')
    loadList()
    router.push(newProjectDestination(drama, sourceImportIntent.value, projectListReturnTo.value))
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '创建失败'))
  } finally {
    newSaving.value = false
  }
}

function openEditDialog(d) {
  if (listWriteLocked.value) return
  editForm.value = { id: d.id, title: d.title || '', description: d.description || '' }
  showEditDialog.value = true
}

function resetEditForm() {
  editForm.value = { id: null, title: '', description: '' }
}

async function submitEdit() {
  if (listWriteLocked.value) return
  const title = editForm.value.title?.trim()
  if (!title || editForm.value.id == null) return
  editSaving.value = true
  try {
    await dramaAPI.update(editForm.value.id, { title, description: editForm.value.description?.trim() || undefined })
    showEditDialog.value = false
    ElMessage.success('已保存')
    loadList()
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '保存失败'))
  } finally {
    editSaving.value = false
  }
}

function handleProjectAction(action, drama) {
  if (action === 'export') return onExport(drama)
  if (action === 'edit') return openEditDialog(drama)
  if (action === 'trash') return moveToTrash(drama)
}

async function onExport(d) {
  if (exportingId.value !== null) return
  exportingId.value = d.id
  let downloadUrl = ''
  let anchor = null
  try {
    const blob = await validateExportBlob(await dramaAPI.exportDrama(d.id))
    downloadUrl = URL.createObjectURL(blob)
    anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = sanitizeExportFilename(d.title)
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    exportFailure.value = null
    ElMessage.success('项目包已验证，下载已开始')
  } catch (error) {
    const message = await resolveExportFailureMessage(error)
    exportFailure.value = {
      drama: { id: d.id, title: d.title || '未命名项目' },
      message,
    }
    ElMessage.error(message)
  } finally {
    if (anchor?.isConnected) anchor.remove()
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    exportingId.value = null
  }
}

function openSourceImportProject() {
  if (listWriteLocked.value) return
  showNewDialog.value = true
}

function clearImportFailure() {
  importFailure.value = null
}

async function dismissImportFailure() {
  clearImportFailure()
  await nextTick()
  const trigger = headerRef.value?.importTriggerButton?.$el || headerRef.value?.importTriggerButton
  trigger?.focus?.()
}

function normalizeImportFailureFilename(name) {
  let fileName = String(name || '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  if (!fileName) fileName = '未命名项目包'
  return fileName
}

function sanitizeImportFailureReason(message) {
  const collapsed = String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return '项目包导入失败，请重新选择项目包后重试'

  const redacted = collapsed
    .replace(/file:\/\/\/\S+/gi, '本地文件')
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '本地文件')
    .replace(/\/(?:[^/\s]+\/)+[^/\s]*/g, '服务器文件')
    .trim()

  if (/(traceback|stack|sqlite|sqlstate|sql\b|errno|exception|node_modules|backend-node|frontweb| at [A-Za-z_$][\w$]*\s*\()/i.test(redacted)) {
    return '项目包解析失败，请确认文件完整且与当前版本兼容'
  }

  return redacted.slice(0, 160) || '项目包导入失败，请重新选择项目包后重试'
}

function resolveImportFailureMessage(error) {
  const fallback = '项目包导入失败，请重新选择项目包后重试'
  const responseBody = error?.response?.data
  if (typeof responseBody === 'string' && responseBody.trim()) {
    return toUserFacingError({ message: sanitizeImportFailureReason(responseBody) }, fallback)
  }
  if (responseBody && typeof responseBody === 'object') {
    const responseMessage = responseBody?.error?.message
      || responseBody?.message
      || (typeof responseBody?.error === 'string' ? responseBody.error : '')
    if (responseMessage) return toUserFacingError({ message: sanitizeImportFailureReason(responseMessage) }, fallback)
  }
  return toUserFacingError({ message: sanitizeImportFailureReason(error?.message) }, fallback)
}

function setImportFailure(fileName, error) {
  importFailure.value = {
    fileName: normalizeImportFailureFilename(fileName),
    message: resolveImportFailureMessage(error),
  }
}

function triggerImport() {
  if (listWriteLocked.value) return
  importFileInput.value?.click()
}

async function onImportFile(e) {
  if (listWriteLocked.value) {
    if (e.target) e.target.value = ''
    return
  }
  const file = e.target.files?.[0]
  if (!file) return
  e.target.value = ''
  clearImportFailure()
  if (!/\.zip$/i.test(file.name || '')) {
    setImportFailure(file.name, new Error('请选择 .zip 格式的项目包'))
    return
  }
  importing.value = true
  try {
    const data = await dramaAPI.importDrama(file)
    importFailure.value = null
    ElMessage.success(`导入成功：${data?.title || '项目'}`) 
    loadList()
  } catch (error) {
    setImportFailure(file.name, error)
  } finally {
    importing.value = false
  }
}

async function moveToTrash(d) {
  if (listWriteLocked.value) return
  try {
    await ElMessageBox.confirm(
      `项目「${(d.title || '未命名').slice(0, 20)}${(d.title && d.title.length > 20) ? '…' : ''}」将移入回收站。项目内容和关联素材会完整保留，可随时恢复。`,
      '移入回收站',
      { type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await dramaAPI.moveToTrash(d.id)
    ElMessage.success('项目已移入回收站')
    loadList()
    if (showTrashDialog.value) loadTrash()
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '移入回收站失败'))
  }
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
  if (projectReloadTimer) clearTimeout(projectReloadTimer)
  listAbortController?.abort()
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
.project-pagination {
  display: flex;
  justify-content: center;
  min-height: 56px;
  margin-top: 18px;
  padding: 10px 0 2px;
}
.empty {
  text-align: center;
  padding: 48px 24px;
}
.empty-title {
  font-size: 1.1rem;
  color: #e4e4e7;
  margin: 0 0 8px;
}
.empty-desc {
  color: #71717a;
  font-size: 0.9rem;
  margin: 0 0 20px;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 18px;
}
.project-card {
  position: relative;
  background: rgba(24, 24, 30, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 8px;
  padding: 0;
  transition: border-color 0.25s, background 0.25s, transform 0.25s, box-shadow 0.25s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  overflow: hidden;
}
.project-card-link {
  display: block;
  height: 100%;
  padding: 14px 16px;
  border-radius: inherit;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
.project-card-link:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: -4px;
  box-shadow: inset 0 0 0 1px rgba(165, 180, 252, 0.35), 0 0 0 4px rgba(99, 102, 241, 0.22);
}
.project-card:focus-within {
  border-color: rgba(129, 140, 248, 0.75);
}
.project-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: transparent;
  pointer-events: none;
}
.project-card:hover {
  border-color: rgba(99, 102, 241, 0.55);
  background: rgba(28, 28, 36, 0.9);
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(99, 102, 241, 0.12), 0 0 0 1px rgba(99, 102, 241, 0.08), 0 2px 8px rgba(0, 0, 0, 0.4);
}

.project-card-body {
  min-width: 0;
}
.project-card-layout {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 16px;
  min-height: 182px;
}
.project-card-cover {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 182px;
  overflow: hidden;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  background: #202028;
  color: #71717a;
}
.project-card-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.project-card-cover-placeholder {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 12px 8px;
  color: #8b8b97;
  font-size: 0.7rem;
  line-height: 1.35;
  text-align: center;
}
.project-card-cover-placeholder .el-icon {
  color: #a5b4fc;
  font-size: 22px;
}
.project-card-cover--empty {
  border-style: dashed;
  background: rgba(99, 102, 241, 0.06);
}
.project-card-content {
  display: flex;
  min-width: 0;
  min-height: 100%;
  flex-direction: column;
}
.project-card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding-right: 36px;
}
.project-updated {
  overflow: hidden;
  color: #8b8b97;
  font-size: 0.74rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-card-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  margin-bottom: 8px;
  padding-right: 36px;
}
.project-title {
  min-width: 0;
  font-size: 1.05rem;
  line-height: 1.4;
  margin: 2px 0 0;
  color: #fafafa;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.project-desc {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0 0 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.project-card-stats {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 12px;
}
.project-stat {
  display: inline-flex;
  min-width: 64px;
  min-height: 42px;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  color: #a1a1aa;
  font-size: 0.72rem;
  line-height: 1.1;
}
.project-stat strong {
  color: #f4f4f5;
  font-size: 1rem;
  font-weight: 680;
  line-height: 1;
}
.project-stat--compact {
  min-width: 58px;
  align-items: center;
  color: #fbbf24;
  font-family: monospace;
  font-size: 0.86rem;
}
.project-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 10px;
}
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 99px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}
.badge-status--draft {
  background: rgba(113, 113, 122, 0.15);
  color: #a1a1aa;
  border: 1px solid rgba(113, 113, 122, 0.3);
}
.badge-status--published {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.badge-status--generating {
  background: rgba(234, 179, 8, 0.12);
  color: #fcd34d;
  border: 1px solid rgba(234, 179, 8, 0.3);
}
.badge-status--archived {
  background: rgba(99, 102, 241, 0.1);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.25);
}
.badge-episodes {
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.28);
}
.badge-storyboards {
  background: rgba(20, 184, 166, 0.12);
  color: #2dd4bf;
  border: 1px solid rgba(20, 184, 166, 0.28);
}
.badge-ratio {
  background: rgba(251, 146, 60, 0.1);
  color: #fb923c;
  border: 1px solid rgba(251, 146, 60, 0.25);
  font-family: monospace;
}
.badge-style {
  background: rgba(168, 85, 247, 0.1);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.25);
}
.badge-genre {
  background: rgba(249, 115, 22, 0.1);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.25);
}
.project-meta {
  font-size: 0.75rem;
  color: #71717a;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}
.project-card-continue {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  color: #a5b4fc;
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
}
.project-card-assets {
  position: absolute;
  left: 28px;
  bottom: 24px;
  z-index: 3;
  display: inline-flex;
  width: 88px;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(199, 210, 254, 0.45);
  border-radius: 6px;
  background: rgba(9, 9, 14, 0.82);
  color: #e0e7ff;
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  backdrop-filter: blur(8px);
}
.project-card-assets:hover,
.project-card-assets:focus-visible {
  border-color: #a5b4fc;
  background: rgba(49, 46, 129, 0.92);
  color: #ffffff;
}
.project-card-assets:focus-visible {
  outline: 2px solid #c7d2fe;
  outline-offset: 2px;
}
.project-card-link:hover .project-card-continue,
.project-card-link:focus-visible .project-card-continue {
  color: #c7d2fe;
}
.project-menu-button {
  --el-button-size: 30px;
  color: #a1a1aa;
  margin-top: -2px;
  align-self: start;
}
.project-card-menu {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
}
.project-menu-button:hover,
.project-menu-button:focus-visible {
  color: #e4e4e7;
  background: rgba(99, 102, 241, 0.16);
}
.trash-policy {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
  padding: 12px 14px;
  border-left: 3px solid #2dd4bf;
  background: rgba(20, 184, 166, 0.08);
}
.trash-policy-icon {
  margin-top: 2px;
  flex: 0 0 auto;
  color: #5eead4;
  font-size: 20px;
}
.trash-policy strong {
  display: block;
  color: #f4f4f5;
  font-size: 0.92rem;
  line-height: 1.4;
}
.trash-policy p {
  margin: 4px 0 0;
  color: #a1a1aa;
  font-size: 0.84rem;
  line-height: 1.55;
}
.trash-dialog-content {
  min-height: 180px;
}
.trash-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid #303038;
}
.trash-list-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  min-height: 108px;
  padding: 16px 2px;
  border-bottom: 1px solid #303038;
}
.trash-item-main {
  min-width: 0;
}
.trash-item-title {
  margin: 0 0 6px;
  overflow: hidden;
  color: #f4f4f5;
  font-size: 0.98rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trash-item-meta,
.trash-item-retention {
  margin: 0;
  color: #a1a1aa;
  font-size: 0.8rem;
  line-height: 1.55;
}
.trash-item-retention {
  color: #5eead4;
}
.trash-restore-button {
  min-width: 92px;
}
.trash-empty {
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #71717a;
}
.trash-empty .el-icon {
  font-size: 28px;
}
.trash-empty p,
.trash-error,
.trash-live-status {
  margin: 0;
}
.trash-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-left: 3px solid #f87171;
  background: rgba(239, 68, 68, 0.08);
  color: #fca5a5;
}
.trash-error p {
  margin: 0;
}
.trash-live-status {
  min-height: 20px;
  margin-top: 12px;
  color: #a1a1aa;
  font-size: 0.8rem;
}
.trash-pagination {
  margin-top: 14px;
  justify-content: center;
}

/* ===== 亮色模式适配 ===== */
html.light .film-list {
  background: #f7f8fa;
  color: #20242c;
}
html.light .project-card {
  background: #ffffff;
  border-color: #e1e5eb;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
  backdrop-filter: none;
}
html.light .project-card::before {
  background: transparent;
}
html.light .project-card:hover {
  border-color: #aeb6c2;
  background: #ffffff;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
}
html.light .project-card-cover {
  border-color: #e1e5eb;
  background: #f3f4f6;
  color: #6b7280;
}
html.light .project-card-cover--empty {
  background: #f8f7ff;
  border-color: #cfd3e1;
}
html.light .project-card-cover-placeholder .el-icon {
  color: #6366f1;
}
html.light .project-card-continue {
  color: #4f46e5;
}
html.light .project-card-assets {
  border-color: rgba(79, 70, 229, 0.4);
  background: rgba(255, 255, 255, 0.9);
  color: #4338ca;
}
html.light .project-card-assets:hover,
html.light .project-card-assets:focus-visible {
  border-color: #4f46e5;
  background: #eef2ff;
  color: #312e81;
}
html.light .project-card-link:hover .project-card-continue,
html.light .project-card-link:focus-visible .project-card-continue {
  color: #3730a3;
}

html.light .project-updated { color: #6b7280; }
html.light .project-title { color: #20242c; }
html.light .project-desc { color: #4b5563; }
html.light .project-meta { color: #6b7280; }
html.light .project-stat {
  background: #f8fafc;
  border-color: #e1e5eb;
  color: #6b7280;
}
html.light .project-stat strong { color: #20242c; }
html.light .project-stat--compact { color: #92400e; }
html.light .project-menu-button { color: #6b7280; }
html.light .project-menu-button:hover,
html.light .project-menu-button:focus-visible {
  color: #3730a3;
  background: rgba(79, 70, 229, 0.1);
}
html.light .trash-policy {
  background: #ecfdf5;
  border-left-color: #0f766e;
}
html.light .trash-policy-icon,
html.light .trash-item-retention { color: #0f766e; }
html.light .trash-policy strong,
html.light .trash-item-title { color: #20242c; }
html.light .trash-policy p,
html.light .trash-item-meta,
html.light .trash-live-status { color: #5b6470; }
html.light .trash-list,
html.light .trash-list-item { border-color: #e1e5eb; }
html.light .trash-empty { color: #6b7280; }
html.light .trash-error {
  background: #fef2f2;
  color: #b91c1c;
}
html.light .badge-status--draft {
  background: rgba(107, 114, 128, 0.1);
  color: #4b5563;
  border-color: rgba(107, 114, 128, 0.25);
}


@media (max-width: 620px) {
  .project-card-topline {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
  .project-card-layout {
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 12px;
    min-height: 168px;
  }
  .project-card-cover {
    min-height: 168px;
  }
}
</style>
