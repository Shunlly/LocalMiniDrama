<template>
  <section class="section card pipeline-section" aria-labelledby="pipeline-title">
    <div class="pipeline-disclosure-head">
      <div class="pipeline-heading">
        <el-icon><VideoPlay /></el-icon>
        <h2 id="pipeline-title" class="pipeline-title">全流程生成</h2>
      </div>
      <div
        class="pipeline-compact-copy"
        data-testid="film-pipeline-summary"
        :data-state="focusState"
      >
        <span>{{ focusKicker }}</span>
        <strong>{{ focusTitle }}</strong>
        <span class="pipeline-compact-next"><span>下一步</span>{{ focusNextStep }}</span>
      </div>
      <div class="pipeline-compact-actions">
        <button
          v-if="compactAction"
          type="button"
          class="pipeline-compact-action"
          data-testid="film-pipeline-action"
          @click="runCompactAction"
        >
          <span>{{ compactAction.label }}</span>
          <el-icon><ArrowRight /></el-icon>
        </button>
        <button
          type="button"
          class="pipeline-toggle"
          data-testid="film-pipeline-toggle"
          :aria-expanded="expanded"
          aria-controls="film-pipeline-details"
          @click="toggle"
        >
          {{ expanded ? '收起' : '展开' }}
          <el-icon><ArrowUp v-if="expanded" /><ArrowDown v-else /></el-icon>
        </button>
      </div>
    </div>

    <div
      id="film-pipeline-details"
      v-show="expanded"
      class="pipeline-details"
      data-testid="film-pipeline-details"
    >
    <div class="pipeline-toolbar">
      <div class="pipeline-utility-actions">
        <el-popover placement="bottom-start" :width="390" trigger="click">
          <template #reference>
            <el-button plain>
              <el-icon><Setting /></el-icon>
              生成设置
            </el-button>
          </template>
          <div class="pipeline-settings">
            <label class="pipeline-setting">
              <span>画面比例</span>
              <el-select
                :model-value="aspectRatio"
                @update:model-value="updateSetting('aspectRatio', $event)"
              >
                <el-option label="16:9 横屏" value="16:9" />
                <el-option label="9:16 竖屏" value="9:16" />
                <el-option label="3:4 竖版" value="3:4" />
                <el-option label="1:1 方形" value="1:1" />
                <el-option label="4:3" value="4:3" />
                <el-option label="21:9 宽银幕" value="21:9" />
              </el-select>
            </label>
            <label class="pipeline-setting">
              <span>单镜时长</span>
              <el-select
                :model-value="clipDuration"
                @update:model-value="updateSetting('clipDuration', $event)"
              >
                <el-option label="4 秒" :value="4" />
                <el-option label="5 秒" :value="5" />
                <el-option label="8 秒" :value="8" />
                <el-option label="10 秒" :value="10" />
                <el-option label="12 秒" :value="12" />
                <el-option label="15 秒" :value="15" />
              </el-select>
            </label>
            <label class="pipeline-setting">
              <span>分镜语言</span>
              <el-select
                :model-value="scriptLanguage"
                clearable
                @update:model-value="updateSetting('scriptLanguage', $event)"
              >
                <el-option label="中文" value="zh" />
                <el-option label="英文" value="en" />
              </el-select>
            </label>
            <label class="pipeline-setting pipeline-setting-wide">
              <span>生成风格</span>
              <StylePickerButton
                :model-value="generationStyle"
                :options="generationStyleOptions"
                @update:model-value="$emit('update:generationStyle', $event)"
                @change="$emit('save-settings', true)"
              />
            </label>
          </div>
        </el-popover>
      </div>
    </div>

    <div class="pipeline-focus" :data-state="focusState">
      <div v-if="focusReason" class="pipeline-focus-copy">
        <p v-if="!longFocusReason" class="pipeline-focus-reason" role="alert">{{ focusReason }}</p>
        <details v-if="longFocusReason" class="pipeline-reason-details" role="alert">
          <summary>
            <span class="pipeline-reason-preview">{{ focusReason }}</span>
            <span class="pipeline-reason-toggle">
              <span class="when-closed">查看完整原因</span>
              <span class="when-open">收起原因</span>
            </span>
          </summary>
          <p class="pipeline-reason-full">{{ focusReason }}</p>
        </details>
      </div>

      <div class="pipeline-actions">
        <div class="pipeline-mode-action">
          <span class="pipeline-mode-label is-production">完整成片</span>
          <ActionGate label="一键生成成片" :reason="productionReason">
            <el-button
              type="primary"
              :loading="running && !paused"
              :disabled="Boolean(productionReason)"
              @click="$emit('start-one-click')"
            >
              一键生成成片
            </el-button>
          </ActionGate>
        </div>
        <div class="pipeline-mode-action">
          <span class="pipeline-mode-label is-draft">草稿预演</span>
          <ActionGate label="仅生成文本框架" :reason="draftReason">
            <el-button
              :loading="running && !paused"
              :disabled="Boolean(draftReason)"
              @click="$emit('start-text-framework')"
            >
              仅生成文本框架
            </el-button>
          </ActionGate>
        </div>
        <el-button
          v-if="showReadinessAction"
          link
          type="primary"
          class="pipeline-config-action"
          @click="$emit('open-ai-config', productionReadinessServiceType)"
        >前往 AI 配置</el-button>
        <el-button
          v-if="showReadinessRetry"
          plain
          type="primary"
          class="pipeline-config-action"
          @click="$emit('retry-readiness')"
        >重试检查</el-button>
        <template v-if="running">
          <el-button v-if="!paused" type="warning" @click="$emit('pause')">暂停</el-button>
          <el-button v-else type="success" @click="$emit('resume')">继续</el-button>
        </template>
      </div>
    </div>

    <div v-if="running || errorLog.length > 0" class="pipeline-status" aria-live="polite">
      <div v-if="currentStep" class="pipeline-current-step">
        <span v-if="stepIndex > 0" class="pipeline-step-badge">{{ stepIndex }}/{{ stepTotal }}</span>
        {{ cleanCurrentStep }}
      </div>
      <div v-if="countdown > 0" class="pipeline-countdown">
        <div class="pipeline-countdown-ring" aria-hidden="true">
          <span class="pipeline-countdown-num">{{ countdown }}</span>
          <span class="pipeline-countdown-unit">秒</span>
        </div>
        <div class="pipeline-countdown-body">
          <p class="pipeline-countdown-msg">{{ countdownMessage }}</p>
          <div class="pipeline-countdown-actions">
            <el-button size="small" type="success" @click="$emit('skip-countdown')">立即开始下一阶段</el-button>
            <el-button v-if="!paused" size="small" type="warning" @click="$emit('pause')">暂停倒计时</el-button>
            <span v-else class="pipeline-countdown-paused">已暂停，点击“继续”恢复</span>
          </div>
        </div>
      </div>
      <div v-if="activeTaskLabels.length > 0" class="pipeline-active-tasks" aria-label="执行中的任务">
        <span v-for="label in activeTaskLabels" :key="label" class="pipeline-task-chip">
          <span class="pipeline-task-dot" />{{ label }}
        </span>
      </div>
      <div v-if="errorLog.length > 0" class="pipeline-error-log" role="alert">
        <div class="pipeline-error-title">执行过程中的错误</div>
        <div v-for="(entry, index) in errorLog" :key="index" class="pipeline-error-line">
          [{{ entry.step }}] {{ entry.message }}
        </div>
      </div>
    </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { ArrowDown, ArrowRight, ArrowUp, Setting, VideoPlay } from '@element-plus/icons-vue'
