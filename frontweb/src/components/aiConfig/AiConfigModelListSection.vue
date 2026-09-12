<template>
  <el-form-item prop="modelText">
    <template #label>
      <span class="form-label-tip">模型列表
        <el-tooltip placement="top" popper-class="cfg-tip-popper">
          <template #content>
            <div class="cfg-tip-content">
              该厂商下可用的模型，多个用逗号或换行分隔。<br>
              可搜索并追加预设模型，也可直接输入自定义模型名。
            </div>
          </template>
          <el-icon class="tip-icon"><QuestionFilled /></el-icon>
        </el-tooltip>
      </span>
    </template>
    <div class="model-row">
      <el-select
        :model-value="presetModelPick"
        aria-label="追加预设模型"
        placeholder="追加或输入模型名"
        no-data-text="暂无预设模型，可直接输入"
        clearable
        filterable
        allow-create
        default-first-option
        style="width: 220px; margin-bottom: 8px"
        @update:model-value="$emit('update:presetModelPick', $event)"
        @change="onPresetModelSelect"
      >
        <el-option v-for="m in availableModels" :key="m" :label="m" :value="m" />
      </el-select>
      <el-button
        type="primary"
        plain
        :loading="discoverModelsLoading"
        :disabled="discoverModelsDisabled"
        :title="discoverModelsDisabled ? discoverModelsDisabledReason : undefined"
        :aria-label="discoverModelsLoading ? '正在读取模型' : (discoverModelsDisabled ? (discoverModelsDisabledReason || '当前不能读取模型') : '从服务读取模型')"
        @click="discoverModelsFromService"
      >从服务读取模型</el-button>
    </div>
    <p v-if="discoverModelsLoading" class="field-tip">正在从服务读取模型…</p>
    <p v-else-if="discoverModelsDisabledReason" class="field-tip">{{ discoverModelsDisabledReason }}</p>
    <p v-if="providerModelEmptyHint" class="field-tip">{{ providerModelEmptyHint }}</p>
    <el-input
      :ref="setModelListInputRef"
      v-model="form.modelText"
      data-ai-config-field="model"
      type="textarea"
      :rows="2"
      aria-label="模型列表"
      placeholder="选择预设厂商后自动填入，可编辑；多个用逗号或换行分隔"
      :aria-invalid="isConfigFieldInvalid('model')"
      :aria-describedby="configFieldDescriptionId('model')"
    />
    <span :id="configFieldDescriptionId('model')" class="config-field-a11y-description">
      {{ configFieldDescription('model') }}
    </span>
  </el-form-item>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'

defineProps({
  form: { type: Object, required: true },
  presetModelPick: { type: String, default: '' },
  availableModels: { type: Array, default: () => [] },
  discoverModelsLoading: { type: Boolean, default: false },
  discoverModelsDisabled: { type: Boolean, default: false },
  discoverModelsDisabledReason: { type: String, default: '' },
  providerModelEmptyHint: { type: String, default: '' },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
  setModelListInputRef: { type: Function, required: true },
  discoverModelsFromService: { type: Function, required: true },
  onPresetModelSelect: { type: Function, required: true },
})

defineEmits(['update:presetModelPick'])
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
.model-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
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
