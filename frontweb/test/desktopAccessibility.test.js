import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readSourceIntakeWorkflowSources } from './helpers/sourceIntakeWorkflowSources.js'
import { readAiConfigFormDialogTreeSource } from './helpers/aiConfigFormDialogSources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const actionGateSource = read('../src/components/filmCreate/ActionGate.vue')
const sourceWorkflowSource = readSourceIntakeWorkflowSources()
const aiConfigViewSource = read('../src/views/AiConfig.vue')
const aiConfigContentSource = [
  read('../src/components/AIConfigContent.vue'),
  read('../src/components/aiConfig/AiConfigWorkspaceSwitch.vue'),
  read('../src/components/aiConfig/AiConfigCoverageHeader.vue'),
  read('../src/components/aiConfig/AiConfigCoveragePanel.vue'),
  read('../src/components/aiConfig/AiConfigConfigsPanel.vue'),
].join('\n')
const aiConfigFormDialogSource = readAiConfigFormDialogTreeSource()
const aiConfigPageSource = `${aiConfigContentSource}\n${aiConfigFormDialogSource}`
const readinessSource = read('../src/components/ProjectReadinessPanel.vue')
const dramaDetailSource = [
  read('../src/views/DramaDetail.vue'),
  read('../src/components/dramaDetail/DramaDetailEpisodeList.vue'),
  read('../src/components/dramaDetail/DramaDetailResourceLibrary.vue'),
].join('\n')
const dramaDetailDialogsSource = read('../src/components/dramaDetail/DramaDetailResourceDialogs.vue')
const themeSource = read('../src/styles/theme.css')

test('disabled action gates expose the action name and reason to keyboard users', () => {
  assert.match(actionGateSource, /role="group"/)
  assert.match(actionGateSource, /aria-disabled="true"/)
  assert.match(actionGateSource, /:aria-label="accessibleLabel"/)
  assert.match(actionGateSource, /:aria-describedby="reasonId"/)
  assert.match(actionGateSource, /:id="reasonId"/)
  assert.match(actionGateSource, /label: \{ type: String, default: '此操作' \}/)
  assert.match(actionGateSource, /`\$\{props\.label\}不可用：\$\{props\.reason\}`/)

  assert.match(sourceWorkflowSource, /<ActionGate label="导入故事素材" :reason="actionReasons\.import">/)
  assert.match(sourceWorkflowSource, /<ActionGate label="重试失败步骤" :reason="controlActionReasons\.retry">/)
  assert.match(sourceWorkflowSource, /<ActionGate label="执行 QA 审计" :reason="(?:actionReasons\.qa|qaReason)">/)
  assert.doesNotMatch(sourceWorkflowSource, /<el-tooltip/)
})

test('AI configuration uses a real page heading and keyboard-operable help control', () => {
  assert.match(aiConfigViewSource, /<button type="button" class="logo" :aria-label="logoBackLabel" @click="goBack">/)
  assert.match(aiConfigViewSource, /router\.replace\(returnTo\.value \|\| \{ name: 'list' \}\)/)
  assert.match(aiConfigViewSource, /<h1 class="page-title">AI 配置<\/h1>/)
  assert.match(aiConfigContentSource, /<h2 id="ai-service-coverage-title">AI 服务配置与验证<\/h2>/)
  assert.match(aiConfigPageSource, /class="tip-button" aria-label="查看接口规范说明"/)
  assert.match(aiConfigPageSource, /\.tip-button:focus-visible/)
  assert.match(aiConfigContentSource, /role="tablist" aria-label="AI 配置工作区"/)
  assert.match(aiConfigContentSource, /\.config-workspace-mode:focus-visible/)
  assert.match(aiConfigContentSource, /id="ai-config-coverage-panel"/)
  assert.match(aiConfigContentSource, /id="ai-config-configs-panel"/)
  assert.match(aiConfigContentSource, /role="tabpanel"/)
  assert.match(aiConfigContentSource, /tabindex="-1"/)
  assert.match(aiConfigContentSource, /\.config-workspace-panel:focus-visible/)
})

test('project readiness and detail controls avoid dead or mouse-only interactions', () => {
  assert.match(readinessSource, /:is="service\.ready \? 'span' : 'button'"/)
  assert.match(dramaDetailSource, /<RouterLink[\s\S]*class="episode-card-main"/)
  assert.match(dramaDetailSource, /class="episode-enter"/)
  assert.match(dramaDetailSource, /class="episode-card-delete"/)
  assert.match(dramaDetailSource, /:aria-label="`删除第 /)
  assert.match(dramaDetailSource, /role="tablist" aria-label="项目资源分类"/)
  assert.match(dramaDetailSource, /role="tab"/)
  assert.match(dramaDetailDialogsSource, /前往制作页新增并入库/)
})

test('project readiness keeps the next action visible while diagnostics are collapsible', () => {
  assert.match(readinessSource, /data-testid="project-readiness-toggle"/)
  assert.match(readinessSource, /:aria-expanded="expanded"/)
  assert.match(readinessSource, /aria-controls="project-readiness-details"/)
  assert.match(readinessSource, /id="project-readiness-details"/)
  assert.match(readinessSource, /v-show="expanded"/)

  const nextActionStart = readinessSource.indexOf('class="next-action"')
  const detailsStart = readinessSource.indexOf('id="project-readiness-details"')
  assert.ok(nextActionStart > 0 && nextActionStart < detailsStart)
})

test('theme status colors remain readable in both desktop themes', () => {
  assert.match(themeSource, /--status-success: #4ade80;/)
  assert.match(themeSource, /--status-warning: #fbbf24;/)
  assert.match(themeSource, /html\.light \{[\s\S]*--status-success: #15803d;/)
  assert.match(themeSource, /html\.light \{[\s\S]*--status-warning: #a16207;/)
})