import StylePickerButton from '@/components/StylePickerButton.vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import { useDisclosureState } from '@/composables/useDisclosureState'
import { getPipelineCompactAction } from '@/utils/filmPipelineAction'

const props = defineProps({
  aspectRatio: { type: String, default: '16:9' },
  clipDuration: { type: Number, default: 5 },
  scriptLanguage: { type: String, default: '' },
  generationStyle: { type: String, default: '' },
  generationStyleOptions: { type: Array, default: () => [] },
  disabledReason: { type: String, default: '' },
  productionDisabledReason: { type: String, default: '' },
  draftDisabledReason: { type: String, default: '' },
  productionReadinessReason: { type: String, default: '' },
  productionReadinessState: { type: String, default: 'ready' },
  productionReadinessServiceType: { type: String, default: '' },
  running: { type: Boolean, default: false },
  paused: { type: Boolean, default: false },
  errorLog: { type: Array, default: () => [] },
  currentStep: { type: String, default: '' },
  stepIndex: { type: Number, default: 0 },
  stepTotal: { type: Number, default: 0 },
  countdown: { type: Number, default: 0 },
  countdownMessage: { type: String, default: '' },
  activeTasks: { type: [Array, Set], default: () => [] },
})

const { expanded, toggle } = useDisclosureState({
  forceExpanded: computed(() => props.running),
})

