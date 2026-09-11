<template>
  <nav id="film-create-quick-nav" class="quick-nav" :class="{ collapsed: navCollapsed }" aria-label="快捷导航">
    <div class="nav-sidebar-header">
      <span v-if="!navCollapsed" class="nav-sidebar-title">导航</span>
      <button
        type="button"
        class="nav-toggle"
        :title="navCollapsed ? '展开导航' : '收起导航'"
        :aria-label="navCollapsed ? '展开导航' : '收起导航'"
        :aria-expanded="!navCollapsed"
        aria-controls="film-create-quick-nav"
        @click="emit('toggle-nav')"
      >
        <el-icon><Expand v-if="navCollapsed" /><Fold v-else /></el-icon>
      </button>
    </div>

    <div class="nav-steps">
      <button
        v-for="(step, idx) in navSteps"
        :key="step.key"
        type="button"
        class="nav-step"
        :class="['status-' + step.status, { 'is-current': activeNavAnchor === step.anchor }]"
        :aria-current="activeNavAnchor === step.anchor ? 'step' : undefined"
        :title="navStepLabel(step)"
        :aria-label="navStepLabel(step)"
        @click="emit('scroll-to-anchor', step.anchor, step.anchor)"
      >
        <span class="step-connector-wrap">
          <span v-if="idx > 0" class="step-line step-line-top" :class="{ filled: navSteps[idx - 1].status === 'done' }" />
          <span
            class="step-dot"
            :class="['dot-' + step.status]"
          >
            <el-icon v-if="step.status === 'done'" class="dot-icon"><Check /></el-icon>
            <el-icon v-else-if="step.status === 'generating'" class="dot-icon spin"><Loading /></el-icon>
            <span v-else class="dot-num">{{ idx + 1 }}</span>
          </span>
          <span v-if="idx < navSteps.length - 1" class="step-line step-line-bottom" :class="{ filled: step.status === 'done' }" />
        </span>

        <span class="step-body">
          <span class="step-label">{{ step.label }}</span>
          <span v-if="step.count > 0 && step.status !== 'done'" class="step-count">{{ step.count }}</span>
          <span v-if="step.status === 'partial'" class="step-badge partial-badge" title="部分完成" aria-hidden="true">
            <el-icon><WarningFilled /></el-icon>
          </span>
          <span v-else-if="step.status === 'generating'" class="step-badge gen-badge" title="生成中" aria-hidden="true">
            <el-icon class="spin"><Loading /></el-icon>
          </span>
        </span>
      </button>
    </div>

    <div v-if="!navCollapsed && storyboards.length > 0" class="nav-group">
      <button
        type="button"
        class="nav-sub-toggle"
        :title="storyboardMenuExpanded ? '收起分镜列表' : '展开分镜列表'"
        :aria-label="storyboardMenuExpanded ? '收起分镜列表' : '展开分镜列表'"
        :aria-expanded="storyboardMenuExpanded"
        aria-controls="storyboard-nav-list"
        @click="storyboardMenuExpanded = !storyboardMenuExpanded"
      >
        <el-icon><Minus v-if="storyboardMenuExpanded" /><Plus v-else /></el-icon>
        <span>分镜列表</span>
      </button>
      <div id="storyboard-nav-list" v-show="storyboardMenuExpanded" class="nav-sub-list">
        <template v-for="(sb, i) in storyboards" :key="sb.id">
          <div
            v-if="sb.segment_title && (i === 0 || sb.segment_index !== storyboards[i - 1].segment_index)"
            class="nav-segment-label"
          >
            <span class="nav-segment-dot" />
            {{ sb.segment_title }}
          </div>
          <button
            type="button"
            class="nav-sub-item"
            :title="sb.title || ('分镜 ' + (i + 1))"
            :aria-label="'跳转到分镜 ' + (i + 1) + '：' + (sb.title || '未命名')"
            @click="emit('scroll-to-anchor', 'sb-' + sb.id, 'anchor-storyboard-images')"
          >
            {{ i + 1 }}. {{ sb.title || '分镜' }}
          </button>
        </template>
      </div>
    </div>

    <div v-if="allActiveTaskItems.length > 0" class="atp-panel">
      <div v-if="navCollapsed" class="atp-collapsed-badge" role="status" aria-live="polite" :aria-label="`进行中任务 ${allActiveTaskItems.length} 个：${allActiveTaskLabels.join('、')}`" :title="allActiveTaskLabels.join('\n')">
        <span class="atp-spin-dot" />
        <span class="atp-collapsed-count">{{ allActiveTaskItems.length }}</span>
      </div>
      <template v-else>
        <div class="atp-header">
          <span class="atp-spin-dot" />
          <span class="atp-title">进行中</span>
          <span class="atp-count-badge">{{ allActiveTaskItems.length }}</span>
        </div>
        <div class="atp-list">
          <div
            v-for="item in allActiveTaskItems.slice(0, 8)"
            :key="item.id"
            class="atp-item"
          >
            <span class="atp-item-dot" />
            <el-tooltip :content="item.label" placement="right" :show-after="300" :enterable="false">
              <span class="atp-item-label">{{ item.label }}</span>
            </el-tooltip>
            <button
              type="button"
              class="atp-item-close"
              :title="item.kind === 'pipeline' && pipelineStopping ? '正在停止流水线，请稍候' : '取消任务'"
              :aria-label="item.kind === 'pipeline' && pipelineStopping ? '取消任务不可用：正在停止流水线，请稍候' : `取消任务${item.label || ''}`"
              :disabled="item.kind === 'pipeline' && pipelineStopping"
              @click.stop="emit('cancel-active-task', item)"
            >
              <el-icon v-if="item.kind === 'pipeline' && pipelineStopping" :size="12" class="is-loading"><Loading /></el-icon>
              <el-icon v-else :size="12"><Close /></el-icon>
            </button>
          </div>
          <div
            v-if="overflowTaskCount > 0"
            class="atp-more"
            role="status"
            :title="overflowTaskTitle"
            :aria-label="overflowTaskAriaLabel"
          >
            还有 {{ overflowTaskCount }} 个任务未列出
          </div>
        </div>
      </template>
    </div>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { Check, Close, Expand, Fold, Loading, Minus, Plus, WarningFilled } from '@element-plus/icons-vue'

