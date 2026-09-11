<template>
  <section class="config-form-section">
    <div class="config-section-header">
      <div>
        <h4>模型</h4>
        <p>维护该厂商可用模型，并指定生成任务实际使用的默认模型。</p>
      </div>
      <span class="config-section-index">03</span>
    </div>
    <AiConfigModelListSection
      :form="form"
      v-model:preset-model-pick="presetModelPick"
      :available-models="availableModels"
      :discover-models-loading="discoverModelsLoading"
      :discover-models-disabled="discoverModelsDisabled"
      :discover-models-disabled-reason="discoverModelsDisabledReason"
      :provider-model-empty-hint="providerModelEmptyHint"
      :is-config-field-invalid="isConfigFieldInvalid"
      :config-field-description-id="configFieldDescriptionId"
      :config-field-description="configFieldDescription"
      :set-model-list-input-ref="setModelListInputRef"
      :discover-models-from-service="discoverModelsFromService"
      :on-preset-model-select="onPresetModelSelect"
    />
    <el-form-item prop="default_model">
      <template #label>
        <span class="form-label-tip">默认模型
          <el-tooltip content="有多个模型时，实际调用哪个进行生成。建议选响应快、效果好的那个。" placement="top" popper-class="cfg-tip-popper">
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-select
        v-model="form.default_model"
        data-ai-config-field="default_model"
        aria-label="默认模型"
        placeholder="选择或输入默认模型名"
        no-data-text="暂无模型，可直接输入或先填写模型列表"
        clearable
        filterable
        allow-create
        default-first-option
        style="width: 100%"
        :aria-invalid="isConfigFieldInvalid('default_model') || isDefaultModelUnavailable"
        :aria-describedby="configFieldDescriptionId('default_model')"
        @change="onDefaultModelChange"
      >
        <el-option
          v-if="isDefaultModelUnavailable"
          :label="`${form.default_model}（已失效）`"
          :value="form.default_model"
          disabled
        />
        <el-option v-for="m in formModelList" :key="m" :label="m" :value="m" />
      </el-select>
      <p v-if="isDefaultModelUnavailable" class="field-tip field-tip-warning" role="alert">
        当前默认模型已不在模型列表中，请显式选择有效模型后保存。
      </p>
      <p v-else-if="!formModelList.length" class="field-tip">下一步：先在上方填写模型列表，或直接输入默认模型名。</p>
      <p v-else class="field-tip">可搜索已有模型，也可直接输入自定义模型名；输入后会加入上方模型列表。</p>
      <span :id="configFieldDescriptionId('default_model')" class="config-field-a11y-description">
        {{ configFieldDescription('default_model') }}
      </span>
    </el-form-item>
    <el-form-item v-if="isDeepSeekOfficialForm">
      <template #label>
        <span class="form-label-tip">思考模式
          <el-tooltip placement="top" popper-class="cfg-tip-popper">
            <template #content>
              <div class="cfg-tip-content">
                DeepSeek V4 官方模型用 thinking 参数控制思考模式。<br>
                关闭思考对应旧 deepseek-chat；开启思考对应旧 deepseek-reasoner。
              </div>
            </template>
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <div class="deepseek-settings">
        <el-radio-group v-model="form.deepseek_thinking">
          <el-radio-button label="disabled">关闭思考</el-radio-button>
          <el-radio-button label="enabled">开启思考</el-radio-button>
        </el-radio-group>
        <el-select
          v-if="form.deepseek_thinking === 'enabled'"
          v-model="form.deepseek_reasoning_effort"
          aria-label="思考强度"
          no-data-text="暂无可选思考强度"
          style="width: 140px"
        >
          <el-option label="高（high）" value="high" />
          <el-option label="最高（max）" value="max" />
        </el-select>
      </div>
      <p class="field-tip">官方旧模型名将在 2026-07-24 废弃；新配置建议使用 deepseek-v4-flash 或 deepseek-v4-pro。</p>
    </el-form-item>
  </section>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'
import AiConfigModelListSection from '@/components/aiConfig/AiConfigModelListSection.vue'

defineProps({
  form: { type: Object, required: true },
  availableModels: { type: Array, default: () => [] },
  discoverModelsLoading: { type: Boolean, default: false },
  discoverModelsDisabled: { type: Boolean, default: false },
  discoverModelsDisabledReason: { type: String, default: '' },
  providerModelEmptyHint: { type: String, default: '' },
  formModelList: { type: Array, default: () => [] },
  isDefaultModelUnavailable: { type: Boolean, default: false },
  isDeepSeekOfficialForm: { type: Boolean, default: false },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
  setModelListInputRef: { type: Function, required: true },
  discoverModelsFromService: { type: Function, required: true },
  onPresetModelSelect: { type: Function, required: true },
  onDefaultModelChange: { type: Function, required: true },
})

const presetModelPick = defineModel('presetModelPick', { type: String, default: '' })
</script>

<style scoped>
.config-field-a11y-description {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.config-form-section {
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-blank, #fff);
}
.config-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.config-section-header h4 {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: 15px;
  line-height: 22px;
}
.config-section-header p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular, #606266);
  font-size: 12px;
  line-height: 1.5;
}
.config-section-index {
  flex: 0 0 auto;
  min-width: 34px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-size: 12px;
  font-weight: 600;
}
.deepseek-settings {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
.field-tip-warning {
  color: var(--el-color-warning-dark-2, #b88230);
  font-weight: 500;
}
.form-label-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.tip-icon {
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.tip-icon:hover {
  color: var(--el-color-primary, #409eff);
}
@media (max-width: 760px) {
  .config-section-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 520px) {
  .config-form-section {
    padding: 12px;
  }
}
</style>
