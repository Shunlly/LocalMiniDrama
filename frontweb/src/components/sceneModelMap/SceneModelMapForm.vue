<template>
  <el-form ref="innerFormRef" :model="form" :rules="rules" label-width="120px">
    <el-form-item prop="key" label="场景键">
      <el-select
        v-model="form.key"
        aria-label="场景键"
        filterable
        allow-create
        default-first-option
        placeholder="选择或输入场景键"
        style="width: 100%"
        :disabled="!!editingKey"
        :title="editingKey ? '已保存的业务场景不能修改标识' : undefined"
        @change="$emit('key-change', $event)"
      >
        <el-option
          v-for="k in predefinedKeys"
          :key="k.value"
          :label="k.label"
          :value="k.value"
        />
      </el-select>
      <p class="field-tip">{{ editingKey ? '已保存的业务场景不能修改标识' : '选择后会自动设置对应的服务类型' }}</p>
    </el-form-item>

    <el-form-item prop="service_type" label="服务类型">
      <el-select v-model="form.service_type" aria-label="服务类型" placeholder="选择服务类型" style="width: 100%" disabled title="由场景键自动决定，不可更改">
        <el-option label="文本/对话" value="text" />
        <el-option label="文本生成图片" value="image" />
        <el-option label="分镜图片生成" value="storyboard_image" />
        <el-option label="视频生成" value="video" />
        <el-option label="语音合成 TTS" value="tts" />
      </el-select>
      <p class="field-tip">由场景键自动决定，不可更改</p>
    </el-form-item>

    <el-form-item label="AI 配置">
      <el-select
        v-model="form.config_id"
        aria-label="AI 配置"
        clearable
        placeholder="选择 AI 配置（留空使用默认）"
        style="width: 100%"
        @change="$emit('config-change', $event)"
      >
        <el-option
          v-for="c in filteredConfigs"
          :key="c.id"
          :label="configOptionLabel(c)"
          :value="c.id"
        />
      </el-select>
      <p class="field-tip">指定具体的 AI 服务配置，不选则使用该类服务的默认配置</p>
      <p v-if="!filteredConfigs.length" class="field-warning">当前服务类型没有可用的启用中 AI 配置，保存后将使用系统默认；请先在 AI 配置中添加并启用对应服务。</p>
    </el-form-item>

    <el-form-item label="模型覆盖">
      <el-select
        v-model="form.model_override"
        aria-label="模型覆盖"
        clearable
        placeholder="选择模型（留空使用配置默认）"
        style="width: 100%"
        :disabled="Boolean(modelOverrideDisabledReason)"
        :title="modelOverrideDisabledReason || undefined"
      >
        <el-option
          v-for="m in selectedConfigModels"
          :key="m"
          :label="m"
          :value="m"
        />
      </el-select>
      <p class="field-tip">
        {{ selectedConfigModels.length ? '从该配置的可用模型中选择' : '请先选择 AI 配置' }}
      </p>
    </el-form-item>
    <el-form-item prop="description" label="描述">
      <el-input
        v-model="form.description"
        aria-label="场景描述"
        placeholder="输入场景描述，便于理解用途"
      />
    </el-form-item>
  </el-form>
</template>

<script setup>
import { ref } from 'vue'
import { SCENE_MODEL_PREDEFINED_KEYS, configOptionLabel } from './sceneModelMapCatalog.js'

const form = defineModel('form', { type: Object, required: true })

defineProps({
  editingKey: { type: [String, Number], default: null },
  filteredConfigs: { type: Array, default: () => [] },
  selectedConfigModels: { type: Array, default: () => [] },
  modelOverrideDisabledReason: { type: String, default: '' },
})

defineEmits(['key-change', 'config-change'])

const innerFormRef = ref(null)
const predefinedKeys = SCENE_MODEL_PREDEFINED_KEYS
const rules = {
  key: [{ required: true, message: '请输入场景键', trigger: 'blur' }],
  service_type: [{ required: true, message: '请选择服务类型', trigger: 'change' }],
}

function validate() {
  return innerFormRef.value?.validate()
}

function resetFields() {
  innerFormRef.value?.resetFields()
}

defineExpose({
  validate,
  resetFields,
})
</script>

<style scoped>
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: #999;
  line-height: 1.4;
}
.field-warning {
  margin: 6px 0 0;
  font-size: 12px;
  color: #b45309;
  line-height: 1.4;
}
</style>
