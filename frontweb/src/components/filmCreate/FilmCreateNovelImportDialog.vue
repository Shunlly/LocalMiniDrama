<template>
  <AccessibleDialog
    v-model="visible"
    title="导入小说/长文"
    width="600px"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    @close="emit('reset')"
  >
    <div class="novel-import-dialog">
      <p class="novel-import-hint">{{ NOVEL_INTAKE_HINT }}</p>
      <p v-if="intakeError" class="novel-import-error" role="alert" aria-live="assertive">{{ intakeError }}</p>
      <el-tabs v-model="mode" aria-label="小说导入方式">
        <el-tab-pane label="粘贴文本" name="text">
          <el-input
            v-model="text"
            type="textarea"
            :rows="10"
            aria-label="小说正文"
            :placeholder="NOVEL_INTAKE_PLACEHOLDER"
          />
        </el-tab-pane>
        <el-tab-pane label="上传文件" name="file">
          <el-upload
            drag
            aria-label="上传小说文本文件"
            :auto-upload="false"
            :limit="1"
            :disabled="importing || fileReading || confirming"
            :on-change="handleFileChange"
            :on-exceed="handleFileExceed"
            accept=".txt,.md"
            :show-file-list="false"
          >
            <el-icon class="el-icon--upload"><DocumentAdd /></el-icon>
            <div class="el-upload__text">拖拽 .txt / .md 文件到此处，或<em>点击上传</em></div>
          </el-upload>
          <p class="novel-import-file-help">{{ NOVEL_INTAKE_FILE_HELP }}</p>
          <div v-if="fileReading" class="novel-file-status" role="status" aria-live="polite">正在读取文本...</div>
          <div v-else-if="fileAccepted && displayFileName" class="novel-file-name">已选择：{{ displayFileName }}</div>
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
      <el-button :disabled="importing || fileReading" @click="requestClose">取消</el-button>
      <el-button type="primary" :loading="importing || fileReading || confirming" @click="handleImport">开始导入</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DocumentAdd } from '@element-plus/icons-vue'
import {
  NOVEL_INTAKE_FILE_HELP,
  NOVEL_INTAKE_HINT,
  NOVEL_INTAKE_LEAVE_COPY,
  NOVEL_INTAKE_PLACEHOLDER,
  buildNovelIntakeConfirmCopy,
  createNovelIntakeLeaveGuard,
  inspectNovelIntakeFile,
  inspectNovelIntakeSubmit,
  inspectNovelIntakeText,
  novelIntakeHasDraft,
} from '@/components/filmCreate/novelIntakeUx.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  fileName: { type: String, default: '' },
  importing: { type: Boolean, default: false },
})

const visible = defineModel('visible', { type: Boolean, default: false })
const mode = defineModel('mode', { type: String, default: 'text' })
const text = defineModel('text', { type: String, default: '' })
const maxChapters = defineModel('maxChapters', { type: Number, default: 10 })
const aiSummarize = defineModel('aiSummarize', { type: Boolean, default: false })

const emit = defineEmits(['reset', 'file-change', 'import'])

const intakeError = ref('')
const fileAccepted = ref(false)
const localFileName = ref('')
const fileReading = ref(false)
const confirming = ref(false)
let fileReadToken = 0

const displayFileName = computed(() => localFileName.value || props.fileName || '')
const hasDraft = computed(() => novelIntakeHasDraft({
  text: text.value,
  fileName: displayFileName.value,
  fileAccepted: fileAccepted.value,
}))

const leaveGuard = createNovelIntakeLeaveGuard({
  getVisible: () => visible.value,
  getImporting: () => props.importing || fileReading.value,
  getHasDraft: () => hasDraft.value,
  warnBusy() {
    ElMessage.warning(NOVEL_INTAKE_LEAVE_COPY.busyMessage)
  },
  confirmDraft() {
    return ElMessageBox.confirm(
      NOVEL_INTAKE_LEAVE_COPY.message,
      NOVEL_INTAKE_LEAVE_COPY.title,
      {
        type: 'warning',
        confirmButtonText: NOVEL_INTAKE_LEAVE_COPY.confirmButtonText,
        cancelButtonText: NOVEL_INTAKE_LEAVE_COPY.cancelButtonText,
        distinguishCancelAndClose: true,
      },
    )
  },
})

