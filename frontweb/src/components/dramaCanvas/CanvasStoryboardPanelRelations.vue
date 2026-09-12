<template>
  <div class="relation-row">
    <el-form-item label="角色" class="rel-item">
      <el-select
        v-model="characterIds"
        :aria-label="storyboardControlLabel('角色')"
        multiple
        collapse-tags
        collapse-tags-tooltip
        filterable
        placeholder="角色"
        teleported
        popper-class="canvas-panel-popper"
        @visible-change="onSelectVisibleChange"
        @change="onRelationChange"
      >
        <el-option
          v-for="c in characters"
          :key="c.id"
          :label="c.name || '未命名'"
          :value="normalizeEntityId(c.id)"
        />
      </el-select>
    </el-form-item>
    <el-form-item label="场景" class="rel-item">
      <el-select
        v-model="sceneId"
        :aria-label="storyboardControlLabel('场景')"
        clearable
        filterable
        placeholder="场景"
        teleported
        popper-class="canvas-panel-popper"
        @visible-change="onSelectVisibleChange"
        @change="onRelationChange"
      >
        <el-option
          v-for="s in scenes"
          :key="s.id"
          :label="s.location || '未命名'"
          :value="normalizeEntityId(s.id)"
        />
      </el-select>
    </el-form-item>
    <el-form-item label="道具" class="rel-item">
      <el-select
        v-model="propIds"
        :aria-label="storyboardControlLabel('道具')"
        multiple
        collapse-tags
        collapse-tags-tooltip
        filterable
        placeholder="道具"
        teleported
        popper-class="canvas-panel-popper"
        @visible-change="onSelectVisibleChange"
        @change="onRelationChange"
      >
        <el-option
          v-for="p in propsList"
          :key="p.id"
          :label="p.name || '未命名'"
          :value="normalizeEntityId(p.id)"
        />
      </el-select>
    </el-form-item>
  </div>
  <div class="inline-add-row">
    <el-button link type="primary" size="small" :aria-label="storyboardControlLabel('添加角色')" @click.stop="createAsset('character')">添加角色</el-button>
    <el-button link type="primary" size="small" :aria-label="storyboardControlLabel('添加场景')" @click.stop="createAsset('scene')">添加场景</el-button>
    <el-button link type="primary" size="small" :aria-label="storyboardControlLabel('添加道具')" @click.stop="createAsset('prop')">添加道具</el-button>
  </div>
</template>

<script setup>
import { normalizeEntityId } from '@/utils/canvasEntityIds'

const characterIds = defineModel('characterIds', { type: Array, required: true })
const sceneId = defineModel('sceneId')
const propIds = defineModel('propIds', { type: Array, required: true })

defineProps({
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propsList: { type: Array, default: () => [] },
  storyboardControlLabel: { type: Function, required: true },
  onSelectVisibleChange: { type: Function, required: true },
  onRelationChange: { type: Function, required: true },
  createAsset: { type: Function, required: true },
})
</script>

<style scoped>
.relation-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}
.rel-item {
  flex: 1;
  min-width: 0;
  margin-bottom: 4px !important;
}
.inline-add-row {
  display: flex;
  gap: 10px;
  margin: 0 0 8px 36px;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}
</style>
