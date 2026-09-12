<template>
  <div
    v-if="readinessDependencyState === 'loading' && !hasReadinessSnapshot"
    class="dependency-status"
    role="status"
    aria-live="polite"
  >
    <span>正在检查 AI 配置与故事素材状态...</span>
  </div>
  <div
    v-else-if="readinessDependencyState === 'error'"
    class="dependency-status dependency-status--error"
    role="alert"
    aria-live="assertive"
  >
    <span>
      {{ readinessDependencyError }}
      <template v-if="hasReadinessSnapshot">当前显示的是上次成功加载的就绪状态。</template>
    </span>
    <el-button size="small" type="primary" plain aria-label="重试加载就绪度" @click="emit('retry')">
      重试
    </el-button>
  </div>
  <ProjectReadinessPanel
    v-if="projectReadiness"
    :readiness="projectReadiness"
    @action="emit('action', $event)"
  />
</template>

<script setup>
import ProjectReadinessPanel from '@/components/ProjectReadinessPanel.vue'

// 就绪检查只负责展示，重试与动作分发仍由页面处理
defineProps({
  readinessDependencyState: { type: String, default: 'idle' },
  readinessDependencyError: { type: String, default: '' },
  hasReadinessSnapshot: { type: Boolean, default: false },
  projectReadiness: { type: Object, default: null },
})

const emit = defineEmits(['retry', 'action'])
</script>

<style scoped>
.dependency-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.6);
  color: #bfdbfe;
  font-size: 12px;
  line-height: 1.5;
}
.dependency-status--error {
  border-color: rgba(248, 113, 113, 0.32);
  background: rgba(127, 29, 29, 0.16);
  color: #fecaca;
}
html.light .dependency-status {
  background: rgba(239, 246, 255, 0.88);
  border-color: rgba(59, 130, 246, 0.22);
  color: #1d4ed8;
}
html.light .dependency-status--error {
  background: #fef2f2;
  border-color: rgba(239, 68, 68, 0.22);
  color: #b91c1c;
}
</style>
