<template>
  <div class="episode-batch-import-trigger">
    <el-button size="small" @click="openDialog">
      <el-icon><Upload /></el-icon>批量导入剧集
    </el-button>

    <AccessibleDialog
      v-model="visible"
      title="批量导入剧集"
      width="920px"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      :before-close="requestClose"
      @close="resetState"
    >
      <div class="batch-import-dialog">
        <el-tabs v-model="activeTab" class="batch-import-tabs">
          <el-tab-pane label="1. 导入设置" name="config">
            <div class="batch-import-panel">
              <div v-if="previewTabDisabledReason" class="batch-import-disabled-reason">{{ previewTabDisabledReason }}</div>
              <div class="batch-import-toolbar">
                <input
                  ref="fileInputRef"
                  type="file"
                  accept=".txt,text/plain"
                  class="hidden-file-input"
                  aria-hidden="true"
                  tabindex="-1"
                  @change="onFileChange"
                />
                <el-button
                  aria-label="选择 TXT 剧本文件"
                  :disabled="importing"
                  :title="importing ? '正在导入剧集，请完成后再选择文件。' : ''"
                  @click="fileInputRef?.click()"
                >
                  <el-icon><Upload /></el-icon>选择 TXT 文件
                </el-button>
                <span class="batch-import-file" :class="{ 'is-empty': !fileName }">
                  {{ fileName || '未选择文件' }}
                </span>
              </div>

              <el-form label-width="120px" class="batch-import-form">
                <el-form-item label="章节正则">
                  <el-input v-model="chapterPattern" placeholder="例如：^\s*(第\d+章[^\n]*)" aria-label="章节正则" />
                </el-form-item>
                <el-form-item label="每集章节数">
                  <el-input-number v-model="chaptersPerEpisode" :min="1" :max="100" aria-label="每集章节数" />
                </el-form-item>
              </el-form>

              <div class="batch-import-tip-block">
                <div class="batch-import-tip">将提前准备好的小说原文或剧本内容的 TXT 文件导入系统</div>
                <div class="batch-import-tip">请正确输入用于匹配章节标题的正则表达式。</div>
                <div class="batch-import-tip">示例：<code class="batch-import-code">^\s*(第\d+章[^\n]*)</code>、<code class="batch-import-code">^\s*(第\d+集[^\n]*)</code></div>
                <div class="batch-import-tip">点击“确认导入配置”后，会先解析章节并切换到预览页。</div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="2. 预览确认" name="preview" :disabled="!previewReady">
            <template #label>
              <span :title="previewTabDisabledReason">2. 预览确认</span>
            </template>
            <EpisodeBatchImportPreviewPanel
              :preview-chapters="previewChapters"
              :preview-episodes="previewEpisodes"
              @back="activeTab = 'config'"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <EpisodeBatchImportFooter
          :active-tab="activeTab"
          :importing="importing"
          :close-disabled-reason="closeDisabledReason"
          :config-confirm-disabled-reason="configConfirmDisabledReason"
          :import-confirm-disabled-reason="importConfirmDisabledReason"
          @cancel="requestClose()"
          @back="activeTab = 'config'"
          @confirm-config="confirmConfig"
          @confirm-import="confirmImport"
        />
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { Upload } from '@element-plus/icons-vue'
import {
  createProjectInstanceLifecycle,
  isProjectInstanceDisposedError,
} from '@/utils/projectInstanceLifecycle.js'
import {
  DEFAULT_CHAPTER_PATTERN,
  splitNovelChapters,
  buildEpisodesFromChapters,
} from './episodeBatchImport/episodeBatchImportChapters.js'
import EpisodeBatchImportPreviewPanel from './episodeBatchImport/EpisodeBatchImportPreviewPanel.vue'
import EpisodeBatchImportFooter from './episodeBatchImport/EpisodeBatchImportFooter.vue'

const batchImportLifecycle = createProjectInstanceLifecycle()
const ElMessage = batchImportLifecycle.guardNotifier(RawElMessage)

const props = defineProps({
  startEpisodeNumber: {
    type: Number,
    default: 1,
  },
  // Vue 事件监听是即发即忘；该回调让弹窗等待父级异步落盘后再关闭或提示成功。
  importHandler: {
    type: Function,
    default: null,
  },
})

const emit = defineEmits(['import'])

const visible = ref(false)
const activeTab = ref('config')
const previewReady = ref(false)
const importing = ref(false)
const fileInputRef = ref(null)
const fileName = ref('')
const rawText = ref('')
const chapterPattern = ref(DEFAULT_CHAPTER_PATTERN)
const chaptersPerEpisode = ref(1)
const previewChapters = ref([])
const previewEpisodes = ref([])
let closeConfirmOpen = false

const closeDisabledReason = computed(() => (
  importing.value ? '正在导入剧集，请完成后再关闭。' : ''
))
const configConfirmDisabledReason = computed(() => {
  if (importing.value) return '正在导入剧集，请完成后再关闭。'
  if (!rawText.value.trim()) return '请先选择包含章节文本的 TXT 文件'
  return ''
})
const importConfirmDisabledReason = computed(() => {
  if (importing.value) return '正在导入剧集，请稍候。'
  if (!previewEpisodes.value.length) return '请先完成预览确认'
  return ''
})
const previewTabDisabledReason = computed(() => (
  previewReady.value ? '' : '请先选择文件并确认导入配置'
))

