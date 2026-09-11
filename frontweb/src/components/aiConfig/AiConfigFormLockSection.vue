<template>
  <div>
    <el-descriptions :column="1" border style="margin-bottom: 16px">
      <el-descriptions-item label="名称">{{ form.name }}</el-descriptions-item>
      <el-descriptions-item label="类型">{{ serviceTypeLabel(form.service_type) }}</el-descriptions-item>
      <el-descriptions-item label="厂商">{{ form.provider }}</el-descriptions-item>
    </el-descriptions>
    <el-form :ref="bindFormRef" :model="form" label-width="100px" @validate="handleConfigFieldValidated">
      <el-form-item prop="api_key" :rules="[{ required: true, message: '请输入 API 密钥', trigger: 'blur' }]">
        <template #label><span class="form-label-tip">API 密钥</span></template>
        <el-input
          :ref="bindApiKeyInputRef"
          v-model="form.api_key"
          data-ai-config-field="api_key"
          type="password"
          :placeholder="form.provider === 'jimeng_ai_api' ? '即梦 Session，多个用英文逗号分隔' : '输入你的 API 密钥'"
          show-password
          :aria-invalid="isConfigFieldInvalid('api_key')"
          :aria-describedby="configFieldDescriptionId('api_key')"
        />
        <span :id="configFieldDescriptionId('api_key')" class="config-field-a11y-description">
          {{ configFieldDescription('api_key') }}
        </span>
      </el-form-item>
      <el-form-item prop="default_model" :rules="defaultModelRules">
        <template #label><span class="form-label-tip">默认模型</span></template>
        <el-select
          v-model="form.default_model"
          data-ai-config-field="default_model"
          clearable
          filterable
          default-first-option
          aria-label="默认模型"
          placeholder="搜索或选择已有模型"
          no-data-text="暂无可用模型"
          style="width: 100%"
          :aria-invalid="isConfigFieldInvalid('default_model') || isDefaultModelUnavailable"
          :aria-describedby="configFieldDescriptionId('default_model')"
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
        <p v-else class="field-tip">实际调用时使用的模型，可搜索已有模型名。锁定模式下不能新增模型列表。</p>
        <span :id="configFieldDescriptionId('default_model')" class="config-field-a11y-description">
          {{ configFieldDescription('default_model') }}
        </span>
      </el-form-item>
      <el-form-item>
        <template #label>
          <span class="form-label-tip">设为默认
            <el-tooltip placement="top" popper-class="cfg-tip-popper">
              <template #content>
                <div class="cfg-tip-content">
                  每种服务类型只有一个「默认」配置。<br>
                  生成时系统会优先使用默认配置，建议每类至少设一个默认。
                </div>
              </template>
              <el-icon class="tip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-switch v-model="form.is_default" :disabled="configWriteLocked" />
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'
import { serviceTypeLabel } from '@/utils/aiConfigLabels.js'

defineProps({
  form: { type: Object, required: true },
  configWriteLocked: { type: Boolean, default: false },
  defaultModelRules: { type: Array, default: () => [] },
  formModelList: { type: Array, default: () => [] },
  isDefaultModelUnavailable: { type: Boolean, default: false },
  bindFormRef: { type: Function, required: true },
  bindApiKeyInputRef: { type: Function, required: true },
  handleConfigFieldValidated: { type: Function, required: true },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
})
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
</style>
