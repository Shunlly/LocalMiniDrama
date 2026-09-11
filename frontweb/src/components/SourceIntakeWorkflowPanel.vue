<template>
  <section id="source-intake-workflow" class="source-workflow-section" tabindex="-1">
    <div class="section-head">
      <div>
        <div class="section-title">故事素材流程</div>
        <div class="section-subtitle">素材导入 / 制作流程 / 质量检查 / 时间线</div>
      </div>
      <div class="head-actions">
        <ActionGate label="刷新" :reason="refreshBusyReason">
          <el-button size="small" :loading="loading" :disabled="Boolean(refreshBusyReason)" :aria-label="loading ? '正在刷新素材处理' : (refreshBusyReason || '刷新素材处理')" @click="loadData">
            {{ loading ? '正在刷新' : '刷新' }}
          </el-button>
        </ActionGate>
      </div>
    </div>

    <div v-if="compactCompletionVisible" data-testid="source-workflow-complete" class="source-workflow-complete">
      <SourceIntakeCompletionBanner
        v-bind="completionBannerBindings"
        @enter-production="$emit('enter-production')"
        @focus-episode-list="$emit('focus-episode-list')"
      />
    </div>

    <div
      id="source-workflow-history"
      v-show="!compactCompletionVisible || workflowHistoryExpanded"
    >
    <SourceIntakeStepper
      v-bind="stepperBindings"
      @select="selectFlowStep"
    />

    <div
      v-if="workflowDataError"
      class="workflow-status-banner workflow-status-banner--error"
      role="alert"
      aria-live="assertive"
    >
      <span>{{ workflowDataError }}</span>
      <el-button size="small" type="primary" plain :loading="loading" :aria-label="loading ? '正在加载素材处理' : '重试加载素材处理'" @click="loadData">
        重试
      </el-button>
    </div>

    <div class="workflow-focus">
      <SourceIntakeCurrentStageCard v-bind="currentStageBindings" />

      <div class="workflow-stage-card">
        <SourceIntakeLaunchModeCard
          v-if="inspectedFlowStep.id === 'intake' || inspectedFlowStep.id === 'process'"
          v-bind="launchModeBindings"
          @change="handleWorkflowModeChange"
          @open-ai-config="openAiConfigForReadiness"
        />

        <template v-if="inspectedFlowStep.id === 'intake'">
          <div class="intake-stage-layout">
            <SourceIntakeIntakeStageForm
              ref="intakeStageFormRef"
              v-model="form"
              v-bind="intakeFormBindings"
              :source-file-accept="SOURCE_FILE_ACCEPT"
              @source-file-change="handleSourceFile"
              @clear-selected-file="clearSelectedFile"
              @refresh-imported-sources="refreshImportedSources"
              @import-source="importSourceOnly"
              @start-workflow="startWorkflow"
              @open-extraction-ai-config="openAiConfigForExtraction"
            />

            <div class="status-block source-records-block">
              <div class="block-head">
                <span>已导入素材</span>
                <span class="count">{{ sources.length }}</span>
              </div>
              <div v-if="flowState.sourceEmptyState" class="empty-stage-state">
                <strong>{{ flowState.sourceEmptyState.title }}</strong>
                <p>{{ flowState.sourceEmptyState.description }}</p>
                <p class="empty-stage-hint">可用上方「导入故事素材」或「导入并启动{{ workflowModeShortLabel }}」保存后，记录会显示在这里。</p>
              </div>
              <div v-else class="mini-list">
                <div v-for="source in sources" :key="source.id" class="mini-item">
                  <span class="source-record-identity">
                    <button class="link-button" :aria-label="`查看素材详情`" @click="openSourceDetail(source)">
                      {{ source.title || sourceTypeLabel(source.source_type) }}
                    </button>
                    <small v-if="sourceProvenanceLabel(source)">{{ sourceProvenanceLabel(source) }}</small>
                  </span>
                  <span class="mini-actions">
                    <el-tag size="small" effect="plain">{{ sourceTypeLabel(source.source_type) }}</el-tag>
                    <ActionGate :label="`以 ${workflowModeShortLabel} 启动`" :reason="existingSourceLaunchReason">
                      <el-button
                        size="small"
                        link
                        type="primary"
                        :loading="startingSourceId === source.id"
                        :disabled="Boolean(existingSourceLaunchReason)"
                        :aria-label="startingSourceId === source.id ? '正在启动' : (existingSourceLaunchReason || '以当前模式启动')" @click="startExistingSource(source)"
                      >
                        以 {{ workflowModeShortLabel }} 启动
                      </el-button>
                    </ActionGate>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="inspectedFlowStep.id === 'process'">
          <SourceIntakeProcessStageCard
            v-bind="processStageBindings"
            @retry="retryRun"
            @pause="pauseRun"
            @resume="resumeRun"
            @cancel="cancelRun"
            @restart-latest="startExistingSource"
            @start-existing="startExistingSource"
            @select-step="selectFlowStep"
            @open-extraction-ai-config="openAiConfigForExtraction"
          >
            <template #status>
              <div
                v-if="pollStatusMessage"
                class="poll-status-banner"
                :class="{ 'is-error': pollState === 'error' }"
                :role="pollState === 'error' ? 'alert' : 'status'"
                aria-live="polite"
              >
                <span>{{ pollStatusMessage }}</span>
                <el-button
                  v-if="pollState === 'error' || pollState === 'recovering'"
                  size="small"
                  type="primary"
                  link
                  :loading="pollState === 'recovering'"
                  :aria-label="pollState === 'recovering' ? '正在恢复轮询' : '恢复轮询'" @click="resumePolling"
                >
                  恢复轮询
                </el-button>
              </div>
            </template>
          </SourceIntakeProcessStageCard>
        </template>

        <template v-else-if="inspectedFlowStep.id === 'qa'">
          <SourceIntakeQaStageCard
            v-bind="qaStageBindings"
            @run-qa="runQaAudit"
          />
        </template>

        <template v-else-if="inspectedFlowStep.id === 'remediation'">
          <SourceIntakeRemediationStageCard
            v-bind="remediationStageBindings"
            @remediate="remediateQa"
            @select-step="selectFlowStep"
          />
        </template>

        <template v-else>
          <SourceIntakeDeliveryStageCard
            v-bind="deliveryStageBindings"
            @select-step="selectFlowStep"
          />
        </template>
      </div>
    </div>
    </div>

    <SourceIntakeSourceDetailDrawer
      v-bind="sourceDetailBindings"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import SourceIntakeCompletionBanner from '@/components/sourceIntake/SourceIntakeCompletionBanner.vue'
