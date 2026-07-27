import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourceWorkflow = readFileSync(
  new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url),
  'utf8',
)
const dramaDetail = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const mediaLibrary = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

test('workflow completion distinguishes structure, media delivery, and summary loading', () => {
  assert.match(sourceWorkflow, /const completionSummaryReady = computed/)
  assert.match(sourceWorkflow, /草稿结构已完成/)
  assert.match(sourceWorkflow, /正式媒体已生成，交付检查已通过/)
  assert.match(sourceWorkflow, /交付摘要整理中/)
  assert.match(sourceWorkflow, /v-if="completionSummaryReady" class="workflow-complete-metrics"/)
  assert.doesNotMatch(sourceWorkflow, /hasPlaceholderOutputs \? 1 : 0/)
  assert.doesNotMatch(sourceWorkflow, /草稿预演已完成/)
  assert.doesNotMatch(sourceWorkflow, /正式制作已完成/)
})

test('episode cards look actionable and describe script readiness instead of finished media', () => {
  assert.match(dramaDetail, /completed:\s*'剧本已就绪'/)
  const enterRule = dramaDetail.match(/\.episode-enter\s*\{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(enterRule, /color:\s*var\(--el-color-primary\)/)
  assert.match(enterRule, /opacity:\s*1/)
})

test('material center exposes named filters and a visible project-import command', () => {
  assert.match(mediaLibrary, /<el-radio-group[^>]*aria-label="素材类型筛选"/)
  assert.match(
    mediaLibrary,
    /type="primary"[\s\S]*?plain[\s\S]*?aria-label="选择项目后导入网页 URL"/,
  )
})
