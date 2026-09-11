<template>
  <div class="ai-config-content">
    <el-tabs v-model="activeTab" class="config-tabs">
      <el-tab-pane label="AI 配置" name="configs">
        <div class="tab-content">
          <AiConfigDependencyErrorBar
            :config-dependency-error="configDependencyError"
            :stale-data-hint="Boolean(configLoadError && list.length)"
            :loading="loading || vendorLockLoading"
            :retry-config-dependencies="retryConfigDependencies"
          />

          <AiConfigWorkspaceSwitch
            v-model:coverage-workspace-mode-ref="coverageWorkspaceModeRef"
            v-model:configs-workspace-mode-ref="configsWorkspaceModeRef"
            :config-workspace-view="configWorkspaceView"
            :select-config-workspace-view="selectConfigWorkspaceView"
            :on-config-workspace-keydown="onConfigWorkspaceKeydown"
          />

          <AiConfigCoveragePanel
            :config-workspace-view="configWorkspaceView"
            :service-coverage="serviceCoverage"
            :coverage-summary-cards="coverageSummaryCards"
            :config-list-pending-empty="configListPendingEmpty"
            :config-list-failed-empty="configListFailedEmpty"
            :loading="loading || vendorLockLoading"
            :retry-config-dependencies="retryConfigDependencies"
            :ordered-coverage-services="orderedCoverageServices"
            :ordered-extraction-coverage-services="orderedExtractionCoverageServices"
            :active-service-filter="activeServiceFilter"
            :coverage-actions="coverageActions"
            :is-coverage-action-testing="isCoverageActionTesting"
            :is-coverage-action-disabled="isCoverageActionDisabled"
            :set-coverage-card-ref="setCoverageCardRef"
            @select="onCoverageSelect"
            @action="onCoverageAction"
          />

          <AiConfigConfigsPanel
            :config-workspace-view="configWorkspaceView"
            :vendor-lock="vendorLock"
            :config-write-locked="configWriteLocked"
            :config-write-lock-reason="configWriteLockReason"
            :selected-rows="selectedRows"
            :batch-deleting="batchDeleting"
            :active-service-filter="activeServiceFilter"
            :filtered-count="filteredList.length"
            v-model:import-file-ref="importFileRef"
            v-model:config-list-section-ref="configListSectionRef"
            :open-add="openAdd"
            :export-configs="exportConfigs"
            :trigger-import="triggerImport"
            :import-configs="importConfigs"
            :open-one-key-volc="openOneKeyVolc"
            :open-one-key-agnes="openOneKeyAgnes"
            :open-one-key-tongyi="openOneKeyTongyi"
            :on-batch-delete="onBatchDelete"
            :open-bulk-key="openBulkKey"
            :clear-service-filter="clearServiceFilter"
            :loading="loading"
            :vendor-lock-loading="vendorLockLoading"
            :rows="filteredList"
            :config-empty-title="configEmptyTitle"
            :config-empty-description="configEmptyDescription"
            :config-list-failed-empty="configListFailedEmpty"
            :config-list-pending-empty="configListPendingEmpty"
            :is-config-row-selectable="isConfigRowSelectable"
            :on-selection-change="onSelectionChange"
            :open-test="openTest"
            :on-row-edit="onRowEdit"
            :on-delete="onDelete"
            :retry-config-dependencies="retryConfigDependencies"
            :open-add-for-service="openAddForService"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="hasSavedConfigs" label="高级设置（提示词）" name="prompts">
        <div class="tab-content">
          <PromptEditor ref="promptEditorRef" />
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="hasSavedConfigs" label="高级设置（业务场景）" name="sceneModelMap">
        <div class="tab-content">
          <SceneModelMap ref="sceneModelMapRef" />
        </div>
      </el-tab-pane>
      <el-tab-pane label="生成设置" name="generation">
        <div class="tab-content">
        <AiConfigGenerationSettingsPane
          v-model:gen-concurrency-input="genConcurrencyInput"
          v-model:gen-video-concurrency-input="genVideoConcurrencyInput"
          :generation-settings-load-state="generationSettingsLoadState"
          :generation-settings-load-error="generationSettingsLoadError"
          :gen-setting-saving="genSettingSaving"
          :gen-setting-saved="genSettingSaved"
          :generation-settings-write-locked="generationSettingsWriteLocked"
          :generation-settings-write-lock-reason="generationSettingsWriteLockReason"
          :load-generation-settings="loadGenerationSettings"
          :save-generation-settings="saveGenerationSettings"
          :on-concurrency-change="onConcurrencyChange"
          :on-video-concurrency-change="onVideoConcurrencyChange"
        />
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="hasSavedConfigs" label="认证资产管理" name="sd2_assets">
        <div class="tab-content">
        <Sd2AssetManagement :configs="list" :write-locked="configWriteLocked || vendorLock.enabled" @saved="handleSd2AssetSaved" />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 添加/编辑 -->
    <AiConfigFormDialog
      v-model:dialog-visible="dialogVisible"
      v-model:show-protocol-help="showProtocolHelp"
      v-model:form="form"
      v-model:advanced-form-sections="advancedFormSections"
      v-model:preset-model-pick="presetModelPick"
      v-model:form-ref="formRef"
      v-model:api-key-input-ref="apiKeyInputRef"
      v-model:config-dialog-scroll-ref="configDialogScrollRef"
      v-model:workflow-input-ref="workflowInputRef"
      :vendor-lock="vendorLock"
      :editing-id="editingId"
      :config-validation-summary="configValidationSummary"
      :config-write-locked="configWriteLocked"
      :config-write-lock-reason="configWriteLockReason"
      :saving="saving"
      :default-model-rules="defaultModelRules"
      :rules="rules"
      :form-model-list="formModelList"
      :is-default-model-unavailable="isDefaultModelUnavailable"
      :is-comfy-ui-form="isComfyUiForm"
      :is-deep-seek-official-form="isDeepSeekOfficialForm"
      :available-provider-options="availableProviderOptions"
      :endpoint-preview-info="endpointPreviewInfo"
      :jimeng2-assets-loading="jimeng2AssetsLoading"
      :available-models="availableModels"
      :discover-models-loading="discoverModelsLoading"
      :discover-models-disabled="discoverModelsDisabled"
      :discover-models-disabled-reason="discoverModelsDisabledReason"
      :provider-model-empty-hint="providerModelEmptyHint"
      :confirm-config-dialog-close="confirmConfigDialogClose"
      :handle-config-dialog-closed="handleConfigDialogClosed"
      :request-config-dialog-close="requestConfigDialogClose"
      :submit="submit"
      :handle-config-field-validated="handleConfigFieldValidated"
      :is-config-field-invalid="isConfigFieldInvalid"
      :config-field-description-id="configFieldDescriptionId"
      :config-field-description="configFieldDescription"
      :on-service-type-change="onServiceTypeChange"
      :on-provider-change="onProviderChange"
      :on-default-model-change="onDefaultModelChange"
      :open-jimeng2-material-assets-dialog="openJimeng2MaterialAssetsDialog"
      :set-model-list-input-ref="setModelListInputRef"
      :discover-models-from-service="discoverModelsFromService"
      :on-preset-model-select="onPresetModelSelect"
    />
    <AiConfigOneKeyDialogs
      v-model:one-key-tongyi-visible="oneKeyTongyiVisible"
      v-model:one-key-tongyi-key="oneKeyTongyiKey"
      v-model:one-key-volc-visible="oneKeyVolcVisible"
      v-model:one-key-volc-key="oneKeyVolcKey"
      v-model:one-key-agnes-visible="oneKeyAgnesVisible"
      v-model:one-key-agnes-key="oneKeyAgnesKey"
      :one-key-tongyi-saving="oneKeyTongyiSaving"
      :one-key-volc-saving="oneKeyVolcSaving"
      :one-key-agnes-saving="oneKeyAgnesSaving"
      :config-write-locked="configWriteLocked"
      :config-write-lock-reason="configWriteLockReason"
      :confirm-one-key-tongyi-close="confirmOneKeyTongyiClose"
      :confirm-one-key-volc-close="confirmOneKeyVolcClose"
      :confirm-one-key-agnes-close="confirmOneKeyAgnesClose"
      :request-one-key-tongyi-close="requestOneKeyTongyiClose"
      :request-one-key-volc-close="requestOneKeyVolcClose"
      :request-one-key-agnes-close="requestOneKeyAgnesClose"
      :submit-one-key-tongyi="submitOneKeyTongyi"
      :submit-one-key-volc="submitOneKeyVolc"
      :submit-one-key-agnes="submitOneKeyAgnes"
    />
    <AiConfigJimeng2AssetsDialog
      v-model:jimeng2-assets-dialog-visible="jimeng2AssetsDialogVisible"
      :jimeng2-assets-loading="jimeng2AssetsLoading"
      :jimeng2-assets-rows="jimeng2AssetsRows"
      :jimeng2-assets-has-more="jimeng2AssetsHasMore"
      :format-jimeng2-asset-created-at="formatJimeng2AssetCreatedAt"
      :load-more-jimeng2-material-assets="loadMoreJimeng2MaterialAssets"
      :on-jimeng2-assets-dialog-closed="onJimeng2AssetsDialogClosed"
    />
    <AiConfigConnectionTestDialog
      v-model:test-visible="testVisible"
      :test-result="testResult"
      :test-service-type="testServiceType"
      :test-error="testError"
      :test-error-detail="testErrorDetail"
      :test-result-announcement="testResultAnnouncement"
      :test-suggest-discover-models="testSuggestDiscoverModels"
      :testing-config-id="testingConfigId"
      :restore-tested-coverage-card-focus="restoreTestedCoverageCardFocus"
      :retry-connection-test="retryConnectionTest"
    />
    <AiConfigBulkKeyDialog
      v-model:bulk-key-visible="bulkKeyVisible"
      v-model:bulk-key-input="bulkKeyInput"
      :bulk-key-saving="bulkKeySaving"
      :config-write-locked="configWriteLocked"
      :config-write-lock-reason="configWriteLockReason"
      :confirm-bulk-key-close="confirmBulkKeyClose"
      :request-bulk-key-close="requestBulkKeyClose"
      :submit-bulk-key="submitBulkKey"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { formatJimeng2AssetCreatedAt } from '@/components/aiConfig/aiConfigFormatters.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { runWithOwnedRequestErrorToast } from '@/utils/request'
