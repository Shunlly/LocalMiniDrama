<template>
  <div class="sidebar-section workflow-list">
    <div class="sec-label">工作流 {{ workflowGroups.length }}</div>
    <div
      v-for="group in workflowGroups"
      :key="group.id"
      class="sidebar-item workflow-item"
      :class="{ active: activeGroupId === group.id }"
      @click="emit('select-group', group.id)"
    >
      <div class="wf-item-title">{{ group.title }}</div>
      <div class="wf-item-meta">{{ (group.storyboard_ids || []).length }} 镜 · {{ (group.pipeline || []).join('→') }}</div>
    </div>
    <div v-if="!workflowGroups.length" class="sidebar-workflow-empty">
      <div class="workflow-empty-title">尚未创建工作流</div>
      <p>从顶部工作流工具中框选分镜后创建分组，分组会显示在这里。</p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  workflowGroups: { type: Array, default: () => [] },
  activeGroupId: { type: [String, Number], default: null },
})

const emit = defineEmits(['select-group'])
</script>

<style scoped>
.sidebar-section {
  margin-bottom: 14px;
}

.sec-label {
  font-size: 11px;
  color: var(--text-subtle, #71717a);
  margin-bottom: 6px;
}

.sidebar-item {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text-primary, #e4e4e7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s;
}

.sidebar-item:hover {
  background: rgba(129, 140, 248, 0.12);
}

.sidebar-item.active {
  background: rgba(52, 211, 153, 0.16);
  color: var(--canvas-emerald-text, #6ee7b7);
}

.workflow-item {
  white-space: normal;
}

.wf-item-title {
  font-weight: 600;
}

.wf-item-meta {
  margin-top: 2px;
  font-size: 10px;
  color: var(--canvas-text-faint, var(--text-faint, #52525b));
}

.sidebar-workflow-empty {
  padding: 10px;
  border: 1px dashed var(--border-color, #3f3f46);
  border-radius: 6px;
  background: rgba(129, 140, 248, 0.05);
}

.workflow-empty-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #e4e4e7);
}

.sidebar-workflow-empty p {
  margin: 4px 0 0;
  color: var(--canvas-text-subtle, var(--text-subtle, #71717a));
  font-size: 10px;
  line-height: 1.5;
}
</style>