const props = defineProps({
  navCollapsed: { type: Boolean, default: false },
  navSteps: { type: Array, default: () => [] },
  activeNavAnchor: { type: String, default: '' },
  storyboards: { type: Array, default: () => [] },
  allActiveTaskItems: { type: Array, default: () => [] },
  allActiveTaskLabels: { type: Array, default: () => [] },
  pipelineStopping: { type: Boolean, default: false },
})

const storyboardMenuExpanded = defineModel('storyboardMenuExpanded', { type: Boolean, default: false })

function navStepStatusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'partial') return '部分完成'
  if (status === 'generating') return '生成中'
  return '未开始'
}

function navStepLabel(step) {
  return `跳转到${step.label}（${navStepStatusLabel(step.status)}）`
}

const overflowTaskItems = computed(() => (props.allActiveTaskItems || []).slice(8))
const overflowTaskCount = computed(() => overflowTaskItems.value.length)
const overflowTaskTitle = computed(() => overflowTaskItems.value.map((item) => item.label).filter(Boolean).join('\n'))
const overflowTaskAriaLabel = computed(() => {
  const labels = overflowTaskItems.value.map((item) => item.label).filter(Boolean).join('、')
  return labels
    ? `还有 ${overflowTaskCount.value} 个任务未列出：${labels}`
    : `还有 ${overflowTaskCount.value} 个任务未列出`
})

const emit = defineEmits([
  'toggle-nav',
  'scroll-to-anchor',
  'cancel-active-task',
])
</script>

