<template>
  <section id="source-intake-workflow" class="source-workflow-section" tabindex="-1">
    <div class="section-head">
      <div>
        <div class="section-title">故事素材流程</div>
        <div class="section-subtitle">素材导入 / 制作流程 / 质量检查 / 时间线</div>
      </div>
      <div class="head-actions">
        <el-button size="small" :loading="loading" :disabled="isWorkflowLaunchBusy || workflowActionBusy" @click="loadData">
          {{ loading ? '正在刷新' : '刷新' }}
        </el-button>
      </div>
    </div>

    <div v-if="compactCompletionVisible" data-testid="source-workflow-complete" class="source-workflow-complete">
      <div class="workflow-complete-heading">
        <strong>{{ completionTitle }}</strong>
        <span>{{ qaPresentation.scoreLabel }}</span>
      </div>
      <div v-if="completionSummaryReady" class="workflow-complete-metrics" aria-label="完成摘要">
        <span><small>QA</small><strong>{{ qaPresentation.statusLabel }}</strong></span>
        <span><small>分集</small><strong>{{ completionEpisodeCount }} 集</strong></span>
        <span><small>轨道</small><strong>{{ timelineSummary.trackCount }} 轨</strong></span>
        <span><small>时长</small><strong>{{ formatDuration(timelineSummary.durationSec) }}</strong></span>
        <span><small>占位</small><strong>{{ completionPlaceholderCount }} 项</strong></span>
      </div>
      <p v-else class="workflow-complete-pending" role="status" aria-live="polite">
        交付摘要整理中，轨道、时长和占位统计将在时间线加载后显示。
      </p>
      <div class="workflow-complete-actions">
        <el-button type="primary" @click="$emit('enter-production')">进入制作</el-button>
        <el-button plain @click="$emit('focus-episode-list')">查看分集</el-button>
        <el-button
          class="workflow-history-toggle"
          text
          :aria-controls="'source-workflow-history'"
          :aria-expanded="workflowHistoryExpanded"
          @click="workflowHistoryExpanded = !workflowHistoryExpanded"
        >
          <el-icon><ArrowUp v-if="workflowHistoryExpanded" /><ArrowDown v-else /></el-icon>
          流程记录
        </el-button>
      </div>
    </div>

    <div
      id="source-workflow-history"
      v-show="!compactCompletionVisible || workflowHistoryExpanded"
    >
    <nav class="flow-stepper" aria-label="素材处理步骤">
      <button
        v-for="step in flowState.steps"
        :key="step.id"
        type="button"
        class="flow-step"
        :class="[
          `is-${step.status}`,
          { 'is-current': flowState.activeStepId === step.id },
          { 'is-selected': inspectedFlowStep.id === step.id },
        ]"
        :aria-current="flowState.activeStepId === step.id ? 'step' : undefined"
        :aria-pressed="inspectedFlowStep.id === step.id"
        @click="selectFlowStep(step.id)"
      >
        <span class="flow-step-number">{{ step.status === 'done' ? '✓' : step.number }}</span>
        <span class="flow-step-copy">
          <strong>{{ step.label }}</strong>
          <small>{{ step.statusLabel }}</small>
          <small class="flow-step-summary">{{ step.summary }}</small>
        </span>
      </button>
    </nav>

    <div
      v-if="workflowDataError"
      class="workflow-status-banner workflow-status-banner--error"
      role="alert"
      aria-live="assertive"
    >
      <span>{{ workflowDataError }}</span>
      <el-button size="small" type="primary" plain :loading="loading" @click="loadData">
        重试
      </el-button>
    </div>

    <div class="workflow-focus">
      <div class="workflow-focus-head">
        <div class="stage-heading">
          <span class="stage-number">{{ inspectedFlowStep.number }}</span>
          <div>
            <strong>{{ inspectedFlowStep.label }}</strong>
            <span>{{ inspectedFlowStep.summary }}</span>
          </div>
          <el-tag size="small" :type="stageStatusTagType(inspectedFlowStep.status)">{{ inspectedFlowStep.statusLabel }}</el-tag>
        </div>
      </div>

      <div class="workflow-stage-card">
        <div v-if="inspectedFlowStep.id === 'intake' || inspectedFlowStep.id === 'process'" class="workflow-mode-band">
          <div class="workflow-mode-head">
            <strong>启动模式</strong>
            <el-tag size="small" :type="workflowMode === 'production' ? 'danger' : 'info'">
              {{ workflowModeShortLabel }}
            </el-tag>
          </div>
          <el-radio-group
            v-model="workflowMode"
            class="workflow-mode-control"
            aria-label="工作流启动模式"
            :disabled="isWorkflowLaunchBusy"
            @change="handleWorkflowModeChange"
          >
            <el-radio-button value="draft">草稿预演</el-radio-button>
            <el-radio-button value="production">正式制作</el-radio-button>
          </el-radio-group>
          <p>{{ workflowModeDescription }}</p>

          <div
            v-if="workflowMode === 'production' && (readinessChecking || productionReadiness)"
            class="production-readiness"
            :class="{ 'is-ready': productionReadiness?.ready, 'has-gaps': productionReadiness && !productionReadiness.ready }"
            :role="productionReadiness && !productionReadiness.ready ? 'alert' : 'status'"
            aria-live="polite"
          >
            <template v-if="readinessChecking">
              <strong>正在检查正式制作能力</strong>
              <span>正在核对文本、图像、视频、语音和本地合成能力…</span>
            </template>
            <template v-else-if="productionReadiness?.ready">
              <strong>正式制作能力已就绪</strong>
              <span>本次启动需要的服务与本地媒体工具均可用。</span>
            </template>
            <template v-else>
              <div class="readiness-gap-head">
                <strong>正式制作暂不能启动</strong>
                <el-button size="small" type="primary" plain @click="openAiConfigForReadiness">
                  <el-icon><Setting /></el-icon>
                  前往 AI 配置
                </el-button>
              </div>
              <ul class="readiness-gap-list">
                <li v-for="gap in productionReadiness?.missing_capabilities || []" :key="gap.key">
                  <strong>{{ gap.label }}</strong>
                  <span>{{ gap.detail }}</span>
                </li>
              </ul>
            </template>
          </div>
        </div>

        <template v-if="inspectedFlowStep.id === 'intake'">
          <div class="intake-stage-layout">
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

              <el-form-item label="网页 URL" :error="sourceUrlValidationMessage">
                <el-input
                  ref="sourceUrlInput"
                  v-model="form.source_url"
                  clearable
                  placeholder="粘贴公开网页或纯文本链接，系统会抽取正文作为素材"
                />
                <div class="field-help">仅导入公开可访问的文本 / HTML 页面，请确认素材版权或授权。</div>
              </el-form-item>

              <el-form-item label="本地素材文件">
                <div class="file-row">
                  <input
                    ref="sourceFileInput"
                    type="file"
                    :accept="SOURCE_FILE_ACCEPT"
                    class="hidden-file-input"
                    @change="handleSourceFile"
                  />
                  <el-button size="small" :loading="sourceFileReading" :disabled="sourceUploadBusy" @click="sourceFileInput?.click()">选择文件</el-button>
                  <el-button v-if="sourceFile" size="small" link type="danger" :disabled="sourceUploadBusy" @click="clearSelectedFile">移除</el-button>
                  <span class="file-name">{{ selectedFilename || '支持文本、PDF、图片、音频和视频，单文件最大 20MB' }}</span>
                </div>
                <div class="field-help">
                  文本：txt、md、csv、tsv、srt、vtt、ass、json；图片：png、jpg、jpeg、webp、gif；音频：mp3、wav、m4a、aac、flac、ogg、oga；视频：mp4、mov、mkv、avi、webm、ogv。
                </div>
                <div v-if="sourceOperationStatus" class="source-operation-status" role="status" aria-live="polite">
                  {{ sourceOperationStatus }}
                </div>
                <div v-if="sourceOperationError" class="source-operation-error" role="alert" aria-live="assertive">
                  {{ sourceOperationError }}
                </div>
                <div
                  v-if="sourceListRefreshError"
                  class="source-operation-error source-import-refresh-alert"
                  role="alert"
                  aria-live="assertive"
                >
                  <span>{{ sourceListRefreshError }}</span>
                  <el-button
                    size="small"
                    type="primary"
                    plain
                    :loading="sourceListRefreshing"
                    :disabled="sourceSaving || sourceFileReading || isWorkflowLaunchBusy"
                    @click="refreshImportedSources"
                  >
                    刷新列表
                  </el-button>
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
                <ActionGate label="导入故事素材" :reason="actionReasons.import">
                    <el-button :loading="sourceSaving" :disabled="Boolean(actionReasons.import) || sourceUploadBusy" @click="importSourceOnly">
                      导入故事素材
                    </el-button>
                </ActionGate>
                <ActionGate :label="`导入并启动 ${workflowModeShortLabel}`" :reason="actionReasons.start">
                    <el-button type="primary" :loading="workflowStarting && !startingSourceId" :disabled="Boolean(actionReasons.start) || sourceUploadBusy" @click="startWorkflow">
                      {{ workflowStartButtonLabel }}
                    </el-button>
                </ActionGate>
              </div>
              <div v-if="actionReasons.start" class="action-reason">{{ actionReasons.start }}</div>
            </el-form>

            <div class="status-block source-records-block">
              <div class="block-head">
                <span>已导入素材</span>
                <span class="count">{{ sources.length }}</span>
              </div>
              <div v-if="flowState.sourceEmptyState" class="empty-stage-state">
                <strong>{{ flowState.sourceEmptyState.title }}</strong>
                <p>{{ flowState.sourceEmptyState.description }}</p>
              </div>
              <div v-else class="mini-list">
                <div v-for="source in sources" :key="source.id" class="mini-item">
                  <span class="source-record-identity">
                    <button class="link-button" @click="openSourceDetail(source)">
                      {{ source.title || sourceTypeLabel(source.source_type) }}
                    </button>
                    <small v-if="sourceProvenanceLabel(source)">{{ sourceProvenanceLabel(source) }}</small>
                  </span>
                  <span class="mini-actions">
                    <el-tag size="small" effect="plain">{{ sourceTypeLabel(source.source_type) }}</el-tag>
                    <ActionGate :label="`以 ${workflowModeShortLabel} 启动`" :reason="newWorkflowRunReason">
                      <el-button
                        size="small"
                        link
                        type="primary"
                        :loading="startingSourceId === source.id"
                        :disabled="Boolean(newWorkflowRunReason) || isWorkflowLaunchBusy"
                        @click="startExistingSource(source)"
                      >
                        以 {{ workflowModeShortLabel }} 启动
                      </el-button>
                    </ActionGate>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="inspectedFlowStep.id === 'process'">
          <div class="status-block">
            <div class="stage-heading stage-heading--compact">
              <div>
                <strong>处理进度</strong>
                <span>监控改编、资产、分镜和媒体步骤。</span>
              </div>
              <el-tag v-if="runState.id" size="small" :type="runTagType">{{ runState.label }}</el-tag>
            </div>

            <template v-if="selectedRun">
              <el-progress :percentage="runState.progress" :status="runProgressStatus" />
              <div class="run-meta">
                <span>{{ workflowTypeLabel(selectedRun.type) }}</span>
                <span>{{ runState.modeLabel }}</span>
                <span>{{ formatTime(selectedRun.created_at) }}</span>
                <span v-if="runState.activeStep">当前：{{ workflowStepLabel(runState.activeStep, selectedRun) }}</span>
                <span v-if="runState.costLabel">{{ runState.costLabel }}</span>
                <span v-if="runState.costSummary.unknownCount" class="cost-unconfigured">
                  {{ runState.costSummary.unknownCount }} 项未配置价格
                </span>
              </div>
              <div
                v-if="pollStatusMessage"
                class="poll-status-banner"
                :class="{ 'is-error': pollState === 'error' }"
                :role="pollState === 'error' ? 'alert' : 'status'"
                aria-live="polite"
              >
                <span>{{ pollStatusMessage }}</span>
                <el-button
                  v-if="pollState === 'error' || pollState === 'recovering'"
                  size="small"
                  type="primary"
                  link
                  :loading="pollState === 'recovering'"
                  @click="resumePolling"
                >
                  恢复轮询
                </el-button>
              </div>
              <div v-if="runState.mediaNotice" class="placeholder-note" :class="{ 'is-error': runState.productionPlaceholder }">
                {{ runState.mediaNotice }}
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
                    <span class="step-name">{{ workflowStepLabel(step, selectedRun) }}</span>
                    <span class="step-status">{{ workflowStepStatusLabel(step.status) }}</span>
                    <span class="step-attempts">#{{ step.attempts || 0 }}</span>
                  </div>
                </div>
              </details>

              <div v-if="runState.failedStep" class="run-error">
                {{ runState.failedStep.error || selectedRun.error }}
              </div>

              <div class="action-row compact">
                <ActionGate label="重试失败步骤" :reason="actionReasons.retry">
                  <el-button size="small" :disabled="Boolean(actionReasons.retry) || workflowActionBusy" :loading="retrying" @click="retryRun">
                    {{ retrying ? '正在提交重试' : '重试失败步骤' }}
                  </el-button>
                </ActionGate>
                <ActionGate label="暂停处理" :reason="actionReasons.pause">
                  <el-button size="small" :disabled="Boolean(actionReasons.pause) || workflowActionBusy" :loading="pausing" @click="pauseRun">
                    {{ pausing ? '正在暂停' : '暂停' }}
                  </el-button>
                </ActionGate>
                <ActionGate label="恢复处理" :reason="actionReasons.resume">
                  <el-button size="small" type="primary" plain :disabled="Boolean(actionReasons.resume) || workflowActionBusy" :loading="resuming" @click="resumeRun">
                    {{ resuming ? '正在恢复' : '恢复' }}
                  </el-button>
                </ActionGate>
                <ActionGate label="取消处理" :reason="actionReasons.cancel">
                  <el-button size="small" type="danger" plain :disabled="Boolean(actionReasons.cancel) || workflowActionBusy" :loading="cancelling" @click="cancelRun">
                    {{ cancelling ? '正在取消' : '取消' }}
                  </el-button>
                </ActionGate>
              </div>
            </template>

            <div v-else-if="sources.length > 0" class="stage-empty stage-empty--actionable">
              <span>已有 {{ sources.length }} 份素材，选择最近导入的素材开始处理。</span>
              <ActionGate :label="`以 ${workflowModeShortLabel} 启动`" :reason="newWorkflowRunReason">
                <el-button type="primary" :loading="startingSourceId === sources[0].id" :disabled="Boolean(newWorkflowRunReason) || isWorkflowLaunchBusy" @click="startExistingSource(sources[0])">
                  以 {{ workflowModeShortLabel }} 启动
                </el-button>
              </ActionGate>
            </div>
            <div v-else class="stage-empty">请先在“导入素材”步骤添加故事素材。</div>
          </div>
        </template>

        <template v-else-if="inspectedFlowStep.id === 'qa'">
          <div class="status-block">
            <div class="stage-heading stage-heading--compact">
              <div>
                <strong>{{ qaPresentation.scopeLabel }}</strong>
                <span>检查项目结构、产物完整性和流程状态。</span>
              </div>
              <el-tag v-if="latestQa.id" size="small" :type="latestQa.passed ? 'success' : 'warning'">
                {{ qaPresentation.scoreLabel }}
              </el-tag>
            </div>

            <div class="stage-action-row">
              <ActionGate label="执行 QA 审计" :reason="actionReasons.qa">
                  <el-button size="small" type="primary" plain :disabled="Boolean(actionReasons.qa)" :loading="qaRunning" @click="runQaAudit">
                    执行 QA 审计
                  </el-button>
              </ActionGate>
              <span v-if="actionReasons.qa" class="action-reason action-reason--inline">{{ actionReasons.qa }}</span>
            </div>

            <template v-if="latestQa.id">
              <div v-if="qaPresentation.notice" class="placeholder-note">
                {{ qaPresentation.notice }}
              </div>
              <div class="qa-line" :class="{ passed: latestQa.passed }">
                {{ qaPresentation.statusLabel }} / {{ latestQa.issueCount }} 个问题
              </div>
              <div class="qa-issues">
                <div v-for="issue in latestQa.issues.slice(0, 3)" :key="issue.code + issue.message" class="qa-issue">
                  {{ issue.message }}
                </div>
              </div>

              <details class="qa-detail">
                <summary>完整 QA 明细</summary>
                <div class="qa-detail-title">检查项</div>
                <div v-for="check in latestQa.checks" :key="check.key" class="qa-issue">
                  {{ qaCheckLabel(check.key) }}：{{ check.passed ? '通过' : '未通过' }}
                </div>
                <div class="qa-detail-title">建议</div>
                <div v-for="item in latestQa.recommendations" :key="item" class="qa-issue">
                  {{ item }}
                </div>
              </details>
            </template>
            <div v-else class="stage-empty">等待当前运行 QA。流程完成后执行 QA，问题和建议会显示在这里。</div>
          </div>
        </template>

        <template v-else-if="inspectedFlowStep.id === 'remediation'">
          <div class="status-block">
            <div class="stage-heading stage-heading--compact">
              <div>
                <strong>修复建议</strong>
                <span>自动重跑可修复步骤，其余问题保留人工建议。</span>
              </div>
            </div>
            <div class="stage-action-row">
              <ActionGate label="一键修复" :reason="actionReasons.remediate">
                  <el-button
                    size="small"
                    type="warning"
                    plain
                    :disabled="Boolean(actionReasons.remediate)"
                    :loading="remediating"
                    @click="remediateQa"
                  >
                    一键修复
                  </el-button>
              </ActionGate>
              <span v-if="actionReasons.remediate" class="action-reason action-reason--inline">{{ actionReasons.remediate }}</span>
            </div>
            <div v-if="remediationStatus" class="remediation-status">{{ remediationStatus }}</div>
            <div v-if="latestQa.remediationActions.length" class="remediation-actions">
              <div v-for="action in latestQa.remediationActions" :key="action.code" class="qa-issue">
                {{ action.label }}：{{ action.automated ? '可自动执行' : '需要人工处理' }}
              </div>
            </div>
            <div v-else-if="latestQa.passed" class="stage-success">QA 已通过，不需要修复。</div>
            <div v-else class="stage-empty">先执行 QA，这里才会出现自动修复建议。</div>
          </div>
        </template>

        <template v-else>
          <div class="status-block timeline-block">
            <div class="stage-heading stage-heading--compact">
              <div>
                <strong>剧集 / 时间线</strong>
                <span>确认剧集数量、轨道和可用媒体。</span>
              </div>
              <el-tag v-if="timelineSummary.itemCount" size="small" :type="timelineSummary.hasPlaceholderItems ? 'warning' : timelineSummary.hasRequiredTracks ? 'success' : 'warning'">
                {{ timelineSummary.hasOnlyPlaceholderItems ? '占位' : timelineSummary.hasPlaceholderItems ? '含占位' : timelineSummary.itemCount + ' 条' }}
              </el-tag>
            </div>
            <div v-if="timelineSummary.episodeCount" class="timeline-summary">
              <span>{{ timelineSummary.episodeCount }} 集</span>
              <span>{{ timelineSummary.trackCount }} 轨</span>
              <span>{{ formatDuration(timelineSummary.durationSec) }}</span>
              <span>{{ timelineSummary.trackTypes.map(timelineTrackTypeLabel).join(' / ') }}</span>
              <span v-if="timelineSummary.placeholderItemCount">{{ timelineSummary.placeholderItemCount }} 条占位</span>
            </div>
            <div v-else-if="props.drama?.episodes?.length" class="timeline-summary">
              <span>{{ props.drama.episodes.length }} 集已生成</span>
              <span>时间线尚未生成</span>
            </div>
            <div v-else class="stage-empty">完成素材处理后，这里会显示剧集与时间线摘要。</div>
            <div class="stage-action-row delivery-actions">
              <el-button type="primary" plain @click="selectFlowStep('intake')">继续导入故事素材</el-button>
            </div>
          </div>
        </template>
      </div>
    </div>
    </div>

    <el-drawer v-model="sourceDetailVisible" title="素材详情" size="46%">
      <div v-if="sourceDetailLoading" class="empty-line">加载中...</div>
      <template v-else-if="sourceDetail">
        <div class="detail-meta">
          <div><strong>{{ sourceDetail.source.title }}</strong></div>
          <div>{{ sourceTypeLabel(sourceDetail.source.source_type) }} / {{ formatTime(sourceDetail.source.created_at) }}</div>
          <div>素材片段 {{ sourceDetail.items.length }} / 故事事件 {{ sourceDetail.events.length }} / 事件关系 {{ sourceDetail.event_edges.length }}</div>
        </div>

        <div class="detail-section">
          <div class="detail-title">素材片段</div>
          <div v-for="item in sourceDetail.items" :key="item.id" class="detail-row">
            <strong>#{{ item.item_no }} {{ item.title }}</strong>
            <p>{{ item.summary }}</p>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-title">故事事件</div>
          <div v-for="event in sourceDetail.events" :key="event.id" class="detail-row">
            <strong>#{{ event.event_no }} {{ event.title }}</strong>
            <p>{{ event.detail }}</p>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-title">事件关系</div>
          <div v-for="edge in sourceDetail.event_edges" :key="edge.id" class="detail-row compact-row">
            {{ sourceRelationLabel(edge.relation_type) }}：{{ sourceEventLabel(edge.from_event_id) }} → {{ sourceEventLabel(edge.to_event_id) }}
          </div>
        </div>
      </template>
      <div v-else class="empty-line">未找到素材详情</div>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowUp, Setting } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import { sourceIntakeAPI as rawSourceIntakeAPI } from '@/api/sourceIntake'
