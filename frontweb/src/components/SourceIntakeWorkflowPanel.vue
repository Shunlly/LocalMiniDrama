<template>
  <section class="source-workflow-section">
    <div class="section-head">
      <div>
        <div class="section-title">故事素材流水线</div>
        <div class="section-subtitle">Source Intake / Workflow Run / QA / Timeline</div>
      </div>
      <div class="head-actions">
        <el-button size="small" :loading="loading" @click="loadData">刷新</el-button>
        <el-button size="small" plain :loading="qaRunning" @click="runQaAudit">QA 审计</el-button>
        <el-button
          size="small"
          type="warning"
          plain
          :disabled="!latestQa.id || latestQa.passed || !latestQa.canRemediate"
          :loading="remediating"
          @click="remediateQa"
        >
          一键补救
        </el-button>
      </div>
    </div>

    <div class="workflow-layout">
      <div class="intake-pane">
        <el-form label-position="top" class="intake-form">
          <div class="form-row">
            <el-form-item label="素材类型">
              <el-select v-model="form.source_type" placeholder="自动识别" clearable>
                <el-option
                  v-for="item in sourceTypeOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="目标集数">
              <el-input-number v-model="form.target_episode_count" :min="1" :max="100" controls-position="right" />
            </el-form-item>
          </div>

          <el-form-item label="标题">
            <el-input v-model="form.title" placeholder="故事素材标题" />
          </el-form-item>

          <el-form-item label="网页 URL">
            <el-input
              v-model="form.source_url"
              clearable
              placeholder="粘贴公开网页或纯文本链接，系统会抽取正文作为素材"
            />
            <div class="field-help">仅导入公开可访问的文本/HTML 页面；请确认素材版权或授权。</div>
          </el-form-item>

          <el-form-item label="本地文本文件">
            <div class="file-row">
              <input
                ref="sourceFileInput"
                type="file"
                accept=".txt,.md,.csv,.tsv,.srt,.vtt,.ass,.json"
                class="hidden-file-input"
                @change="handleSourceFile"
              />
              <el-button size="small" @click="sourceFileInput?.click()">选择文件</el-button>
              <el-button v-if="sourceFile" size="small" link type="danger" @click="clearSelectedFile">移除</el-button>
              <span class="file-name">{{ selectedFilename || '支持 txt、md、csv、tsv、srt、vtt、ass、json，最大 20MB' }}</span>
            </div>
          </el-form-item>

          <el-form-item label="原始素材">
            <el-input
              v-model="form.text"
              type="textarea"
              :rows="8"
              placeholder="粘贴小说、梗概、剧本、分镜表、漫画文字说明或转写文本"
            />
          </el-form-item>

          <div class="action-row">
            <el-button :loading="sourceSaving" :disabled="!hasSourceInput" @click="importSourceOnly">
              仅导入素材
            </el-button>
            <el-button type="primary" :loading="workflowStarting" :disabled="!hasSourceInput" @click="startWorkflow">
              启动流水线
            </el-button>
          </div>
        </el-form>
      </div>

      <div class="status-pane">
        <div class="status-block">
          <div class="block-head">
            <span>最近 Workflow Run</span>
            <el-tag v-if="runState.id" size="small" :type="runTagType">{{ runState.label }}</el-tag>
          </div>

          <template v-if="selectedRun">
            <el-progress :percentage="runState.progress" :status="runProgressStatus" />
            <div class="run-meta">
              <span>{{ selectedRun.type }}</span>
              <span>{{ formatTime(selectedRun.created_at) }}</span>
              <span v-if="runState.activeStep">当前：{{ workflowStepLabel(runState.activeStep.step_key) }}</span>
            </div>
            <div v-if="runState.novel2animePlaceholder" class="placeholder-note">
              Novel2Anime 当前媒体步骤使用本地 mock 占位，production QA 会要求真实 provider 产物。
            </div>

            <details class="run-detail" open>
              <summary>步骤明细</summary>
              <div class="step-list">
                <div
                  v-for="step in selectedRun.steps || []"
                  :key="step.id"
                  class="step-item"
                  :class="'step-' + step.status"
                >
                  <span class="step-dot" />
                  <span class="step-name">{{ workflowStepLabel(step.step_key) }}</span>
                  <span class="step-status">{{ step.status }}</span>
                  <span class="step-attempts">#{{ step.attempts || 0 }}</span>
                </div>
              </div>
            </details>

            <div v-if="runState.failedStep" class="run-error">
              {{ runState.failedStep.error || selectedRun.error }}
            </div>

            <div class="action-row compact">
              <el-button size="small" :disabled="!runState.canRetry" :loading="retrying" @click="retryRun">重试失败步骤</el-button>
              <el-button size="small" :disabled="!runState.canPause" :loading="pausing" @click="pauseRun">暂停</el-button>
              <el-button size="small" type="primary" plain :disabled="!runState.canResume" :loading="resuming" @click="resumeRun">恢复</el-button>
              <el-button size="small" type="danger" plain :disabled="!runState.canCancel" :loading="cancelling" @click="cancelRun">取消</el-button>
            </div>
          </template>

          <div v-else class="empty-line">暂无 workflow run</div>
        </div>

        <div class="status-block split">
          <div>
            <div class="block-head">
              <span>素材记录</span>
              <span class="count">{{ sources.length }}</span>
            </div>
            <div class="mini-list">
              <div v-for="source in sources" :key="source.id" class="mini-item">
                <button class="link-button" @click="openSourceDetail(source)">
                  {{ source.title || source.source_type }}
                </button>
                <span class="mini-actions">
                  <el-tag size="small" effect="plain">{{ source.source_type }}</el-tag>
                  <el-button size="small" link type="primary" :loading="workflowStarting" @click="startWorkflowFromSource(source)">
                    启动
                  </el-button>
                </span>
              </div>
              <div v-if="!sources.length" class="empty-line">暂无素材</div>
            </div>
          </div>

          <div>
            <div class="block-head">
              <span>最近 QA</span>
              <el-tag v-if="latestQa.id" size="small" :type="latestQa.passed ? 'success' : 'warning'">
                {{ latestQa.score }}
              </el-tag>
            </div>

            <template v-if="latestQa.id">
              <div class="qa-line" :class="{ passed: latestQa.passed }">
                {{ latestQa.passed ? '通过' : '未通过' }} / {{ latestQa.issueCount }} 项问题
              </div>
              <div v-if="remediationStatus" class="remediation-status">{{ remediationStatus }}</div>
              <div class="qa-issues">
                <div v-for="issue in latestQa.issues.slice(0, 3)" :key="issue.code + issue.message" class="qa-issue">
                  {{ issue.message }}
                </div>
              </div>

              <details class="qa-detail">
                <summary>完整 QA 明细</summary>
                <div class="qa-detail-title">检查项</div>
                <div v-for="check in latestQa.checks" :key="check.key" class="qa-issue">
                  {{ check.key }}：{{ check.passed ? '通过' : '未通过' }}
                </div>
                <div class="qa-detail-title">建议</div>
                <div v-for="item in latestQa.recommendations" :key="item" class="qa-issue">
                  {{ item }}
                </div>
                <div v-if="latestQa.remediationActions.length" class="qa-detail-title">补救动作</div>
                <div v-for="action in latestQa.remediationActions" :key="action.code" class="qa-issue">
                  {{ action.label }}：{{ action.automated ? '可自动执行' : '需要人工处理' }}
                </div>
              </details>
            </template>

            <div v-else class="empty-line">暂无 QA 报告</div>
          </div>
        </div>

        <div class="status-block timeline-block">
          <div class="block-head">
            <span>时间线摘要</span>
            <el-tag v-if="timelineSummary.itemCount" size="small" :type="timelineSummary.hasPlaceholderItems ? 'warning' : timelineSummary.hasRequiredTracks ? 'success' : 'warning'">
              {{ timelineSummary.hasOnlyPlaceholderItems ? '占位' : timelineSummary.hasPlaceholderItems ? '含占位' : timelineSummary.itemCount + ' 条' }}
            </el-tag>
          </div>
          <div v-if="timelineSummary.episodeCount" class="timeline-summary">
            <span>{{ timelineSummary.episodeCount }} 集</span>
            <span>{{ timelineSummary.trackCount }} 轨</span>
            <span>{{ formatDuration(timelineSummary.durationSec) }}</span>
            <span>{{ timelineSummary.trackTypes.join(' / ') }}</span>
            <span v-if="timelineSummary.placeholderItemCount">{{ timelineSummary.placeholderItemCount }} 条占位</span>
          </div>
          <div v-else class="empty-line">暂无时间线</div>
        </div>
      </div>
    </div>

    <el-drawer v-model="sourceDetailVisible" title="素材详情" size="46%">
      <div v-if="sourceDetailLoading" class="empty-line">加载中...</div>
      <template v-else-if="sourceDetail">
        <div class="detail-meta">
          <div><strong>{{ sourceDetail.source.title }}</strong></div>
          <div>{{ sourceDetail.source.source_type }} / {{ formatTime(sourceDetail.source.created_at) }}</div>
          <div>Items {{ sourceDetail.items.length }} / Events {{ sourceDetail.events.length }} / Edges {{ sourceDetail.event_edges.length }}</div>
        </div>

        <div class="detail-section">
          <div class="detail-title">Source Items</div>
          <div v-for="item in sourceDetail.items" :key="item.id" class="detail-row">
            <strong>#{{ item.item_no }} {{ item.title }}</strong>
            <p>{{ item.summary }}</p>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-title">Story Events</div>
          <div v-for="event in sourceDetail.events" :key="event.id" class="detail-row">
            <strong>#{{ event.event_no }} {{ event.title }}</strong>
            <p>{{ event.detail }}</p>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-title">Event Edges</div>
          <div v-for="edge in sourceDetail.event_edges" :key="edge.id" class="detail-row compact-row">
            {{ edge.relation_type }}：{{ edge.from_event_id }} -> {{ edge.to_event_id }}
          </div>
        </div>
      </template>
      <div v-else class="empty-line">未找到素材详情</div>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceIntakeAPI } from '@/api/sourceIntake'