import SourceIntakeCurrentStageCard from '@/components/sourceIntake/SourceIntakeCurrentStageCard.vue'
import SourceIntakeDeliveryStageCard from '@/components/sourceIntake/SourceIntakeDeliveryStageCard.vue'
import SourceIntakeIntakeStageForm from '@/components/sourceIntake/SourceIntakeIntakeStageForm.vue'
import SourceIntakeLaunchModeCard from '@/components/sourceIntake/SourceIntakeLaunchModeCard.vue'
import SourceIntakeProcessStageCard from '@/components/sourceIntake/SourceIntakeProcessStageCard.vue'
import SourceIntakeQaStageCard from '@/components/sourceIntake/SourceIntakeQaStageCard.vue'
import SourceIntakeRemediationStageCard from '@/components/sourceIntake/SourceIntakeRemediationStageCard.vue'
import SourceIntakeSourceDetailDrawer from '@/components/sourceIntake/SourceIntakeSourceDetailDrawer.vue'
import SourceIntakeStepper from '@/components/sourceIntake/SourceIntakeStepper.vue'
import { createSourceIntakeFileSelectController, SOURCE_FILE_ACCEPT } from '@/components/sourceIntake/sourceIntakeFileSelect.js'
import { createSourceIntakeFlowStepController } from '@/components/sourceIntake/sourceIntakeFlowSteps.js'
import { createSourceIntakeImportActions } from '@/components/sourceIntake/sourceIntakeImportActions.js'
import { createSourceIntakeLaunchController } from '@/components/sourceIntake/sourceIntakeLaunchActions.js'
import { createSourceIntakeLeaveController } from '@/components/sourceIntake/sourceIntakeLeaveGuard.js'
import { createSourceIntakeMessageHelpers } from '@/components/sourceIntake/sourceIntakeMessages.js'
import { createSourceIntakePollSession } from '@/components/sourceIntake/sourceIntakePoll.js'
import { createSourceIntakeQaActions } from '@/components/sourceIntake/sourceIntakeQaActions.js'
import { createSourceIntakeRunControls } from '@/components/sourceIntake/sourceIntakeRunControls.js'
import { createSourceIntakeDataActions, createSourceIntakeSnapshotSession } from '@/components/sourceIntake/sourceIntakeSnapshot.js'
import {
  bindSourceIntakeWorkspaceWatches,
  createSourceIntakeWorkspaceBindings,
  createSourceIntakeWorkspaceComputeds,
} from '@/components/sourceIntake/sourceIntakeWorkspaceBindings.js'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import { sourceIntakeAPI as rawSourceIntakeAPI } from '@/api/sourceIntake'
import { workflowRunsAPI as rawWorkflowRunsAPI } from '@/api/workflowRuns'
import { qaReportsAPI as rawQaReportsAPI } from '@/api/qaReports'
import { timelinesAPI as rawTimelinesAPI } from '@/api/timelines'
import {
  sourceProvenanceLabel,
  sourceTypeLabel,
} from '@/utils/sourceIntakeAdapter'
import {
  SOURCE_WORKFLOW_REFRESH_UNCONFIRMED_MESSAGE,
  assertSourceWorkflowLifecycleActive,
  createSourceImportController,
  createSourceWorkflowSnapshotController,
  createSourceWorkflowLifecycleGuard,
  extractCreatedStorySource,
  shouldIgnoreSourceWorkflowPollError,
} from '@/utils/sourceImportOutcome'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import {
  SOURCE_WORKFLOW_CANCEL_REASON,
  SOURCE_WORKFLOW_PAUSE_REASON,
} from '@/utils/sourceWorkflowState'
import {
  DEFAULT_WORKFLOW_MODE,
  normalizeProductionReadiness,
} from '@/utils/sourceWorkflowLaunch'
import { projectRouteInstanceKey } from '@/utils/projectListRoute'

