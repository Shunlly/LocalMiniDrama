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
      <el-button class="project-assets-shortcut" link size="small" @click="revealProjectAssets">
        <el-icon><FolderOpened /></el-icon>
        项目素材 {{ filteredAssets.length }}
      </el-button>
    </div>

    <details :open="Boolean(searchQuery)" class="asset-section" data-asset-section="characters">
      <summary>角色 <span>{{ filteredCharacters.length }}</span></summary>
      <button
        v-for="item in filteredCharacters"
        :key="`character:${item.id}`"
        type="button"
        class="asset-item"
        @click="emit('add-entity', { kind: 'character', item })"
      >{{ item.name || '未命名角色' }}</button>
      <p v-if="!filteredCharacters.length" class="asset-empty">暂无匹配角色</p>
    </details>

    <details :open="Boolean(searchQuery)" class="asset-section" data-asset-section="scenes">
      <summary>场景 <span>{{ filteredScenes.length }}</span></summary>
      <button
        v-for="item in filteredScenes"
        :key="`scene:${item.id}`"
        type="button"
        class="asset-item"
        @click="emit('add-entity', { kind: 'scene', item })"
      >{{ item.location || item.name || '未命名场景' }}</button>
      <p v-if="!filteredScenes.length" class="asset-empty">暂无匹配场景</p>
    </details>

    <details :open="Boolean(searchQuery)" class="asset-section" data-asset-section="props">
      <summary>道具 <span>{{ filteredProps.length }}</span></summary>
      <button
        v-for="item in filteredProps"
        :key="`prop:${item.id}`"
        type="button"
        class="asset-item"
        @click="emit('add-entity', { kind: 'prop', item })"
      >{{ item.name || '未命名道具' }}</button>
      <p v-if="!filteredProps.length" class="asset-empty">暂无匹配道具</p>
    </details>

    <details :open="Boolean(searchQuery)" class="asset-section" data-asset-section="storyboard-media">
      <summary>分镜媒体 <span>{{ filteredStoryboardMedia.length }}</span></summary>
      <button
        v-for="item in filteredStoryboardMedia"
        :key="item.id"
        type="button"
        class="asset-item asset-item-media"
        :draggable="true"
        @dragstart.stop="startMediaDrag($event, item, 'storyboard-media')"
        @click="emit('add-media', item)"
      >
        <span class="asset-kind">{{ item.type === 'video' ? '视频' : '图片' }}</span>
        <span>{{ item.label }}</span>
      </button>
      <p v-if="!filteredStoryboardMedia.length" class="asset-empty">暂无匹配分镜媒体</p>
    </details>

    <details ref="projectAssetsSectionRef" open class="asset-section" data-asset-section="project-assets">
      <summary>项目素材 <span>{{ filteredAssets.length }}</span></summary>
      <button
        v-for="item in filteredAssets"
        :key="`asset:${item.id}`"
        type="button"
        class="asset-item asset-item-media"
        :draggable="true"
        @dragstart.stop="startMediaDrag($event, item, 'project-asset')"
        @click="emit('add-media', item)"
      >
        <span class="asset-kind">{{ item.type === 'video' ? '视频' : '图片' }}</span>
        <span>{{ item.name || `素材 ${item.id}` }}</span>
      </button>
      <p v-if="!filteredAssets.length" class="asset-empty">暂无匹配项目素材</p>
    </details>
  </aside>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
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

const emit = defineEmits(['add-entity', 'add-media', 'upload-files', 'open-picker', 'close'])
const fileInputRef = ref(null)
const projectAssetsSectionRef = ref(null)
const searchQuery = ref('')
const mediaType = ref('all')
const filterOptions = computed(() => ({ query: searchQuery.value, type: mediaType.value }))
const filteredCharacters = computed(() => filterFreeCanvasAssetItems(props.characters, filterOptions.value))
const filteredScenes = computed(() => filterFreeCanvasAssetItems(props.scenes, filterOptions.value))
const filteredProps = computed(() => filterFreeCanvasAssetItems(props.propsList, filterOptions.value))
const filteredStoryboardMedia = computed(() => filterFreeCanvasAssetItems(props.storyboardMedia, filterOptions.value))
const filteredAssets = computed(() => filterFreeCanvasAssetItems(
  props.assets.filter((item) => item?.type === 'image' || item?.type === 'video'),
  filterOptions.value,
))

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
}

.asset-sidebar-header h2 {
  margin: 0;
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
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 7px;
  margin-top: 3px;
  padding: 6px 7px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--canvas-text-primary, #e4e4e7);
  font: inherit;
  font-size: 12px;
  text-align: left;
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
