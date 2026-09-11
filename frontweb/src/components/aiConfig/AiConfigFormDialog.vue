<template>
    <!-- 添加/编辑 -->
    <AccessibleDialog
      v-model="dialogVisible"
      :title="vendorLock.enabled ? '修改 API 密钥 / 默认模型' : (editingId ? '编辑配置' : '添加配置')"
      width="720px"
      top="4vh"
      class="ai-config-dialog ai-config-form-dialog ai-config-overlay"
      append-to-body
      :close-on-click-modal="false"
      :before-close="confirmConfigDialogClose"
      @closed="handleConfigDialogClosed"
    >
      <div :ref="bindConfigDialogScrollRef" class="ai-config-dialog-scroll">
        <div
          v-if="configValidationSummary.length"
          class="ai-config-validation-summary"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <strong>无法保存，请检查以下字段：</strong>
          <ul>
            <li v-for="item in configValidationSummary" :key="item.prop">
              {{ configFieldDisplayLabel(item.label) }}：{{ item.message }}
            </li>
          </ul>
        </div>
      <!-- 锁定模式：只展示 api_key 和 default_model -->
      <template v-if="vendorLock.enabled">
        <AiConfigFormLockSection
          :form="form"
          :config-write-locked="configWriteLocked"
          :default-model-rules="defaultModelRules"
          :form-model-list="formModelList"
          :is-default-model-unavailable="isDefaultModelUnavailable"
          :bind-form-ref="bindFormRef"
          :bind-api-key-input-ref="bindApiKeyInputRef"
          :handle-config-field-validated="handleConfigFieldValidated"
          :is-config-field-invalid="isConfigFieldInvalid"
          :config-field-description-id="configFieldDescriptionId"
          :config-field-description="configFieldDescription"
        />
      </template>

      <!-- 普通模式：完整表单 -->
      <el-form v-else :ref="bindFormRef" :model="form" :rules="rules" label-width="100px" @validate="handleConfigFieldValidated">
        <AiConfigFormBasicSection
          :form="form"
          :editing-id="editingId"
          :is-config-field-invalid="isConfigFieldInvalid"
          :config-field-description-id="configFieldDescriptionId"
          :config-field-description="configFieldDescription"
          :on-service-type-change="onServiceTypeChange"
        />
        <AiConfigFormVendorSection
          :form="form"
          :available-provider-options="availableProviderOptions"
          :jimeng2-assets-loading="jimeng2AssetsLoading"
          :bind-api-key-input-ref="bindApiKeyInputRef"
          :is-config-field-invalid="isConfigFieldInvalid"
          :config-field-description-id="configFieldDescriptionId"
          :config-field-description="configFieldDescription"
          :on-provider-change="onProviderChange"
          :open-jimeng2-material-assets-dialog="openJimeng2MaterialAssetsDialog"
        />
        <AiConfigFormEndpointSection
          :form="form"
          v-model:advanced-form-sections="advancedFormSections"
          v-model:show-protocol-help="showProtocolHelp"
          :is-comfy-ui-form="isComfyUiForm"
          :endpoint-preview-info="endpointPreviewInfo"
          :can-configure-local-http="canConfigureLocalHttp"
          :bind-workflow-input-ref="bindWorkflowInputRef"
          :is-config-field-invalid="isConfigFieldInvalid"
          :config-field-description-id="configFieldDescriptionId"
          :config-field-description="configFieldDescription"
        />
        <AiConfigFormModelSection
          v-if="form.service_type !== 'jimeng2_character_auth'"
          :form="form"
          v-model:preset-model-pick="presetModelPick"
          :available-models="availableModels"
          :discover-models-loading="discoverModelsLoading"
          :discover-models-disabled="discoverModelsDisabled"
          :discover-models-disabled-reason="discoverModelsDisabledReason"
          :provider-model-empty-hint="providerModelEmptyHint"
          :form-model-list="formModelList"
          :is-default-model-unavailable="isDefaultModelUnavailable"
          :is-deep-seek-official-form="isDeepSeekOfficialForm"
          :is-config-field-invalid="isConfigFieldInvalid"
          :config-field-description-id="configFieldDescriptionId"
          :config-field-description="configFieldDescription"
          :set-model-list-input-ref="setModelListInputRef"
          :discover-models-from-service="discoverModelsFromService"
          :on-preset-model-select="onPresetModelSelect"
          :on-default-model-change="onDefaultModelChange"
        />
        <AiConfigFormPolicySection
          :form="form"
          :config-write-locked="configWriteLocked"
        />
      </el-form>
      </div>
      <template #footer>
        <el-button aria-label="取消编辑配置" @click="requestConfigDialogClose">取消</el-button>
        <el-button type="primary" aria-label="保存配置" :loading="saving" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="submit">保存</el-button>
      </template>
    </AccessibleDialog>