import { workflowRunsAPI as rawWorkflowRunsAPI } from '@/api/workflowRuns'
import { qaReportsAPI as rawQaReportsAPI } from '@/api/qaReports'
import { timelinesAPI as rawTimelinesAPI } from '@/api/timelines'
import {
  SOURCE_TYPE_OPTIONS,
  buildSourceIntakePayload,
  buildSourceUploadFormData,
  buildWebSourceIntakePayload,
  inferSourceTypeFromFilename,
  sourceProvenanceLabel,
  sourceRelationLabel,
  sourceTypeLabel,
} from '@/utils/sourceIntakeAdapter'
import {
  assertSourceWorkflowLifecycleActive,
  createSourceImportController,
  createSourceWorkflowLifecycleGuard,
  runGatedQaRemediation,
  selectQaReportForRun,
} from '@/utils/sourceImportOutcome'
import {
  normalizeWorkflowRun,
  workflowStepLabel,
  workflowStepStatusLabel,
  workflowTypeLabel,
} from '@/utils/workflowRunStatus'
import { buildQaPresentation, normalizeQaReport, qaCheckLabel } from '@/utils/qaReport'
import { formatDuration, normalizeTimelineSummary, timelineTrackTypeLabel } from '@/utils/timelineSummary'
import {
  buildSourceWorkflowState,
  getNewWorkflowRunReason,
  getSourceWorkflowActionReasons,
  selectInspectedWorkflowStep,
} from '@/utils/sourceWorkflowState'
import {
  DEFAULT_WORKFLOW_MODE,
  buildAiConfigLocation,
  isValidHttpSourceUrl,
  launchSourceWorkflow,
  normalizeProductionReadiness,
} from '@/utils/sourceWorkflowLaunch'
import { revealSourceImportIntent } from '@/utils/sourceImportIntent'
import { projectRouteInstanceKey } from '@/utils/projectListRoute'