import { aiAPI } from '@/api/ai'
import { generationSettingsAPI } from '@/api/prompts'
import { useAiConfigGenerationSettings } from '@/composables/useAiConfigGenerationSettings.js'
import { useAiConfigOneKeyPresets } from '@/composables/useAiConfigOneKeyPresets.js'
import { useAiConfigImportExport } from '@/composables/useAiConfigImportExport.js'
import { useAiConfigRowMutations } from '@/composables/useAiConfigRowMutations.js'
import { useAiConfigDiscoverModels } from '@/composables/useAiConfigDiscoverModels.js'
import { useAiConfigVendorLock } from '@/composables/useAiConfigVendorLock.js'
import { useAiConfigJimeng2Assets } from '@/composables/useAiConfigJimeng2Assets.js'
import { useAiConfigFormActions } from '@/composables/useAiConfigFormActions.js'
import { useAiConfigSessionStatus } from '@/composables/useAiConfigSessionStatus.js'
import { useAiConfigPageRequests } from '@/composables/useAiConfigPageRequests.js'
import { isOpenAiCompatibleConfig } from '@/utils/aiConfigDiscoverModels.js'
import { describeConnectionTestError } from '@/utils/aiConfigConnectionTest.js'
import { describeConfigEditTarget } from '@/utils/aiConfigProviderOptions.js'
import { buildAiServiceCoverage, sortAiServiceCoverage } from '@/utils/aiConfigCoverage.js'
import { useAiConfigCoverage } from '@/composables/useAiConfigCoverage.js'
import { useAiConfigWorkspaceView } from '@/composables/useAiConfigWorkspaceView.js'
import { useAiConfigFormDerived } from '@/composables/useAiConfigFormDerived.js'
import { useAiConfigFormRules } from '@/composables/useAiConfigFormRules.js'
import { useAiConfigWriteLock } from '@/composables/useAiConfigWriteLock.js'
import { useAiConfigEmptyCopy } from '@/composables/useAiConfigEmptyCopy.js'
import { useAiConfigPageChrome } from '@/composables/useAiConfigPageChrome.js'
import {
  isMaskedSecret,
  useAiConfigUnsaved,
} from '@/composables/useAiConfigUnsaved.js'
import { createAiConfigConnectionStatusStore } from '@/utils/aiConfigConnectionStatusStore.js'
import {
  runAiConfigCreateBatch,
} from '@/utils/aiConfigMutations.js'
import { jsonRequestOptions } from '@/utils/aiConfigRequestOptions.js'
import {
  normalizeInitialServiceType,
  shouldApplyConfigWorkspaceRequest,
} from '@/utils/aiConfigWorkspace.js'
import PromptEditor from '@/components/PromptEditor.vue'
import SceneModelMap from '@/components/SceneModelMap.vue'
import Sd2AssetManagement from '@/components/Sd2AssetManagement.vue'
import AiConfigWorkspaceSwitch from '@/components/aiConfig/AiConfigWorkspaceSwitch.vue'
import AiConfigCoveragePanel from '@/components/aiConfig/AiConfigCoveragePanel.vue'
import AiConfigConfigsPanel from '@/components/aiConfig/AiConfigConfigsPanel.vue'
import AiConfigDependencyErrorBar from '@/components/aiConfig/AiConfigDependencyErrorBar.vue'
import AiConfigFormDialog from '@/components/aiConfig/AiConfigFormDialog.vue'
import AiConfigOneKeyDialogs from '@/components/aiConfig/AiConfigOneKeyDialogs.vue'
import AiConfigBulkKeyDialog from '@/components/aiConfig/AiConfigBulkKeyDialog.vue'
import AiConfigConnectionTestDialog from '@/components/aiConfig/AiConfigConnectionTestDialog.vue'
import AiConfigJimeng2AssetsDialog from '@/components/aiConfig/AiConfigJimeng2AssetsDialog.vue'
import AiConfigGenerationSettingsPane from '@/components/aiConfig/AiConfigGenerationSettingsPane.vue'
import { createOperationId, logOperation } from '@/utils/operationLog'
import {
  DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
  describeServiceLoadError,
  isRequestCanceled,
  withRequestRetry,
} from '@/utils/requestError'
const props = defineProps({
  initialServiceType: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['configuration-changed'])

const activeTab = ref('configs')
const promptEditorRef = ref(null)
const sceneModelMapRef = ref(null)
const configWorkspaceView = ref(
  normalizeInitialServiceType(props.initialServiceType) ? 'configs' : 'coverage',
)
const coverageWorkspaceModeRef = ref(null)
const configsWorkspaceModeRef = ref(null)

const {
  selectConfigWorkspaceView,
  onConfigWorkspaceKeydown,
} = useAiConfigWorkspaceView({
  configWorkspaceView,
  coverageWorkspaceModeRef,
  configsWorkspaceModeRef,
})
const importFileRef = ref(null)

// ---- 生成设置 ----
const {
  genConcurrencyInput,
  genVideoConcurrencyInput,
  genSettingSaving,
  genSettingSaved,
  generationSettingsLoadState,
  generationSettingsLoadError,
  generationSettingsWriteLocked,
  generationSettingsWriteLockReason,
  generationSettingsDirty,
  loadGenerationSettings,
  saveGenerationSettings,
  onConcurrencyChange,
  onVideoConcurrencyChange,
  abortGenerationSettingsRequest,
} = useAiConfigGenerationSettings({
  generationSettingsAPI,
  ElMessage,
  runWithOwnedRequestErrorToast,
})
const loading = ref(false)
const configLoadState = ref('idle')
const configLoadError = ref('')
const list = ref([])
const hasSavedConfigs = computed(() => (list.value || []).length > 0)
const ADVANCED_CONFIG_TABS = new Set(['prompts', 'sceneModelMap', 'sd2_assets'])
watch(hasSavedConfigs, (hasConfigs) => {
  if (!hasConfigs && ADVANCED_CONFIG_TABS.has(activeTab.value)) {
    activeTab.value = 'configs'
  }
})
let configListLoadSequence = 0
const activeServiceFilter = ref(normalizeInitialServiceType(props.initialServiceType))
const configListSectionRef = ref(null)
watch(
  () => props.initialServiceType,
  async (value) => {
    const normalized = normalizeInitialServiceType(value)
    if (!shouldApplyConfigWorkspaceRequest({
      requestedServiceType: normalized,
      activeServiceType: activeServiceFilter.value,
      workspaceView: configWorkspaceView.value,
    })) return
    await applyRequestedService(normalized)
  },
)
let connectionStatusStore = createAiConfigConnectionStatusStore()
let configListAbortController = null
let connectionTestAbortController = null
let lastTestedConfig = null
let abortDiscoverModelsRequest = () => {}
let resetDiscoverModelsState = () => {}
let abortVendorLockRequest = () => {}

const {
  vendorLock,
  vendorLockResolved,
  vendorLockLoading,
  vendorLockError,
  loadVendorLock,
  abortVendorLockRequest: abortVendorLockFromComposable,
} = useAiConfigVendorLock({
  aiAPI,
  jsonRequestOptions,
})
abortVendorLockRequest = abortVendorLockFromComposable

const {
  sessionTestStatusById,
  initializeConnectionStatusStore,
  invalidateConnectionTestResults,
  abortConnectionStatusScopeRequest,
} = useAiConfigSessionStatus({
  getConnectionStatusStore: () => connectionStatusStore,
  setConnectionStatusStore: (store) => { connectionStatusStore = store },
})
const selectedRows = ref([])
const batchDeleting = ref(false)
const dialogVisible = ref(false)
const editingId = ref(null)
const editingUpdatedAt = ref('')
const saving = ref(false)
const configFormBaseline = ref('')
const configDialogSaved = ref(false)
const showProtocolHelp = ref(false)
const bulkKeyVisible = ref(false)
const bulkKeyInput = ref('')
const bulkKeySaving = ref(false)
const jimeng2AssetsDialogVisible = ref(false)
const jimeng2AssetsLoading = ref(false)
const jimeng2AssetsRows = ref([])
const jimeng2AssetsHasMore = ref(false)
const jimeng2AssetsNextCursor = ref(null)
const formRef = ref(null)
const configDialogScrollRef = ref(null)
const configValidationSummary = ref([])
const apiKeyInputRef = ref(null)
const modelListInputRef = ref(null)
function setModelListInputRef(element) {
  modelListInputRef.value = element
}
const workflowInputRef = ref(null)
const advancedFormSections = ref([])
const form = ref({
  service_type: 'text',
  name: '',
  provider: '',
  api_protocol: '',
  base_url: '',
  api_key: '',
  endpoint: '',
  query_endpoint: '',
  modelText: '',
  default_model: '',
  deepseek_thinking: 'disabled',
  deepseek_reasoning_effort: 'high',
  priority: 0,
  is_default: false,
  // 可灵 Omni 官方 AK/SK（存 settings，后端生成 JWT）
  kling_access_key: '',
  kling_secret_key: '',
  kling_secret_key_base64: false,
  comfy_workflow_json: '',
  // TTS 专属字段
  voice_id: '',
  group_id: '',
})
const presetModelPick = ref('')

const {
  formModelList,
  discoverModelsDisabledReason,
  discoverModelsDisabled,
  isDeepSeekOfficialForm,
  isComfyUiForm,
  isDefaultModelUnavailable,
  isDefaultModelSelectionValid,
  availableProviderOptions,
  availableModels,
  providerModelEmptyHint,
  endpointPreviewInfo,
  onProviderChange,
  onServiceTypeChange,
  onPresetModelSelect,
  onDefaultModelChange,
} = useAiConfigFormDerived({
  form,
  editingId,
  presetModelPick,
})
const {
  discoverModelsLoading,
  discoverModelsFromService,
  abortDiscoverModelsRequest: abortDiscoverModelsRequestFromComposable,
  resetDiscoverModelsState: resetDiscoverModelsStateFromComposable,
} = useAiConfigDiscoverModels({
  ElMessage,
  aiAPI,
  form,
  editingId,
  dialogVisible,
  discoverModelsDisabled,
})
abortDiscoverModelsRequest = abortDiscoverModelsRequestFromComposable
resetDiscoverModelsState = resetDiscoverModelsStateFromComposable
const {
  onJimeng2AssetsDialogClosed,
  openJimeng2MaterialAssetsDialog,
  loadMoreJimeng2MaterialAssets,
} = useAiConfigJimeng2Assets({
  ElMessage,
  aiAPI,
  form,
  editingId,
  jimeng2AssetsDialogVisible,
  jimeng2AssetsLoading,
  jimeng2AssetsRows,
  jimeng2AssetsHasMore,
  jimeng2AssetsNextCursor,
})
const {
  defaultModelRules,
  rules,
} = useAiConfigFormRules({
  form,
  isComfyUiForm,
  isDefaultModelSelectionValid,
})

const testVisible = ref(false)
const testResult = ref(null)
const testServiceType = ref('')
const testError = ref('')
const testErrorDetail = ref('')
const testResultAnnouncement = ref('')
const testSuggestDiscoverModels = ref(false)
const testingConfigId = ref(null)
const oneKeyTongyiVisible = ref(false)
const oneKeyTongyiKey = ref('')
const oneKeyTongyiSaving = ref(false)
const oneKeyVolcVisible = ref(false)
const oneKeyVolcKey = ref('')
const oneKeyVolcSaving = ref(false)
const oneKeyAgnesVisible = ref(false)
const oneKeyAgnesKey = ref('')
const oneKeyAgnesSaving = ref(false)

const serviceCoverage = computed(() => (
  buildAiServiceCoverage(list.value, sessionTestStatusById.value)
))
const orderedCoverageServices = computed(() => sortAiServiceCoverage(serviceCoverage.value.services))
const orderedExtractionCoverageServices = computed(() => (
  sortAiServiceCoverage(serviceCoverage.value.extractionServices || [])
))

const coverageSummaryCards = computed(() => ([
  {
    key: 'ready',
    label: '可用',
    value: `${serviceCoverage.value.readyCount}/${serviceCoverage.value.totalCount}`,
    tone: serviceCoverage.value.ready ? 'success' : 'warning',
  },
  {
    key: 'attention',
    label: '待补齐',
    value: serviceCoverage.value.attentionCount,
    tone: serviceCoverage.value.attentionCount ? 'warning' : 'success',
  },
  {
    key: 'failed-tests',
    label: '测试失败',
    value: serviceCoverage.value.testFailedCount,
    tone: serviceCoverage.value.testFailedCount ? 'danger' : 'success',
  },
  {
    key: 'untested',
    label: '待测试',
    value: serviceCoverage.value.untestedCount,
    tone: serviceCoverage.value.untestedCount ? 'info' : 'success',
  },
]))

const filteredList = computed(() => {
  if (!activeServiceFilter.value) return list.value
  return list.value.filter((row) => row.service_type === activeServiceFilter.value)
})

const {
  configWriteLocked,
  configWriteLockReason,
  canAutoOpenMissingService,
} = useAiConfigWriteLock({
  configLoadState,
  vendorLockResolved,
  saving,
  bulkKeySaving,
  batchDeleting,
  oneKeyTongyiSaving,
  oneKeyVolcSaving,
  oneKeyAgnesSaving,
  selectedRows,
})

const configFormDirty = computed(() => (
  dialogVisible.value
  && Boolean(configFormBaseline.value)
  && configFormFingerprint() !== configFormBaseline.value
))
const credentialDraftDirty = computed(() => (
  (oneKeyTongyiVisible.value && Boolean(oneKeyTongyiKey.value.trim()))
  || (oneKeyVolcVisible.value && Boolean(oneKeyVolcKey.value.trim()))
  || (oneKeyAgnesVisible.value && Boolean(oneKeyAgnesKey.value.trim()))
  || (bulkKeyVisible.value && Boolean(bulkKeyInput.value.trim()))
))

const {
  configFieldDescriptionId,
  isConfigFieldInvalid,
  configFieldDescription,
  clearConfigValidationSummary,
  handleConfigFieldValidated,
  handleConfigValidationFailure,
  hasUnsavedChanges,
  confirmDiscard,
  requestClose,
  confirmConfigDialogClose,
  requestConfigDialogClose,
  confirmOneKeyTongyiClose,
  confirmOneKeyVolcClose,
  confirmOneKeyAgnesClose,
  confirmBulkKeyClose,
  requestOneKeyTongyiClose,
  requestOneKeyVolcClose,
  requestOneKeyAgnesClose,
  requestBulkKeyClose,
} = useAiConfigUnsaved({
  formModelList,
  isComfyUiForm,
  configValidationSummary,
  advancedFormSections,
  configDialogScrollRef,
  configFormDirty,
  generationSettingsDirty,
  credentialDraftDirty,
  promptEditorRef,
  sceneModelMapRef,
  configDialogSaved,
  dialogVisible,
  oneKeyTongyiKey,
  oneKeyTongyiVisible,
  oneKeyVolcKey,
  oneKeyVolcVisible,
  oneKeyAgnesKey,
  oneKeyAgnesVisible,
  bulkKeyInput,
  bulkKeyVisible,
  discardMessage: '当前 AI 配置尚未保存，关闭后本次修改会丢失。',
  discardTitle: '放弃未保存修改？',
  discardConfirmText: '放弃修改',
  discardCancelText: '继续编辑',
})

defineExpose({
  hasUnsavedChanges,
  requestClose,
})

const {
  notifyConfigurationChanged,
  resetForm,
  configFormFingerprint,
  openConfigDialog,
  openAdd,
  openAddForService,
  openEdit,
  confirmReplaceDefaultConfig,
  submit,
} = useAiConfigFormActions({
  emit,
  ElMessage,
  configWriteLocked,
  form,
  formRef,
  editingId,
  editingUpdatedAt,
  presetModelPick,
  advancedFormSections,
  dialogVisible,
  configDialogSaved,
  configFormBaseline,
  configDialogScrollRef,
  saving,
  list,
  loadList,
  resetDiscoverModelsState: () => resetDiscoverModelsState(),
  clearConfigValidationSummary,
  handleConfigValidationFailure,
  onServiceTypeChange,
  activeServiceFilter,
  apiKeyInputRef,
  modelListInputRef,
  workflowInputRef,
  isComfyUiForm,
  isDeepSeekOfficialForm,
  invalidateConnectionTestResults,
  revealSavedConfigs,
})

const {
  handleConfigDialogClosed,
  clearServiceFilter,
  isConfigRowSelectable,
} = useAiConfigPageChrome({
  resetForm,
  configFormBaseline,
  configDialogSaved,
  activeServiceFilter,
  configWriteLocked,
})

const {
  openOneKeyTongyi,
  submitOneKeyTongyi,
  openOneKeyVolc,
  submitOneKeyVolc,
  openOneKeyAgnes,
  submitOneKeyAgnes,
} = useAiConfigOneKeyPresets({
  ElMessage,
  aiAPI,
  runAiConfigCreateBatch,
  configWriteLocked,
  oneKeyTongyiVisible,
  oneKeyTongyiKey,
  oneKeyTongyiSaving,
  oneKeyVolcVisible,
  oneKeyVolcKey,
  oneKeyVolcSaving,
  oneKeyAgnesVisible,
  oneKeyAgnesKey,
  oneKeyAgnesSaving,
  loadList,
  list,
  configLoadError,
  invalidateConnectionTestResults,
  notifyConfigurationChanged,
})

const {
  exportConfigs,
  triggerImport,
  importConfigs,
} = useAiConfigImportExport({
  ElMessage,
  aiAPI,
  runAiConfigCreateBatch,
  configWriteLocked,
  importFileRef,
  loadList,
  list,
  configLoadError,
  invalidateConnectionTestResults,
  notifyConfigurationChanged,
})

const {
  openBulkKey,
  submitBulkKey,
  onDelete,
  onSelectionChange,
  onBatchDelete,
} = useAiConfigRowMutations({
  ElMessage,
  aiAPI,
  configWriteLocked,
  bulkKeyInput,
  bulkKeyVisible,
  bulkKeySaving,
  selectedRows,
  batchDeleting,
  loadList,
  list,
  invalidateConnectionTestResults,
  notifyConfigurationChanged,
})

const {
  configListPendingEmpty,
  configListFailedEmpty,
  configEmptyTitle,
  configEmptyDescription,
  configDependencyError,
} = useAiConfigEmptyCopy({
  list,
  configLoadState,
  configLoadError,
  vendorLockError,
  activeServiceFilter,
})

const {
  coverageActions,
  onCoverageSelect,
  onCoverageAction,
  shouldAutoOpenRequestedService,
  focusServiceConfigs,
  applyRequestedService,
  setCoverageCardRef,
  isCoverageActionTesting,
  isCoverageActionDisabled,
  restoreTestedCoverageCardFocus: restoreCoverageCardFocus,
} = useAiConfigCoverage({
  vendorLock,
  configWriteLocked,
  testingConfigId,
  canAutoOpenMissingService,
  configWorkspaceView,
  activeServiceFilter,
  serviceCoverage,
  coverageWorkspaceModeRef,
  configListSectionRef,
  selectConfigWorkspaceView,
  normalizeInitialServiceType,
  openAddForService,
  openEdit,
  openTest,
  abortConnectionTest: () => { connectionTestAbortController?.abort() },
})

async function restoreTestedCoverageCardFocus() {
  connectionTestAbortController?.abort()
  await restoreCoverageCardFocus()
}

function onRowEdit(row) {
  if (configWriteLocked.value) return
  const target = describeConfigEditTarget(row)
  if (target.tab) {
    activeTab.value = target.tab
    ElMessage.info(target.message)
    return
  }
  openEdit(row)
}

function revealSavedConfigs() {
  selectConfigWorkspaceView('configs')
  activeServiceFilter.value = ''
}

async function handleSd2AssetSaved() {
  invalidateConnectionTestResults()
  notifyConfigurationChanged()
  await loadList()
}

async function loadList() {
  configListAbortController?.abort()
  const controller = new AbortController()
  configListAbortController = controller
  const requestId = ++configListLoadSequence
  loading.value = true
  configLoadState.value = list.value.length ? 'refreshing' : 'loading'
  try {
    const nextList = await withRequestRetry(
      () => aiAPI.list(undefined, jsonRequestOptions(controller.signal)),
      { maxAttempts: 2, delayMs: 400, signal: controller.signal },
    )
    if (requestId !== configListLoadSequence) return false
    list.value = nextList
    sessionTestStatusById.value = connectionStatusStore.forConfigs(list.value)
    configLoadError.value = ''
    configLoadState.value = 'ready'
    return true
  } catch (error) {
    if (isRequestCanceled(error) || requestId !== configListLoadSequence) return false
    configLoadError.value = describeServiceLoadError(error, {
      serviceLabel: 'AI 配置服务',
      fallback: '暂时无法读取 AI 配置，请稍后重试。',
      signal: controller.signal,
    })
    configLoadState.value = 'error'
    return false
  } finally {
    if (requestId === configListLoadSequence) loading.value = false
    if (configListAbortController === controller) configListAbortController = null
  }
}

async function openTest(row) {
  if (row.service_type === 'jimeng2_character_auth') {
    ElMessage.info('即梦2角色认证无需在此联调；保存后请在创作页「角色」面板中点击「认证资产」验证。')
    return
  }
  if (row.service_type === 'model_ark_asset') {
    ElMessage.info('认证资产库请在「认证资产管理」标签页使用「刷新列表」验证连接。')
    return
  }
  if (testingConfigId.value !== null && lastTestedConfig && String(lastTestedConfig.id) === String(row.id)) return
  connectionTestAbortController?.abort()
  const controller = new AbortController()
  connectionTestAbortController = controller
  lastTestedConfig = row
  testingConfigId.value = row.id
  testVisible.value = true
  testResult.value = null
  testError.value = ''
  testErrorDetail.value = ''
  testResultAnnouncement.value = '正在测试连接'
  testServiceType.value = row.service_type || 'text'
  testSuggestDiscoverModels.value = isOpenAiCompatibleConfig(row)
  const testModel = row.default_model || (Array.isArray(row.model) ? row.model[0] : row.model)
  const operationId = createOperationId('ai_config_test')
  const startedAt = Date.now()
  logOperation({
    operation: 'ai_config_test',
    operationId,
    phase: 'start',
    configId: row.id,
    serviceType: row.service_type || 'text',
  })
  try {
    await aiAPI.testConnection({
      id: row.id,
      base_url: row.base_url,
      api_key: isMaskedSecret(row.api_key) ? undefined : row.api_key,
      model: testModel,
      provider: row.provider,
      endpoint: row.endpoint,
      service_type: row.service_type,
      settings: row.settings
    }, {
      signal: controller.signal,
      timeout: DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
      suppressErrorToast: true,
    })
    testResult.value = true
    const testedAt = new Date().toISOString()
    connectionStatusStore.set(row.id, 'passed', testedAt)
    sessionTestStatusById.value = {
      ...sessionTestStatusById.value,
      [row.id]: { status: 'passed', testedAt },
    }
    testResultAnnouncement.value = '连接测试通过'
    logOperation({
      operation: 'ai_config_test',
      operationId,
      phase: 'success',
      durationMs: Date.now() - startedAt,
      configId: row.id,
      serviceType: row.service_type || 'text',
    })
  } catch (e) {
    if (isUserFacingAbort(e, controller.signal) || controller.signal.aborted) {
      if (testVisible.value && String(testingConfigId.value) === String(row.id)) {
        testResultAnnouncement.value = ''
      }
      return
    }
    testResult.value = false
    const described = describeConnectionTestError(e, controller.signal, row.service_type)
    testError.value = described.title
    testErrorDetail.value = described.detail
    const testedAt = new Date().toISOString()
    connectionStatusStore.set(row.id, 'failed', testedAt)
    sessionTestStatusById.value = {
      ...sessionTestStatusById.value,
      [row.id]: { status: 'failed', testedAt },
    }
    testResultAnnouncement.value = `连接测试失败：${testError.value}`
    logOperation({
      operation: 'ai_config_test',
      operationId,
      phase: 'error',
      durationMs: Date.now() - startedAt,
      configId: row.id,
      serviceType: row.service_type || 'text',
      error: testError.value,
    })
  } finally {
    if (connectionTestAbortController === controller) connectionTestAbortController = null
    if (String(testingConfigId.value) === String(row.id)) testingConfigId.value = null
  }
}

const {
  abortAiConfigPageRequests,
  retryConnectionTest,
  retryConfigDependencies,
} = useAiConfigPageRequests({
  abortVendorLockRequest: () => abortVendorLockRequest(),
  abortGenerationSettingsRequest: () => abortGenerationSettingsRequest(),
  abortDiscoverModelsRequest: () => abortDiscoverModelsRequest(),
  abortConfigListRequest: () => {
    configListAbortController?.abort()
    configListAbortController = null
  },
  abortConnectionTestRequest: () => {
    connectionTestAbortController?.abort()
    connectionTestAbortController = null
  },
  abortConnectionStatusScopeRequest,
  loadVendorLock,
  loadList,
  testingConfigId,
  openTest,
  getLastTestedConfig: () => lastTestedConfig,
})

onMounted(async () => {
  await initializeConnectionStatusStore()
  await Promise.all([loadVendorLock(), loadList(), loadGenerationSettings()])
  if (activeServiceFilter.value) await applyRequestedService(activeServiceFilter.value)
})

onBeforeUnmount(() => {
  abortAiConfigPageRequests()
})
</script>

<style>
.ai-config-content,
.ai-config-overlay {
  --ai-config-success-surface: #ecfdf5;
  --ai-config-success-border: rgba(16, 185, 129, 0.24);
  --ai-config-success-text: #047857;
  --ai-config-warning-surface: #fffbeb;
  --ai-config-warning-border: rgba(245, 158, 11, 0.24);
  --ai-config-warning-text: #a16207;
  --ai-config-danger-surface: #fef2f2;
  --ai-config-danger-border: rgba(239, 68, 68, 0.24);
  --ai-config-danger-text: #b91c1c;
  --ai-config-info-surface: #eff6ff;
  --ai-config-info-border: rgba(59, 130, 246, 0.24);
  --ai-config-info-text: #0369a1;
  --ai-config-code-surface: var(--el-fill-color, #f0f2f5);
}

html.dark .ai-config-content,
html.dark .ai-config-overlay {
  color-scheme: dark;
  --el-bg-color: var(--bg-card);
  --el-bg-color-page: var(--bg-page);
  --el-bg-color-overlay: var(--bg-card);
  --el-fill-color: var(--bg-hover);
  --el-fill-color-light: var(--bg-inner);
  --el-fill-color-lighter: var(--bg-hover);
  --el-fill-color-extra-light: var(--bg-inner);
  --el-fill-color-blank: var(--bg-card);
  --el-text-color-primary: var(--text-bright);
  --el-text-color-regular: var(--text-primary);
  --el-text-color-secondary: var(--text-muted);
  --el-text-color-placeholder: var(--text-subtle);
  --el-text-color-disabled: var(--text-faint);
  --el-border-color: var(--border-muted);
  --el-border-color-light: var(--border-color);
  --el-border-color-lighter: var(--border-color);
  --el-border-color-extra-light: var(--border-color);
  --el-disabled-bg-color: var(--bg-hover);
  --el-disabled-text-color: var(--text-subtle);
  --el-mask-color: rgba(0, 0, 0, 0.72);
  --el-table-bg-color: var(--bg-card);
  --el-table-tr-bg-color: var(--bg-card);
  --el-table-header-bg-color: var(--bg-inner);
  --el-table-row-hover-bg-color: var(--bg-hover);
  --el-table-current-row-bg-color: var(--bg-hover);
  --el-table-border-color: var(--border-color);
  --el-table-text-color: var(--text-primary);
  --el-table-header-text-color: var(--text-muted);
  --el-color-primary-light-9: rgba(64, 158, 255, 0.14);
  --el-color-primary-light-8: rgba(64, 158, 255, 0.22);
  --el-color-primary-light-7: rgba(64, 158, 255, 0.34);
  --el-color-success-light-9: rgba(16, 185, 129, 0.14);
  --el-color-warning-light-9: rgba(245, 158, 11, 0.14);
  --el-color-danger-light-9: rgba(239, 68, 68, 0.14);
  --el-color-info-light-9: rgba(148, 163, 184, 0.14);
  --ai-config-success-surface: rgba(16, 185, 129, 0.14);
  --ai-config-success-border: rgba(52, 211, 153, 0.4);
  --ai-config-success-text: #6ee7b7;
  --ai-config-warning-surface: rgba(245, 158, 11, 0.14);
  --ai-config-warning-border: rgba(251, 191, 36, 0.4);
  --ai-config-warning-text: #fcd34d;
  --ai-config-danger-surface: rgba(239, 68, 68, 0.14);
  --ai-config-danger-border: rgba(248, 113, 113, 0.4);
  --ai-config-danger-text: #fca5a5;
  --ai-config-info-surface: rgba(59, 130, 246, 0.14);
  --ai-config-info-border: rgba(96, 165, 250, 0.4);
  --ai-config-info-text: #93c5fd;
  --ai-config-code-surface: var(--bg-hover);
}

html.dark .ai-config-overlay {
  --el-dialog-bg-color: var(--bg-card);
  background: var(--bg-card);
  border: 1px solid var(--border-muted);
  color: var(--text-primary);
}

html.dark .el-dialog:has(.ai-config-content) {
  --el-dialog-bg-color: var(--bg-card);
  background: var(--bg-card);
  border: 1px solid var(--border-muted);
  color: var(--text-primary);
}

html.dark .ai-config-overlay :is(.el-dialog__title, .el-dialog__body) {
  color: var(--text-primary);
}

html.dark .el-dialog:has(.ai-config-content) :is(.el-dialog__title, .el-dialog__body) {
  color: var(--text-primary);
}

html.dark :is(.ai-config-content, .ai-config-overlay) :is(
  .el-input__wrapper,
  .el-select__wrapper,
  .el-textarea__inner,
  .el-input-number
) {
  background: var(--bg-inner);
  color: var(--text-primary);
}

html.dark :is(.ai-config-content, .ai-config-overlay) .el-table {
  background: var(--el-table-bg-color);
  color: var(--el-table-text-color);
}

html.dark :is(.ai-config-content, .ai-config-overlay) .el-table__inner-wrapper::before {
  background-color: var(--el-table-border-color);
}

html.dark :is(.ai-config-content, .ai-config-overlay) :is(
  .tab-content,
  .el-dialog__body,
  .el-scrollbar__wrap,
  .el-table__body-wrapper
) {
  scrollbar-color: var(--border-muted) transparent;
  scrollbar-width: thin;
}

html.dark :is(.ai-config-content, .ai-config-overlay) :is(
  .tab-content,
  .el-dialog__body,
  .el-scrollbar__wrap,
  .el-table__body-wrapper
)::-webkit-scrollbar-thumb {
  background: var(--border-muted);
  border: 2px solid var(--bg-card);
  border-radius: 8px;
}
</style>

<style scoped>
.ai-config-content {
  padding: 0;
}
.config-tabs {
  margin-top: -4px;
}
.tab-content {
  padding-top: 16px;
  min-width: 0;
}
.config-workspace-panel {
  min-width: 0;
}
.one-key-tip {
  margin: 0 0 12px;
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
code {
  background: var(--ai-config-code-surface, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
}
@media (max-width: 760px) {
  .ai-config-content,
  .tab-content,
  .config-workspace-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  :deep(.el-tabs__content),
  :deep(.el-tab-pane),
  :deep(.el-form-item__content),
  :deep(.el-input),
  :deep(.el-select) {
    min-width: 0;
    max-width: 100%;
  }
}
</style>
