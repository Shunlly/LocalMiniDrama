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

          <div class="config-workspace-switch" role="tablist" aria-label="AI 配置工作区">
            <button
              ref="coverageWorkspaceModeRef"
              id="ai-config-mode-coverage"
              type="button"
              role="tab"
              class="config-workspace-mode"
              data-testid="ai-config-mode-coverage"
              :class="{ active: configWorkspaceView === 'coverage' }"
              :aria-selected="configWorkspaceView === 'coverage'"
              :tabindex="configWorkspaceView === 'coverage' ? 0 : -1"
              aria-controls="ai-config-coverage-panel"
              @click="selectConfigWorkspaceView('coverage')"
              @keydown="onConfigWorkspaceKeydown('coverage', $event)"
            >
              服务状态
            </button>
            <button
              ref="configsWorkspaceModeRef"
              id="ai-config-mode-configs"
              type="button"
              role="tab"
              class="config-workspace-mode"
              data-testid="ai-config-mode-configs"
              :class="{ active: configWorkspaceView === 'configs' }"
              :aria-selected="configWorkspaceView === 'configs'"
              :tabindex="configWorkspaceView === 'configs' ? 0 : -1"
              aria-controls="ai-config-configs-panel"
              @click="selectConfigWorkspaceView('configs')"
              @keydown="onConfigWorkspaceKeydown('configs', $event)"
            >
              配置管理
            </button>
          </div>

          <div
            id="ai-config-coverage-panel"
            v-show="configWorkspaceView === 'coverage'"
            class="config-workspace-panel"
            role="tabpanel"
            aria-labelledby="ai-config-mode-coverage"
          >
          <section class="coverage-panel" aria-labelledby="ai-service-coverage-title">
            <div class="coverage-header">
              <div>
                <div class="coverage-title-row">
                  <h2 id="ai-service-coverage-title">AI 服务配置与验证</h2>
                  <el-tag
                    v-if="!configListPendingEmpty && !configListFailedEmpty"
                    :type="serviceCoverage.ready ? 'success' : 'warning'"
                    size="small"
                    effect="light"
                  >
                    {{ serviceCoverage.readyCount }}/{{ serviceCoverage.totalCount }} 类可用
                  </el-tag>
                </div>
                <p>每类服务可用需启用默认配置；默认配置还需凭据、模型或工作流完整。上方统计只看五类正式制作服务。</p>
              </div>
              <span class="coverage-test-note">连接测试结果来自后端记录或此设备保存的最近结果</span>
            </div>
            <div
              v-if="configListPendingEmpty"
              class="coverage-unresolved-state"
              role="status"
              aria-live="polite"
            >
              正在读取 AI 配置...
            </div>
            <div
              v-else-if="configListFailedEmpty"
              class="coverage-unresolved-state coverage-unresolved-state--error"
              role="alert"
            >
              <div class="coverage-unresolved-copy">
                <strong>暂时无法确认服务状态</strong>
                <span>配置列表还没有成功加载，当前不能判断五类服务是否已配置。</span>
              </div>
              <el-button size="small" type="primary" plain :loading="loading || vendorLockLoading" @click="retryConfigDependencies">
                重试
              </el-button>
            </div>
            <template v-else>
            <div class="coverage-summary-strip">
              <div
                v-for="card in coverageSummaryCards"
                :key="card.key"
                class="coverage-summary-card"
                :class="`summary-${card.tone}`"
              >
                <span>{{ card.label }}</span>
                <strong>{{ card.value }}</strong>
              </div>
            </div>
            <AiConfigCoverageCards
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
            </template>
          </section>
          </div>

          <div
            id="ai-config-configs-panel"
            v-show="configWorkspaceView === 'configs'"
            class="config-workspace-panel config-management-panel"
            role="tabpanel"
            aria-labelledby="ai-config-mode-configs"
          >
          <AiConfigListToolbar
            :vendor-lock="vendorLock"
            :config-write-locked="configWriteLocked"
            :config-write-lock-reason="configWriteLockReason"
            :selected-rows="selectedRows"
            :batch-deleting="batchDeleting"
            :active-service-filter="activeServiceFilter"
            :filtered-count="filteredList.length"
            v-model:import-file-ref="importFileRef"
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
          />
          <p class="default-tip">生成任务会优先使用同类服务中已启用的默认配置。即梦2角色认证、认证资产库、图片识别和语音转写属于扩展能力，不计入上方五类基础生成服务。</p>
          <div ref="configListSectionRef" class="config-list-section">
          <el-table
            v-loading="loading"
            :data="filteredList"
            stripe
            style="width: 100%"
            @selection-change="onSelectionChange"
          >
            <el-table-column v-if="!vendorLock.enabled" type="selection" width="46" :selectable="isConfigRowSelectable" />
            <el-table-column prop="name" label="名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="provider" label="提供商" min-width="180" show-overflow-tooltip />
            <el-table-column prop="base_url" label="接口地址（Base URL）" min-width="170" show-overflow-tooltip />
            <el-table-column prop="default_model" label="默认模型" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.default_model || (Array.isArray(row.model) && row.model[0]) || '—' }}
              </template>
            </el-table-column>
            <el-table-column prop="service_type" label="类型" width="148">
              <template #default="{ row }">
                <span :class="['type-badge', 'type-' + row.service_type]">
                  <el-icon class="type-icon">
                    <ChatDotRound v-if="row.service_type === 'text'" />
                    <Picture v-else-if="row.service_type === 'image'" />
                    <Film v-else-if="row.service_type === 'storyboard_image'" />
                    <VideoCamera v-else-if="row.service_type === 'video'" />
                    <Microphone v-else-if="row.service_type === 'tts'" />
                    <Document v-else-if="row.service_type === 'ocr'" />
                    <Headset v-else-if="row.service_type === 'transcription'" />
                    <Key v-else-if="row.service_type === 'jimeng2_character_auth'" />
                    <Folder v-else-if="row.service_type === 'model_ark_asset'" />
                  </el-icon>
                  {{ serviceTypeLabel(row.service_type) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="is_default" label="默认" width="60">
              <template #default="{ row }">
                <el-tag v-if="row.is_default" type="success" size="small">✓</el-tag>
                <span v-else class="no-default">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" :aria-label="configActionLabel('测试', row)" @click="openTest(row)">测试</el-button>
                <el-button link type="primary" size="small" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" :aria-label="configActionLabel(vendorLock.enabled ? '修改密钥' : '编辑', row)" @click="onRowEdit(row)">{{ vendorLock.enabled ? '修改密钥' : '编辑' }}</el-button>
                <el-button v-if="!vendorLock.enabled" link type="danger" size="small" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" :aria-label="configActionLabel('删除', row)" @click="onDelete(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="config-empty-state">
                <el-icon class="config-empty-icon"><MagicStick /></el-icon>
                <strong>{{ configEmptyTitle }}</strong>
                <span>{{ configEmptyDescription }}</span>
                <div class="config-empty-actions">
                  <el-button
                    v-if="configListFailedEmpty"
                    type="primary"
                    size="small"
                    :loading="loading || vendorLockLoading"
                    @click="retryConfigDependencies"
                  >
                    重试
                  </el-button>
                  <el-button
                    v-else-if="!vendorLock.enabled && !configListPendingEmpty"
                    type="primary"
                    size="small"
                    :disabled="configWriteLocked"
                    :title="configWriteLocked ? configWriteLockReason : undefined"
                    @click="openAddForService(activeServiceFilter || 'text')"
                  >
                    <el-icon><Plus /></el-icon>
                    {{ activeServiceFilter ? `添加${serviceTypeLabel(activeServiceFilter)}配置` : '添加第一个配置' }}
                  </el-button>
                  <el-button v-if="activeServiceFilter && !configListFailedEmpty" size="small" @click="clearServiceFilter">查看全部</el-button>
                </div>
              </div>
            </template>
          </el-table>
          </div>
          </div>
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
        <div class="tab-content generation-settings">
          <div class="gs-section-title">⚡ 一键生成并发设置</div>
          <p class="gs-desc">控制「一键生成视频」和「补全并生成」流水线中，各类任务同时并行生成的数量。并发数越高速度越快，但过高可能触发接口限流（请求过于频繁）。建议根据你的 API 额度选择。</p>

          <div
            v-if="generationSettingsLoadState === 'error'"
            class="generation-settings-load-state generation-settings-load-state--error"
            role="alert"
            aria-live="assertive"
          >
            <div class="generation-settings-load-copy">
              <strong>生成设置读取失败</strong>
              <span>{{ generationSettingsLoadError }}</span>
            </div>
            <el-button size="small" type="primary" plain @click="loadGenerationSettings">重试</el-button>
          </div>
          <div
            v-else-if="generationSettingsLoadState === 'loading'"
            class="generation-settings-load-state"
            role="status"
            aria-live="polite"
          >
            正在读取生成设置...
          </div>
          <template v-else>
          <div class="gs-row">
            <span class="gs-label">图片并发数</span>
            <el-select
              v-model="genConcurrencyInput"
              filterable
              allow-create
              default-first-option
              aria-label="图片并发数"
              placeholder="选择或输入并发数"
              no-data-text="暂无可选项，可直接输入"
              style="width: 180px"
              @change="onConcurrencyChange"
            >
              <el-option label="1（串行，最稳定）" :value="1" />
              <el-option label="2" :value="2" />
              <el-option label="3（默认）" :value="3" />
              <el-option label="5" :value="5" />
              <el-option label="8" :value="8" />
              <el-option label="10" :value="10" />
            </el-select>
            <span class="gs-unit">个任务同时生成</span>
          </div>

          <div class="gs-row" style="margin-top: 10px">
            <span class="gs-label">视频并发数</span>
            <el-select
              v-model="genVideoConcurrencyInput"
              filterable
              allow-create
              default-first-option
              aria-label="视频并发数"
              placeholder="选择或输入并发数"
              no-data-text="暂无可选项，可直接输入"
              style="width: 180px"
              @change="onVideoConcurrencyChange"
            >
              <el-option label="1（串行，最稳定）" :value="1" />
              <el-option label="2" :value="2" />
              <el-option label="3（默认）" :value="3" />
              <el-option label="5" :value="5" />
              <el-option label="8" :value="8" />
              <el-option label="10" :value="10" />
            </el-select>
            <span class="gs-unit">个任务同时生成</span>
          </div>

          <div style="margin-top: 14px">
            <el-button
              type="primary"
              size="small"
              aria-label="保存生成设置"
              :loading="genSettingSaving"
              :disabled="generationSettingsWriteLocked"
              :title="generationSettingsWriteLocked ? generationSettingsWriteLockReason : undefined"
              @click="saveGenerationSettings"
            >保存</el-button>
          </div>
          <el-alert
            v-if="genSettingSaved"
            type="success"
            title="已保存"
            :closable="false"
            show-icon
            style="margin-top: 12px; width: fit-content"
          />
          </template>
          <div class="gs-tip-box">
            <div class="gs-tip-title">📌 适用范围</div>
            <ul class="gs-tip-list">
              <li>图片并发：步骤 2 角色图、步骤 4 场景图、步骤 6 分镜图</li>
              <li>视频并发：步骤 7 分镜视频</li>
            </ul>
          </div>
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
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { runWithOwnedRequestErrorToast } from '@/utils/request'
import { Plus, MagicStick, ChatDotRound, Picture, Film, VideoCamera, Key, Microphone, Folder, Document, Headset } from '@element-plus/icons-vue'
import { aiAPI } from '@/api/ai'
import { generationSettingsAPI } from '@/api/prompts'
import { useAiConfigGenerationSettings } from '@/composables/useAiConfigGenerationSettings.js'
import { useAiConfigOneKeyPresets } from '@/composables/useAiConfigOneKeyPresets.js'
import { useAiConfigImportExport } from '@/composables/useAiConfigImportExport.js'
import { useAiConfigRowMutations } from '@/composables/useAiConfigRowMutations.js'
import { useAiConfigDiscoverModels } from '@/composables/useAiConfigDiscoverModels.js'
import { useAiConfigVendorLock } from '@/composables/useAiConfigVendorLock.js'
import { useAiConfigJimeng2Assets } from '@/composables/useAiConfigJimeng2Assets.js'
import {
  parseModelText,
  isOpenAiCompatibleConfig,
  hasDiscoverableCredential,
} from '@/utils/aiConfigDiscoverModels.js'
import {
  hidesApiProtocolField,
  serviceTypeLabel,
  configActionLabel,
} from '@/utils/aiConfigLabels.js'
import { describeConnectionTestError } from '@/utils/aiConfigConnectionTest.js'
import {
  parseSettings,
  parseComfyWorkflowJson,
  isDeepSeekOfficial,
  resolveDeepSeekFormSettings,
} from '@/utils/aiConfigFormSettings.js'
import { applyProviderSelection } from '@/utils/aiConfigProviderSelection.js'
import { createBlankAiConfigForm, hydrateAiConfigForm } from '@/utils/aiConfigFormState.js'
import {
  findExistingDefaultConfig,
  buildReplaceDefaultConfirmCopy,
  buildAiConfigSubmitPayload,
} from '@/utils/aiConfigSubmitPayload.js'
import {
  buildAvailableProviderOptions,
  buildAvailableModels,
  providerModelEmptyHint as describeProviderModelEmptyHint,
  describeConfigEditTarget,
} from '@/utils/aiConfigProviderOptions.js'
import {
  applyServiceTypeChange,
  appendModelToList,
  applyPresetModelSelect,
} from '@/utils/aiConfigServiceTypeChange.js'
import { buildEndpointPreviewInfo } from '@/utils/aiConfigEndpointPreview.js'
import { buildAiServiceCoverage, sortAiServiceCoverage } from '@/utils/aiConfigCoverage.js'
import { useAiConfigCoverage } from '@/composables/useAiConfigCoverage.js'
import { useAiConfigWorkspaceView } from '@/composables/useAiConfigWorkspaceView.js'
import {
  DEFAULT_MODEL_VALIDATION_MESSAGE,
  isMaskedSecret,
  isDefaultModelSelectionValid as isValidDefaultModelSelection,
  configFormFingerprint as fingerprintConfigForm,
  useAiConfigUnsaved,
} from '@/composables/useAiConfigUnsaved.js'
import {
  createAiConfigConnectionStatusStore,
  resolveAiConfigConnectionStatusScope,
} from '@/utils/aiConfigConnectionStatusStore.js'
import {
  confirmAiConfigMutationInList,
  confirmAiConfigMutationResult,
  runAiConfigCreateBatch,
} from '@/utils/aiConfigMutations.js'
import { applyAiConfigRepairTarget } from '@/utils/aiConfigRepairTarget.js'
import { CUSTOM_PROVIDER_SENTINEL, getBaseUrlForProvider, getProviderEndpointDefaults, getProviderProtocol, isApiKeyOptionalProvider, providerConfigs } from '@/utils/aiProviderPresets.js'
import { buildProviderPricing, parseSettingsObject, readProviderPricingForm } from '@/utils/providerPricing.js'
import { shouldApplyConfigWorkspaceRequest } from '@/utils/aiConfigWorkspace.js'
import PromptEditor from '@/components/PromptEditor.vue'
import SceneModelMap from '@/components/SceneModelMap.vue'
import Sd2AssetManagement from '@/components/Sd2AssetManagement.vue'
import AiConfigCoverageCards from '@/components/aiConfig/AiConfigCoverageCards.vue'
import AiConfigDependencyErrorBar from '@/components/aiConfig/AiConfigDependencyErrorBar.vue'
import AiConfigListToolbar from '@/components/aiConfig/AiConfigListToolbar.vue'
import AiConfigFormDialog from '@/components/aiConfig/AiConfigFormDialog.vue'
import AiConfigOneKeyDialogs from '@/components/aiConfig/AiConfigOneKeyDialogs.vue'
import AiConfigBulkKeyDialog from '@/components/aiConfig/AiConfigBulkKeyDialog.vue'
import AiConfigConnectionTestDialog from '@/components/aiConfig/AiConfigConnectionTestDialog.vue'
import AiConfigJimeng2AssetsDialog from '@/components/aiConfig/AiConfigJimeng2AssetsDialog.vue'
import { createOperationId, logOperation } from '@/utils/operationLog'
import {
  DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
  DEFAULT_JSON_TIMEOUT_MS,
  describeServiceLoadError,
  isRequestCanceled,
  isRequestTimeout,
  withRequestRetry,
} from '@/utils/requestError'
const props = defineProps({
  initialServiceType: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['configuration-changed'])

function notifyConfigurationChanged() {
  emit('configuration-changed')
}

const filterableServiceTypes = new Set(['text', 'image', 'storyboard_image', 'video', 'tts', 'ocr', 'transcription'])

function normalizeInitialServiceType(value) {
  const normalized = String(value || '').trim()
  return filterableServiceTypes.has(normalized) ? normalized : ''
}

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
const sessionTestStatusById = ref({})
let connectionStatusStore = createAiConfigConnectionStatusStore()
let configListAbortController = null
let connectionTestAbortController = null
let connectionStatusScopeAbortController = null
let lastTestedConfig = null
let abortDiscoverModelsRequest = () => {}
let resetDiscoverModelsState = () => {}
let abortVendorLockRequest = () => {}

function abortAiConfigPageRequests() {
  configListAbortController?.abort()
  abortVendorLockRequest()
  abortGenerationSettingsRequest()
  connectionTestAbortController?.abort()
  connectionStatusScopeAbortController?.abort()
  abortDiscoverModelsRequest()
  configListAbortController = null
  connectionTestAbortController = null
  connectionStatusScopeAbortController = null
}

function jsonRequestOptions(signal, timeout = DEFAULT_JSON_TIMEOUT_MS) {
  return { signal, timeout, suppressErrorToast: true }
}

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

async function initializeConnectionStatusStore() {
  connectionStatusScopeAbortController?.abort()
  const controller = new AbortController()
  connectionStatusScopeAbortController = controller
  const scope = await resolveAiConfigConnectionStatusScope({
    fallbackScope: import.meta.env.VITE_LOCALMINIDRAMA_INSTANCE_ID || '',
    signal: controller.signal,
  })
  if (controller.signal.aborted) return
  connectionStatusStore = createAiConfigConnectionStatusStore({ scope })
}

function invalidateConnectionTestResults() {
  connectionStatusStore.invalidateAll()
  sessionTestStatusById.value = {}
}
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

const formModelList = computed(() => parseModelText(form.value.modelText))
const discoverModelsDisabledReason = computed(() => {
  if (!String(form.value.base_url || '').trim()) return '请先填写接口地址'
  if (hasDiscoverableCredential(form.value)) return ''
  return '请先填写 API 密钥后再读取模型'
})
const discoverModelsDisabled = computed(() => Boolean(discoverModelsDisabledReason.value))
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
const isDefaultModelUnavailable = computed(() => {
  const selected = String(form.value.default_model || '').trim()
  return Boolean(selected && !formModelList.value.includes(selected))
})

function isDefaultModelSelectionValid(value) {
  return isValidDefaultModelSelection(value, {
    isComfyUi: isComfyUiForm.value,
    modelList: formModelList.value,
  })
}

const defaultModelRules = [
  {
    validator: (_rule, value, cb) => {
      if (isDefaultModelSelectionValid(value)) return cb()
      cb(new Error(DEFAULT_MODEL_VALIDATION_MESSAGE))
    },
    trigger: 'change',
  },
]

// 新增配置延续首项默认值；用户手填的自定义模型会同步进列表，避免被首项覆盖。编辑时保留已失效历史值。
watch(
  () => [formModelList.value, form.value.default_model],
  () => {
    const list = formModelList.value
    const current = String(form.value.default_model || '').trim()
    if (current && !list.includes(current) && form.value.service_type !== 'jimeng2_character_auth') {
      if (!editingId.value) ensureModelInList(current)
      return
    }
    if (editingId.value || list.length === 0) return
    if (!current || !list.includes(current)) {
      form.value.default_model = list[0] || ''
    }
  },
  { immediate: true }
)

function onServiceTypeChange() {
  applyServiceTypeChange(form.value, { editingId: editingId.value })
}

function ensureModelInList(modelName) {
  appendModelToList(form.value, modelName)
}

function onPresetModelSelect(value) {
  applyPresetModelSelect(form.value, value)
  presetModelPick.value = ''
}

function onDefaultModelChange(value) {
  appendModelToList(form.value, value)
}

const rules = computed(() => ({
  service_type: [{ required: true, message: '请选择服务类型', trigger: 'change' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择或输入厂商', trigger: 'change' }],
  base_url: [{ required: true, message: '请输入接口地址（Base URL）', trigger: 'blur' }],
  api_key: [
    {
      validator: (_rule, v, cb) => {
        const st = form.value.service_type
        if (st === 'jimeng2_character_auth') {
          if (v != null && String(v).trim()) return cb()
          return cb(new Error('请填写令牌（Token）'))
        }
        const proto = form.value.api_protocol
        if (isApiKeyOptionalProvider(form.value.provider, proto)) return cb()
        const ak = (form.value.kling_access_key || '').trim()
        const sk = (form.value.kling_secret_key || '').trim()
        if (st === 'video' && proto === 'kling_omni' && ak && sk) return cb()
        if (v != null && String(v).trim()) return cb()
        cb(new Error('请输入 API 密钥，或使用官方 AccessKey + SecretKey（可不填 API 密钥）'))
      },
      trigger: 'blur',
    },
  ],
  api_protocol: [
    {
      validator: (_rule, value, cb) => {
        const st = form.value.service_type
        const protocolVisible = !hidesApiProtocolField(st)
        const presetProvider = (providerConfigs[st] || []).some((item) => item.id === form.value.provider)
        if (!protocolVisible || presetProvider || String(value || '').trim()) return cb()
        cb(new Error('自定义厂商请选择接口规范'))
      },
      trigger: 'change',
    },
  ],
  endpoint: [
    {
      validator: (_rule, value, cb) => {
        const st = form.value.service_type
        const presetProvider = (providerConfigs[st] || []).some((item) => item.id === form.value.provider)
        if (st !== 'video' || presetProvider || String(value || '').trim()) return cb()
        cb(new Error('自定义视频厂商请输入提交端点'))
      },
      trigger: 'blur',
    },
  ],
  modelText: [
    {
      validator: (_rule, value, cb) => {
        if (form.value.service_type === 'jimeng2_character_auth' || isComfyUiForm.value || parseModelText(value).length > 0) return cb()
        cb(new Error('请填写至少一个模型'))
      },
      trigger: 'blur',
    },
  ],
  default_model: defaultModelRules,
  comfy_workflow_json: [
    {
      validator: (_rule, value, cb) => {
        if (!isComfyUiForm.value) return cb()
        try {
          parseComfyWorkflowJson(value)
          cb()
        } catch (error) {
          cb(error)
        }
      },
      trigger: 'blur',
    },
  ],
}))
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

const configWriteLocked = computed(() => (
  configLoadState.value !== 'ready'
  || !vendorLockResolved.value
  || saving.value
  || bulkKeySaving.value
  || batchDeleting.value
  || oneKeyTongyiSaving.value
  || oneKeyVolcSaving.value
  || oneKeyAgnesSaving.value
))

const configWriteLockReason = computed(() => {
  if (saving.value) return '正在保存配置，请稍候'
  if (bulkKeySaving.value) return '正在批量替换密钥，请稍候'
  if (batchDeleting.value) return '正在批量删除配置，请稍候'
  if (oneKeyTongyiSaving.value || oneKeyVolcSaving.value || oneKeyAgnesSaving.value) {
    return '正在一键配置，请稍候'
  }
  if (configLoadState.value !== 'ready') return '配置列表尚未就绪'
  if (!vendorLockResolved.value) return '厂商锁定状态尚未解析'
  return ''
})

function formatJimeng2AssetCreatedAt(value) {
  const timestamp = Date.parse(String(value ?? ''))
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

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
  ElMessageBox,
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

const configListPendingEmpty = computed(() => (
  !list.value.length && configLoadState.value !== 'ready' && configLoadState.value !== 'error'
))
const configListFailedEmpty = computed(() => (
  !list.value.length && configLoadState.value === 'error'
))
const configEmptyTitle = computed(() => {
  if (configListFailedEmpty.value) return '暂时无法读取配置列表'
  if (configListPendingEmpty.value) return '正在读取配置列表'
  if (activeServiceFilter.value) return `暂无${serviceTypeLabel(activeServiceFilter.value)}配置`
  return '还没有 AI 服务配置'
})
const configEmptyDescription = computed(() => {
  if (configListFailedEmpty.value) {
    return configLoadError.value || '请点击重试后再查看或添加配置。'
  }
  if (configListPendingEmpty.value) return '正在从本地服务读取已保存的厂商配置。'
  if (activeServiceFilter.value === 'ocr') return '添加一个配置并设为默认，即可用于 PDF/图片识别。'
  if (activeServiceFilter.value === 'transcription') return '添加一个配置并设为默认，即可用于音频/视频转写。'
  if (activeServiceFilter.value) return '添加一个配置并设为默认，即可用于对应生成环节。'
  return '先添加文本、图片或视频厂商，生成流程会自动使用默认配置。'
})

const configDependencyError = computed(() => (
  [configLoadError.value, vendorLockError.value].filter(Boolean).join('；')
))

watch(configWriteLocked, (locked) => {
  if (locked) selectedRows.value = []
})

const canAutoOpenMissingService = computed(() => (
  configLoadState.value === 'ready' && vendorLockResolved.value
))

const {
  coverageActions,
  onCoverageSelect,
  onCoverageAction,
  shouldAutoOpenRequestedService,
  focusServiceConfigs,
  applyRequestedService,
  setCoverageCardRef,
  isCoverageActionTesting: isCoverageActionTestingFromCoverage,
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

function clearServiceFilter() {
  activeServiceFilter.value = ''
}

function isCoverageActionTesting(item, action) {
  return isCoverageActionTestingFromCoverage(item, action)
}

function isCoverageActionDisabled(item, action) {
  if (['add', 'edit'].includes(action.action)) return configWriteLocked.value
  if (action.action !== 'test') return false
  return isCoverageActionTesting(item, action) || testingConfigId.value !== null
}

function isConfigRowSelectable() {
  return !configWriteLocked.value
}

async function restoreTestedCoverageCardFocus() {
  connectionTestAbortController?.abort()
  await restoreCoverageCardFocus()
}

const isDeepSeekOfficialForm = computed(() => (
  form.value.service_type === 'text'
  && isDeepSeekOfficial(form.value.provider, form.value.base_url)
))

const isComfyUiForm = computed(() => (
  ['image', 'storyboard_image'].includes(String(form.value.service_type || '').toLowerCase())
    && ['comfyui', 'comfy_ui'].includes(String(form.value.api_protocol || form.value.provider || '').toLowerCase())
))

/** 当前服务类型下的预设厂商列表（编辑时若当前 provider 不在列表则补一项；末尾始终附一项自定义入口） */
const availableProviderOptions = computed(() => buildAvailableProviderOptions(
  form.value.service_type,
  form.value.provider,
  { editingId: editingId.value },
))

/** 当前厂商的预设模型列表（用于追加预设模型） */
const availableModels = computed(() => buildAvailableModels(form.value.service_type, form.value.provider))

const providerModelEmptyHint = computed(() => describeProviderModelEmptyHint(
  form.value.service_type,
  form.value.provider,
  availableModels.value,
))

const endpointPreviewInfo = computed(() => buildEndpointPreviewInfo(form.value))

function onProviderChange(providerId) {
  applyProviderSelection(form.value, providerId, { editingId: editingId.value })
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

function resetForm() {
  resetDiscoverModelsState()
  editingId.value = null
  editingUpdatedAt.value = ''
  presetModelPick.value = ''
  advancedFormSections.value = []
  clearConfigValidationSummary()
  form.value = createBlankAiConfigForm()
  formRef.value?.resetFields?.()
}

function configFormFingerprint() {
  return fingerprintConfigForm(form.value)
}

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

function openConfigDialog() {
  configDialogSaved.value = false
  clearConfigValidationSummary()
  dialogVisible.value = true
  nextTick(() => {
    configFormBaseline.value = configFormFingerprint()
    if (configDialogScrollRef.value) configDialogScrollRef.value.scrollTop = 0
  })
}

function handleConfigDialogClosed() {
  resetForm()
  configFormBaseline.value = ''
  configDialogSaved.value = false
}

function openAdd() {
  if (configWriteLocked.value) return
  resetForm()
  openConfigDialog()
}

function openAddForService(serviceType) {
  if (configWriteLocked.value) return
  resetForm()
  form.value.service_type = serviceType || 'text'
  activeServiceFilter.value = form.value.service_type
  onServiceTypeChange()
  openConfigDialog()
}

async function openEdit(row, { repairIssue = '' } = {}) {
  if (configWriteLocked.value) return
  editingId.value = row.id
  editingUpdatedAt.value = String(row.updated_at || '')
  advancedFormSections.value = []
  form.value = hydrateAiConfigForm(row)
  openConfigDialog()
  await applyAiConfigRepairTarget(repairIssue, {
    advancedSections: advancedFormSections,
    fieldRefs: {
      credentials: apiKeyInputRef,
      model: modelListInputRef,
      workflow: workflowInputRef,
    },
    nextTickFn: nextTick,
  })
}

async function confirmReplaceDefaultConfig() {
  if (!form.value.is_default) return true
  const existing = findExistingDefaultConfig(list.value, form.value.service_type, editingId.value)
  if (!existing) return true
  const copy = buildReplaceDefaultConfirmCopy(form.value, existing)
  try {
    await ElMessageBox.confirm(
      copy.message,
      copy.title,
      { type: 'warning', confirmButtonText: copy.confirmButtonText, cancelButtonText: copy.cancelButtonText },
    )
    return true
  } catch (error) {
    if (!isUserFacingAbort(error)) {
      ElMessage.error(toUserFacingError(error, '无法确认保存'))
    }
    return false
  }
}

async function submit() {
  if (configWriteLocked.value) return
  try {
    await formRef.value?.validate?.()
  } catch (invalidFields) {
    await handleConfigValidationFailure(invalidFields)
    return
  }
  clearConfigValidationSummary()
  if (!await confirmReplaceDefaultConfig()) return
  if (configWriteLocked.value) return
  saving.value = true
  try {
    const previous = editingId.value
      ? list.value.find((row) => String(row.id) === String(editingId.value))
      : null
    const payload = buildAiConfigSubmitPayload(form.value, {
      editingId: editingId.value,
      editingUpdatedAt: editingUpdatedAt.value,
      previous,
      isComfyUi: isComfyUiForm.value,
      isDeepSeekOfficial: isDeepSeekOfficialForm.value,
    })
    const wasEditing = Boolean(editingId.value)
    const mutationResult = await runWithOwnedRequestErrorToast(async () => (
      wasEditing
        ? await aiAPI.update(editingId.value, payload)
        : await aiAPI.create(payload)
    ))
    const serverConfirmation = confirmAiConfigMutationResult(mutationResult, payload, previous || {})
    if (!serverConfirmation) {
      await loadList()
      ElMessage.error('服务端返回的配置快照与本次提交不一致，未确认保存结果，请重新打开配置核对。')
      return
    }
    const listConfirmed = await loadList()
    const listMatches = listConfirmed && confirmAiConfigMutationInList(serverConfirmation, list.value)
    invalidateConnectionTestResults()
    notifyConfigurationChanged()
    configDialogSaved.value = true
    configFormBaseline.value = configFormFingerprint()
    dialogVisible.value = false
    if (listMatches) ElMessage.success(wasEditing ? '保存成功' : '添加成功')
    else ElMessage.warning('服务端已确认保存，但配置列表刷新或并发校验未完全一致，请刷新后复核。')
  } catch (e) {
    if (isUserFacingAbort(e)) return
    if (e?.response?.status === 409) {
      await loadList()
      ElMessage.warning('配置已被其他操作更新，本次修改未覆盖现有配置，请重新打开后再保存。')
      return
    }
    ElMessage.error(toUserFacingError(e, '保存失败'))
  } finally {
    saving.value = false
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
      if (testVisible.value && testingConfigId.value === row.id) {
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
    if (testingConfigId.value === row.id) testingConfigId.value = null
  }
}

function retryConnectionTest() {
  if (!lastTestedConfig || testingConfigId.value !== null) return
  openTest(lastTestedConfig)
}

async function retryConfigDependencies() {
  await Promise.all([loadVendorLock(), loadList()])
}

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
.config-workspace-panel {
  min-width: 0;
}
.coverage-panel {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-bg-color, #fff);
}
.coverage-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 14px;
}
.coverage-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.coverage-title-row h2 {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0;
}
.coverage-header p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
.coverage-test-note {
  max-width: 260px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
  text-align: right;
}
.coverage-unresolved-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 88px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
.coverage-unresolved-state--error {
  border-color: var(--ai-config-danger-border, #fbc4c4);
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
}
.coverage-unresolved-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.coverage-unresolved-copy strong {
  font-size: 13px;
  line-height: 18px;
}
.coverage-unresolved-copy span,
.config-empty-state > span {
  overflow-wrap: anywhere;
}
.coverage-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.coverage-summary-card {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-blank, #fff);
}
.coverage-summary-card span {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 18px;
}
.coverage-summary-card strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
}
.coverage-summary-card.summary-success {
  border-color: var(--ai-config-success-border, rgba(16, 185, 129, 0.24));
  background: var(--ai-config-success-surface, #ecfdf5);
}
.coverage-summary-card.summary-warning {
  border-color: var(--ai-config-warning-border, rgba(245, 158, 11, 0.24));
  background: var(--ai-config-warning-surface, #fffbeb);
}
.coverage-summary-card.summary-danger {
  border-color: var(--ai-config-danger-border, rgba(239, 68, 68, 0.24));
  background: var(--ai-config-danger-surface, #fef2f2);
}
.coverage-summary-card.summary-info {
  border-color: var(--ai-config-info-border, rgba(59, 130, 246, 0.24));
  background: var(--ai-config-info-surface, #eff6ff);
}
.coverage-summary-card.summary-success strong { color: var(--ai-config-success-text, #047857); }
.coverage-summary-card.summary-warning strong { color: var(--ai-config-warning-text, #a16207); }
.coverage-summary-card.summary-danger strong { color: var(--ai-config-danger-text, #b91c1c); }
.coverage-summary-card.summary-info strong { color: var(--ai-config-info-text, #0369a1); }
.config-empty-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-regular, #606266);
}
.config-empty-state strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 14px;
}
.config-empty-state > span {
  max-width: 440px;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}
.config-empty-icon {
  color: var(--el-color-primary, #409eff);
  font-size: 28px;
}
.config-empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.config-list-section {
  scroll-margin-top: 88px;
}
/* 类型徽章 */
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
}
.type-icon {
  font-size: 13px;
  flex-shrink: 0;
}
/* 文本/对话 — 蓝色 */
.type-text {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.25);
}
/* 文本生成图片 — 绿色 */
.type-image {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.25);
}
/* 分镜图片生成 — 紫色 */
.type-storyboard_image {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
  border-color: rgba(139, 92, 246, 0.25);
}
/* 视频 — 橙色 */
.type-video {
  background: rgba(249, 115, 22, 0.12);
  color: #f97316;
  border-color: rgba(249, 115, 22, 0.25);
}
.type-ocr {
  background: rgba(14, 165, 233, 0.12);
  color: #0284c7;
  border-color: rgba(14, 165, 233, 0.25);
}
.type-transcription {
  background: rgba(234, 88, 12, 0.12);
  color: #c2410c;
  border-color: rgba(234, 88, 12, 0.25);
}
.type-jimeng2_character_auth {
  background: rgba(20, 184, 166, 0.14);
  color: #0d9488;
  border-color: rgba(20, 184, 166, 0.28);
}
.type-model_ark_asset {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.25);
}
.no-default {
  color: var(--el-text-color-secondary, #9ca3af);
  font-size: 13px;
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
.default-tip {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-info-border, #bae6fd);
  background: var(--ai-config-info-surface, #f0f9ff);
  border-radius: 6px;
  font-size: 13px;
  color: var(--ai-config-info-text, #0369a1);
  line-height: 1.5;
}
.generation-settings {
  max-width: 600px;
}
.generation-settings-load-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
}
.generation-settings-load-state--error {
  border-color: var(--el-color-danger-light-5, #fab6b6);
  background: var(--el-color-danger-light-9, #fef0f0);
}
.generation-settings-load-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}
.generation-settings-load-copy strong {
  color: var(--el-color-danger, #f56c6c);
}
.generation-settings-load-copy span {
  overflow-wrap: anywhere;
}
.gs-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.gs-desc {
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.6;
  margin-bottom: 20px;
}
.gs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.gs-label {
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  font-weight: 500;
  white-space: nowrap;
}
.gs-unit {
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  white-space: nowrap;
}
.gs-tip-box {
  margin-top: 20px;
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 13px;
}
.gs-tip-title {
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.gs-tip-list {
  margin: 0 0 8px 16px;
  padding: 0;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.8;
}
.gs-tip-note {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}
@media (max-width: 1440px) {
  .coverage-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
  .coverage-summary-strip {
    grid-template-columns: minmax(0, 1fr);
  }
  .coverage-header,
  .generation-settings-load-state {
    align-items: stretch;
    flex-direction: column;
  }
  .coverage-header {
    gap: 8px;
  }
  .coverage-test-note {
    max-width: none;
    text-align: left;
  }
  .config-workspace-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    box-sizing: border-box;
  }
  .config-workspace-mode {
    min-width: 0;
  }
  .config-empty-actions,
  .pricing-field-row,
  .gs-row {
    flex-wrap: wrap;
  }
  .config-section-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .pricing-help {
    margin-left: 0;
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
@media (max-width: 520px) {
  .coverage-panel,
  .config-form-section {
    padding: 12px;
  }
  .config-workspace-switch {
    grid-template-columns: minmax(0, 1fr);
  }
  .config-empty-actions {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }
  .config-empty-actions :deep(.el-button) {
    margin-left: 0;
    width: 100%;
  }
  .advanced-config-title {
    align-items: flex-start;
    flex-direction: column;
  }
  .ep-row {
    flex-direction: column;
  }
  .ep-label {
    min-width: 0;
  }
}
</style>