const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024
const SOURCE_FILE_EXTENSIONS = Object.freeze([
  '.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json',
  '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
])
const SOURCE_FILE_ACCEPT = SOURCE_FILE_EXTENSIONS.join(',')
const SOURCE_FILE_EXTENSION_SET = new Set(SOURCE_FILE_EXTENSIONS)
const TEXT_SOURCE_FILE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json'])

const props = defineProps({
  dramaId: { type: Number, required: true },
  drama: { type: Object, default: null },
  sourceImportIntent: { type: Boolean, default: false },
})

const emit = defineEmits(['refresh', 'enter-production', 'focus-episode-list'])
const router = useRouter()
const sourceWorkflowLifecycle = createSourceWorkflowLifecycleGuard()
const sourceIntakeAPI = sourceWorkflowLifecycle.guardApi(rawSourceIntakeAPI)
const workflowRunsAPI = sourceWorkflowLifecycle.guardApi(rawWorkflowRunsAPI)
const qaReportsAPI = sourceWorkflowLifecycle.guardApi(rawQaReportsAPI)
const timelinesAPI = sourceWorkflowLifecycle.guardApi(rawTimelinesAPI)

function showWorkflowMessage(type, message) {
  return sourceWorkflowLifecycle.run(() => ElMessage[type](message))
}

