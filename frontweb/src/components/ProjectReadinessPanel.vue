<template>
  <section class="readiness-panel" aria-labelledby="project-readiness-title">
    <div class="readiness-head">
      <div>
        <h2 id="project-readiness-title" class="readiness-title">成片交付就绪度</h2>
        <p class="readiness-subtitle">从素材、五类 AI 服务到语音、逐集合成逐项核对，只保留一个下一步动作。</p>
      </div>
      <div class="readiness-score" :class="{ complete: readiness.complete }">
        <strong>{{ readiness.readyCount }}</strong>
        <span>/ {{ readiness.totalCount }} 项就绪</span>
      </div>
    </div>

    <div class="next-action" :class="{ complete: readiness.complete }">
      <div class="next-copy">
        <span class="next-kicker">下一步</span>
        <strong>{{ readiness.nextAction.title }}</strong>
        <span>{{ readiness.nextAction.description }}</span>
      </div>
      <el-button type="primary" @click="emit('action', readiness.nextAction)">
        {{ readiness.nextAction.label }}
        <el-icon><ArrowRight /></el-icon>
      </el-button>
    </div>

    <el-progress :percentage="readiness.percent" :stroke-width="6" :show-text="false" />

    <div class="summary-grid">
      <div
        v-for="item in readiness.summaryItems"
        :key="item.id"
        class="summary-item"
        :class="[`is-${item.status}`, { ready: item.ready }]"
      >
        <span class="summary-dot" aria-hidden="true" />
        <div class="summary-copy">
          <strong>{{ item.label }}</strong>
          <span>{{ item.detail }}</span>
        </div>
        <span class="summary-state">{{ stateLabel(item.status) }}</span>
      </div>
    </div>

    <div class="service-strip">
      <span class="service-strip-title">AI 默认服务</span>
      <div class="service-chip-list">
        <component
          :is="service.ready ? 'span' : 'button'"
          v-for="service in readiness.services"
          :key="service.type"
          :type="service.ready ? undefined : 'button'"
          class="service-chip"
          :class="{ ready: service.ready }"
          :title="service.ready ? `${service.label}${service.verified ? '已验证' : '已配置'}：${service.detail}` : `前往配置${service.label}`"
          @click="!service.ready && emit('action', serviceAction(service))"
        >
          <span class="service-chip-dot" aria-hidden="true" />
          <span>{{ service.label }}</span>
        </component>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ArrowRight } from '@element-plus/icons-vue'

defineProps({
  readiness: { type: Object, required: true },
})

const emit = defineEmits(['action'])

function stateLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'partial') return '进行中'
  return '待处理'
}

function serviceAction(service) {
  return {
    id: 'configure_ai',
    label: `配置${service.label}`,
    title: `补齐${service.label}默认配置`,
    description: `后续自动化流程需要一个启用且设为默认的${service.label}服务。`,
    target: 'ai-config',
    serviceType: service.type,
  }
}
</script>

<style scoped>
.readiness-panel {
  padding: 20px 24px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow);
}
.readiness-head,
.next-action,
.summary-item {
  display: flex;
  align-items: center;
}
.readiness-head {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.readiness-title {
  margin: 0;
  color: var(--text-bright);
  font-size: 1rem;
  font-weight: 600;
}
.readiness-subtitle {
  margin: 4px 0 0;
  color: var(--text-subtle);
  font-size: 12px;
}
.readiness-score {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: var(--text-muted);
  font-size: 12px;
}
.readiness-score strong {
  color: var(--status-warning);
  font-size: 20px;
}
.readiness-score.complete strong {
  color: var(--status-success);
}
.next-action {
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
  padding: 14px 16px;
  border-left: 3px solid #8b5cf6;
  background: rgba(139, 92, 246, 0.09);
}
.next-action.complete {
  border-left-color: #22c55e;
  background: rgba(34, 197, 94, 0.08);
}
.next-copy {
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 3px 10px;
}
.next-copy strong {
  color: var(--text-bright);
  font-size: 14px;
}
.next-copy > span:last-child {
  grid-column: 2;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.next-kicker {
  grid-row: 1 / span 2;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--accent-text);
  background: rgba(139, 92, 246, 0.2);
  font-size: 11px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin-top: 18px;
}
.summary-item {
  gap: 10px;
  min-height: 54px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}
.summary-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--text-faint);
}
.summary-item.is-done .summary-dot {
  background: #22c55e;
}
.summary-item.is-partial .summary-dot {
  background: #f59e0b;
}
.summary-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
}
.summary-copy strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}
.summary-copy span {
  color: var(--text-subtle);
  font-size: 11px;
  line-height: 1.45;
}
.summary-state {
  flex-shrink: 0;
  color: var(--text-subtle);
  font-size: 11px;
}
.summary-item.is-done .summary-state {
  color: var(--status-success);
}
.summary-item.is-partial .summary-state {
  color: var(--status-warning);
}
.service-strip {
  display: grid;
  gap: 10px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
}
.service-strip-title {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}
.service-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.service-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-inner);
  color: var(--text-muted);
  font: inherit;
  cursor: default;
}
.service-chip.ready {
  color: var(--status-success);
  border-color: rgba(34, 197, 94, 0.32);
}
button.service-chip:not(.ready) {
  cursor: pointer;
}
button.service-chip:not(.ready):hover {
  border-color: rgba(139, 92, 246, 0.4);
  color: var(--accent-text);
}
.service-chip-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: currentColor;
}
@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
  .next-action {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
