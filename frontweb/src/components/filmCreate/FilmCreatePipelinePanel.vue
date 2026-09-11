<template>
  <section class="section card pipeline-section" aria-labelledby="pipeline-title">
    <div class="pipeline-disclosure-head">
      <div class="pipeline-heading">
        <el-icon><VideoPlay /></el-icon>
        <h2 id="pipeline-title" class="pipeline-title">全流程生成</h2>
      </div>
      <div
        ref="summaryRef"
        class="pipeline-compact-copy"
        data-testid="film-pipeline-summary"
        :data-state="focusState"
        tabindex="-1"
      >
        <span>{{ focusKicker }}</span>
        <strong>{{ focusTitle }}</strong>
        <span class="pipeline-compact-next"><span>下一步</span>{{ focusNextStep }}</span>
      </div>
      <div class="pipeline-compact-actions">
        <span v-if="compactAction" class="pipeline-compact-gate">
          <ActionGate
            :reason="compactActionDisabledReason"
            :label="compactAction.label"
          >
            <button
              type="button"
              class="pipeline-compact-action"
              data-testid="film-pipeline-action"
              :disabled="starting || stopping || Boolean(compactActionDisabledReason)"
              :title="compactActionDisabledReason || undefined"
              :aria-label="compactActionAriaLabel"
              @click="runCompactAction(compactAction)"
            >
              <span>{{ compactAction.label }}</span>
              <el-icon><ArrowRight /></el-icon>
            </button>
          </ActionGate>
        </span>
        <span v-if="compactSecondaryAction" class="pipeline-compact-gate">
          <ActionGate
            :reason="compactDisabledReason"
            :label="compactSecondaryAction.label"
          >
            <button
              type="button"
              class="pipeline-compact-action is-secondary"
              data-testid="film-pipeline-secondary-action"
              :disabled="starting || stopping || Boolean(compactDisabledReason)"
              :title="compactDisabledReason || undefined"
              :aria-label="compactSecondaryActionAriaLabel"
              @click="runCompactAction(compactSecondaryAction)"
            >
              <span>{{ compactSecondaryAction.label }}</span>
            </button>
          </ActionGate>
        </span>
        <button
          type="button"
          class="pipeline-toggle"
          data-testid="film-pipeline-toggle"
          :title="expanded ? '收起全流程详情' : '展开全流程详情'"
          :aria-label="expanded ? '收起全流程详情' : '展开全流程详情'"
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
            <el-button plain aria-label="全流程生成设置" title="全流程生成设置">
              <el-icon><Setting /></el-icon>
              生成设置
            </el-button>
          </template>
          <div class="pipeline-settings">
            <label class="pipeline-setting">
              <span>画面比例</span>
              <el-select
                :model-value="aspectRatio"
                aria-label="生成设置：画面比例"
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
                aria-label="生成设置：单镜时长"
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
                aria-label="生成设置：分镜语言"
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

      <FilmCreatePipelineActions
        v-bind="actionPanelProps"
        @start-one-click="$emit('start-one-click')"
        @start-text-framework="$emit('start-text-framework')"
        @open-ai-config="$emit('open-ai-config', $event)"
        @retry-readiness="$emit('retry-readiness')"
        @pause="$emit('pause')"
        @resume="$emit('resume')"
        @cancel="$emit('cancel')"
      />
    </div>

    <div v-if="running || errorLog.length > 0" class="pipeline-status" aria-live="polite">
      <FilmCreatePipelineSteps v-bind="stepsPanelProps" />
      <FilmCreatePipelineStatus
        v-bind="statusPanelProps"
        @skip-countdown="$emit('skip-countdown')"
        @pause="$emit('pause')"
        @start-one-click="$emit('start-one-click')"
      />
    </div>
    <div v-else-if="hasEpisode === false" class="pipeline-empty" role="status" data-testid="film-pipeline-empty">
      <p>{{ emptyGuidanceText }}</p>
      <el-button
        type="primary"
        data-testid="film-pipeline-empty-action"
        :aria-label="emptyActionAriaLabel"
        @click="$emit('add-episode')"
      >{{ emptyActionLabel }}</el-button>
    </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ArrowDown, ArrowRight, ArrowUp, Setting, VideoPlay } from '@element-plus/icons-vue'
import StylePickerButton from '@/components/StylePickerButton.vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import FilmCreatePipelineActions from './FilmCreatePipelineActions.vue'
import FilmCreatePipelineSteps from './FilmCreatePipelineSteps.vue'
import FilmCreatePipelineStatus from './FilmCreatePipelineStatus.vue'
import { useDisclosureState } from '@/composables/useDisclosureState'
import { createFilmCreatePipelinePanelBindings } from '@/components/filmCreate/filmCreatePipelinePanelBindings'

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
  hasEpisode: { type: Boolean, default: true },
  starting: { type: Boolean, default: false },
  stopping: { type: Boolean, default: false },
  stopRequired: { type: Boolean, default: false },
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
  forceExpanded: computed(() => props.running || props.errorLog.length > 0),
})
const summaryRef = ref(null)

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
  'cancel',
  'skip-countdown',
  'add-episode',
])

const {
  compactDisabledReason,
  emptyGuidanceText,
  emptyActionLabel,
  emptyActionAriaLabel,
  focusReason,
  longFocusReason,
  focusState,
  focusKicker,
  focusTitle,
  focusNextStep,
  compactAction,
  compactSecondaryAction,
  compactActionDisabledReason,
  compactActionAriaLabel,
  compactSecondaryActionAriaLabel,
  actionPanelProps,
  stepsPanelProps,
  statusPanelProps,
} = createFilmCreatePipelinePanelBindings(props)

function runCompactAction(action) {
  if (props.starting || props.stopping) return
  const next = action && typeof action.event === 'string' ? action : compactAction.value
  if (!next) return
  if (next.event === 'open-ai-config') emit(next.event, next.payload, { source: 'compact-action' })
  else emit(next.event)
}

function focusSummary() {
  summaryRef.value?.focus({ preventScroll: true })
}

defineExpose({
  focusSummary,
})

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

.pipeline-compact-copy strong {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pipeline-compact-copy:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.pipeline-compact-next {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
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

.pipeline-compact-gate {
  display: inline-flex;
  max-width: 220px;
}
.pipeline-compact-actions :deep(.action-gate-reason) {
  display: none;
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
.pipeline-compact-action:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.pipeline-compact-action:hover {
  border-color: var(--el-color-primary-dark-2);
  background: var(--el-color-primary-dark-2);
}

.pipeline-compact-action.is-secondary {
  border-color: var(--el-border-color);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
}
.pipeline-compact-action.is-secondary:hover {
  border-color: var(--el-color-primary);
  background: var(--el-fill-color-blank);
  color: var(--el-color-primary);
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

.pipeline-focus[data-state="stopped"] {
  border-left-color: var(--el-color-info);
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

.pipeline-empty {
  display: grid;
  gap: 12px;
  justify-items: start;
  margin: 12px 0 0;
  color: var(--film-empty-copy, var(--el-text-color-secondary));
  font-size: 13px;
  line-height: 1.6;
}

.pipeline-empty p {
  margin: 0;
  max-width: 36em;
}

.pipeline-empty :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}

</style>