const props = defineProps({
  dramaId: { type: Number, required: true },
  drama: { type: Object, default: null },
  sourceImportIntent: { type: Boolean, default: false },
})

const emit = defineEmits(['refresh', 'enter-production', 'focus-episode-list'])
const route = useRoute()
const router = useRouter()
const sourceWorkflowLifecycle = createSourceWorkflowLifecycleGuard()
const sourceIntakeAPI = sourceWorkflowLifecycle.guardApi(rawSourceIntakeAPI)
const workflowRunsAPI = sourceWorkflowLifecycle.guardApi(rawWorkflowRunsAPI)
const qaReportsAPI = sourceWorkflowLifecycle.guardApi(rawQaReportsAPI)
const timelinesAPI = sourceWorkflowLifecycle.guardApi(rawTimelinesAPI)

const form = reactive({
  title: '',
  source_type: '',
  target_episode_count: 1,
  source_url: '',
  text: '',
})

const intakeStageFormRef = ref(null)
const sourceUrlInput = computed(() => intakeStageFormRef.value?.sourceUrlInput ?? null)
const sourceFileInput = computed(() => intakeStageFormRef.value?.sourceFileInput ?? null)
const sourceFile = ref(null)
const selectedFilename = ref('')
const sourceFileReading = ref(false)
const sourceOperationMessage = ref('')
const sourceOperationError = ref('')
const sourceListRefreshError = ref('')
const sourceListRefreshing = ref(false)
const workflowDataError = ref('')
const workflowHistoryExpanded = ref(false)
const workflowMode = ref(DEFAULT_WORKFLOW_MODE)
const productionReadiness = ref(null)
const readinessChecking = ref(false)
const startingSourceId = ref(null)
const loading = ref(false)
const sourceSaving = ref(false)
const workflowStarting = ref(false)
const qaRunning = ref(false)
const remediating = ref(false)
const retrying = ref(false)
const pausing = ref(false)
const resuming = ref(false)
const cancelling = ref(false)
const sources = ref([])
const runs = ref([])
const reports = ref([])
const selectedRun = ref(null)
const selectedFlowStepId = ref('')
const timeline = ref(null)
const remediationStatus = ref('')
const sourceDetailVisible = ref(false)
const sourceDetailLoading = ref(false)
const sourceDetail = ref(null)
const pollState = ref('idle')
const pollError = ref('')
const workspaceComputeds = createSourceIntakeWorkspaceComputeds({
  form,
  sourceFile,
  selectedFilename,
  sourceFileReading,
  sourceSaving,
  sourceListRefreshing,
  workflowStarting,
  readinessChecking,
  retrying,
  pausing,
  resuming,
  cancelling,
  loading,
  qaRunning,
  remediating,
  pollState,
  pollError,
  sourceOperationError,
  sourceListRefreshError,
  workflowDataError,
  sourceOperationMessage,
  workflowMode,
  productionReadiness,
  selectedRun,
  reports,
  timeline,
  sources,
  selectedFlowStepId,
  getDrama: () => props.drama,
})
const {
  rawSourceUrl,
  sourceUrlValidationMessage,
  hasWebSourceUrl,
  hasUnsavedSourceInput,
  isWorkflowLaunchBusy,
  sourceOperationActive,
  workflowActionBusy,
  workflowModeShortLabel,
  runState,
  newWorkflowRunReason,
  latestQa,
  actionReasons,
  controlActionReasons,
  existingSourceLaunchReason,
  refreshBusyReason,
  flowState,
  compactCompletionVisible,
  inspectedFlowStep,
  pollStatusMessage,
} = workspaceComputeds
const {
  completionBannerBindings,
  stepperBindings,
  currentStageBindings,
  launchModeBindings,
  intakeFormBindings,
  processStageBindings,
  qaStageBindings,
  remediationStageBindings,
  deliveryStageBindings,
  sourceDetailBindings,
} = createSourceIntakeWorkspaceBindings({
  ...workspaceComputeds,
  workflowHistoryExpanded,
  workflowMode,
  readinessChecking,
  productionReadiness,
  sourceFileReading,
  sourceFile,
  selectedFilename,
  sourceOperationError,
  sourceListRefreshError,
  sourceListRefreshing,
  sourceSaving,
  workflowStarting,
  startingSourceId,
  selectedRun,
  retrying,
  pausing,
  resuming,
  cancelling,
  sources,
  qaRunning,
  remediating,
  remediationStatus,
  sourceDetailVisible,
  sourceDetailLoading,
  sourceDetail,
  getDrama: () => props.drama,
})