function attachUnloadGuard() {
  window.addEventListener('beforeunload', leaveGuard.handleBeforeUnload)
}

function detachUnloadGuard() {
  window.removeEventListener('beforeunload', leaveGuard.handleBeforeUnload)
}

watch(visible, (open) => {
  if (!open) {
    detachUnloadGuard()
    return
  }
  intakeError.value = ''
  fileAccepted.value = Boolean(props.fileName)
  localFileName.value = props.fileName || ''
  attachUnloadGuard()
}, { immediate: true })

watch([mode, text], () => {
  if (!visible.value || mode.value !== 'text') return
  intakeError.value = inspectNovelIntakeText(text.value, { allowEmpty: true }).error
})

onBeforeRouteLeave(async () => {
  if (!visible.value) return true
  const allowed = await leaveGuard.confirmLeave()
  if (allowed) visible.value = false
  return allowed
})

onBeforeUnmount(() => {
  detachUnloadGuard()
})

async function handleBeforeClose(done) {
  if (await leaveGuard.confirmLeave()) done()
}

async function requestClose() {
  if (await leaveGuard.confirmLeave()) visible.value = false
}

function waitForParentFileReader(fileLike) {
  const file = fileLike?.raw || fileLike
  if (!file || typeof FileReader !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve()
    reader.onerror = () => resolve()
    try {
      reader.readAsText(file, 'utf-8')
    } catch {
      resolve()
    }
  })
}

async function applySelectedFile(fileLike) {
  const token = ++fileReadToken
  fileReading.value = true
  try {
    const result = await inspectNovelIntakeFile(fileLike)
    if (token !== fileReadToken) return
    if (result.error) {
      fileAccepted.value = false
      localFileName.value = ''
      intakeError.value = result.error
      ElMessage.warning(result.error)
      return
    }
    fileAccepted.value = true
    localFileName.value = resolveSelectedName(fileLike)
    intakeError.value = ''
    emit('file-change', fileLike)
    // 父组件仍用 FileReader 异步写入内容，后排队同一次读取，避免立刻导入读到空串。
    await waitForParentFileReader(fileLike)
  } finally {
    if (token === fileReadToken) fileReading.value = false
  }
}

function resolveSelectedName(fileLike) {
  return String(fileLike?.raw?.name || fileLike?.name || '').trim()
}

function handleFileChange(file) {
  if (!file || props.importing || confirming.value) return
  return applySelectedFile(file)
}

function handleFileExceed(files) {
  const file = files?.[0]
  if (!file) return
  return applySelectedFile({ raw: file, name: file.name, size: file.size })
}

async function handleImport() {
  if (props.importing || fileReading.value || confirming.value) return
  const result = inspectNovelIntakeSubmit({
    mode: mode.value,
    text: text.value,
    fileName: displayFileName.value,
    fileAccepted: fileAccepted.value,
  })
  if (result.error) {
    intakeError.value = result.error
    ElMessage.warning(result.error)
    return
  }
  const copy = buildNovelIntakeConfirmCopy({
    maxChapters: maxChapters.value,
    aiSummarize: aiSummarize.value,
  })
  confirming.value = true
  try {
    await ElMessageBox.confirm(copy.message, copy.title, {
      type: 'warning',
      confirmButtonText: copy.confirmButtonText,
      cancelButtonText: copy.cancelButtonText,
      distinguishCancelAndClose: true,
    })
    emit('import')
  } catch {
    // 用户取消确认
  } finally {
    confirming.value = false
  }
}
</script>

<style scoped>
.novel-import-hint {
  color: #6b7280;
  font-size: 13px;
  margin-bottom: 12px;
  line-height: 1.6;
}
.novel-import-error {
  margin: 0 0 12px;
  color: #dc2626;
  font-size: 13px;
  line-height: 1.5;
}
.novel-import-file-help {
  margin: 8px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
.novel-file-name,
.novel-file-status {
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
