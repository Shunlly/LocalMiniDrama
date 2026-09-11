<template>
  <div v-if="countdown > 0" class="pipeline-countdown">
    <div class="pipeline-countdown-ring" aria-hidden="true">
      <span class="pipeline-countdown-num">{{ countdown }}</span>
      <span class="pipeline-countdown-unit">秒</span>
    </div>
    <div class="pipeline-countdown-body">
      <p class="pipeline-countdown-msg">{{ countdownMessage }}</p>
      <div class="pipeline-countdown-actions">
        <el-button size="small" type="success" @click="$emit('skip-countdown')">立即开始下一阶段</el-button>
        <ActionGate v-if="!paused" label="暂停倒计时" :reason="pauseDisabledReason">
          <el-button size="small" type="warning" :disabled="Boolean(pauseDisabledReason)" :title="pauseDisabledReason || undefined" @click="$emit('pause')">暂停倒计时</el-button>
        </ActionGate>
        <span v-else class="pipeline-countdown-paused">已暂停，点击“继续”恢复</span>
      </div>
    </div>
  </div>
  <div v-if="activeTaskLabels.length > 0" class="pipeline-active-tasks" aria-label="执行中的任务">
    <span v-for="label in activeTaskLabels" :key="label" class="pipeline-task-chip">
      <span class="pipeline-task-dot" />{{ label }}
    </span>
  </div>
  <div v-if="displayErrorLog.length > 0" class="pipeline-error-log" role="alert">
    <div class="pipeline-error-title">执行过程中的错误</div>
    <div v-for="(entry, index) in displayErrorLog" :key="index" class="pipeline-error-line">
      [{{ entry.step }}] {{ entry.message }}
    </div>
    <ActionGate v-if="!running" label="重试全流程" :reason="retryDisabledReason">
      <el-button type="primary" :disabled="Boolean(retryDisabledReason) || starting" :title="retryDisabledReason || (starting ? '正在启动全流程，请稍候' : undefined)" @click="$emit('start-one-click')">
        重试全流程
      </el-button>
    </ActionGate>
  </div>
</template>

<script setup>
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineProps({
  countdown: { type: Number, default: 0 },
  countdownMessage: { type: String, default: '' },
  paused: { type: Boolean, default: false },
  pauseDisabledReason: { type: String, default: '' },
  displayErrorLog: { type: Array, default: () => [] },
  activeTaskLabels: { type: Array, default: () => [] },
  running: { type: Boolean, default: false },
  starting: { type: Boolean, default: false },
  retryDisabledReason: { type: String, default: '' },
})

defineEmits([
  'skip-countdown',
  'pause',
  'start-one-click',
])
</script>

<style scoped>

.pipeline-active-tasks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.pipeline-task-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px 2px 6px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 12px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 12px;
  white-space: nowrap;
}

.pipeline-task-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: pipeline-dot-pulse 1.2s ease-in-out infinite;
}

@keyframes pipeline-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}

.pipeline-error-log {
  max-height: 200px;
  margin-top: 8px;
  padding: 12px;
  overflow-y: auto;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 6px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.pipeline-error-title {
  margin-bottom: 8px;
  font-weight: 600;
}

.pipeline-error-line {
  margin-bottom: 4px;
  word-break: break-word;
}

.pipeline-error-log :deep(.el-button) {
  margin-top: 8px;
}

.pipeline-countdown {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin: 10px 0 8px;
  padding: 12px 14px;
  border: 1px solid var(--el-color-success-light-5);
  border-radius: 6px;
  background: var(--el-color-success-light-9);
}

.pipeline-countdown-ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  height: 54px;
  border: 2px solid var(--el-color-success-light-3);
  border-radius: 50%;
  color: var(--el-color-success);
}

.pipeline-countdown-num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}

.pipeline-countdown-unit {
  font-size: 11px;
}

.pipeline-countdown-body {
  flex: 1;
  min-width: 0;
}

.pipeline-countdown-msg {
  margin: 0 0 8px;
  color: var(--el-text-color-primary);
  line-height: 1.5;
}

.pipeline-countdown-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.pipeline-countdown-paused {
  color: var(--el-color-warning);
  font-size: 12px;
}
</style>
