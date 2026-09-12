<template>
<div
  class="sb-ctrl-bar"
  :class="{ 'sb-ctrl-bar--drop-target': dropTargetStoryboardIndex === i }"
  @dragover="onReorderDragOver($event, i)"
  @drop="onReorderDrop($event, i)"
>
  <button
    type="button"
    class="sb-reorder-handle"
    :draggable="storyboards.length > 1 && !storyboardGenerating && !universalOmniPolishRunning && !storyboardReorderBusy"
    :disabled="storyboards.length < 2 || storyboardGenerating || universalOmniPolishRunning || storyboardReorderBusy"
    :aria-label="reorderHandleReason() ? `拖动排序分镜${i + 1}不可用：${reorderHandleReason()}` : `拖动排序分镜${i + 1}，按上下方向键移动`"
    :title="reorderHandleReason() || '拖动排序；按上下方向键移动'"
    @click.stop
    @dragstart.stop="onReorderDragStart($event, i)"
    @dragend="onReorderDragEnd"
    @keydown.up.prevent.stop="onMoveStoryboardUp(sb, i)"
    @keydown.down.prevent.stop="onMoveStoryboardDown(sb, i)"
  >
    <el-icon aria-hidden="true"><Rank /></el-icon>
  </button>
  <span class="sb-ctrl-num">{{ i + 1 }}</span>
  <span class="sb-ctrl-title">{{ sb.title || '未命名分镜' }}</span>
  <span
    class="sb-ctrl-reorder-wrap"
    :title="storyboardMoveCopies[i].up.title"
  >
    <button
      type="button"
      class="sb-ctrl-btn sb-ctrl-reorder-btn"
      :disabled="storyboardMoveCopies[i].up.disabled"
      :aria-label="storyboardMoveCopies[i].up.ariaLabel"
      :title="storyboardMoveCopies[i].up.title"
      @click="onMoveStoryboardUp(sb, i)"
    >
      <el-icon aria-hidden="true"><ArrowUp /></el-icon>
    </button>
  </span>
  <span
    class="sb-ctrl-reorder-wrap"
    :title="storyboardMoveCopies[i].down.title"
  >
    <button
      type="button"
      class="sb-ctrl-btn sb-ctrl-reorder-btn"
      :disabled="storyboardMoveCopies[i].down.disabled"
      :aria-label="storyboardMoveCopies[i].down.ariaLabel"
      :title="storyboardMoveCopies[i].down.title"
      @click="onMoveStoryboardDown(sb, i)"
    >
      <el-icon aria-hidden="true"><ArrowDown /></el-icon>
    </button>
  </span>
  <el-tag v-if="sb.movement" size="small" effect="plain" type="info" class="sb-movement-tag">{{ getMovementLabel(sb.movement) }}</el-tag>
  <el-button size="small" plain class="sb-ctrl-btn sb-ctrl-config-btn" :aria-label="`打开分镜${i + 1}视频参数`" :title="`打开分镜${i + 1}视频参数`" @click="onOpenVideoParamsDialog(sb)">⚙ 分镜配置</el-button>
  <el-button
    size="small"
    plain
    class="sb-ctrl-btn sb-ctrl-mode-btn"
    :title="isSbUniversalMode(sb.id) ? '切换为经典分镜（中间显示参考图）' : '切换为全能模式（中间为片段描述，经典字段保留）'"
    :aria-label="isSbUniversalMode(sb.id) ? '切换为经典分镜（中间显示参考图）' : '切换为全能模式（中间为片段描述，经典字段保留）'"
    @click="onToggleSbUniversalMode(sb)"
  >
    {{ isSbUniversalMode(sb.id) ? '经典分镜' : '全能模式' }}
  </el-button>
  <el-button
    size="small"
    plain
    class="sb-ctrl-btn sb-ctrl-insert-btn"
    :aria-label="`在分镜${i + 1}前插入新分镜`"
    title="在本镜头前插入新分镜"
    @click="onInsertStoryboardBefore(sb)"
  >
    <el-icon aria-hidden="true"><Plus /></el-icon>
    <span>插入分镜</span>
  </el-button>
  <el-button
    size="small"
    plain
    class="sb-ctrl-btn sb-ctrl-insert-btn"
    :aria-label="`在分镜${i + 1}后插入新分镜`"
    title="在本镜头后插入新分镜"
    @click="onInsertStoryboardAfter(sb)"
  >
    <el-icon aria-hidden="true"><Plus /></el-icon>
    <span>后插</span>
  </el-button>
  <el-button
    class="sb-ctrl-delete"
    type="danger"
    text
    size="small"
    :title="`删除分镜${i + 1}`"
    :aria-label="`删除分镜${sb.storyboard_number || i + 1}`"
    @click="onDeleteSingleStoryboard(sb.id)"
  >
    <el-icon><Delete /></el-icon>
  </el-button>
</div>
</template>

<script setup>
import { ArrowDown, ArrowUp, Delete, Plus, Rank } from '@element-plus/icons-vue'

defineOptions({ inheritAttrs: false })

defineProps({
  sb: { type: Object, required: true },
  i: { type: Number, required: true },
  storyboards: { type: Array, default: () => [] },
  storyboardGenerating: { type: Boolean, default: false },
  universalOmniPolishRunning: { type: Boolean, default: false },
  storyboardReorderBusy: { type: Boolean, default: false },
  dropTargetStoryboardIndex: { type: Number, default: null },
  storyboardMoveCopies: { type: Array, default: () => [] },
  getMovementLabel: { type: Function, required: true },
  isSbUniversalMode: { type: Function, required: true },
  reorderHandleReason: { type: Function, required: true },
  onMoveStoryboardUp: { type: Function, required: true },
  onMoveStoryboardDown: { type: Function, required: true },
  onReorderDragStart: { type: Function, required: true },
  onReorderDragOver: { type: Function, required: true },
  onReorderDragEnd: { type: Function, required: true },
  onReorderDrop: { type: Function, required: true },
  onOpenVideoParamsDialog: { type: Function, required: true },
  onToggleSbUniversalMode: { type: Function, required: true },
  onInsertStoryboardBefore: { type: Function, required: true },
  onInsertStoryboardAfter: { type: Function, required: true },
  onDeleteSingleStoryboard: { type: Function, required: true },
})
</script>

<style scoped src="./FilmCreateStoryboardToolbar.css"></style>