</template>

<script setup>
import AiConfigFormBasicSection from '@/components/aiConfig/AiConfigFormBasicSection.vue'
import AiConfigFormEndpointSection from '@/components/aiConfig/AiConfigFormEndpointSection.vue'
import AiConfigFormLockSection from '@/components/aiConfig/AiConfigFormLockSection.vue'
import AiConfigFormModelSection from '@/components/aiConfig/AiConfigFormModelSection.vue'
import AiConfigFormPolicySection from '@/components/aiConfig/AiConfigFormPolicySection.vue'
import AiConfigFormVendorSection from '@/components/aiConfig/AiConfigFormVendorSection.vue'
import { configFieldDisplayLabel } from '@/utils/aiConfigLabels.js'

defineOptions({ inheritAttrs: false })

defineProps({
  vendorLock: { type: Object, required: true },
  editingId: { default: null },
  configValidationSummary: { type: Array, default: () => [] },
  configWriteLocked: { type: Boolean, default: false },
  configWriteLockReason: { type: String, default: '' },
  saving: { type: Boolean, default: false },
  defaultModelRules: { type: Array, default: () => [] },
  rules: { type: Object, default: () => ({}) },
  formModelList: { type: Array, default: () => [] },
  isDefaultModelUnavailable: { type: Boolean, default: false },
  isComfyUiForm: { type: Boolean, default: false },
  isDeepSeekOfficialForm: { type: Boolean, default: false },
  availableProviderOptions: { type: Array, default: () => [] },
  endpointPreviewInfo: { default: null },
  jimeng2AssetsLoading: { type: Boolean, default: false },
  availableModels: { type: Array, default: () => [] },
  discoverModelsLoading: { type: Boolean, default: false },
  discoverModelsDisabled: { type: Boolean, default: false },
  discoverModelsDisabledReason: { type: String, default: '' },
  providerModelEmptyHint: { type: String, default: '' },
  canConfigureLocalHttp: { type: Boolean, default: false },
  confirmConfigDialogClose: { type: Function, required: true },
  handleConfigDialogClosed: { type: Function, required: true },
  requestConfigDialogClose: { type: Function, required: true },
  submit: { type: Function, required: true },
  handleConfigFieldValidated: { type: Function, required: true },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
  onServiceTypeChange: { type: Function, required: true },
  onProviderChange: { type: Function, required: true },
  onDefaultModelChange: { type: Function, required: true },
  openJimeng2MaterialAssetsDialog: { type: Function, required: true },
  setModelListInputRef: { type: Function, required: true },
  discoverModelsFromService: { type: Function, required: true },
  onPresetModelSelect: { type: Function, required: true },
})

const dialogVisible = defineModel('dialogVisible', { type: Boolean, default: false })
const showProtocolHelp = defineModel('showProtocolHelp', { type: Boolean, default: false })
const form = defineModel('form', { type: Object })
const advancedFormSections = defineModel('advancedFormSections', { type: Array, default: () => [] })
const presetModelPick = defineModel('presetModelPick', { type: String, default: '' })
const formRef = defineModel('formRef')
const apiKeyInputRef = defineModel('apiKeyInputRef')
const configDialogScrollRef = defineModel('configDialogScrollRef')
const workflowInputRef = defineModel('workflowInputRef')

// 把内部表单节点回写给父组件，提交校验、修复聚焦和滚动仍由页面持有
function bindFormRef(el) {
  formRef.value = el
}
function bindApiKeyInputRef(el) {
  apiKeyInputRef.value = el
}
function bindConfigDialogScrollRef(el) {
  configDialogScrollRef.value = el
}
function bindWorkflowInputRef(el) {
  workflowInputRef.value = el
}
</script>

<style>
.ai-config-form-dialog {
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-config-form-dialog > .el-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>

<style scoped>
.ai-config-dialog-scroll {
  max-height: calc(92vh - 150px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 4px;
  scrollbar-gutter: stable;
}
.ai-config-validation-summary {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-danger-border, #fbc4c4);
  border-radius: 6px;
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.ai-config-validation-summary strong {
  display: block;
  font-size: 13px;
  line-height: 20px;
}
.ai-config-validation-summary ul {
  margin: 4px 0 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.6;
}
@media (max-width: 760px) {
  :deep(.el-form-item__content),
  :deep(.el-input),
  :deep(.el-select) {
    min-width: 0;
    max-width: 100%;
  }
}
</style>
