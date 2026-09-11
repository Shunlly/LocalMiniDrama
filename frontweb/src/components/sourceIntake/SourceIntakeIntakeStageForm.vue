<template>
  <el-form label-position="top" class="intake-form">
    <div class="form-row">
      <el-form-item label="素材类型">
        <el-select v-model="form.source_type" aria-label="素材类型" placeholder="自动识别" clearable>
          <el-option
            v-for="item in sourceTypeOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="目标集数">
        <el-input-number v-model="form.target_episode_count" aria-label="目标集数" :min="1" :max="100" controls-position="right" />
      </el-form-item>
    </div>

    <el-form-item label="标题">
      <el-input v-model="form.title" aria-label="故事素材标题" placeholder="故事素材标题" />
    </el-form-item>

    <el-form-item label="网页 URL" :error="sourceUrlValidationMessage">
      <el-input
        ref="sourceUrlInput"
        v-model="form.source_url"
        clearable
        aria-label="网页 URL"
        placeholder="粘贴公开网页或纯文本链接，系统会抽取正文作为素材"
      />
      <div class="field-help">仅导入公开可访问的文本 / HTML 页面，请确认素材版权或授权。</div>
    </el-form-item>

    <el-form-item label="本地素材文件">
      <div class="file-row">
        <input
          ref="sourceFileInput"
          type="file"
          :accept="sourceFileAccept"
          class="hidden-file-input"
          tabindex="-1"
          aria-hidden="true"
          @change="$emit('source-file-change', $event)"
        />
        <ActionGate label="选择故事素材文件" :reason="sourceUploadBusyReason">
          <el-button size="small" :loading="sourceFileReading" :disabled="Boolean(sourceUploadBusyReason)" aria-label="选择故事素材文件" @click="sourceFileInput?.click()">选择文件</el-button>
        </ActionGate>
        <ActionGate v-if="sourceFile" label="移除已选文件" :reason="sourceUploadBusyReason">
          <el-button size="small" link type="danger" :disabled="Boolean(sourceUploadBusyReason)" :aria-label="sourceUploadBusyReason || '移除已选文件'" @click="$emit('clear-selected-file')">移除</el-button>
        </ActionGate>
        <span class="file-name">{{ selectedFilename || '支持文本、PDF、图片、音频和视频，单文件最大 20MB' }}</span>
      </div>
      <div class="field-help">
        {{ sourceIntakeMediaHelp }}
      </div>
      <div v-if="sourceOperationStatus" class="source-operation-status" role="status" aria-live="polite">
        {{ sourceOperationStatus }}
      </div>
      <div v-if="sourceOperationError" class="source-operation-error" role="alert" aria-live="assertive">
        <span>{{ sourceOperationError }}</span>
        <div v-if="extractionNextStep" class="source-extraction-next-step">
          <span class="next-step-kicker">下一步</span>
          <el-button
            size="small"
            type="primary"
            plain
            :aria-label="extractionNextStep.actionLabel"
            @click="emit('open-extraction-ai-config', extractionNextStep.serviceType)"
          >
            {{ extractionNextStep.actionLabel }}
          </el-button>
          <span v-if="extractionNextStep.extraHint">{{ extractionNextStep.extraHint }}</span>
        </div>
      </div>
      <div
        v-if="sourceListRefreshError"
        class="source-operation-error source-import-refresh-alert"
        role="alert"
        aria-live="assertive"
      >
        <span>{{ sourceListRefreshError }}</span>
        <ActionGate label="刷新列表" :reason="sourceListRetryReason">
          <el-button
            size="small"
            type="primary"
            plain
            :loading="sourceListRefreshing"
            :disabled="Boolean(sourceListRetryReason)"
            :aria-label="sourceListRefreshing ? '正在刷新导入列表' : (sourceListRetryReason || '刷新导入列表')" @click="$emit('refresh-imported-sources')"
          >
            刷新列表
          </el-button>
        </ActionGate>
      </div>
    </el-form-item>

    <SourceIntakeSourceTextPanel v-model:text="form.text" />

    <div class="action-row">
      <ActionGate label="导入故事素材" :reason="actionReasons.import">
          <el-button :loading="sourceSaving" :disabled="Boolean(actionReasons.import)" :aria-label="sourceSaving ? '正在导入故事素材' : (actionReasons.import || '导入故事素材')" @click="$emit('import-source')">
            导入故事素材
          </el-button>
      </ActionGate>
      <ActionGate :label="`导入并启动 ${workflowModeShortLabel}`" :reason="actionReasons.start">
          <el-button type="primary" :loading="workflowStarting && !startingSourceId" :disabled="Boolean(actionReasons.start)" :aria-label="workflowStarting && !startingSourceId ? '正在启动流程' : (actionReasons.start || '启动素材流程')" @click="$emit('start-workflow')">
            {{ workflowStartButtonLabel }}
          </el-button>
      </ActionGate>
    </div>
  </el-form>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import SourceIntakeSourceTextPanel from '@/components/sourceIntake/SourceIntakeSourceTextPanel.vue'
import { resolveSourceIntakeExtractionNextStep } from '@/utils/sourceWorkflowState.js'

const props = defineProps({
  sourceTypeOptions: { type: Array, required: true },
  sourceUrlValidationMessage: { type: String, default: '' },
  sourceFileAccept: { type: String, required: true },
  sourceFileReading: { type: Boolean, default: false },
  sourceUploadBusyReason: { type: String, default: '' },
  sourceFile: { default: null },
  selectedFilename: { type: String, default: '' },
  sourceIntakeMediaHelp: { type: String, default: '' },
  sourceOperationStatus: { type: String, default: '' },
  sourceOperationError: { type: String, default: '' },
  sourceListRefreshError: { type: String, default: '' },
  sourceListRetryReason: { type: String, default: '' },
  sourceListRefreshing: { type: Boolean, default: false },
  sourceSaving: { type: Boolean, default: false },
  actionReasons: { type: Object, required: true },
  workflowModeShortLabel: { type: String, required: true },
  workflowStarting: { type: Boolean, default: false },
  startingSourceId: { default: null },
  workflowStartButtonLabel: { type: String, required: true },
})

const emit = defineEmits([
  'source-file-change',
  'clear-selected-file',
  'refresh-imported-sources',
  'import-source',
  'start-workflow',
  'open-extraction-ai-config',
])
const extractionNextStep = computed(() => resolveSourceIntakeExtractionNextStep(
  props.sourceOperationError,
  {
    file: props.sourceFile,
    filename: props.selectedFilename,
  },
))

const form = defineModel({ type: Object, required: true })
const sourceFileInput = ref(null)
const sourceUrlInput = ref(null)

watch(
  () => [props.sourceFile, props.selectedFilename],
  ([file, filename]) => {
    if (!file && !filename && sourceFileInput.value) sourceFileInput.value.value = ''
  },
)

defineExpose({
  sourceFileInput,
  sourceUrlInput,
})
</script>

<style scoped>
.action-row,
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 150px;
  gap: 12px;
}
.hidden-file-input {
  display: none;
}
.file-name {
  color: var(--source-text-muted);
  font-size: 12px;
}
.field-help {
  margin-top: 6px;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.source-operation-status,
.source-operation-error {
  margin-top: 7px;
  font-size: 12px;
  line-height: 1.45;
}
.source-operation-status {
  color: var(--status-success);
}
.source-operation-error {
  color: var(--el-color-danger);
}
.source-import-refresh-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.source-extraction-next-step {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  color: var(--source-text-muted);
}
.next-step-kicker {
  font-weight: 600;
  color: var(--el-color-danger);
}
@media (max-width: 900px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
