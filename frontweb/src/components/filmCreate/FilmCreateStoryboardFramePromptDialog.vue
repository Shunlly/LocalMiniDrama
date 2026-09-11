<template>
  <AccessibleDialog
    v-model="showFramePromptEditor"
    :title="`${editingFramePromptSlot === 'last' ? '尾帧' : '首帧'}图生提示词 · 编辑`"
    width="720px"
    destroy-on-close
  >
    <div class="frame-prompt-editor-body">
      <div class="frame-prompt-editor-hint">
        此提示词将直接发给AI生成首/尾帧图片。支持编辑后保存，保存后点击「生成」即可使用新提示词。
      </div>

      <div v-if="editingFramePromptSb?.layout_description" class="frame-layout-anchor">
        <div class="frame-layout-anchor-label">本分镜空间布局锚点（首尾帧强制一致合同，最高优先级）</div>
        <div class="frame-layout-anchor-text">{{ editingFramePromptSb.layout_description }}</div>
        <div class="frame-layout-anchor-note">首帧必须严格按此生成初始站位；尾帧必须在完全相同的左右位置、距离、构图下仅演化姿态/表情/结果。</div>
      </div>

      <el-input
        v-model="editingFramePromptText"
        type="textarea"
        :rows="14"
        :aria-label="`${editingFramePromptSlot === 'last' ? '尾帧' : '首帧'}图生提示词`"
        placeholder="在此编辑最终发给AI生图的完整提示词..."
        class="frame-prompt-editor-textarea"
      />
    </div>
    <template #footer>
      <el-button aria-label="关闭帧提示词" @click="showFramePromptEditor = false">关闭</el-button>
      <el-button :loading="editingFramePromptRegenerating" :title="editingFramePromptRegenerating ? '正在重新生成提示词，请稍候' : undefined" :aria-label="editingFramePromptRegenerating ? '正在重新生成提示词，请稍候' : '重新生成帧提示词'" @click="regenerateEditingFramePrompt">重新生成</el-button>
      <el-button type="primary" :loading="editingFramePromptSaving" :title="editingFramePromptSaving ? '正在保存提示词，请稍候' : undefined" :aria-label="editingFramePromptSaving ? '正在保存提示词，请稍候' : '保存帧提示词'" @click="saveEditingFramePrompt">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  editingFramePromptRegenerating: { type: Boolean, default: false },
  editingFramePromptSaving: { type: Boolean, default: false },
  editingFramePromptSb: { type: Object, default: null },
  editingFramePromptSlot: { type: String, default: 'first' },
  regenerateEditingFramePrompt: { type: Function, required: true },
  saveEditingFramePrompt: { type: Function, required: true },
})

const showFramePromptEditor = defineModel('showFramePromptEditor', { type: Boolean, default: false })
const editingFramePromptText = defineModel('editingFramePromptText', { type: String, default: '' })
</script>

<style scoped>
.frame-prompt-editor-body {
  padding: 4px 0;
}
.frame-prompt-editor-hint {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
  line-height: 1.5;
}
html.light .frame-prompt-editor-hint {
  color: #475569;
}
.frame-prompt-editor-textarea :deep(.el-textarea__inner) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
}
.frame-layout-anchor {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}
html.light .frame-layout-anchor {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.frame-layout-anchor-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 4px;
}
.frame-layout-anchor-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: #1e293b;
  background: #fff;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}
.frame-layout-anchor-note {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
