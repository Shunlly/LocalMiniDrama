<template>
  <aside
    class="free-canvas-asset-sidebar"
    aria-label="自由画布素材"
    @dragover.prevent
    @drop.prevent="handleDrop"
  >
    <header class="asset-sidebar-header">
      <h2>创作素材</h2>
      <div class="asset-sidebar-actions">
        <input
          ref="fileInputRef"
          class="visually-hidden"
          type="file"
          aria-label="上传本地图片或视频"
          tabindex="-1"
          accept="image/*,video/*"
          multiple
          @change="handleFileSelection"
        />
        <el-tooltip content="上传素材" placement="bottom">
          <el-button
            size="small"
            circle
            :loading="uploading"
            aria-label="上传素材"
            title="上传素材"
            @click="fileInputRef?.click()"
          >
            <el-icon><Upload /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="从素材中心选择" placement="bottom">
          <el-button size="small" circle aria-label="从素材中心选择" title="从素材中心选择" @click="emit('open-picker')">
            <el-icon><FolderOpened /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="收起素材栏" placement="bottom">
          <el-button size="small" circle aria-label="收起素材栏" title="收起素材栏" @click="emit('close')">
            <el-icon><Close /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </header>

    <p v-if="uploading" class="upload-state" role="status" aria-live="polite">{{ uploadStatus }}</p>

    <div class="asset-discovery-controls">
      <el-input
        v-model="searchQuery"
        size="small"
        clearable
        :prefix-icon="Search"
        aria-label="搜索创作素材"
        placeholder="搜索素材"
      />
      <el-radio-group v-model="mediaType" size="small" aria-label="素材类型">
        <el-radio-button label="all">全部</el-radio-button>
        <el-radio-button label="image">图片</el-radio-button>
        <el-radio-button label="video">视频</el-radio-button>
      </el-radio-group>
      <el-button class="project-assets-shortcut" link size="small" aria-label="查看项目素材" @click="revealProjectAssets">
        <el-icon><FolderOpened /></el-icon>
        项目素材 {{ filteredAssets.length }}
      </el-button>
    </div>

    <details :open="isAssetSectionOpen(filteredCharacters.length)" class="asset-section" data-asset-section="characters">
      <summary>角色 <span>{{ filteredCharacters.length }}</span></summary>
      <CanvasWindowedList
        v-if="filteredCharacters.length"
        name="characters"
        :items="filteredCharacters"
        :item-key="characterItemKey"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="asset-item"
            :aria-label="`添加角色${item.name || '未命名角色'}`"
            @click="emit('add-entity', { kind: 'character', item })"
          >{{ item.name || '未命名角色' }}</button>
        </template>
      </CanvasWindowedList>
      <div v-if="!filteredCharacters.length" class="asset-empty" role="status">
        <p>{{ assetEmptyText('角色') }}</p>
        <button v-if="hasActiveAssetFilters" type="button" class="asset-empty-action" aria-label="清除素材筛选" @click="clearAssetFilters">清除素材筛选</button>
        <button v-else type="button" class="asset-empty-action" aria-label="去制作页添加角色" @click="emit('go-production')">去制作页添加角色</button>
      </div>
    </details>

    <details :open="isAssetSectionOpen(filteredScenes.length)" class="asset-section" data-asset-section="scenes">
      <summary>场景 <span>{{ filteredScenes.length }}</span></summary>
      <CanvasWindowedList
        v-if="filteredScenes.length"
        name="scenes"
        :items="filteredScenes"
        :item-key="sceneItemKey"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="asset-item"
            :aria-label="`添加场景${item.location || item.name || '未命名场景'}`"
            @click="emit('add-entity', { kind: 'scene', item })"
          >{{ item.location || item.name || '未命名场景' }}</button>
        </template>
      </CanvasWindowedList>
      <div v-if="!filteredScenes.length" class="asset-empty" role="status">
        <p>{{ assetEmptyText('场景') }}</p>
        <button v-if="hasActiveAssetFilters" type="button" class="asset-empty-action" aria-label="清除素材筛选" @click="clearAssetFilters">清除素材筛选</button>
        <button v-else type="button" class="asset-empty-action" aria-label="去制作页添加场景" @click="emit('go-production')">去制作页添加场景</button>
      </div>
    </details>

    <details :open="isAssetSectionOpen(filteredProps.length)" class="asset-section" data-asset-section="props">
      <summary>道具 <span>{{ filteredProps.length }}</span></summary>
      <CanvasWindowedList
        v-if="filteredProps.length"
        name="props"
        :items="filteredProps"
        :item-key="propItemKey"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="asset-item"
            :aria-label="`添加道具${item.name || '未命名道具'}`"
            @click="emit('add-entity', { kind: 'prop', item })"
          >{{ item.name || '未命名道具' }}</button>
        </template>
      </CanvasWindowedList>
      <div v-if="!filteredProps.length" class="asset-empty" role="status">
        <p>{{ assetEmptyText('道具') }}</p>
        <button v-if="hasActiveAssetFilters" type="button" class="asset-empty-action" aria-label="清除素材筛选" @click="clearAssetFilters">清除素材筛选</button>
        <button v-else type="button" class="asset-empty-action" aria-label="去制作页添加道具" @click="emit('go-production')">去制作页添加道具</button>
      </div>
    </details>

    <details :open="isAssetSectionOpen(filteredStoryboardMedia.length)" class="asset-section" data-asset-section="storyboard-media">
      <summary>分镜媒体 <span>{{ filteredStoryboardMedia.length }}</span></summary>
      <CanvasWindowedList
        v-if="filteredStoryboardMedia.length"
        name="storyboard-media"
        :items="filteredStoryboardMedia"
        :item-key="storyboardMediaItemKey"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="asset-item asset-item-media"
            :draggable="true"
            @dragstart.stop="startMediaDrag($event, item, 'storyboard-media')"
            :aria-label="`添加分镜素材${item.name || item.id || ''}`"
            @click="emit('add-media', item)"
          >
        <span class="asset-kind">{{ item.type === 'video' ? '视频' : '图片' }}</span>
        <span>{{ item.label }}</span>
          </button>
        </template>
      </CanvasWindowedList>
      <div v-if="!filteredStoryboardMedia.length" class="asset-empty" role="status">
        <p>{{ assetEmptyText('分镜媒体') }}</p>
        <button v-if="hasActiveAssetFilters" type="button" class="asset-empty-action" aria-label="清除素材筛选" @click="clearAssetFilters">清除素材筛选</button>
        <template v-else>
          <button type="button" class="asset-empty-action" aria-label="上传素材" @click="fileInputRef?.click()">上传素材</button>
          <button type="button" class="asset-empty-action" aria-label="从素材中心选择" @click="emit('open-picker')">从素材中心选择</button>
        </template>
      </div>
    </details>

    <details ref="projectAssetsSectionRef" open class="asset-section" data-asset-section="project-assets">
      <summary>项目素材 <span>{{ filteredAssets.length }}</span></summary>
      <CanvasWindowedList
        v-if="filteredAssets.length"
        name="project-assets"
        :items="filteredAssets"
        :item-key="projectAssetItemKey"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="asset-item asset-item-media"
            :draggable="true"
            @dragstart.stop="startMediaDrag($event, item, 'project-asset')"
            :aria-label="`添加项目素材${item.name || ('素材 ' + item.id)}`"
            @click="emit('add-media', item)"
          >
        <span class="asset-kind">{{ item.type === 'video' ? '视频' : '图片' }}</span>
        <span>{{ item.name || `素材 ${item.id}` }}</span>
          </button>
        </template>
      </CanvasWindowedList>
      <div v-if="!filteredAssets.length" class="asset-empty" role="status">
        <p>{{ assetEmptyText('项目素材') }}</p>
        <button v-if="hasActiveAssetFilters" type="button" class="asset-empty-action" aria-label="清除素材筛选" @click="clearAssetFilters">清除素材筛选</button>
        <template v-else>
          <button type="button" class="asset-empty-action" aria-label="上传素材" @click="fileInputRef?.click()">上传素材</button>
          <button type="button" class="asset-empty-action" aria-label="从素材中心选择" @click="emit('open-picker')">从素材中心选择</button>
        </template>
      </div>
    </details>
  </aside>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import CanvasWindowedList from '@/components/dramaCanvas/CanvasWindowedList.vue'