const { showWorkflowMessage, sourceIntakeFailureMessage, emitRefresh } = createSourceIntakeMessageHelpers({
  lifecycle: sourceWorkflowLifecycle,
  emit,
  getFailureContext: () => ({
    file: sourceFile.value,
    filename: selectedFilename.value,
    sourceUrl: rawSourceUrl.value,
  }),
})

const {
  requestedFlowStepFromRoute,
  persistInspectedFlowStep,
  revealInspectedHistoryIfNeeded,
  selectFlowStep,
  checkProductionReadiness,
  handleWorkflowModeChange,
  captureProductionReadinessError,
  openAiConfigForReadiness,
  openAiConfigForExtraction,
  persistProcessStep,
} = createSourceIntakeFlowStepController({
  route,
  router,
  flowState,
  selectedFlowStepId,
  compactCompletionVisible,
  workflowHistoryExpanded,
  productionReadiness,
  sourceOperationError,
  sourceOperationMessage,
  workflowMode,
  form,
  getDramaId: () => props.dramaId,
  getDramaStyle: () => props.drama?.style || '',
  workflowRunsAPI,
  readinessChecking,
})

const snapshotBridge = {
  refreshWorkflowSnapshot: async () => ({ status: 'ignored' }),
}
const { stopPoll, startPoll, refreshSelectedRun, resumePolling } = createSourceIntakePollSession({
  sourceWorkflowLifecycle,
  isRunActive: () => runState.value.active,
  pollState,
  pollError,
  selectedRun,
  getRun: (runId) => workflowRunsAPI.get(runId),
  isUserFacingAbort,
  toUserFacingError,
  refreshWorkflowSnapshot: (...args) => snapshotBridge.refreshWorkflowSnapshot(...args),
  emitRefresh,
})