const emit = defineEmits([
  'update:aspectRatio',
  'update:clipDuration',
  'update:scriptLanguage',
  'update:generationStyle',
  'save-settings',
  'start-one-click',
  'start-text-framework',
  'open-ai-config',
  'retry-readiness',
  'pause',
  'resume',
  'skip-countdown',
])

const activeTaskLabels = computed(() => Array.from(props.activeTasks || []))
const cleanCurrentStep = computed(() => props.currentStep.replace(/^\[步骤 \d+\/\d+\] /, ''))
const productionReason = computed(() => props.productionDisabledReason || props.disabledReason)
const draftReason = computed(() => props.draftDisabledReason || props.disabledReason)
const focusReason = computed(() => props.running ? '' : productionReason.value)
const longFocusReason = computed(() => focusReason.value.length > 56)
const focusState = computed(() => {
  if (props.running) return props.paused ? 'paused' : 'running'
  if (!draftReason.value && props.productionReadinessState === 'checking') return 'checking'
  if (!draftReason.value && props.productionReadinessState === 'error') return 'error'
  return focusReason.value ? 'blocked' : 'ready'
})
const focusKicker = computed(() => {
  if (!draftReason.value && props.productionReadinessState === 'checking') return '能力检查'
  if (!draftReason.value && props.productionReadinessState === 'error') return '检查失败'
  return focusReason.value ? '当前阻断' : '当前任务'
})
const focusTitle = computed(() => {
  if (props.running) {
    return cleanCurrentStep.value || (props.paused ? '全流程生成已暂停' : '正在执行全流程生成')
  }
  if (!draftReason.value && props.productionReadinessState === 'checking') return '正在检查完整成片能力'
  if (!draftReason.value && props.productionReadinessState === 'error') return '完整成片能力检查失败'
  return focusReason.value ? '完整成片暂不可生成' : '完整成片已可生成'
})
const focusNextStep = computed(() => {
  if (props.running) return props.paused ? '继续当前生成流程' : '等待当前阶段完成'
  if (draftReason.value) return '处理当前阻断后再启动生成'
  if (props.productionReadinessState === 'checking') return '等待检查完成'
  if (props.productionReadinessState === 'error') return '重试检查，确认本地服务与配置状态'
  if (props.productionReadinessState === 'missing') return '前往 AI 配置补齐完整成片能力'
  return '一键生成完整成片'
})
const showReadinessAction = computed(() => (
  !props.running
  && !draftReason.value
  && props.productionReadinessState === 'missing'
))
const showReadinessRetry = computed(() => (
  !props.running
  && !draftReason.value
  && props.productionReadinessState === 'error'
))
const compactAction = computed(() => getPipelineCompactAction({
  readinessState: props.productionReadinessState,
  serviceType: props.productionReadinessServiceType,
  running: props.running,
  paused: props.paused,
  draftReason: draftReason.value,
  productionReason: productionReason.value,
}))

function runCompactAction() {
  const action = compactAction.value
  if (!action) return
  if (action.event === 'open-ai-config') emit(action.event, action.payload)
  else emit(action.event)
}

