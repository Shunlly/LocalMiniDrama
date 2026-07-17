<template>
  <div class="media-library-page">
    <div class="page-header">
      <div class="header-left">
        <el-button text class="back-link" @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          项目首页
        </el-button>
        <div class="title-wrap">
          <h1 class="page-title">素材中心</h1>
          <p class="page-subtitle">上传后的图片和视频会在所有项目里复用；单文件最大 100MB。</p>
        </div>
      </div>
      <div class="header-actions">
        <el-button :disabled="mediaWriteLocked" @click="goNewProject">
          <el-icon><Plus /></el-icon>
          新建项目
        </el-button>
        <el-button type="primary" :loading="uploading" :disabled="mediaWriteLocked" @click="triggerUpload">
          <el-icon><Upload /></el-icon>
          上传素材
        </el-button>
        <input ref="uploadInput" type="file" accept="image/*,video/*" multiple style="display:none" @change="onUpload" />
      </div>
    </div>

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

    <section v-if="loading || mediaItems.length > 0" class="entry-strip" aria-label="素材入口说明">
      <div class="entry-item">
        <span class="entry-label">上传到素材中心</span>
        <p class="entry-description">把不超过 100MB 的图片和视频放进全局素材，后续项目可以直接复用。</p>
        <el-button text class="entry-action" :disabled="mediaWriteLocked" @click="triggerUpload">立即上传</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">网页 URL 导入</span>
        <p class="entry-description">网页正文导入仍在项目里完成，用于建立故事素材。</p>
        <el-button text class="entry-action" :disabled="mediaWriteLocked" @click="goNewProject">新建项目后导入网页 URL</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">角色 / 场景 / 道具入库</span>
        <p class="entry-description">在项目里点“加入素材库”后，会同步到首页里的分类素材入口。</p>
        <el-button text class="entry-action" @click="goHome">返回项目首页</el-button>
      </div>
    </section>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-radio-group v-model="mediaType" class="type-filter" @change="applyFilters">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="image">图片</el-radio-button>
        <el-radio-button value="video">视频</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="keyword"
        placeholder="搜索素材..."
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
          <span class="media-meta">{{ formatSize(item.size) }}</span>
          <span class="media-origin">{{ item.source_drama_title || '全局上传，可跨项目复用' }}</span>
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
            <el-button type="primary" :disabled="mediaWriteLocked" @click="triggerUpload">
              <el-icon><Upload /></el-icon>上传素材
            </el-button>
            <el-button :disabled="mediaWriteLocked" @click="goNewProject">新建项目后导入网页 URL</el-button>
            <el-button text @click="goHome">返回项目首页</el-button>
          </template>
        </div>
        <p v-if="!hasActiveFilters" class="empty-note">需要把角色、场景或道具沉淀到分类素材时，请先在项目内点“加入素材库”。</p>
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

    <!-- 预览弹窗 -->
    <el-dialog v-model="showPreview" title="素材预览" width="800px" destroy-on-close>
      <div class="preview-content">
        <video
          v-if="previewItem?.type === 'video'"
          :src="itemUrl(previewItem)"
          :aria-label="videoPreviewLabel(previewItem)"
          controls
          class="preview-video"
          autoplay
        />
        <img
          v-else-if="previewItem"
          :src="itemUrl(previewItem)"
          :alt="previewAlt(previewItem)"
          class="preview-image"
        />
      </div>
      <div class="preview-meta">
        <div class="meta-row"><span>名称：</span>{{ previewItem?.name || '未命名' }}</div>
        <div class="meta-row"><span>大小：</span>{{ formatSize(previewItem?.size) }}</div>
        <div class="meta-row"><span>创建时间：</span>{{ previewItem?.created_at }}</div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Upload, Search, Loading, CircleCheck,
  ZoomIn, Delete, Files, Plus, Refresh
} from '@element-plus/icons-vue'
import { assetsAPI } from '@/api/assets'
import { uploadAPI } from '@/api/upload'
import request from '@/utils/request'
import {
  createLatestMediaRequestGuard,
  formatMediaSize as formatSize,
  hasActiveMediaFilters,
  normalizeMediaItem as normalizeItem,
} from '@/utils/mediaLibrary'
import {
  MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL,
  partitionMediaLibraryUploads,
} from '@/utils/mediaUploadValidation'