function emitRefresh() {
  return sourceWorkflowLifecycle.run(() => emit('refresh'))
}

const sourceTypeOptions = SOURCE_TYPE_OPTIONS
const form = reactive({
  title: '',
  source_type: '',
  target_episode_count: 1,
  source_url: '',
  text: '',
})

const sourceFileInput = ref(null)
const sourceUrlInput = ref(null)
const sourceFile = ref(null)
const selectedFilename = ref('')
const sourceFileReading = ref(false)
const sourceOperationMessage = ref('')
const sourceOperationError = ref('')
const sourceListRefreshError = ref('')
const sourceListRefreshing = ref(false)
const workflowDataError = ref('')
const workflowHistoryExpanded = ref(false)
const workflowMode = ref(DEFAULT_WORKFLOW_MODE)
const productionReadiness = ref(null)
const readinessChecking = ref(false)
const startingSourceId = ref(null)
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
const selectedFlowStepId = ref('')
const timeline = ref(null)
const remediationStatus = ref('')
const sourceDetailVisible = ref(false)
const sourceDetailLoading = ref(false)
const sourceDetail = ref(null)
const pollState = ref('idle')
const pollError = ref('')
let pollTimer = null
let leaveConfirmationOpen = false

const rawSourceUrl = computed(() => String(form.source_url || '').trim())
const sourceUrlValidationMessage = computed(() => {
  if (!rawSourceUrl.value || isValidHttpSourceUrl(rawSourceUrl.value)) return ''
  return '请输入完整的 http:// 或 https:// 网页地址。'
})
const hasWebSourceUrl = computed(() => Boolean(rawSourceUrl.value) && !sourceUrlValidationMessage.value)
const hasSourceInput = computed(() => Boolean(sourceFile.value || hasWebSourceUrl.value || form.text.trim()))
const hasUnsavedSourceInput = computed(() => Boolean(sourceFile.value || rawSourceUrl.value || form.text.trim()))
const isWorkflowLaunchBusy = computed(() => workflowStarting.value || readinessChecking.value)
const sourceOperationActive = computed(() => Boolean(
  sourceFileReading.value
  || sourceSaving.value
  || sourceListRefreshing.value
  || workflowStarting.value
  || readinessChecking.value,
))
const workflowActionBusy = computed(() => retrying.value || pausing.value || resuming.value || cancelling.value)
const sourceUploadBusy = computed(() => (
  sourceFileReading.value || sourceSaving.value || sourceListRefreshing.value || isWorkflowLaunchBusy.value
))
const workflowModeShortLabel = computed(() => workflowMode.value === 'production' ? '正式制作' : '草稿预演')
const workflowModeDescription = computed(() => workflowMode.value === 'production'
  ? '调用正式 AI 服务生成可交付媒体，并在本机完成成片合成。启动前会检查全部制作能力。'
  : '用于快速验证改编与镜头流程；媒体步骤生成草稿占位，不调用正式媒体服务。')