import { workflowRunsAPI } from '@/api/workflowRuns'
import { qaReportsAPI } from '@/api/qaReports'
import { timelinesAPI } from '@/api/timelines'
import {
  SOURCE_TYPE_OPTIONS,
  buildSourceIntakePayload,
  buildSourceUploadFormData,
  inferSourceTypeFromFilename,
} from '@/utils/sourceIntakeAdapter'
import { normalizeWorkflowRun, workflowStepLabel } from '@/utils/workflowRunStatus'
import { normalizeQaReport } from '@/utils/qaReport'
import { formatDuration, normalizeTimelineSummary } from '@/utils/timelineSummary'

const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024

const props = defineProps({
  dramaId: { type: Number, required: true },
  drama: { type: Object, default: null },
})

const emit = defineEmits(['refresh'])

const sourceTypeOptions = SOURCE_TYPE_OPTIONS
const form = reactive({
  title: '',
  source_type: '',
  target_episode_count: 1,
  source_url: '',
  text: '',
})

const sourceFileInput = ref(null)
const sourceFile = ref(null)
const selectedFilename = ref('')
const loading = ref(false)
const sourceSaving = ref(false)
const workflowStarting = ref(false)
const qaRunning = ref(false)
const remediating = ref(false)
const retrying = ref(false)
const pausing = ref(false)
const resuming = ref(false)
const cancelling = ref(false)
const sources = ref([])
const runs = ref([])
const reports = ref([])
const selectedRun = ref(null)
const timeline = ref(null)
const remediationStatus = ref('')
const sourceDetailVisible = ref(false)
const sourceDetailLoading = ref(false)
const sourceDetail = ref(null)
let pollTimer = null