import { Close, FolderOpened, Search, Upload } from '@element-plus/icons-vue'
import {
  createFreeCanvasMediaDragPayload,
  filterFreeCanvasAssetItems,
  FREE_CANVAS_MEDIA_DRAG_TYPE,
} from '@/utils/freeCanvasMedia'

const props = defineProps({
  projectId: { type: [Number, String], required: true },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propsList: { type: Array, default: () => [] },
  storyboardMedia: { type: Array, default: () => [] },
  assets: { type: Array, default: () => [] },
  uploading: { type: Boolean, default: false },
  uploadStatus: { type: String, default: '' },
})

const emit = defineEmits(['add-entity', 'add-media', 'upload-files', 'open-picker', 'go-production', 'close'])
const fileInputRef = ref(null)
const projectAssetsSectionRef = ref(null)
const searchQuery = ref('')
const mediaType = ref('all')
const filterOptions = computed(() => ({ query: searchQuery.value, type: mediaType.value }))
const characterItemKey = (item) => `character:${item?.id}`
const sceneItemKey = (item) => `scene:${item?.id}`
const propItemKey = (item) => `prop:${item?.id}`
const storyboardMediaItemKey = (item) => item?.id
const projectAssetItemKey = (item) => `asset:${item?.id}`
const filteredCharacters = computed(() => filterFreeCanvasAssetItems(props.characters, filterOptions.value))
const filteredScenes = computed(() => filterFreeCanvasAssetItems(props.scenes, filterOptions.value))
const filteredProps = computed(() => filterFreeCanvasAssetItems(props.propsList, filterOptions.value))
const filteredStoryboardMedia = computed(() => filterFreeCanvasAssetItems(props.storyboardMedia, filterOptions.value))
const filteredAssets = computed(() => filterFreeCanvasAssetItems(
  props.assets.filter((item) => item?.type === 'image' || item?.type === 'video'),
  filterOptions.value,
))
const hasActiveAssetFilters = computed(() => Boolean(searchQuery.value.trim()) || mediaType.value !== 'all')

