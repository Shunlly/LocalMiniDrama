<template>
  <div class="panel-head">
    <span>分镜 #{{ storyboard?.storyboard_number ?? storyboard?.id }}</span>
    <div class="head-actions">
      <span v-if="busyLabel" class="busy-tag">{{ busyLabel }}</span>
      <el-button link size="small" type="primary" aria-label="打开列表详情" @click.stop="openListMode">列表详情</el-button>
      <el-button link size="small" aria-label="收起面板" @click.stop="closePanel">收起</el-button>
    </div>
  </div>
  <div v-if="audioOutcomeUnknown" class="media-query-blocker" role="alert">
    <span>上一次配音结果待确认，服务端可能仍在合成并产生费用。</span>
    <el-button size="small" type="warning" plain @click.stop="refreshAfterUnknownAudio">刷新分镜状态</el-button>
  </div>
</template>

<script setup>
defineProps({
  storyboard: { type: Object, required: true },
  busyLabel: { type: String, default: '' },
  audioOutcomeUnknown: { type: Boolean, default: false },
  openListMode: { type: Function, required: true },
  closePanel: { type: Function, required: true },
  refreshAfterUnknownAudio: { type: Function, required: true },
})
</script>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--canvas-indigo-text, #c7d2fe);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.busy-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.18);
  color: var(--canvas-blue-text, #93c5fd);
  animation: pulse-tag 1.2s ease-in-out infinite;
}
@keyframes pulse-tag {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}
</style>
