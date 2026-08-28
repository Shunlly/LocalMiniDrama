<template>
  <AccessibleDialog v-model="visible" title="导入小说/长文" width="600px" @close="emit('reset')">
    <div class="novel-import-dialog">
      <p class="novel-import-hint">支持粘贴小说文本或上传 txt 文件，AI 自动识别章节并转换为剧本集数</p>
      <el-tabs v-model="mode">
        <el-tab-pane label="粘贴文本" name="text">
          <el-input
            v-model="text"
            type="textarea"
            :rows="10"
            placeholder="粘贴小说正文，AI 会自动识别章节..."
          />
        </el-tab-pane>
        <el-tab-pane label="上传文件" name="file">
          <el-upload
            drag
            :auto-upload="false"
            :on-change="(file) => emit('file-change', file)"
            accept=".txt,.md"
            :show-file-list="false"
          >
            <el-icon class="el-icon--upload"><DocumentAdd /></el-icon>
            <div class="el-upload__text">拖拽 .txt / .md 文件到此处，或<em>点击上传</em></div>
          </el-upload>
          <div v-if="fileName" class="novel-file-name">已选择：{{ fileName }}</div>
        </el-tab-pane>
      </el-tabs>
      <div class="novel-import-options">
        <div class="novel-import-count">
          <span>最多导入集数：</span>
          <el-input-number v-model="maxChapters" aria-label="最多导入集数" :min="1" :max="20" size="small" style="width:100px" />
        </div>
        <el-checkbox v-model="aiSummarize" size="small">AI 转换为剧本格式（会消耗 Token）</el-checkbox>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="importing" @click="emit('import')">开始导入</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import { DocumentAdd } from '@element-plus/icons-vue'

defineOptions({ inheritAttrs: false })

defineProps({
  fileName: { type: String, default: '' },
  importing: { type: Boolean, default: false },
})

const visible = defineModel('visible', { type: Boolean, default: false })
const mode = defineModel('mode', { type: String, default: 'text' })
const text = defineModel('text', { type: String, default: '' })
const maxChapters = defineModel('maxChapters', { type: Number, default: 10 })
const aiSummarize = defineModel('aiSummarize', { type: Boolean, default: false })

const emit = defineEmits(['reset', 'file-change', 'import'])
</script>

<style scoped>
.novel-import-hint {
  color: #6b7280;
  font-size: 13px;
  margin-bottom: 12px;
}
.novel-file-name {
  margin-top: 8px;
  font-size: 13px;
  color: #409eff;
}
.novel-import-options {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.novel-import-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
</style>