const router = useRouter()
const loading = ref(false)
const uploading = ref(false)
const uploadProgress = ref({ current: 0, total: 0 })
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
const hasActiveFilters = computed(() => hasActiveMediaFilters(mediaType.value, keyword.value))
const mediaIsStale = computed(() => Boolean(loadError.value) && hasSuccessfulMediaLoad.value)
const mediaWriteLocked = computed(() => loading.value || !hasSuccessfulMediaLoad.value || Boolean(loadError.value))
const mediaRequestGuard = createLatestMediaRequestGuard()
let keywordTimer = null

function goHome() {
  router.push('/')
}

function goNewProject() {
  if (mediaWriteLocked.value) return
  router.push({ path: '/', query: { new: '1' } })
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
  if (oversized.length) {
    const names = oversized.slice(0, 3).map((file) => file.name).join('、')
    const suffix = oversized.length > 3 ? ` 等 ${oversized.length} 个文件` : ''
    ElMessage.warning(`${names}${suffix} 超过单文件 ${MEDIA_LIBRARY_MAX_FILE_SIZE_LABEL} 限制，未开始上传`)
  }
  if (!files.length) {
    e.target.value = ''
    return
  }
  uploading.value = true
  uploadProgress.value = { current: 0, total: files.length }
  let succeeded = 0
  for (const file of files) {
    try {
      await uploadAPI.uploadAsset(file)
      succeeded++
    } catch (err) {
      ElMessage.warning(`${file.name} 上传失败: ${err.message}`)
    } finally {
      uploadProgress.value.current++
    }
  }
  uploading.value = false
  e.target.value = ''
  if (succeeded === files.length && oversized.length === 0) ElMessage.success(`${succeeded} 个素材上传完成`)
  else if (succeeded > 0) {
    const skipped = oversized.length ? `，跳过 ${oversized.length} 个超限文件` : ''
    ElMessage.warning(`已上传 ${succeeded}/${files.length} 个可上传素材${skipped}`)
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
  const backendMessage = error?.response?.data?.error?.message
  if (backendMessage) return backendMessage
  const status = Number(error?.response?.status)
  if (Number.isInteger(status) && status > 0) return `素材服务暂时不可用（HTTP ${status}）`
  if (error?.code === 'ECONNABORTED') return '连接素材服务超时，请稍后重试'
  return '无法连接素材服务，请检查服务是否已启动'
}

async function loadMedia() {
  const requestId = mediaRequestGuard.begin()
  loading.value = true
  try {
    const params = {
      page: page.value,
      page_size: pageSize.value,
    }
    if (mediaType.value !== 'all') params.type = mediaType.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    const res = await assetsAPI.list(params)
    mediaRequestGuard.commit(requestId, () => {
      mediaItems.value = (res?.items || []).map(normalizeItem)
      total.value = res?.pagination?.total ?? res?.total ?? 0
      hasSuccessfulMediaLoad.value = true
      loadError.value = ''
    })
  } catch (err) {
    mediaRequestGuard.commit(requestId, () => {
      loadError.value = describeMediaLoadError(err)
    })
  } finally {
    mediaRequestGuard.commit(requestId, () => {
      loading.value = false
    })
  }
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
    await ElMessageBox.confirm('确定删除该素材？', '删除确认', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await request.delete(`/assets/${item.id}`)
    ElMessage.success('已删除')
    loadMedia()
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

async function batchDelete() {
  if (mediaWriteLocked.value) return
  const count = selectedIds.size
  if (count <= 0) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${count} 个素材？`, '批量删除', { type: 'warning' })
  } catch (_) {
    return
  }
  let failed = 0
  for (const id of selectedIds) {
    try {
      await request.delete(`/assets/${id}`)
    } catch (_) { failed++ }
  }
  selectedIds.clear()
  if (failed > 0) ElMessage.warning(`${count - failed} 个删除成功，${failed} 个失败`)
  else ElMessage.success(`${count} 个素材已删除`)
  loadMedia()
}

onMounted(loadMedia)
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
}

.meta-row span {
  font-weight: 500;
  color: #374151;
}
</style>
