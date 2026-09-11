<template>
  <aside class="canvas-sidebar">
    <div v-if="canvasMode === 'production'" class="sidebar-section sidebar-script">
      <div class="sec-label sec-label-row">
        <span>📜 剧本</span>
        <el-button link size="small" type="warning" aria-label="编辑剧本" @click="focusScriptNode">编辑</el-button>
      </div>
    </div>
    <div class="sidebar-title">
      素材库
      <el-button v-if="highlightAssetId" link size="small" aria-label="清除资产高亮" @click="clearAssetHighlight">清除</el-button>
    </div>
    <div class="sidebar-section">
      <div class="sec-label sec-label-row">
        <span>角色 {{ (drama.characters || []).length }}</span>
        <el-button v-if="canvasMode === 'production'" link size="small" type="primary" aria-label="新建角色" @click="openCreateDialog('character')">+</el-button>
      </div>
      <CanvasWindowedList
        v-if="(drama.characters || []).length"
        name="characters"
        :items="drama.characters || []"
        :item-key="characterItemKey"
        :force-index="characterForceIndex"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="sidebar-item"
            :class="{ active: highlightAssetId === 'char:' + item.id }"
            :aria-label="`定位角色${item.name || '未命名'}`"
            @click="selectSidebarAsset('char:' + item.id)"
          >
            {{ item.name || '未命名' }}
          </button>
        </template>
      </CanvasWindowedList>
      <p v-if="!(drama.characters || []).length" class="sidebar-empty" role="status">
        暂无角色
        <el-button link type="primary" size="small" aria-label="新建角色" @click="openCreateDialog('character')">新建</el-button>
      </p>
    </div>
    <div class="sidebar-section">
      <div class="sec-label sec-label-row">
        <span>场景 {{ (drama.scenes || []).length }}</span>
        <el-button v-if="canvasMode === 'production'" link size="small" type="primary" aria-label="新建场景" @click="openCreateDialog('scene')">+</el-button>
      </div>
      <CanvasWindowedList
        v-if="(drama.scenes || []).length"
        name="scenes"
        :items="drama.scenes || []"
        :item-key="sceneItemKey"
        :force-index="sceneForceIndex"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="sidebar-item"
            :class="{ active: highlightAssetId === 'scene:' + item.id }"
            :aria-label="`定位场景${item.location || '未命名'}`"
            @click="selectSidebarAsset('scene:' + item.id)"
          >
            {{ item.location || '未命名' }}
          </button>
        </template>
      </CanvasWindowedList>
      <p v-if="!(drama.scenes || []).length" class="sidebar-empty" role="status">
        暂无场景
        <el-button link type="primary" size="small" aria-label="新建场景" @click="openCreateDialog('scene')">新建</el-button>
      </p>
    </div>
    <div class="sidebar-section">
      <div class="sec-label sec-label-row">
        <span>道具 {{ (drama.props || []).length }}</span>
        <el-button v-if="canvasMode === 'production'" link size="small" type="primary" aria-label="新建道具" @click="openCreateDialog('prop')">+</el-button>
      </div>
      <CanvasWindowedList
        v-if="(drama.props || []).length"
        name="props"
        :items="drama.props || []"
        :item-key="propItemKey"
        :force-index="propForceIndex"
      >
        <template #item="{ item }">
          <button
            type="button"
            class="sidebar-item"
            :class="{ active: highlightAssetId === 'prop:' + item.id }"
            :aria-label="`定位道具${item.name || '未命名'}`"
            @click="selectSidebarAsset('prop:' + item.id)"
          >
            {{ item.name || '未命名' }}
          </button>
        </template>
      </CanvasWindowedList>
      <p v-if="!(drama.props || []).length" class="sidebar-empty" role="status">
        暂无道具
        <el-button link type="primary" size="small" aria-label="新建道具" @click="openCreateDialog('prop')">新建</el-button>
      </p>
    </div>

    <CanvasWorkflowSidebarList
      v-if="canvasMode === 'production'"
      :workflow-groups="workflowGroups"
      :active-group-id="activeGroupId"
      :storyboard-details="workflowStoryboardDetails"
      :reorder-disabled="workflowOrderSaving || workflowRunning"
      :reorder-pending="workflowOrderSaving"
      @select-group="setActiveGroupId"
      @reorder-storyboards="reorderWorkflowStoryboards"
    />
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import CanvasWindowedList from '@/components/dramaCanvas/CanvasWindowedList.vue'
import CanvasWorkflowSidebarList from '@/components/dramaCanvas/CanvasWorkflowSidebarList.vue'

const props = defineProps({
  drama: { type: Object, required: true },
  canvasMode: { type: String, default: 'production' },
  highlightAssetId: { default: null },
  workflowGroups: { type: Array, default: () => [] },
  activeGroupId: { default: null },
  workflowStoryboardDetails: { type: Object, default: () => ({}) },
  workflowOrderSaving: { type: Boolean, default: false },
  workflowRunning: { type: Boolean, default: false },
  focusScriptNode: { type: Function, required: true },
  openCreateDialog: { type: Function, required: true },
  clearAssetHighlight: { type: Function, required: true },
  selectSidebarAsset: { type: Function, required: true },
  setActiveGroupId: { type: Function, required: true },
  reorderWorkflowStoryboards: { type: Function, required: true },
})

function forceIndexByPrefix(items, prefix) {
  const highlight = String(props.highlightAssetId || '')
  if (!highlight.startsWith(prefix)) return null
  const id = highlight.slice(prefix.length)
  const index = (items || []).findIndex((item) => String(item?.id) === id)
  return index >= 0 ? index : null
}

const characterItemKey = (item) => `c-${item?.id}`
const sceneItemKey = (item) => `s-${item?.id}`
const propItemKey = (item) => `p-${item?.id}`
const characterForceIndex = computed(() => forceIndexByPrefix(props.drama?.characters, 'char:'))
const sceneForceIndex = computed(() => forceIndexByPrefix(props.drama?.scenes, 'scene:'))
const propForceIndex = computed(() => forceIndexByPrefix(props.drama?.props, 'prop:'))
</script>

<style scoped>
.canvas-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color, #27272a);
  background: var(--bg-card, #18181b);
  padding: 14px 12px;
  overflow-y: auto;
}

.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--text-bright, #fafafa);
}

.sidebar-section { margin-bottom: 14px; }
.sidebar-script {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #27272a);
}

.sec-label {
  font-size: 11px;
  color: var(--text-subtle, #71717a);
  margin-bottom: 6px;
}

.sec-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-item {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  font-size: 12px;
  line-height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--text-primary, #e4e4e7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s;
}
.sidebar-item:hover { background: rgba(129, 140, 248, 0.12); }
.sidebar-item:focus-visible { outline: 2px solid var(--canvas-indigo-strong); outline-offset: 1px; }
.sidebar-item.active { background: rgba(52, 211, 153, 0.16); color: var(--canvas-emerald-text); }
.sidebar-empty { font-size: 11px; color: var(--text-faint, #52525b); padding: 4px 0; }
</style>