function openDialog() {
  visible.value = true
  activeTab.value = 'config'
}

function hasUnsavedWork() {
  return importing.value || Boolean(rawText.value.trim() || fileName.value || previewEpisodes.value.length)
}

function isImporting() {
  return importing.value
}

async function requestClose(done) {
  if (importing.value) {
    ElMessage.warning('正在导入剧集，请完成后再关闭。')
    return false
  }
  if (!rawText.value.trim() && !fileName.value && !previewEpisodes.value.length) {
    if (typeof done === 'function') done()
    else resetState()
    return true
  }
  if (closeConfirmOpen) return false
  closeConfirmOpen = true
  try {
    await ElMessageBox.confirm(
      '已选择的剧本文件和预览结果尚未导入，关闭后会丢失。',
      '关闭批量导入？',
      {
        confirmButtonText: '放弃并关闭',
        cancelButtonText: '继续导入',
        type: 'warning',
        distinguishCancelAndClose: true,
      },
    )
    if (typeof done === 'function') done()
    else resetState()
    return true
  } catch {
    return false
  } finally {
    closeConfirmOpen = false
  }
}

defineExpose({
  openDialog,
  hasUnsavedWork,
  isImporting,
  requestClose,
})

onBeforeUnmount(() => {
  batchImportLifecycle.dispose()
})

function resetState() {
  visible.value = false
  activeTab.value = 'config'
  previewReady.value = false
  importing.value = false
  fileName.value = ''
  rawText.value = ''
  chapterPattern.value = DEFAULT_CHAPTER_PATTERN
  chaptersPerEpisode.value = 1
  previewChapters.value = []
  previewEpisodes.value = []
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function onFileChange(event) {
  const file = event.target?.files?.[0]
  if (!file) return
  if (!/\.txt$/i.test(file.name || '')) {
    ElMessage.warning('请选择 TXT 文本文件')
    event.target.value = ''
    return
  }
  fileName.value = file.name
  rawText.value = ''
  previewReady.value = false
  previewChapters.value = []
  previewEpisodes.value = []
  const reader = new FileReader()
  reader.onload = (ev) => {
    rawText.value = String(ev.target?.result || '')
    if (!rawText.value.trim()) {
      fileName.value = ''
      rawText.value = ''
      event.target.value = ''
      ElMessage.error('文件内容为空，请选择包含章节文本的 TXT 文件')
    }
  }
  reader.onerror = () => {
    fileName.value = ''
    rawText.value = ''
    event.target.value = ''
    ElMessage.error('读取文件失败，请重新选择 TXT 文件')
  }
  reader.readAsText(file, 'utf-8')
}

function confirmConfig() {
  if (!rawText.value.trim()) {
    ElMessage.warning('请先选择 TXT 文件')
    return
  }
  try {
    const chapters = splitNovelChapters(rawText.value, chapterPattern.value)
    const episodes = buildEpisodesFromChapters(chapters, chaptersPerEpisode.value, props.startEpisodeNumber)
    if (!episodes.length) {
      ElMessage.warning('未生成可导入的集数')
      return
    }
    previewChapters.value = chapters
    previewEpisodes.value = episodes
    previewReady.value = true
    activeTab.value = 'preview'
    ElMessage.success(`已识别 ${chapters.length} 章，可导入 ${episodes.length} 集`)
  } catch (e) {
    if (isUserFacingAbort(e)) return
    previewReady.value = false
    previewChapters.value = []
    previewEpisodes.value = []
    ElMessage.error(toUserFacingError(e, '章节预览失败'))
  }
}

async function confirmImport() {
  if (!previewEpisodes.value.length) {
    ElMessage.warning('请先完成预览')
    return
  }
  importing.value = true
  try {
    const payload = previewEpisodes.value.map((episode) => ({
      episode_number: episode.episode_number,
      title: episode.title,
      script_content: episode.script_content,
      description: null,
      duration: 0,
    }))
    await batchImportLifecycle.execute(() => (
      props.importHandler
        ? props.importHandler(payload)
        : emit('import', payload)
    ))
    batchImportLifecycle.run(() => {
      ElMessage.success(`已导入 ${previewEpisodes.value.length} 集`)
      resetState()
    })
  } catch (e) {
    if (isUserFacingAbort(e) || isProjectInstanceDisposedError(e)) return
    ElMessage.error(toUserFacingError(e, '批量导入失败'))
  } finally {
    batchImportLifecycle.run(() => { importing.value = false })
  }
}
</script>

<style scoped>
.episode-batch-import-trigger { display: inline-flex; }
.batch-import-dialog { display: flex; flex-direction: column; }
.batch-import-tabs { width: 100%; }
.batch-import-panel { display: flex; flex-direction: column; gap: 16px; min-height: 420px; }
.batch-import-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.batch-import-file { font-size: 0.85rem; color: #a1a1aa; }
.batch-import-file.is-empty { color: #71717a; }
.batch-import-form { margin-bottom: 0; }
.batch-import-tip-block { display: flex; flex-direction: column; gap: 8px; }
.batch-import-tip { font-size: 0.82rem; color: #71717a; }
.batch-import-code { color: #c084fc; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; }
.batch-import-disabled-reason { font-size: 12px; color: #a1a1aa; line-height: 1.4; }
.hidden-file-input {
  display: none;
}
</style>