const hasWebSourceUrl = computed(() => Boolean(String(form.source_url || '').trim()))
const hasSourceInput = computed(() => Boolean(sourceFile.value || hasWebSourceUrl.value || form.text.trim()))
const runState = computed(() => normalizeWorkflowRun(selectedRun.value))
const timelineSummary = computed(() => normalizeTimelineSummary(timeline.value))
const latestQa = computed(() => {
  const runId = selectedRun.value?.id
  const matched = runId ? reports.value.find((report) => report.run_id === runId) : null
  return normalizeQaReport(matched || reports.value[0] || null)
})
const runTagType = computed(() => {
  if (selectedRun.value?.status === 'completed') return 'success'
  if (selectedRun.value?.status === 'failed') return 'danger'
  if (selectedRun.value?.status === 'cancelled') return 'info'
  if (selectedRun.value?.status === 'paused') return 'info'
  return 'warning'
})
const runProgressStatus = computed(() => {
  if (selectedRun.value?.status === 'completed') return 'success'
  if (selectedRun.value?.status === 'failed') return 'exception'
  return undefined
})

function syncDefaults() {
  form.target_episode_count = Math.max(1, Number(props.drama?.episodes?.length) || Number(props.drama?.total_episodes) || 1)
  if (!form.title) form.title = props.drama?.title ? `${props.drama.title} 素材` : ''
}

function formatTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPoll() {
  stopPoll()
  if (!runState.value.active) return
  pollTimer = setInterval(refreshSelectedRun, 2500)
}

function clearSelectedFile() {
  sourceFile.value = null
  selectedFilename.value = ''
  if (sourceFileInput.value) sourceFileInput.value.value = ''
}

async function handleSourceFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    clearSelectedFile()
    ElMessage.warning('Source Intake 文本上传最大 20MB，请拆分素材或稍后接入多媒体解析流程')
    return
  }
  sourceFile.value = file
  selectedFilename.value = file.name
  if (!form.title) form.title = file.name.replace(/\.[^.]+$/, '')
  const inferredType = inferSourceTypeFromFilename(file.name)
  if (inferredType && !form.source_type) form.source_type = inferredType
  if (file.size <= 2 * 1024 * 1024) {
    try {
      form.text = await file.text()
    } catch (_) {
      form.text = ''
    }
  } else {
    form.text = ''
  }
  ElMessage.success(`已选择 ${file.name}`)
}

async function refreshSelectedRun() {
  if (!selectedRun.value?.id) return
  try {
    const run = await workflowRunsAPI.get(selectedRun.value.id)
    selectedRun.value = run
    if (!normalizeWorkflowRun(run).active) {
      stopPoll()
      await Promise.all([loadReports(), loadSources(), loadTimeline()])
      emit('refresh')
    }
  } catch (_) {
    stopPoll()
  }
}

async function loadSources() {
  sources.value = await sourceIntakeAPI.listForDrama(props.dramaId)
}

async function loadRuns() {
  runs.value = await workflowRunsAPI.list({ drama_id: props.dramaId, type: 'novel2anime', limit: 10 })
  const latest = runs.value[0]
  selectedRun.value = latest ? await workflowRunsAPI.get(latest.id) : null
  startPoll()
}

async function loadReports() {
  reports.value = await qaReportsAPI.list({ drama_id: props.dramaId, limit: 10 })
}

async function loadTimeline() {
  try {
    timeline.value = await timelinesAPI.getDramaTimeline(props.dramaId)
  } catch (_) {
    timeline.value = null
  }
}

async function loadData() {
  if (!props.dramaId) return
  loading.value = true
  try {
    await Promise.all([loadSources(), loadRuns(), loadReports(), loadTimeline()])
  } catch (e) {
    ElMessage.error(e.message || '加载流水线状态失败')
  } finally {
    loading.value = false
  }
}

async function createSourceFromForm() {
  if (sourceFile.value) {
    return sourceIntakeAPI.uploadForDrama(props.dramaId, buildSourceUploadFormData(form, props.drama, sourceFile.value))
  }
  if (hasWebSourceUrl.value) {
    const payload = buildSourceIntakePayload({ ...form, text: '' }, props.drama)
    return sourceIntakeAPI.importUrlForDrama(props.dramaId, {
      ...payload,
      source_url: String(form.source_url || '').trim(),
    })
  }
  return sourceIntakeAPI.createForDrama(props.dramaId, buildSourceIntakePayload(form, props.drama))
}

function resetSourceInput() {
  form.text = ''
  form.source_url = ''
  clearSelectedFile()
}

async function importSourceOnly() {
  sourceSaving.value = true
  try {
    await createSourceFromForm()
    ElMessage.success('素材已导入')
    resetSourceInput()
    await loadSources()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    sourceSaving.value = false
  }
}

