<template>
  <div class="config-workspace-switch" role="tablist" aria-label="AI 配置工作区">
    <button
      :ref="bindCoverageWorkspaceModeRef"
      id="ai-config-mode-coverage"
      type="button"
      role="tab"
      class="config-workspace-mode"
      data-testid="ai-config-mode-coverage"
      :class="{ active: configWorkspaceView === 'coverage' }"
      :aria-selected="configWorkspaceView === 'coverage'"
      :tabindex="configWorkspaceView === 'coverage' ? 0 : -1"
      aria-label="服务状态" aria-controls="ai-config-coverage-panel"
      @click="selectConfigWorkspaceView('coverage')"
      @keydown="onConfigWorkspaceKeydown('coverage', $event)"
    >
      服务状态
    </button>
    <button
      :ref="bindConfigsWorkspaceModeRef"
      id="ai-config-mode-configs"
      type="button"
      role="tab"
      class="config-workspace-mode"
      data-testid="ai-config-mode-configs"
      :class="{ active: configWorkspaceView === 'configs' }"
      :aria-selected="configWorkspaceView === 'configs'"
      :tabindex="configWorkspaceView === 'configs' ? 0 : -1"
      aria-label="配置管理" aria-controls="ai-config-configs-panel"
      @click="selectConfigWorkspaceView('configs')"
      @keydown="onConfigWorkspaceKeydown('configs', $event)"
    >
      配置管理
    </button>
  </div>
</template>

<script setup>
/**
 * AI 配置页「服务状态 / 配置管理」工作区切换。
 * 选中态和键盘处理仍由页面 composable 提供，这里只负责渲染 tablist 并回绑按钮 ref。
 */
defineProps({
  configWorkspaceView: { type: String, required: true },
  selectConfigWorkspaceView: { type: Function, required: true },
  onConfigWorkspaceKeydown: { type: Function, required: true },
})

const coverageWorkspaceModeRef = defineModel('coverageWorkspaceModeRef')
const configsWorkspaceModeRef = defineModel('configsWorkspaceModeRef')

function bindCoverageWorkspaceModeRef(el) {
  coverageWorkspaceModeRef.value = el
}

function bindConfigsWorkspaceModeRef(el) {
  configsWorkspaceModeRef.value = el
}
</script>

<style scoped>
.config-workspace-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 16px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-inner);
}
.config-workspace-mode {
  min-width: 112px;
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
}
.config-workspace-mode:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.config-workspace-mode.active {
  color: var(--accent-text);
  border-color: var(--border-muted);
  background: var(--bg-hover);
}
.config-workspace-mode:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: 2px;
}
@media (max-width: 760px) {
  .config-workspace-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    box-sizing: border-box;
  }
  .config-workspace-mode {
    min-width: 0;
  }
}
@media (max-width: 520px) {
  .config-workspace-switch {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