const snapshotSession = createSourceIntakeSnapshotSession({
  getDramaId: () => props.dramaId,
  getTargetEpisodeCount: () => form.target_episode_count,
  getStyle: () => props.drama?.style || '',
  sourceIntakeAPI,
  workflowRunsAPI,
  qaReportsAPI,
  timelinesAPI,
  normalizeProductionReadiness,
  createSnapshotController: createSourceWorkflowSnapshotController,
  isActive: () => sourceWorkflowLifecycle.isActive(),
  sources,
  runs,
  reports,
  productionReadiness,
  selectedRun,
  timeline,
  workflowDataError,
  startPoll,
})
const {
  refreshWorkflowSnapshot,
  refreshAndConfirmRun,
} = snapshotSession
snapshotBridge.refreshWorkflowSnapshot = refreshWorkflowSnapshot

const { clearSelectedFile, handleSourceFile } = createSourceIntakeFileSelectController({
  form,
  sourceFile,
  selectedFilename,
  sourceFileReading,
  sourceOperationMessage,
  sourceOperationError,
  sourceFileInput,
  showWorkflowMessage,
})

const importControllerRef = { current: null }
const {
  syncDefaults,
  resetSourceInput,
  createSourceFromForm,
  importSourceOnly,
  refreshImportedSources,
  openSourceImportIntent,
  openSourceDetail,
} = createSourceIntakeImportActions({
  rawSourceUrl,
  sourceUrlValidationMessage,
  sourceFile,
  sourceIntakeAPI,
  getDramaId: () => props.dramaId,
  form,
  getDrama: () => props.drama,
  hasWebSourceUrl: () => hasWebSourceUrl.value,
  clearSelectedFile,
  getImportController: () => importControllerRef.current,
  sourceSaving,
  isWorkflowLaunchBusy: () => isWorkflowLaunchBusy.value,
  getSelectedFilename: () => selectedFilename.value,
  sourceListRefreshing,
  sourceFileReading,
  workflowHistoryExpanded,
  selectedFlowStepId,
  sourceUrlInput,
  nextTickFn: nextTick,
  persistInspectedFlowStep,
  sourceDetailVisible,
  sourceDetailLoading,
  sourceDetail,
  isLifecycleActive: () => sourceWorkflowLifecycle.isActive(),
  showWorkflowMessage,
  isUserFacingAbort,
  toUserFacingError,
})

const sourceImportController = createSourceImportController({
  createSource: async () => extractCreatedStorySource(await createSourceFromForm()),
  fetchSources: () => refreshWorkflowSnapshot(),
  applySources: () => {},
  confirmCreated: (source, snapshot) => snapshot?.sources?.some(
    (item) => String(item?.id) === String(source?.id),
  ),
  clearInput: () => resetSourceInput(),
  onImportStarted: () => {
    sourceOperationMessage.value = ''
    sourceOperationError.value = ''
  },
  onCreated: (_source, context) => {
    const uploadedFilename = context?.uploadedFilename
    sourceOperationMessage.value = uploadedFilename ? `${uploadedFilename} 上传解析完成。` : '素材已导入。'
    showWorkflowMessage('success', '素材已导入')
  },
  onCreateFailed: (error) => {
    const message = sourceIntakeFailureMessage(error, '导入失败')
    if (!message) return
    sourceOperationError.value = message
    showWorkflowMessage('error', message)
  },
  setRefreshAlert: (message) => { sourceListRefreshError.value = message },
  emitRefresh,
})
importControllerRef.current = sourceImportController