function updateSetting(name, value) {
  emit(`update:${name}`, value)
  emit('save-settings', false)
}
</script>

<style scoped>
.pipeline-section {
  padding: 14px 16px;
}

.pipeline-disclosure-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.pipeline-compact-copy {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(180px, auto);
  align-items: baseline;
  min-width: 0;
  gap: 6px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.pipeline-compact-copy strong,
.pipeline-compact-copy > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pipeline-compact-copy strong {
  color: var(--el-text-color-primary);
  font-size: 13px;
}

.pipeline-compact-next {
  display: inline-flex;
  gap: 6px;
}

.pipeline-compact-next > span {
  color: var(--el-color-primary);
  font-weight: 600;
}

.pipeline-compact-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
}

.pipeline-compact-action,
.pipeline-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.pipeline-compact-action {
  max-width: 160px;
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: var(--el-color-white);
  white-space: nowrap;
}

.pipeline-compact-action:hover {
  border-color: var(--el-color-primary-dark-2);
  background: var(--el-color-primary-dark-2);
}

.pipeline-toggle:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.pipeline-compact-action:focus-visible,
.pipeline-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.pipeline-details {
  margin-top: 12px;
}

.pipeline-toolbar,
.pipeline-actions,
.pipeline-utility-actions,
.pipeline-heading {
  display: flex;
  align-items: center;
}

.pipeline-toolbar {
  justify-content: flex-end;
  gap: 16px;
  margin-bottom: 10px;
}

.pipeline-heading {
  gap: 7px;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}

.pipeline-title {
  margin: 0;
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: 0;
}

.pipeline-actions {
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
}

.pipeline-utility-actions {
  justify-content: flex-end;
}

.pipeline-focus {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 16px 20px;
  padding: 12px 14px;
  border-left: 3px solid var(--el-color-primary);
  background: var(--el-fill-color-light);
}

.pipeline-focus[data-state="blocked"] {
  border-left-color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.pipeline-focus[data-state="checking"] {
  border-left-color: var(--el-color-info);
}

.pipeline-focus[data-state="error"] {
  border-left-color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.pipeline-focus[data-state="running"],
.pipeline-focus[data-state="paused"] {
  border-left-color: var(--el-color-success);
}

.pipeline-focus-copy {
  display: grid;
  flex: 1 1 360px;
  min-width: 0;
  gap: 4px;
}

.pipeline-focus-reason,
.pipeline-reason-full {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.pipeline-reason-details {
  min-width: 0;
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.pipeline-reason-details summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
  cursor: pointer;
  list-style: none;
}

.pipeline-reason-details summary::-webkit-details-marker {
  display: none;
}

.pipeline-reason-preview {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.pipeline-reason-toggle {
  color: var(--el-color-primary);
  white-space: nowrap;
}

.pipeline-reason-details .when-open,
.pipeline-reason-details[open] .when-closed,
.pipeline-reason-details[open] .pipeline-reason-preview {
  display: none;
}

.pipeline-reason-details[open] .when-open {
  display: inline;
}

.pipeline-reason-details[open] summary {
  grid-template-columns: 1fr auto;
}

.pipeline-reason-full {
  max-height: 120px;
  margin-top: 6px;
  padding-right: 4px;
  overflow-y: auto;
}

.pipeline-config-action {
  align-self: center;
}

.pipeline-mode-action {
  display: inline-grid;
  gap: 4px;
  justify-items: stretch;
}

.pipeline-mode-label {
  color: var(--el-text-color-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  text-align: center;
}

.pipeline-mode-label.is-production {
  color: var(--el-color-danger);
}

.pipeline-mode-label.is-draft {
  color: var(--el-color-info);
}

.pipeline-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.pipeline-setting {
  display: grid;
  gap: 6px;
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.pipeline-setting-wide {
  grid-column: 1 / -1;
}

.pipeline-setting-wide :deep(.style-picker-wrap),
.pipeline-setting-wide :deep(.style-picker-trigger) {
  width: 100%;
}

.pipeline-status {
  margin-top: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-size: 13px;
}

.pipeline-current-step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.pipeline-step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

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
