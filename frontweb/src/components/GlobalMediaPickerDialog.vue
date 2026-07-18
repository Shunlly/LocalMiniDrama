<template>
  <el-dialog
    v-model="innerVisible"
    :title="title"
    width="980px"
    destroy-on-close
    @closed="handleClosed"
  >
    <div class="global-media-picker">
      <div class="picker-context" role="status" aria-live="polite">
        <span class="picker-context__label">挂载目标</span>
        <span class="picker-context__value">{{ context.projectTitle || '未命名项目' }}</span>
        <span v-if="context.episodeLabel" class="picker-context__sep">/</span>
        <span v-if="context.episodeLabel" class="picker-context__value">{{ context.episodeLabel }}</span>
        <span v-if="context.storyboardLabel" class="picker-context__sep">/</span>
        <span v-if="context.storyboardLabel" class="picker-context__value">{{ context.storyboardLabel }}</span>
        <span v-if="context.usageLabel" class="picker-context__usage">{{ context.usageLabel }}</span>
      </div>

      <div class="picker-toolbar">
        <el-radio-group v-model="mediaType" size="small" aria-label="素材类型" @change="applyFilters">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="image">图片</el-radio-button>
          <el-radio-button value="video">视频</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索素材名称"
          class="picker-search"
          @input="debouncedLoad"
        />
      </div>

      <p class="picker-hint">
        {{ acceptHint }}
      </p>

      <div v-if="loadError" class="picker-error" role="alert">
        <span>{{ loadError }}</span>
        <el-button size="small" @click="loadAssets">重试</el-button>
      </div>

      <div v-loading="loading" class="picker-grid" :aria-busy="loading">
        <el-tooltip
          v-for="item in items"
          :key="item.id"
          :content="item.name || '未命名素材'"
          placement="top"
          popper-class="media-name-tooltip"
          :show-after="250"
          :visible="focusedItemId === item.id || hoveredItemId === item.id"
        >
          <button
            type="button"
            class="picker-card"
            :class="{
              'picker-card--selected': selectedId === item.id,
              'picker-card--incompatible': !isCompatible(item),
            }"
            :aria-pressed="selectedId === item.id"
            :aria-label="cardLabel(item)"
            :aria-describedby="`media-card-name-${item.id}`"
            @click="selectItem(item)"
            @focus="focusedItemId = item.id"
            @blur="focusedItemId = null"
            @mouseenter="hoveredItemId = item.id"
            @mouseleave="hoveredItemId = null"
            @keydown.enter.prevent="onCardEnter(item)"
            @keydown.space.prevent="selectItem(item)"
          >
            <span :id="`media-card-name-${item.id}`" class="visually-hidden">
              完整素材名称：{{ item.name || '未命名素材' }}
            </span>
            <div class="picker-card__thumb">
              <video
                v-if="item.type === 'video'"
                :src="itemUrl(item)"
                muted
                preload="metadata"
                aria-hidden="true"
                class="picker-card__video"
              />
              <img
                v-else
                :src="itemUrl(item)"
                :alt="`${item.name || '未命名素材'} 预览图`"
                class="picker-card__image"
              />
            </div>
            <div class="picker-card__body">
              <div class="picker-card__title-row">
                <span class="picker-card__title">{{ item.name || '未命名素材' }}</span>
                <span class="picker-card__type">{{ item.type === 'video' ? '视频' : '图片' }}</span>
              </div>
              <div class="picker-card__meta">
                <span>{{ item.source_drama_title || '全局上传' }}</span>
                <span v-if="item.file_size">{{ formatSize(item.file_size) }}</span>
              </div>
              <div v-if="selectedId === item.id" class="picker-card__selection">
                {{ isCompatible(item) ? '已选中' : incompatibleMessage }}
              </div>
            </div>
          </button>
        </el-tooltip>

        <div v-if="!loading && !loadError && !items.length" class="picker-empty">
          <p>{{ hasActiveFilters ? '当前筛选下没有素材。' : '素材中心还是空的。' }}</p>
          <div class="picker-empty__actions">
            <el-button v-if="hasActiveFilters" size="small" @click="clearFilters">清除筛选</el-button>
            <el-button size="small" type="primary" @click="openMediaLibrary">前往素材中心上传</el-button>
          </div>
        </div>
      </div>

      <div v-if="total > pageSize" class="picker-pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="loadAssets"
        />
      </div>
    </div>

    <template #footer>
      <div class="picker-footer">
        <span class="picker-footer__status">{{ footerStatus }}</span>
        <div class="picker-footer__actions">
          <el-button @click="innerVisible = false">取消</el-button>
          <el-button
            type="primary"
            :disabled="confirmDisabled"
            @click="confirmSelection"
          >
            选择素材
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { assetsAPI } from '@/api/assets'
import {
  createLatestMediaRequestGuard,
  formatMediaSize as formatSize,
} from '@/utils/mediaLibrary'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '选择素材' },
  accept: { type: String, default: 'all' },
  context: {
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['update:modelValue', 'select', 'open-library'])

const innerVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const loading = ref(false)
const loadError = ref('')
const items = ref([])
const selectedId = ref(null)
const focusedItemId = ref(null)
const hoveredItemId = ref(null)
const keyword = ref('')
const mediaType = ref('all')
const page = ref(1)
const pageSize = ref(24)
const total = ref(0)
const mediaRequestGuard = createLatestMediaRequestGuard()
let keywordTimer = null
let activeLoadController = null

const selectedItem = computed(() => items.value.find((item) => Number(item.id) === Number(selectedId.value)) || null)
const hasActiveFilters = computed(() => mediaType.value !== 'all' || Boolean(keyword.value.trim()))
const confirmDisabled = computed(() => (
  loading.value
  || Boolean(loadError.value)
  || !selectedItem.value
  || !isCompatible(selectedItem.value)
))
const incompatibleMessage = computed(() => props.accept === 'video' ? '当前用途只接受视频素材' : '当前用途只接受图片素材')
const acceptHint = computed(() => {
  if (props.accept === 'video') return '可浏览全部素材，当前用途仅可确认视频素材。'
  if (props.accept === 'image') return '可浏览全部素材，当前用途仅可确认图片素材。'
  return '可浏览并选择素材中心中的全部素材。'
})
const footerStatus = computed(() => {
  if (loading.value) return '正在加载素材'
  if (loadError.value) return '素材加载失败，请重试'
  if (!selectedItem.value) return '未选择素材'
  if (!isCompatible(selectedItem.value)) return incompatibleMessage.value
  return `${selectedItem.value.name || '未命名素材'} 已就绪`
})

function isCompatible(item) {
  if (!item) return false
  if (props.accept === 'all') return true
  return item.type === props.accept
}

