<template>
  <div
    v-if="configDependencyError"
    class="config-load-state config-load-state--error"
    role="alert"
    aria-live="assertive"
  >
    <div class="config-load-copy">
      <strong>AI 配置依赖加载失败</strong>
      <span>
        {{ configDependencyError }}
        <template v-if="staleDataHint">当前显示的是上次成功加载的数据，写操作已暂停。</template>
      </span>
    </div>
    <el-button size="small" type="primary" plain aria-label="重新读取 AI 配置依赖" :loading="loading" @click="retryConfigDependencies">
      重新读取 AI 配置依赖
    </el-button>
  </div>
</template>

<script setup>
defineProps({
  configDependencyError: { type: String, default: '' },
  staleDataHint: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  retryConfigDependencies: { type: Function, required: true },
})
</script>

<style scoped>
.config-load-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-info-border, #c6e2ff);
  border-radius: 8px;
  background: var(--ai-config-info-surface, #ecf5ff);
  color: var(--ai-config-info-text, #1d4ed8);
}
.config-load-state--error {
  border-color: var(--ai-config-danger-border, #fbc4c4);
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
}
.config-load-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.config-load-copy strong {
  color: inherit;
  font-size: 13px;
  line-height: 18px;
}
.config-load-copy span {
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
</style>