async function startWorkflow() {
  workflowStarting.value = true
  try {
    if (sourceFile.value || hasWebSourceUrl.value) {
      const result = await createSourceFromForm()
      selectedRun.value = await startWorkflowFromSource(result.source, { silent: true })
    } else {
      selectedRun.value = await workflowRunsAPI.startNovel2Anime({
        drama_id: props.dramaId,
        ...buildSourceIntakePayload(form, props.drama),
      })
    }
    ElMessage.success('流水线已启动')
    resetSourceInput()
    await Promise.all([loadSources(), loadRuns()])
    startPoll()
  } catch (e) {
    ElMessage.error(e.message || '启动失败')
  } finally {
    workflowStarting.value = false
  }
}

async function startWorkflowFromSource(source, options = {}) {
  if (!source?.id) return null
  if (!options.silent) workflowStarting.value = true
  try {
    const run = await workflowRunsAPI.startNovel2Anime({
      drama_id: props.dramaId,
      source_id: source.id,
      title: source.title || '',
      target_episode_count: form.target_episode_count,
      style: props.drama?.style || '',
    })
    selectedRun.value = run
    if (!options.silent) {
      ElMessage.success('已从素材启动流水线')
      await loadRuns()
      startPoll()
    }
    return run
  } catch (e) {
    ElMessage.error(e.message || '启动失败')
    return null
  } finally {
    if (!options.silent) workflowStarting.value = false
  }
}

async function retryRun() {
  if (!selectedRun.value?.id) return
  retrying.value = true
  try {
    selectedRun.value = await workflowRunsAPI.retry(selectedRun.value.id)
    ElMessage.success('已提交重试')
    startPoll()
  } catch (e) {
    ElMessage.error(e.message || '重试失败')
  } finally {
    retrying.value = false
  }
}

async function cancelRun() {
  if (!selectedRun.value?.id) return
  cancelling.value = true
  try {
    selectedRun.value = await workflowRunsAPI.cancel(selectedRun.value.id, 'User cancelled from Source Intake panel')
    ElMessage.success('已取消')
    stopPoll()
  } catch (e) {
    ElMessage.error(e.message || '取消失败')
  } finally {
    cancelling.value = false
  }
}

async function pauseRun() {
  if (!selectedRun.value?.id) return
  pausing.value = true
  try {
    selectedRun.value = await workflowRunsAPI.pause(selectedRun.value.id, 'User paused from Source Intake panel')
    ElMessage.success('已暂停')
    stopPoll()
  } catch (e) {
    ElMessage.error(e.message || '暂停失败')
  } finally {
    pausing.value = false
  }
}

async function resumeRun() {
  if (!selectedRun.value?.id) return
  resuming.value = true
  try {
    selectedRun.value = await workflowRunsAPI.resume(selectedRun.value.id)
    ElMessage.success('已恢复')
    startPoll()
  } catch (e) {
    ElMessage.error(e.message || '恢复失败')
  } finally {
    resuming.value = false
  }
}

async function runQaAudit() {
  qaRunning.value = true
  try {
    await qaReportsAPI.audit({ drama_id: props.dramaId, run_id: selectedRun.value?.id || undefined, mode: 'draft' })
    await loadReports()
    ElMessage.success('QA 审计已完成')
  } catch (e) {
    ElMessage.error(e.message || 'QA 审计失败')
  } finally {
    qaRunning.value = false
  }
}

async function remediateQa() {
  if (!latestQa.value.id) return
  remediating.value = true
  remediationStatus.value = '正在提交自动补救...'
  try {
    const result = await qaReportsAPI.remediate(latestQa.value.id, {
      target_episode_count: form.target_episode_count,
      style: props.drama?.style || '',
    })
    if (result.workflow_run) {
      selectedRun.value = result.workflow_run
      const action = result.actions_taken?.[0]?.code || 'workflow'
      remediationStatus.value = `已启动补救：${action}`
      ElMessage.success('已启动自动补救工作流')
      startPoll()
    } else {
      remediationStatus.value = result.reason || '当前 QA 报告没有可自动执行的补救动作'
      ElMessage.warning(remediationStatus.value)
    }
    await Promise.all([loadRuns(), loadReports()])
  } catch (e) {
    remediationStatus.value = ''
    ElMessage.error(e.message || '自动补救失败')
  } finally {
    remediating.value = false
  }
}