function itemUrl(item) {
  if (!item) return ''
  if (item.local_path) return '/static/' + String(item.local_path).replace(/^\//, '')
  return item.url || item.image_url || item.video_url || ''
}

function cardLabel(item) {
  const source = item.source_drama_title || '全局上传'
  const state = isCompatible(item) ? '可选' : incompatibleMessage.value
  return `${item.name || '未命名素材'}，${item.type === 'video' ? '视频' : '图片'}，来源 ${source}，${state}`
}

function clearKeywordTimer() {
  clearTimeout(keywordTimer)
  keywordTimer = null
}

function abortActiveLoad() {
  activeLoadController?.abort()
  activeLoadController = null
}

function invalidatePendingLoads() {
  mediaRequestGuard.begin()
  abortActiveLoad()
}

function resetPickerState() {
  clearKeywordTimer()
  loading.value = false
  selectedId.value = null
  focusedItemId.value = null
  hoveredItemId.value = null
  loadError.value = ''
  items.value = []
  keyword.value = ''
  mediaType.value = 'all'
  page.value = 1
  total.value = 0
}

function handleClosed() {
  if (props.modelValue) return
  resetPickerState()
}

function selectItem(item) {
  selectedId.value = item.id
}

function onCardEnter(item) {
  if (Number(selectedId.value) === Number(item.id) && isCompatible(item)) {
    confirmSelection()
    return
  }
  selectItem(item)
}

async function loadAssets() {
  const requestId = mediaRequestGuard.begin()
  abortActiveLoad()
  const controller = new AbortController()
  activeLoadController = controller
  loading.value = true
  loadError.value = ''
  selectedId.value = null
  try {
    const params = {
      page: page.value,
      page_size: pageSize.value,
    }
    if (mediaType.value !== 'all') params.type = mediaType.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    const response = await assetsAPI.list(params, {
      signal: controller.signal,
      suppressErrorToast: true,
    })
    mediaRequestGuard.commit(requestId, () => {
      items.value = Array.isArray(response?.items) ? response.items : []
      total.value = response?.pagination?.total ?? response?.total ?? 0
      loadError.value = ''
    })
  } catch {
    if (controller.signal.aborted) return
    mediaRequestGuard.commit(requestId, () => {
      items.value = []
      total.value = 0
      loadError.value = '暂时无法加载素材，请检查服务状态后重试'
    })
  } finally {
    if (activeLoadController === controller) activeLoadController = null
    mediaRequestGuard.commit(requestId, () => {
      loading.value = false
    })
  }
}

function applyFilters() {
  page.value = 1
  loadAssets()
}

function clearFilters() {
  keyword.value = ''
  mediaType.value = 'all'
  applyFilters()
}

function openMediaLibrary() {
  invalidatePendingLoads()
  innerVisible.value = false
  emit('open-library')
}

function debouncedLoad() {
  clearKeywordTimer()
  keywordTimer = setTimeout(() => {
    applyFilters()
  }, 300)
}

function confirmSelection() {
  if (confirmDisabled.value) return
  emit('select', selectedItem.value)
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      invalidatePendingLoads()
      clearKeywordTimer()
      return
    }
    resetPickerState()
    loadAssets()
  },
)
</script>

<style scoped>
.global-media-picker {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.picker-context {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-page);
  color: var(--text-primary);
}

.picker-context__label {
  color: var(--text-muted);
  font-size: 12px;
}

.picker-context__value,
.picker-context__usage {
  font-size: 13px;
  color: var(--text-bright);
}

.picker-context__usage {
  margin-left: auto;
}

.picker-context__sep {
  color: var(--text-muted);
}

.picker-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.picker-search {
  max-width: 260px;
}

.picker-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.picker-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  min-height: 240px;
}

.picker-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: inherit;
  text-align: left;
  overflow: hidden;
}

.picker-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.picker-card--selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5);
}

.picker-card--incompatible {
  opacity: 0.72;
}

.picker-card__thumb {
  aspect-ratio: 16 / 10;
  background: var(--bg-page);
  overflow: hidden;
}

.picker-card__image,
.picker-card__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.picker-card__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}

.picker-card__title-row,
.picker-card__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.picker-card__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-card__type,
.picker-card__meta,
.picker-card__selection {
  font-size: 12px;
  color: var(--text-muted);
}

:global(.media-name-tooltip) {
  max-width: min(560px, calc(100vw - 32px));
  overflow-wrap: anywhere;
}

.picker-card__selection {
  color: var(--el-color-primary);
}

.picker-empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-muted);
  flex-direction: column;
  gap: 10px;
}

.picker-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.picker-pagination {
  display: flex;
  justify-content: flex-end;
}

.picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.picker-footer__status {
  font-size: 12px;
  color: var(--text-muted);
}

.picker-footer__actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 768px) {
  .picker-toolbar,
  .picker-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .picker-context__usage {
    margin-left: 0;
    width: 100%;
  }

  .picker-search {
    max-width: none;
  }

  .picker-footer__actions {
    justify-content: flex-end;
  }
}
</style>