function clearAssetFilters() {
  searchQuery.value = ''
  mediaType.value = 'all'
}

function isAssetSectionOpen(filteredCount) {
  if (Number(filteredCount) === 0) return true
  return Boolean(String(searchQuery.value || '').trim())
}

function assetEmptyText(kind) {
  if (hasActiveAssetFilters.value) return `没有匹配的${kind}`
  if (kind === '项目素材' || kind === '分镜媒体') return `暂无${kind}，可上传或从素材中心选择`
  return `暂无${kind}，可先在制作页添加，或上传图片作为参考`
}

function emitFiles(files) {
  const values = Array.from(files || [])
  if (values.length) emit('upload-files', values)
}

function handleFileSelection(event) {
  emitFiles(event?.target?.files)
  if (event?.target) event.target.value = ''
}

function handleDrop(event) {
  emitFiles(event?.dataTransfer?.files)
}

function startMediaDrag(event, item, kind) {
  const payload = createFreeCanvasMediaDragPayload(item, {
    projectId: props.projectId,
    kind,
  })
  if (!payload || !event?.dataTransfer) return
  event.dataTransfer.setData(FREE_CANVAS_MEDIA_DRAG_TYPE, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'copy'
}

async function revealProjectAssets() {
  await nextTick()
  if (!projectAssetsSectionRef.value) return
  projectAssetsSectionRef.value.open = true
  projectAssetsSectionRef.value.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  projectAssetsSectionRef.value.querySelector?.('summary')?.focus({ preventScroll: true })
}
</script>

<style scoped>
.free-canvas-asset-sidebar {
  box-sizing: border-box;
  width: 240px;
  flex: 0 0 240px;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px;
  border-right: 1px solid var(--border-color, #27272a);
  background: var(--bg-card, #18181b);
  scrollbar-gutter: stable;
}

.asset-sidebar-header,
.asset-sidebar-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}

.asset-sidebar-header h2 {
  margin: 0;
  min-width: 0;
  font-size: 14px;
}

.asset-sidebar-actions { justify-content: flex-end; }

.asset-discovery-controls {
  display: grid;
  gap: 8px;
  padding: 10px 0 2px;
}

.asset-discovery-controls :deep(.el-radio-group) {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.asset-discovery-controls :deep(.el-radio-button),
.asset-discovery-controls :deep(.el-radio-button__inner) {
  width: 100%;
}

.project-assets-shortcut {
  width: fit-content;
  margin: 0;
}

.asset-section {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color, #27272a);
}

.asset-section summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  color: var(--canvas-text-secondary, #d4d4d8);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.asset-section summary span {
  color: var(--canvas-text-subtle, #71717a);
  font-weight: 400;
}

.asset-item {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 7px;
  margin-top: 0;
  padding: 0 7px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--canvas-text-primary, #e4e4e7);
  font: inherit;
  font-size: 12px;
  line-height: 32px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.asset-item:hover { background: var(--canvas-chip-surface, rgba(255, 255, 255, 0.08)); }
.asset-item:focus-visible,
.asset-section summary:focus-visible { outline: 2px solid var(--canvas-focus-ring, #818cf8); outline-offset: 2px; }

.asset-item-media > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-kind {
  flex: 0 0 auto;
  color: var(--canvas-indigo-text, #a5b4fc);
  font-size: 10px;
}

.asset-empty,
.upload-state {
  margin: 5px 0 0;
  color: var(--canvas-text-subtle, #71717a);
  font-size: 11px;
  line-height: 16px;
}
.asset-empty {
  display: grid;
  justify-items: start;
  gap: 6px;
}
.asset-empty p {
  margin: 0;
}
.asset-empty-action {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--canvas-indigo-text, #a5b4fc);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.asset-empty-action:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}

.upload-state { color: var(--canvas-info-text, #60a5fa); }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