async function openSourceDetail(source) {
  sourceDetailVisible.value = true
  sourceDetailLoading.value = true
  sourceDetail.value = null
  try {
    sourceDetail.value = await sourceIntakeAPI.get(source.id)
  } catch (e) {
    ElMessage.error(e.message || '加载素材详情失败')
  } finally {
    sourceDetailLoading.value = false
  }
}

watch(() => props.drama, syncDefaults, { immediate: true })
watch(() => props.dramaId, loadData)

onMounted(loadData)
onBeforeUnmount(stopPoll)
</script>

<style scoped>
.source-workflow-section {
  background: rgba(24, 24, 27, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 20px 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: #fafafa;
}
.section-subtitle {
  margin-top: 3px;
  font-size: 12px;
  color: #71717a;
}
.head-actions,
.action-row,
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.workflow-layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(360px, 1.1fr);
  gap: 18px;
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
  color: #a1a1aa;
  font-size: 12px;
}
.field-help {
  margin-top: 6px;
  color: #71717a;
  font-size: 12px;
  line-height: 1.45;
}
.status-pane,
.intake-pane {
  min-width: 0;
}
.status-block {
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 14px;
  background: rgba(18, 18, 22, 0.58);
}
.status-block + .status-block {
  margin-top: 12px;
}
.status-block.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #e4e4e7;
}
.count {
  color: #60a5fa;
}
.run-meta,
.timeline-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 8px 0 10px;
  color: #a1a1aa;
  font-size: 12px;
}
.placeholder-note {
  margin: 8px 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #fde68a;
  background: rgba(245, 158, 11, 0.12);
  font-size: 12px;
  line-height: 1.45;
}
.run-detail,
.qa-detail {
  color: #a1a1aa;
  font-size: 12px;
}
.run-detail summary,
.qa-detail summary {
  cursor: pointer;
  color: #93c5fd;
  margin-bottom: 8px;
}
.step-list {
  display: grid;
  gap: 6px;
}
.step-item {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #a1a1aa;
}
.step-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #52525b;
}
.step-completed .step-dot { background: #22c55e; }
.step-processing .step-dot { background: #60a5fa; }
.step-failed .step-dot { background: #ef4444; }
.step-cancelled .step-dot { background: #71717a; }
.step-name {
  color: #e4e4e7;
}
.step-status,
.step-attempts {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #71717a;
}
.run-error,
.remediation-status {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
  font-size: 12px;
}
.remediation-status {
  color: #bfdbfe;
  background: rgba(96, 165, 250, 0.12);
  margin-bottom: 8px;
}
.compact {
  margin-top: 12px;
}
.mini-list {
  display: grid;
  gap: 6px;
}
.mini-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #a1a1aa;
  font-size: 12px;
}
.link-button {
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent;
  color: #93c5fd;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.qa-line {
  font-size: 13px;
  color: #facc15;
  margin-bottom: 8px;
}
.qa-line.passed {
  color: #4ade80;
}
.qa-issues {
  display: grid;
  gap: 5px;
}
.qa-issue,
.empty-line {
  font-size: 12px;
  color: #71717a;
  line-height: 1.45;
}
.qa-detail {
  margin-top: 10px;
}
.qa-detail-title,
.detail-title {
  margin-top: 8px;
  color: #e4e4e7;
  font-weight: 600;
}
.detail-meta {
  display: grid;
  gap: 4px;
  color: #71717a;
  font-size: 13px;
  margin-bottom: 16px;
}
.detail-section {
  margin-top: 14px;
}
.detail-row {
  border-bottom: 1px solid #27272a;
  padding: 8px 0;
  color: #a1a1aa;
  font-size: 12px;
}
.detail-row p {
  margin: 4px 0 0;
  line-height: 1.5;
}
.compact-row {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
html.light .source-workflow-section {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .section-title,
html.light .block-head,
html.light .step-name,
html.light .qa-detail-title,
html.light .detail-title {
  color: #18181b;
}
html.light .status-block {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .detail-row {
  border-bottom-color: #e5e7eb;
}
@media (max-width: 900px) {
  .workflow-layout,
  .status-block.split {
    grid-template-columns: 1fr;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
