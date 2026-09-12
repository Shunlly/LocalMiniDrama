<template>
  <AccessibleDialog
    v-model="innerVisible"
    :title="title"
    width="980px"
    destroy-on-close
    :close-on-press-escape="true"
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
          aria-label="搜索素材名称"
          class="picker-search"
          @input="debouncedLoad"
        />
      </div>

      <p class="picker-hint">
        {{ acceptHint }}
      </p>

      <div v-if="loadError" class="picker-error" role="alert">
        <span>{{ loadError }}</span>
        <el-button size="small" aria-label="重试加载素材" @click="loadAssets">重试</el-button>
      </div>

      <div v-loading="loading" class="picker-grid" :aria-busy="loading">
        <GlobalMediaPickerCard
          v-for="item in items"
          :key="item.id"
          :item="item"
          :selected="selectedId === item.id"
          :compatible="isCompatible(item)"
          :origin-label="mediaOriginLabel(item)"
          :size-label="item.file_size ? formatSize(item.file_size) : ''"
          :card-label="cardLabel(item)"
          :thumb-url="itemUrl(item)"
          :incompatible-reason="incompatibleReason(item)"
          @select="selectItem(item)"
          @confirm="onCardEnter(item)"
        />

        <GlobalMediaPickerEmpty
          v-if="!loading && !loadError && !items.length"
          :has-active-filters="hasActiveFilters"
          @clear-filters="clearFilters"
          @open-library="openMediaLibrary"
        />
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
      <GlobalMediaPickerFooter
        :status="footerStatus"
        :confirm-disabled="confirmDisabled"
        :confirm-disabled-reason="confirmDisabledReason"
        @cancel="innerVisible = false"
        @confirm="confirmSelection"
      />
    </template>
  </AccessibleDialog>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { assetsAPI } from '@/api/assets'
import {
  createLatestMediaRequestGuard,
  formatMediaSize as formatSize,
  getMediaOriginLabel,
  mediaPickerIncompatibleReason,
} from '@/utils/mediaLibrary'
import {
  mediaPickerCardLabel,
  mediaPickerItemUrl,
} from './globalMediaPicker/globalMediaPickerPresentation.js'
import GlobalMediaPickerCard from './globalMediaPicker/GlobalMediaPickerCard.vue'
import GlobalMediaPickerEmpty from './globalMediaPicker/GlobalMediaPickerEmpty.vue'
import GlobalMediaPickerFooter from './globalMediaPicker/GlobalMediaPickerFooter.vue'

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
const incompatibleMessage = computed(() => incompatibleReason(selectedItem.value) || (
  props.accept === 'video' ? '当前用途只接受视频素材' : '当前用途只接受图片素材'
))
const confirmDisabledReason = computed(() => {
  if (loading.value) return '正在加载素材，请稍候'
  if (loadError.value) return '素材加载失败，请重试'
  if (!selectedItem.value) return '请先选择素材'
  if (!isCompatible(selectedItem.value)) return incompatibleMessage.value
  return ''
})

const acceptHint = computed(() => {
  if (props.accept === 'video') return '可浏览全部素材，当前用途仅可确认视频素材。'
  if (props.accept === 'image') return '可浏览全部素材，当前用途仅可确认图片素材。'
  if (props.context?.reusePolicy === 'current-or-global') {
    return '可浏览全部素材，当前画布只能确认全局素材或当前项目素材。'
  }
  return '可浏览并选择素材中心中的全部素材。'
})
const footerStatus = computed(() => {
  if (loading.value) return '正在加载素材'
  if (loadError.value) return '素材加载失败，请重试'
  if (!selectedItem.value) return '未选择素材'
  if (!isCompatible(selectedItem.value)) return incompatibleMessage.value
  return `${selectedItem.value.name || '未命名素材'} 已就绪`
})

function mediaOriginLabel(item) {
  return getMediaOriginLabel(item, { globalLabel: '全局上传' })
}

function incompatibleReason(item) {
  return mediaPickerIncompatibleReason(item, {
    accept: props.accept,
    context: props.context,
  })
}

function isCompatible(item) {
  return Boolean(item) && !incompatibleReason(item)
}

function itemUrl(item) {
  return mediaPickerItemUrl(item)
}

function cardLabel(item) {
  return mediaPickerCardLabel(item, {
    originLabel: mediaOriginLabel(item),
    compatible: isCompatible(item),
    incompatibleReason: incompatibleReason(item),
  })
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

onBeforeUnmount(() => {
  invalidatePendingLoads()
  clearKeywordTimer()
})
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
  grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  gap: 12px;
  min-width: 0;
  max-width: 100%;
  min-height: 240px;
}

.picker-pagination {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .picker-toolbar {
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
}
</style>