const workflowStartButtonLabel = computed(() => {
  if (readinessChecking.value) return '正在检查正式制作条件'
  if (workflowStarting.value) return `正在启动 ${workflowModeShortLabel.value}`
  return `导入并启动 ${workflowModeShortLabel.value}`
})
const sourceOperationStatus = computed(() => {
  if (readinessChecking.value) return '正在检查正式制作所需的文本、图像、视频、配音与本地合成能力…'
  if (sourceFileReading.value) return `正在读取 ${selectedFilename.value || '文件'}…`
  if (sourceSaving.value && sourceFile.value) return `正在上传并解析 ${selectedFilename.value}…`
  if (sourceListRefreshing.value) return '正在刷新素材列表…'
  if (workflowStarting.value && sourceFile.value) return `正在上传并解析 ${selectedFilename.value}，完成后将启动处理…`
  if (workflowStarting.value) return `正在启动 ${workflowModeShortLabel.value} 流程…`
  return sourceOperationMessage.value
})
const runState = computed(() => normalizeWorkflowRun(selectedRun.value))
const productionLaunchReason = computed(() => {
  if (workflowMode.value !== 'production') return ''
  if (readinessChecking.value) return '正在检查正式制作能力'
  if (!productionReadiness.value) return '尚未完成正式制作能力检查'
  if (productionReadiness.value.ready) return ''
  const labels = (productionReadiness.value.missing_capabilities || [])
    .map((item) => item?.label)
    .filter(Boolean)
  return labels.length
    ? `正式制作条件未满足：${labels.join('、')}`
    : '正式制作条件未满足，请检查制作能力配置'
})
const newWorkflowRunReason = computed(() => (
  getNewWorkflowRunReason(runState.value) || productionLaunchReason.value
))
const timelineSummary = computed(() => normalizeTimelineSummary(timeline.value))
const latestQa = computed(() => normalizeQaReport(
  selectQaReportForRun(reports.value, selectedRun.value?.id),
))
const qaPresentation = computed(() => buildQaPresentation(latestQa.value, runState.value.mode))
const baseActionReasons = computed(() => getSourceWorkflowActionReasons({
  hasSourceInput: hasSourceInput.value,
  runState: runState.value,
  qa: latestQa.value,
}))
const sourceRefreshRecoveryReason = computed(() => (
  sourceListRefreshError.value ? '素材已导入，请先刷新列表确认。' : ''
))
const actionReasons = computed(() => {
  const reasons = {
    ...baseActionReasons.value,
    import: sourceUrlValidationMessage.value || baseActionReasons.value.import,
    start: sourceUrlValidationMessage.value || baseActionReasons.value.start || productionLaunchReason.value,
  }
  if (sourceRefreshRecoveryReason.value) {
    reasons.import = sourceRefreshRecoveryReason.value
    reasons.start = sourceRefreshRecoveryReason.value
  }
  return reasons
})
const flowState = computed(() => buildSourceWorkflowState({
  sourceCount: sources.value.length,
  hasSourceInput: hasSourceInput.value,
  run: selectedRun.value,
  qa: latestQa.value,
  timeline: timelineSummary.value,
  episodeCount: props.drama?.episodes?.length || 0,
  actionReasons: actionReasons.value,
}))
const sourceImportController = createSourceImportController({
  createSource: () => createSourceFromForm(),
  fetchSources: () => sourceIntakeAPI.listForDrama(props.dramaId),
  applySources: (nextSources) => { sources.value = nextSources },
  clearInput: () => resetSourceInput(),
  onImportStarted: () => {
    sourceOperationMessage.value = ''
    sourceOperationError.value = ''
  },
  onCreated: (_source, context) => {
    const uploadedFilename = context?.uploadedFilename
    sourceOperationMessage.value = uploadedFilename ? `${uploadedFilename} 上传并解析完成。` : '素材已导入。'
    showWorkflowMessage('success', '素材已导入')
  },
  onCreateFailed: (error) => {
    sourceOperationError.value = error?.message || '导入失败'
    showWorkflowMessage('error', sourceOperationError.value)
  },
  setRefreshAlert: (message) => { sourceListRefreshError.value = message },
  emitRefresh,
})
const completionVisibilityBlocked = computed(() => Boolean(
  loading.value
  || sourceFileReading.value
  || sourceSaving.value
  || sourceListRefreshing.value
  || workflowStarting.value
  || readinessChecking.value
  || qaRunning.value
  || remediating.value
  || workflowActionBusy.value
  || pollState.value === 'recovering'
  || sourceOperationError.value
  || sourceListRefreshError.value
  || workflowDataError.value
  || pollError.value
))
const compactCompletionVisible = computed(() => (
  flowState.value.complete && !completionVisibilityBlocked.value
))
const completionSummaryReady = computed(() => (
  timelineSummary.value.episodeCount > 0
  && timelineSummary.value.trackCount > 0
  && timelineSummary.value.itemCount > 0
  && timelineSummary.value.durationSec > 0
))
const completionTitle = computed(() => {
  if (!completionSummaryReady.value) return '结构处理已完成，交付摘要整理中'
  if (runState.value.mode !== 'production') return '草稿结构已完成'
  return runState.value.productionPlaceholder
    ? '正式流程已结束，媒体产物仍需修复'
    : '正式媒体已生成，交付检查已通过'
})
const completionEpisodeCount = computed(() => (
  timelineSummary.value.episodeCount || props.drama?.episodes?.length || 0
))
const completionPlaceholderCount = computed(() => (
  timelineSummary.value.placeholderItemCount
))
const actualFlowStep = computed(() => (
  flowState.value.activeStep
  || flowState.value.steps[0]
  || {
    id: 'intake',
    number: 1,
    label: '导入素材',
    summary: '',
    status: 'ready',
    statusLabel: '可开始',
  }
))
const inspectedFlowStep = computed(() => (
  flowState.value.steps.find((step) => step.id === selectedFlowStepId.value)
  || actualFlowStep.value
))
watch(
  () => flowState.value.activeStepId,
  (activeStepId) => {
    selectedFlowStepId.value = activeStepId || flowState.value.steps[0]?.id || ''
  },
  { immediate: true },
)
watch(
  () => flowState.value.complete,
  (complete, previousComplete) => {
    if (complete && !previousComplete) workflowHistoryExpanded.value = false
  },
)
const runTagType = computed(() => {
  if (runState.value.productionPlaceholder) return 'danger'
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
const pollStatusMessage = computed(() => {
  if (!selectedRun.value?.id) return ''
  if (pollState.value === 'recovering') return '正在恢复处理状态轮询...'
  if (pollState.value === 'error') return pollError.value || '处理状态刷新失败，自动轮询已暂停。'
  if (pollState.value === 'polling' && runState.value.active) return '正在自动轮询处理状态。'
  return ''
})

function syncDefaults() {
  form.target_episode_count = Math.max(1, Number(props.drama?.episodes?.length) || Number(props.drama?.total_episodes) || 1)
  if (!form.title) form.title = props.drama?.title ? `${props.drama.title} 素材` : ''
}

function formatTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function stageStatusTagType(status) {
  if (status === 'done') return 'success'
  if (status === 'partial' || status === 'active') return 'warning'
  if (status === 'error' || status === 'blocked') return 'danger'
  return 'info'
}

function selectFlowStep(stepId) {
  selectedFlowStepId.value = selectInspectedWorkflowStep(
    flowState.value,
    selectedFlowStepId.value,
    stepId,
  )
}

function sourceEventLabel(eventId) {
  const event = sourceDetail.value?.events?.find((item) => String(item.id) === String(eventId))
  return `事件 ${event?.event_no ?? eventId ?? '?'}`
}

async function handleWorkflowModeChange() {
  productionReadiness.value = null
  sourceOperationError.value = ''
  sourceOperationMessage.value = ''
  if (workflowMode.value !== 'production') return
  try {
    await checkProductionReadiness({
      drama_id: props.dramaId,
      qa_mode: 'production',
      target_episode_count: form.target_episode_count,
      style: props.drama?.style || '',
    })
  } catch (_) {
    sourceOperationError.value = '暂时无法检查正式制作能力，请稍后重试。'
  }
}

async function checkProductionReadiness(payload) {
  readinessChecking.value = true
  productionReadiness.value = null
  try {
    const readiness = normalizeProductionReadiness(
      await workflowRunsAPI.getNovel2AnimeReadiness(payload)
    )
    productionReadiness.value = readiness
    return readiness
  } finally {
    readinessChecking.value = false
  }
}

function captureProductionReadinessError(error) {
  const apiError = error?.response?.data?.error
  if (apiError?.code !== 'WORKFLOW_NOT_READY' || !apiError.details) return false
  try {
    productionReadiness.value = normalizeProductionReadiness(apiError.details)
    workflowMode.value = 'production'
    selectedFlowStepId.value = 'process'
    return true
  } catch (_) {
    return false
  }
}

function openAiConfigForReadiness() {
  router.push(buildAiConfigLocation({
    dramaId: props.dramaId,
    readiness: productionReadiness.value,
  }))
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPoll() {
  if (!sourceWorkflowLifecycle.isActive()) {
    stopPoll()
    return
  }
  stopPoll()
  if (!runState.value.active) {
    pollState.value = 'idle'
    pollError.value = ''
    return
  }
  pollState.value = 'polling'
  pollError.value = ''
  pollTimer = setInterval(refreshSelectedRun, 2500)
}

function clearSelectedFile() {
  sourceFile.value = null
  selectedFilename.value = ''
  sourceOperationMessage.value = ''
  sourceOperationError.value = ''
  if (sourceFileInput.value) sourceFileInput.value.value = ''
}

async function handleSourceFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  sourceOperationMessage.value = ''
  sourceOperationError.value = ''
  const extensionIndex = file.name.lastIndexOf('.')
  const extension = extensionIndex >= 0 ? file.name.slice(extensionIndex).toLowerCase() : ''
  if (!SOURCE_FILE_EXTENSION_SET.has(extension)) {
    clearSelectedFile()
    sourceOperationError.value = '不支持此文件格式。请选择文本、PDF、图片、音频或视频素材。'
    showWorkflowMessage('warning', sourceOperationError.value)
    return
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    clearSelectedFile()
    sourceOperationError.value = '单个素材文件最大 20MB，请拆分或压缩后再导入。'
    showWorkflowMessage('warning', sourceOperationError.value)
    return
  }
  if (file.size === 0) {
    clearSelectedFile()
    sourceOperationError.value = '素材文件为空，请重新选择。'
    showWorkflowMessage('warning', sourceOperationError.value)
    return
  }
  sourceFile.value = file
  selectedFilename.value = file.name
  if (!form.title) form.title = file.name.replace(/\.[^.]+$/, '')
  const inferredType = inferSourceTypeFromFilename(file.name)
  if (inferredType && !form.source_type) form.source_type = inferredType
  if (TEXT_SOURCE_FILE_EXTENSIONS.has(extension) && file.size <= 2 * 1024 * 1024) {
    sourceFileReading.value = true
    try {
      form.text = await file.text()
    } catch (error) {
      clearSelectedFile()
      sourceOperationError.value = error?.message || '读取文本文件失败，请重新选择。'
      showWorkflowMessage('error', sourceOperationError.value)
      return
    } finally {
      sourceFileReading.value = false
    }
  } else if (TEXT_SOURCE_FILE_EXTENSIONS.has(extension)) {
    form.text = ''
  }
  sourceOperationMessage.value = `${file.name} 已选择，导入时将上传并解析。`
  showWorkflowMessage('success', `已选择 ${file.name}`)
}

async function refreshSelectedRun() {
  if (!selectedRun.value?.id) return
  try {
    const run = await workflowRunsAPI.get(selectedRun.value.id)
    if (!sourceWorkflowLifecycle.isActive()) return
    selectedRun.value = run
    pollState.value = normalizeWorkflowRun(run).active ? 'polling' : 'idle'
    pollError.value = ''
    if (!normalizeWorkflowRun(run).active) {
      stopPoll()
      await Promise.all([loadReports(), loadSources(), loadTimeline()])
      if (!sourceWorkflowLifecycle.isActive()) return
      emitRefresh()
    }
  } catch (error) {
    if (!sourceWorkflowLifecycle.isActive()) return
    stopPoll()
    pollState.value = 'error'
    pollError.value = error?.message || '处理状态刷新失败，自动轮询已暂停。'
  }
}

async function resumePolling() {
  if (!selectedRun.value?.id || pollState.value === 'recovering') return
  pollState.value = 'recovering'
  pollError.value = ''
  try {
    const run = await workflowRunsAPI.get(selectedRun.value.id)
    if (!sourceWorkflowLifecycle.isActive()) return
    selectedRun.value = run
    if (normalizeWorkflowRun(run).active) {
      startPoll()
      return
    }
    pollState.value = 'idle'
    await Promise.all([loadReports(), loadSources(), loadTimeline()])
    if (!sourceWorkflowLifecycle.isActive()) return
    emitRefresh()
  } catch (error) {
    if (!sourceWorkflowLifecycle.isActive()) return
    pollState.value = 'error'
    pollError.value = error?.message || '恢复轮询失败，请重试。'
  }
}

async function loadSources() {
  return sourceImportController.loadSources()
}

async function loadRuns() {
  const nextRuns = await workflowRunsAPI.list({ drama_id: props.dramaId, type: 'novel2anime', limit: 10 })
  if (!sourceWorkflowLifecycle.isActive()) return
  const latest = nextRuns[0]
  const nextSelectedRun = latest ? await workflowRunsAPI.get(latest.id) : null
  if (!sourceWorkflowLifecycle.isActive()) return
  runs.value = nextRuns
  selectedRun.value = nextSelectedRun
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
  if (!props.dramaId || loading.value) return
  loading.value = true
  workflowDataError.value = ''
  try {
    await Promise.all([loadSources(), loadRuns(), loadReports(), loadTimeline()])
    workflowDataError.value = ''
  } catch (e) {
    workflowDataError.value = e.message || '加载素材流程状态失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function openSourceImportIntent() {
  await revealSourceImportIntent({
    historyExpanded: workflowHistoryExpanded,
    selectedStepId: selectedFlowStepId,
    sourceUrlInput,
    nextTickFn: nextTick,
  })
}

async function createSourceFromForm() {
  if (rawSourceUrl.value && sourceUrlValidationMessage.value) {
    throw new Error(sourceUrlValidationMessage.value)
  }
  if (sourceFile.value) {
    return sourceIntakeAPI.uploadForDrama(props.dramaId, buildSourceUploadFormData(form, props.drama, sourceFile.value))
  }
  if (hasWebSourceUrl.value) {
    return sourceIntakeAPI.importUrlForDrama(
      props.dramaId,
      buildWebSourceIntakePayload(form, props.drama),
    )
  }
  return sourceIntakeAPI.createForDrama(props.dramaId, buildSourceIntakePayload(form, props.drama))
}

function resetSourceInput() {
  form.text = ''
  form.source_url = ''
  clearSelectedFile()
}

async function confirmSourceInputLeave() {
  if (sourceOperationActive.value) {
    showWorkflowMessage('warning', '素材正在保存、解析或启动工作流，请完成后再离开。')
    return false
  }
  if (!hasUnsavedSourceInput.value) return true
  if (leaveConfirmationOpen) return false
  leaveConfirmationOpen = true
  try {
    await ElMessageBox.confirm(
      '网页地址、原始素材或待上传文件尚未保存，离开后会丢失。',
      '离开素材编辑？',
      {
        confirmButtonText: '放弃并离开',
        cancelButtonText: '继续编辑',
        type: 'warning',
        distinguishCancelAndClose: true,
      },
    )
    return true
  } catch (_) {
    return false
  } finally {
    leaveConfirmationOpen = false
  }
}

function handleBeforeUnload(event) {
  if (!hasUnsavedSourceInput.value && !sourceOperationActive.value) return
  event.preventDefault()
  event.returnValue = ''
}

async function importSourceOnly() {
  if (sourceSaving.value || isWorkflowLaunchBusy.value) return
  const uploadedFilename = selectedFilename.value
  sourceSaving.value = true
  try {
    await sourceImportController.importSource({ uploadedFilename })
  } finally {
    sourceSaving.value = false
  }
}

async function refreshImportedSources() {
  if (sourceListRefreshing.value || sourceSaving.value || sourceFileReading.value || isWorkflowLaunchBusy.value) return
  sourceListRefreshing.value = true
  try {
    await sourceImportController.refreshSources()
  } finally {
    sourceListRefreshing.value = false
  }
}

async function startWorkflow() {
  if (isWorkflowLaunchBusy.value || newWorkflowRunReason.value) return
  const uploadedFilename = selectedFilename.value
  let createdSource = null
  sourceOperationMessage.value = ''
  sourceOperationError.value = ''
  startingSourceId.value = null
  workflowStarting.value = true
  try {
    const basePayload = {
      drama_id: props.dramaId,
      ...buildSourceIntakePayload(form, props.drama),
    }
    const result = await launchSourceWorkflow({
      mode: workflowMode.value,
      payload: basePayload,
      checkReadiness: checkProductionReadiness,
      start: async (launchPayload) => {
        assertSourceWorkflowLifecycleActive(sourceWorkflowLifecycle)
        if (!sourceFile.value && !hasWebSourceUrl.value) {
          return workflowRunsAPI.startNovel2Anime(launchPayload)
        }
        const sourceResult = await createSourceFromForm()
        assertSourceWorkflowLifecycleActive(sourceWorkflowLifecycle)
        createdSource = sourceResult?.source || null
        if (!createdSource?.id) throw new Error('素材导入成功，但未返回可启动的素材记录。')
        const sourceLaunchPayload = { ...launchPayload }
        delete sourceLaunchPayload.text
        return workflowRunsAPI.startNovel2Anime({
          ...sourceLaunchPayload,
          source_id: createdSource.id,
          title: createdSource.title || launchPayload.title || '',
          source_type: createdSource.source_type || launchPayload.source_type || '',
        })
      },
    })
    if (!sourceWorkflowLifecycle.isActive()) return
    selectedRun.value = result.run
    selectedFlowStepId.value = 'process'
    if (result.readiness) productionReadiness.value = result.readiness
    showWorkflowMessage('success', `${workflowModeShortLabel.value} 流程已启动`)
    resetSourceInput()
    sourceOperationMessage.value = uploadedFilename
      ? `${uploadedFilename} 上传解析完成，${workflowModeShortLabel.value} 流程已启动。`
      : `${workflowModeShortLabel.value} 流程已启动。`
    await Promise.all([loadSources(), loadRuns()])
    if (!sourceWorkflowLifecycle.isActive()) return
    emitRefresh()
    startPoll()
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    if (e?.readiness) productionReadiness.value = e.readiness
    if (createdSource) {
      resetSourceInput()
      sourceOperationMessage.value = '素材已导入，但处理流程未启动。可从“已导入素材”中重试。'
      try {
        await loadSources()
      } catch (_) {}
    }
    sourceOperationError.value = e.message || '启动失败'
    showWorkflowMessage('error', sourceOperationError.value)
  } finally {
    workflowStarting.value = false
  }
}

async function startWorkflowFromSource(source) {
  if (!source?.id) throw new Error('素材记录无效，无法启动处理。')
  const result = await launchSourceWorkflow({
    mode: workflowMode.value,
    payload: {
        drama_id: props.dramaId,
        source_id: source.id,
        title: source.title || '',
        source_type: source.source_type || '',
        target_episode_count: form.target_episode_count,
        style: props.drama?.style || '',
        metadata: props.drama?.metadata || {},
    },
    checkReadiness: checkProductionReadiness,
    start: (launchPayload) => {
      assertSourceWorkflowLifecycleActive(sourceWorkflowLifecycle)
      return workflowRunsAPI.startNovel2Anime(launchPayload)
    },
  })
  assertSourceWorkflowLifecycleActive(sourceWorkflowLifecycle)
  selectedRun.value = result.run
  selectedFlowStepId.value = 'process'
  if (result.readiness) productionReadiness.value = result.readiness
  return result.run
}

async function startExistingSource(source) {
  if (isWorkflowLaunchBusy.value || newWorkflowRunReason.value) return
  sourceOperationMessage.value = ''
  sourceOperationError.value = ''
  startingSourceId.value = source.id
  workflowStarting.value = true
  try {
    await startWorkflowFromSource(source)
    if (!sourceWorkflowLifecycle.isActive()) return
    showWorkflowMessage('success', `已从素材启动 ${workflowModeShortLabel.value} 流程`)
    await loadRuns()
    if (!sourceWorkflowLifecycle.isActive()) return
    emitRefresh()
    startPoll()
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    if (e?.readiness) productionReadiness.value = e.readiness
    sourceOperationError.value = e.message || '启动失败'
    showWorkflowMessage('error', sourceOperationError.value)
  } finally {
    workflowStarting.value = false
    startingSourceId.value = null
  }
}

async function retryRun() {
  if (!selectedRun.value?.id || workflowActionBusy.value) return
  retrying.value = true
  try {
    const nextRun = await workflowRunsAPI.retry(selectedRun.value.id)
    if (!sourceWorkflowLifecycle.isActive()) return
    selectedRun.value = nextRun
    showWorkflowMessage('success', '已提交重试')
    emitRefresh()
    startPoll()
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    captureProductionReadinessError(e)
    showWorkflowMessage('error', e.message || '重试失败')
  } finally {
    retrying.value = false
  }
}

async function cancelRun() {
  if (!selectedRun.value?.id || workflowActionBusy.value) return
  cancelling.value = true
  try {
    const nextRun = await workflowRunsAPI.cancel(selectedRun.value.id, 'User cancelled from Source Intake panel')
    if (!sourceWorkflowLifecycle.isActive()) return
    selectedRun.value = nextRun
    showWorkflowMessage('success', '已取消')
    stopPoll()
    emitRefresh()
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    showWorkflowMessage('error', e.message || '取消失败')
  } finally {
    cancelling.value = false
  }
}

async function pauseRun() {
  if (!selectedRun.value?.id || workflowActionBusy.value) return
  pausing.value = true
  try {
    const nextRun = await workflowRunsAPI.pause(selectedRun.value.id, 'User paused from Source Intake panel')
    if (!sourceWorkflowLifecycle.isActive()) return
    selectedRun.value = nextRun
    showWorkflowMessage('success', '已暂停')
    stopPoll()
    emitRefresh()
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    showWorkflowMessage('error', e.message || '暂停失败')
  } finally {
    pausing.value = false
  }
}

async function resumeRun() {
  if (!selectedRun.value?.id || workflowActionBusy.value) return
  resuming.value = true
  try {
    const nextRun = await workflowRunsAPI.resume(selectedRun.value.id)
    if (!sourceWorkflowLifecycle.isActive()) return
    selectedRun.value = nextRun
    showWorkflowMessage('success', '已恢复')
    emitRefresh()
    startPoll()
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    captureProductionReadinessError(e)
    showWorkflowMessage('error', e.message || '恢复失败')
  } finally {
    resuming.value = false
  }
}

async function runQaAudit() {
  qaRunning.value = true
  try {
    await qaReportsAPI.audit({
      drama_id: props.dramaId,
      run_id: selectedRun.value?.id || undefined,
      mode: runState.value.mode,
    })
    if (!sourceWorkflowLifecycle.isActive()) return
    await loadReports()
    if (!sourceWorkflowLifecycle.isActive()) return
    showWorkflowMessage('success', 'QA 审计已完成')
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    showWorkflowMessage('error', e.message || 'QA 审计失败')
  } finally {
    qaRunning.value = false
  }
}

async function remediateQa() {
  await runGatedQaRemediation({
    report: latestQa.value,
    blockedReason: actionReasons.value.remediate,
    payload: {
      target_episode_count: form.target_episode_count,
      style: props.drama?.style || '',
    },
    remediate: (reportId, payload) => qaReportsAPI.remediate(reportId, payload),
    onStarted: () => {
      remediating.value = true
      remediationStatus.value = '正在提交自动修复...'
    },
    onSucceeded: async (result) => {
      if (!sourceWorkflowLifecycle.isActive()) return
      if (result.workflow_run) {
        selectedRun.value = result.workflow_run
        const action = result.actions_taken?.[0]?.code || 'workflow'
        remediationStatus.value = `已启动修复：${action}`
        showWorkflowMessage('success', '已启动自动修复流程')
        startPoll()
      } else {
        remediationStatus.value = result.reason || '当前 QA 报告没有可自动执行的修复动作'
        showWorkflowMessage('warning', remediationStatus.value)
      }
      await Promise.all([loadRuns(), loadReports()])
    },
    onFailed: (error) => {
      if (!sourceWorkflowLifecycle.isActive()) return
      remediationStatus.value = ''
      showWorkflowMessage('error', error?.message || '自动修复失败')
    },
    onFinished: () => { remediating.value = false },
  })
}

async function runSourceEmptyStateAction(actionId) {
  if (actionId === 'import') {
    await importSourceOnly()
    return
  }
  if (actionId === 'start') {
    await startWorkflow()
  }
}

async function openSourceDetail(source) {
  sourceDetailVisible.value = true
  sourceDetailLoading.value = true
  sourceDetail.value = null
  try {
    const detail = await sourceIntakeAPI.get(source.id)
    if (!sourceWorkflowLifecycle.isActive()) return
    sourceDetail.value = detail
  } catch (e) {
    if (!sourceWorkflowLifecycle.isActive()) return
    showWorkflowMessage('error', e.message || '加载素材详情失败')
  } finally {
    sourceDetailLoading.value = false
  }
}

watch(() => props.drama, syncDefaults, { immediate: true })
watch(() => props.dramaId, () => {
  sourceImportController.reset()
  loadData()
})
watch(() => props.sourceImportIntent, (active) => {
  if (active) openSourceImportIntent()
})

onBeforeRouteLeave(() => confirmSourceInputLeave())
onBeforeRouteUpdate((to, from) => {
  if (projectRouteInstanceKey(to) === projectRouteInstanceKey(from)) return true
  return confirmSourceInputLeave()
})

onMounted(async () => {
  await loadData()
  if (!sourceWorkflowLifecycle.isActive()) return
  if (props.sourceImportIntent) await openSourceImportIntent()
  if (!sourceWorkflowLifecycle.isActive()) return
  window.addEventListener('beforeunload', handleBeforeUnload)
})
onBeforeUnmount(() => {
  sourceWorkflowLifecycle.dispose()
  stopPoll()
  sourceImportController.reset()
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<style scoped>
.source-workflow-section {
  --source-text-muted: #a1a1aa;
  --source-text-secondary: #d4d4d8;
  background: rgba(24, 24, 27, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 20px 24px;
  scroll-margin-top: 84px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
.source-workflow-section:focus {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
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
  color: var(--source-text-muted);
}
.head-actions,
.action-row,
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.workflow-status-banner,
.poll-status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.55);
  color: #bfdbfe;
  font-size: 12px;
  line-height: 1.45;
}
.workflow-status-banner--error,
.poll-status-banner.is-error {
  border-color: rgba(248, 113, 113, 0.32);
  background: rgba(127, 29, 29, 0.16);
  color: #fecaca;
}
.flow-stepper {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 18px;
}
.flow-step {
  appearance: none;
  min-width: 0;
  min-height: 88px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  background: rgba(18, 18, 22, 0.48);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.flow-step:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.flow-step.is-selected {
  border-color: var(--el-text-color-secondary);
  outline: 1px solid var(--el-text-color-secondary);
  outline-offset: -2px;
}

.flow-step.is-selected:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.flow-step.is-current {
  background: rgba(139, 92, 246, 0.12);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.flow-step-number {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #52525b;
  border-radius: 50%;
  color: var(--source-text-muted);
  font-size: 11px;
  font-weight: 700;
}
.flow-step-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.flow-step-copy strong {
  color: #e4e4e7;
  font-size: 12px;
  font-weight: 600;
}
.flow-step-copy small {
  color: var(--source-text-muted);
  font-size: 10px;
  line-height: 1.35;
}
.flow-step-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.flow-step.is-done .flow-step-number {
  border-color: #22c55e;
  color: var(--status-success);
  background: rgba(34, 197, 94, 0.12);
}
.flow-step.is-active .flow-step-number,
.flow-step.is-ready .flow-step-number {
  border-color: #8b5cf6;
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.14);
}
.flow-step.is-error .flow-step-number,
.flow-step.is-blocked .flow-step-number {
  border-color: #ef4444;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
}
.workflow-focus {
  display: grid;
  gap: 12px;
}
.workflow-focus-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.workflow-stage-card {
  min-width: 0;
}
.workflow-mode-band {
  display: grid;
  gap: 9px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.7);
}
.workflow-mode-head,
.readiness-gap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.workflow-mode-head strong,
.production-readiness strong {
  color: #e4e4e7;
  font-size: 13px;
  font-weight: 600;
}
.workflow-mode-control {
  display: flex;
  width: 100%;
  max-width: 100%;
}
.workflow-mode-control :deep(.el-radio-button) {
  min-width: 0;
  flex: 1;
}
.workflow-mode-control :deep(.el-radio-button__inner) {
  width: 100%;
  min-height: 32px;
  padding-inline: 10px;
  white-space: normal;
}
.workflow-mode-band > p {
  margin: 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.production-readiness {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.1);
  color: #fcd34d;
  font-size: 12px;
  line-height: 1.45;
}
.production-readiness.is-ready {
  border-left-color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
  color: #86efac;
}
.production-readiness.has-gaps strong {
  color: #fde68a;
}
.readiness-gap-list {
  display: grid;
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}
.readiness-gap-list li {
  display: grid;
  grid-template-columns: minmax(90px, auto) 1fr;
  gap: 8px;
  align-items: baseline;
}
.readiness-gap-list li strong {
  font-size: 12px;
}
.intake-stage-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
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
.stage-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stage-heading--compact {
  margin-bottom: 12px;
}
.stage-heading > div {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.stage-heading strong {
  color: #f4f4f5;
  font-size: 14px;
  font-weight: 600;
}
.stage-heading div span {
  color: var(--source-text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.stage-number {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--accent-text);
  background: rgba(139, 92, 246, 0.18);
  font-size: 11px;
  font-weight: 700;
}
.action-reason {
  margin-top: 7px;
  color: var(--status-warning);
  font-size: 11px;
  line-height: 1.45;
}
.action-reason--inline {
  margin-top: 0;
}
.stage-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  margin-bottom: 10px;
}
.delivery-actions {
  margin-top: 12px;
  margin-bottom: 0;
}
.stage-empty,
.stage-success {
  padding: 10px 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.stage-success {
  color: var(--status-success);
}
.status-block {
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 14px;
  background: rgba(18, 18, 22, 0.58);
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
.empty-stage-state {
  display: grid;
  gap: 10px;
}
.empty-stage-state strong {
  color: #e4e4e7;
  font-size: 13px;
}
.empty-stage-state p {
  margin: 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.run-meta,
.timeline-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 8px 0 10px;
  color: var(--source-text-secondary);
  font-size: 12px;
}
.run-meta .cost-unconfigured {
  color: #fbbf24;
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
.placeholder-note.is-error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
}
.run-detail,
.qa-detail {
  color: var(--source-text-secondary);
  font-size: 12px;
}
.run-detail summary,
.qa-detail summary {
  cursor: pointer;
  color: #93c5fd;
  margin-bottom: 8px;
}
.step-list,
.remediation-actions,
.mini-list,
.qa-issues {
  display: grid;
  gap: 6px;
}
.step-item {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--source-text-secondary);
}
.step-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #52525b;
}
.step-completed .step-dot {
  background: #22c55e;
}
.step-processing .step-dot {
  background: #60a5fa;
}
.step-failed .step-dot {
  background: #ef4444;
}
.step-cancelled .step-dot {
  background: #71717a;
}
.step-name {
  color: #e4e4e7;
}
.step-status,
.step-attempts {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--source-text-muted);
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
.mini-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--source-text-secondary);
  font-size: 12px;
}
.source-record-identity {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.source-record-identity small {
  overflow: hidden;
  color: var(--source-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  color: var(--status-success);
}
.qa-issue,
.empty-line {
  font-size: 12px;
  color: var(--source-text-muted);
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
  color: var(--source-text-muted);
  font-size: 13px;
  margin-bottom: 16px;
}
.detail-section {
  margin-top: 14px;
}
.detail-row {
  border-bottom: 1px solid #27272a;
  padding: 8px 0;
  color: var(--source-text-secondary);
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
  --source-text-muted: #52525b;
  --source-text-secondary: #3f3f46;
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .workflow-status-banner,
html.light .poll-status-banner {
  background: rgba(239, 246, 255, 0.92);
  border-color: rgba(59, 130, 246, 0.22);
  color: #1d4ed8;
}
html.light .workflow-status-banner--error,
html.light .poll-status-banner.is-error {
  background: #fef2f2;
  border-color: rgba(239, 68, 68, 0.24);
  color: #b91c1c;
}
html.light .flow-step {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .flow-step.is-selected {
  border-color: #94a3b8;
  outline-color: #94a3b8;
}
html.light .flow-step.is-current {
  background: rgba(99, 102, 241, 0.08);
}
html.light .flow-step-copy strong,
html.light .stage-heading strong,
html.light .block-head,
html.light .step-name,
html.light .empty-stage-state strong,
html.light .qa-detail-title,
html.light .detail-title {
  color: #18181b;
}
html.light .status-block {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .workflow-mode-band {
  border-bottom-color: #e5e7eb;
}
html.light .workflow-mode-head strong,
html.light .production-readiness strong {
  color: #18181b;
}
html.light .production-readiness {
  color: #854d0e;
  background: #fffbeb;
}
html.light .production-readiness.has-gaps strong {
  color: #713f12;
}
html.light .production-readiness.is-ready {
  color: #166534;
  background: #f0fdf4;
}
html.light .detail-row {
  border-bottom-color: #e5e7eb;
}
@media (max-width: 900px) {
  .flow-stepper,
  .intake-stage-layout,
  .form-row {
    grid-template-columns: 1fr;
  }
  .readiness-gap-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .readiness-gap-list li {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}

.source-workflow-complete {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(360px, 1.5fr) auto;
  align-items: center;
  gap: 14px;
  max-height: 180px;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color);
}

.workflow-complete-heading,
.workflow-complete-metrics,
.workflow-complete-actions {
  min-width: 0;
}

.workflow-complete-heading {
  display: grid;
  gap: 4px;
}

.workflow-complete-heading strong {
  font-size: 15px;
  color: var(--source-text-primary);
}

.workflow-complete-heading span,
.workflow-complete-metrics small {
  color: var(--source-text-muted);
  font-size: 12px;
}

.workflow-complete-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.workflow-complete-metrics span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.workflow-complete-metrics strong {
  overflow: hidden;
  color: var(--source-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-complete-pending {
  margin: 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.workflow-complete-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.workflow-history-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

</style>
