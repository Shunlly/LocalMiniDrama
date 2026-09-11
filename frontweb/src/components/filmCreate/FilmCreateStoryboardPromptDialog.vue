<template>
  <AccessibleDialog
    v-model="showSbPromptDialog"
    :title="`分镜 ${sbPromptTarget?.storyboard_number ?? ''} · 编辑提示词`"
    width="700px"
    @close="sbPromptTarget = null"
  >
    <el-form v-if="sbPromptTarget" label-position="top" class="sb-prompt-dialog-form">
      <div class="sb-prompt-section-title">图片提示词</div>
      <el-form-item label="原始图片提示词">
        <el-input
          v-model="sbPromptImageText"
          type="textarea"
          :rows="4"
          aria-label="原始图片提示词"
          placeholder="分镜生成时由 AI 写入的原始描述"
        />
      </el-form-item>
      <el-form-item label="通用优化提示词">
        <div class="sb-prompt-polish-row">
          <el-button
            size="small"
            type="warning"
            plain
            :loading="sbPromptPolishing"
            :title="sbPromptPolishing ? '正在生成提示词，请稍候' : undefined"
            @click="onPolishSbPrompt"
          >{{ sbPromptPolishedText ? '重新生成' : '立即生成' }}</el-button>
          <span class="sb-prompt-polish-hint">只更新通用优化字段，不影响首尾帧专用提示词</span>
        </div>
        <el-input
          v-model="sbPromptPolishedText"
          type="textarea"
          :rows="5"
          aria-label="通用优化提示词"
          placeholder="点击「立即生成」润色通用优化提示词（仅更新本字段，不影响首尾帧专用提示词）"
        />
      </el-form-item>
      <div class="sb-prompt-section-title">视频提示词</div>
      <el-form-item label="视频提示词">
        <el-input
          v-model="sbPromptVideoText"
          type="textarea"
          :rows="12"
          aria-label="视频提示词"
          placeholder="视频生成提示词（可选，留空则由系统自动生成）"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showSbPromptDialog = false">取消</el-button>
      <el-button type="primary" :loading="sbPromptSaving" :title="sbPromptSaving ? '正在保存提示词，请稍候' : undefined" @click="onSaveSbPromptDialog">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  sbPromptPolishing: { type: Boolean, default: false },
  sbPromptSaving: { type: Boolean, default: false },
  onPolishSbPrompt: { type: Function, required: true },
  onSaveSbPromptDialog: { type: Function, required: true },
})

const sbPromptTarget = defineModel('sbPromptTarget', { type: Object, default: null })
const showSbPromptDialog = defineModel('showSbPromptDialog', { type: Boolean, default: false })
const sbPromptImageText = defineModel('sbPromptImageText', { type: String, default: '' })
const sbPromptPolishedText = defineModel('sbPromptPolishedText', { type: String, default: '' })
const sbPromptVideoText = defineModel('sbPromptVideoText', { type: String, default: '' })
</script>

<style scoped>
.sb-prompt-section-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 8px;
}
.sb-prompt-dialog-form .el-form-item {
  margin-bottom: 10px;
}
.sb-prompt-polish-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-prompt-polish-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}
</style>