<style scoped>
.quick-nav {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 210;
  display: flex;
  flex-direction: column;
  padding: 14px 0 10px;
  background: linear-gradient(180deg, #131318 0%, #111116 50%, #0f0f14 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 1px 0 0 rgba(255,255,255,0.02), 4px 0 24px rgba(0, 0, 0, 0.4);
  width: var(--film-nav-width);
  overflow-y: auto;
  overflow-x: hidden;
}
html.light .quick-nav {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 247, 255, 0.99) 100%);
  border-right-color: rgba(139, 92, 246, 0.1);
  box-shadow: 1px 0 0 rgba(139,92,246,0.06), 4px 0 20px rgba(139, 92, 246, 0.04);
}
.quick-nav::-webkit-scrollbar { width: 4px; }
.quick-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.quick-nav::-webkit-scrollbar-track { background: transparent; }
.quick-nav.collapsed {
  width: 48px;
  padding: 12px 0;
}
.quick-nav.collapsed .nav-steps,
.quick-nav.collapsed .nav-group {
  display: none;
}
@media (max-width: 768px) {
  .quick-nav { width: 48px; padding: 12px 0; }
  .quick-nav .nav-steps, .quick-nav .nav-group { display: none; }
  .quick-nav .nav-sidebar-title { display: none; }
  .quick-nav .nav-sidebar-header { justify-content: center; padding: 0 4px 8px; }
}
.atp-panel {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 6px 0 4px;
}
.atp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 4px;
}
.atp-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  letter-spacing: 0.03em;
  flex: 1;
}
.atp-count-badge {
  font-size: 0.68rem;
  background: rgba(139, 92, 246, 0.25);
  color: #c4b5fd;
  border-radius: 8px;
  padding: 1px 5px;
  min-width: 16px;
  text-align: center;
}
.atp-spin-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  flex-shrink: 0;
  animation: atp-pulse 1.2s ease-in-out infinite;
}
@keyframes atp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
.atp-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.atp-list :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
  min-width: 0;
}
.atp-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 6px;
  transition: background 0.15s;
  min-width: 0;
  cursor: default;
}
.atp-item:hover { background: rgba(255,255,255,0.05); }
.atp-item-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #7c3aed;
  flex-shrink: 0;
  animation: atp-pulse 1.6s ease-in-out infinite;
}
.atp-item-label {
  font-size: 0.72rem;
  color: #a1a1aa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.atp-item-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.atp-item:hover .atp-item-close,
.atp-item-close:focus-visible {
  opacity: 1;
}
.atp-item-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.atp-more {
  font-size: 0.68rem;
  color: #71717a;
  padding: 2px 10px 2px 19px;
}
.atp-collapsed-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px 0;
  cursor: default;
}
.atp-collapsed-count {
  font-size: 0.65rem;
  color: #a78bfa;
  font-weight: 700;
  line-height: 1;
}
html.light .atp-title { color: #7c3aed; }
html.light .atp-count-badge { background: rgba(139,92,246,0.12); color: #7c3aed; }
html.light .atp-spin-dot { background: #7c3aed; }
html.light .atp-item-dot { background: #8b5cf6; }
html.light .atp-item-label { color: #374151; }
html.light .atp-item:hover { background: rgba(0,0,0,0.04); }
html.light .atp-item-close { color: #9ca3af; }
html.light .atp-item-close:hover { background: rgba(239,68,68,0.1); color: #dc2626; }
html.light .atp-panel { border-top-color: rgba(139,92,246,0.15); }
.nav-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
  flex-shrink: 0;
}
html.light .nav-sidebar-header { border-bottom-color: rgba(139, 92, 246, 0.12); }
.quick-nav.collapsed .nav-sidebar-header {
  justify-content: center;
  padding: 0 4px 8px;
}
.nav-sidebar-title {
  font-size: 13px;
  font-weight: 600;
  color: #7a7a88;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
}
html.light .nav-sidebar-title { color: #7c3aed; }
.nav-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: #5a5a66;
  font: inherit;
  transition: color 0.15s, background 0.15s;
  border-radius: 6px;
  flex-shrink: 0;
  font-size: 16px;
}
.nav-toggle:hover { color: #c8c8d0; background: rgba(255,255,255,0.06); }
html.light .nav-toggle { color: #9ca3af; }
html.light .nav-toggle:hover { color: #374151; background: rgba(0,0,0,0.05); }
.nav-steps {
  display: flex;
  flex-direction: column;
  padding: 0 10px 0 10px;
}
.nav-step {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  padding: 3px 6px 3px 0;
  transition: background 0.2s ease;
  user-select: none;
}
.nav-step:hover { background: rgba(255,255,255,0.04); }
.nav-step.is-current {
  background: rgba(99, 102, 241, 0.11);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
html.light .nav-step.is-current { background: rgba(99, 102, 241, 0.09); }
.nav-step.is-current .step-label { font-weight: 700; }
html.light .nav-step:hover { background: rgba(99,102,241,0.05); }
.step-connector-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}
.step-line {
  width: 2px;
  flex: 1;
  min-height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 1px;
  transition: background 0.3s;
}
html.light .step-line { background: rgba(0,0,0,0.1); }
.step-line.filled { background: rgba(34, 197, 94, 0.5); }
.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  transition: all 0.25s;
  border: 2px solid transparent;
}
.dot-pending {
  background: rgba(39,39,42,0.6);
  border-color: rgba(63,63,70,0.4);
  color: #52525b;
}
html.light .dot-pending {
  background: rgba(229,231,235,0.6);
  border-color: rgba(156,163,175,0.3);
  color: #9ca3af;
}
.dot-partial {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.45);
  color: #f59e0b;
}
.dot-generating {
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.5);
  color: #a78bfa;
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.2);
}
.dot-done {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.5);
  color: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.15);
}
.dot-icon { font-size: 13px; }
.dot-num { font-size: 11px; line-height: 1; }
.step-body {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding: 3px 0;
  min-width: 0;
}
.step-label {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #71717a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.2s ease;
}
html.light .step-label { color: #6b7280; }
.nav-step:hover .step-label { color: #d4d4d8; }
html.light .nav-step:hover .step-label { color: #1e1b4b; }
.status-done .step-label { color: #6ee7b7; }
html.light .status-done .step-label { color: #059669; }
.status-generating .step-label { color: #c4b5fd; }
html.light .status-generating .step-label { color: #7c3aed; }
.status-partial .step-label { color: #fbbf24; }
html.light .status-partial .step-label { color: #d97706; }
.step-count {
  font-size: 10px;
  color: #52525b;
  background: rgba(255,255,255,0.04);
  border-radius: 10px;
  padding: 1px 5px;
  flex-shrink: 0;
  font-weight: 500;
}
html.light .step-count { background: rgba(0,0,0,0.04); color: #9ca3af; }
.step-badge {
  display: flex;
  align-items: center;
  font-size: 11px;
  flex-shrink: 0;
}
.partial-badge { color: #f59e0b; }
.gen-badge { color: #a78bfa; }
@keyframes navSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin { animation: navSpin 1s linear infinite; display: inline-flex; }
.nav-group { margin-top: 4px; }
.nav-sub-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 12px;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  font-size: 12px;
  color: #5a5a66;
  cursor: pointer;
  transition: color 0.15s;
  border-top: 1px solid rgba(255,255,255,0.04);
}
html.light .nav-sub-toggle { border-top-color: rgba(0,0,0,0.07); color: #9ca3af; }
.nav-sub-toggle:hover { color: #e4e4e7; }
html.light .nav-sub-toggle:hover { color: #374151; }
.nav-sub-list {
  background: rgba(0,0,0,0.15);
  padding: 4px 0;
  border-radius: 0 0 6px 6px;
}
html.light .nav-sub-list { background: rgba(99,102,241,0.03); }
.nav-sub-item {
  display: block;
  width: calc(100% - 8px);
  padding: 4px 10px 4px 26px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  font-size: 11.5px;
  color: #52525b;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s, background 0.15s;
  border-radius: 4px;
  margin: 0 4px;
}
html.light .nav-sub-item { color: #9ca3af; }
.nav-sub-item:hover { color: #d4d4d8; background: rgba(255,255,255,0.04); }
html.light .nav-sub-item:hover { color: #1e1b4b; background: rgba(99,102,241,0.06); }
.nav-toggle:focus-visible,
.nav-step:focus-visible,
.nav-sub-toggle:focus-visible,
.nav-sub-item:focus-visible,
.atp-item-close:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.nav-segment-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px 2px;
  font-size: 10px;
  font-weight: 700;
  color: #a78bfa;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.nav-segment-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8b5cf6;
  flex-shrink: 0;
}
</style>