const { loadData, loadSources, markWorkflowRefreshUnconfirmed } = createSourceIntakeDataActions({
  getDramaId: () => props.dramaId,
  refreshWorkflowSnapshot,
  loading,
  workflowDataError,
  shouldIgnoreError(e) {
    return shouldIgnoreSourceWorkflowPollError(e, sourceWorkflowLifecycle) || isUserFacingAbort(e)
  },
  toUserFacingError,
  sourceImportController,
  refreshUnconfirmedMessage: SOURCE_WORKFLOW_REFRESH_UNCONFIRMED_MESSAGE,
  sourceOperationMessage,
})

const { startWorkflow, startExistingSource, runSourceEmptyStateAction } = createSourceIntakeLaunchController({
  isLaunchBusy: () => isWorkflowLaunchBusy.value,
  getBlockedReason: () => newWorkflowRunReason.value,
  getSelectedFilename: () => selectedFilename.value,
  getDramaId: () => props.dramaId,
  form,
  getDrama: () => props.drama,
  getWorkflowMode: () => workflowMode.value,
  checkReadiness: checkProductionReadiness,
  lifecycle: sourceWorkflowLifecycle,
  sourceFile,
  hasWebSourceUrl: () => hasWebSourceUrl.value,
  createSourceFromForm,
  startNovel2Anime: (payload) => workflowRunsAPI.startNovel2Anime(payload),
  resetSourceInput,
  refreshAndConfirmRun,
  markWorkflowRefreshUnconfirmed,
  persistProcessStep,
  showWorkflowMessage,
  emitRefresh,
  productionReadiness,
  loadSources,
  sourceOperationMessage,
  sourceOperationError,
  startingSourceId,
  workflowStarting,
  getWorkflowModeShortLabel: () => workflowModeShortLabel.value,
  isUserFacingAbort,
  toUserFacingError,
  sourceIntakeFailureMessage,
  assertSourceWorkflowLifecycleActive,
  importSourceOnly,
})

const { retryRun, pauseRun, resumeRun, cancelRun } = createSourceIntakeRunControls({
  selectedRun,
  isActionBusy: () => workflowActionBusy.value,
  getControlReasons: () => controlActionReasons.value,
  retrying,
  pausing,
  resuming,
  cancelling,
  retryRunApi: (runId) => workflowRunsAPI.retry(runId),
  pauseRunApi: (runId, reason) => workflowRunsAPI.pause(runId, reason),
  resumeRunApi: (runId) => workflowRunsAPI.resume(runId),
  cancelRunApi: (runId, reason) => workflowRunsAPI.cancel(runId, reason),
  cancelReason: SOURCE_WORKFLOW_CANCEL_REASON,
  pauseReason: SOURCE_WORKFLOW_PAUSE_REASON,
  isLifecycleActive: () => sourceWorkflowLifecycle.isActive(),
  refreshAndConfirmRun,
  markWorkflowRefreshUnconfirmed,
  persistProcessStep,
  showWorkflowMessage,
  emitRefresh,
  startPoll,
  stopPoll,
  captureProductionReadinessError,
  shouldIgnoreError: (error) => shouldIgnoreSourceWorkflowPollError(error, sourceWorkflowLifecycle),
  isUserFacingAbort,
  toUserFacingError,
})

const { runQaAudit, remediateQa } = createSourceIntakeQaActions({
  qaRunning,
  remediating,
  remediationStatus,
  getDramaId: () => props.dramaId,
  getSelectedRunId: () => selectedRun.value?.id,
  getRunMode: () => runState.value.mode,
  getLatestQa: () => latestQa.value,
  getRemediateReason: () => actionReasons.value.remediate,
  getRemediatePayload: () => ({
    target_episode_count: form.target_episode_count,
    style: props.drama?.style || '',
  }),
  auditQa: (payload) => qaReportsAPI.audit(payload),
  remediateQaApi: (reportId, payload) => qaReportsAPI.remediate(reportId, payload),
  isLifecycleActive: () => sourceWorkflowLifecycle.isActive(),
  refreshWorkflowSnapshot,
  refreshAndConfirmRun,
  markWorkflowRefreshUnconfirmed,
  refreshUnconfirmedMessage: SOURCE_WORKFLOW_REFRESH_UNCONFIRMED_MESSAGE,
  showWorkflowMessage,
  isUserFacingAbort,
  toUserFacingError,
})

const { confirmSourceInputLeave, handleBeforeUnload } = createSourceIntakeLeaveController({
  sourceOperationActive,
  hasUnsavedSourceInput,
  showWorkflowMessage,
})

bindSourceIntakeWorkspaceWatches({
  watch,
  flowState,
  selectedFlowStepId,
  requestedFlowStepFromRoute,
  revealInspectedHistoryIfNeeded,
  route,
  workflowHistoryExpanded,
  props,
  syncDefaults,
  snapshotSession,
  sourceImportController,
  loadData,
  openSourceImportIntent,
})

onBeforeRouteLeave(() => confirmSourceInputLeave())
onBeforeRouteUpdate((to, from) => {
  if (projectRouteInstanceKey(to) === projectRouteInstanceKey(from)) return true
  return confirmSourceInputLeave()
})

onMounted(async () => {
  if (props.sourceImportIntent) await openSourceImportIntent()
  await loadData()
  if (!sourceWorkflowLifecycle.isActive()) return
  if (props.sourceImportIntent) await openSourceImportIntent()
  if (!sourceWorkflowLifecycle.isActive()) return
  window.addEventListener('beforeunload', handleBeforeUnload)
})
onBeforeUnmount(() => {
  sourceWorkflowLifecycle.dispose()
  stopPoll()
  snapshotSession.reset()
  sourceImportController.reset()
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<style scoped>
.source-workflow-section {
  --source-text-muted: #a1a1aa;
  --source-text-secondary: #d4d4d8;
  background: rgba(24, 24, 27, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 20px 24px;
  scroll-margin-top: 84px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
.source-workflow-section:focus {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: #fafafa;
}
.section-subtitle {
  margin-top: 3px;
  font-size: 12px;
  color: var(--source-text-muted);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.workflow-status-banner,
.poll-status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.55);
  color: #bfdbfe;
  font-size: 12px;
  line-height: 1.45;
}
.workflow-status-banner--error,
.poll-status-banner.is-error {
  border-color: rgba(248, 113, 113, 0.32);
  background: rgba(127, 29, 29, 0.16);
  color: #fecaca;
}
.workflow-focus {
  display: grid;
  gap: 12px;
}
.workflow-stage-card {
  min-width: 0;
}
.intake-stage-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
  gap: 18px;
}
.status-block {
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 14px;
  background: rgba(18, 18, 22, 0.58);
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #e4e4e7;
}
.count {
  color: #60a5fa;
}
.empty-stage-state {
  display: grid;
  gap: 10px;
}
.empty-stage-state strong {
  color: #e4e4e7;
  font-size: 13px;
}
.empty-stage-state p {
  margin: 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.empty-stage-hint {
  margin: 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.mini-list {
  display: grid;
  gap: 6px;
}
.mini-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--source-text-secondary);
  font-size: 12px;
}
.source-record-identity {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.source-record-identity small {
  overflow: hidden;
  color: var(--source-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.link-button {
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent;
  color: #93c5fd;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
html.light .source-workflow-section {
  --source-text-muted: #52525b;
  --source-text-secondary: #3f3f46;
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .workflow-status-banner,
html.light .poll-status-banner {
  background: rgba(239, 246, 255, 0.92);
  border-color: rgba(59, 130, 246, 0.22);
  color: #1d4ed8;
}
html.light .workflow-status-banner--error,
html.light .poll-status-banner.is-error {
  background: #fef2f2;
  border-color: rgba(239, 68, 68, 0.24);
  color: #b91c1c;
}
html.light .block-head,
html.light .empty-stage-state strong {
  color: #18181b;
}
html.light .status-block {
  background: #f8fafc;
  border-color: #e5e7eb;
}
@media (max-width: 900px) {
  .intake-stage-layout {
    grid-template-columns: 1fr;
  }
}

.source-workflow-complete {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(360px, 1.5fr) auto;
  align-items: center;
  gap: 14px;
  max-height: 180px;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color);
}
</style>
