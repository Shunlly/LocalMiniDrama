import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from '@vue/compiler-sfc'

const dramaDetailSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const sourceWorkflowSource = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')

test('DramaDetail remains a valid SFC with explicit readiness dependency retry and autosave status UI', () => {
  const parsed = parse(dramaDetailSource, { filename: 'DramaDetail.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.match(dramaDetailSource, /readinessDependencyState = ref\('idle'\)/)
  assert.match(dramaDetailSource, /readinessDependencyError = ref\(''\)/)
  assert.match(dramaDetailSource, /hasReadinessSnapshot = ref\(false\)/)
  assert.match(dramaDetailSource, /buildReadinessDependencyError\(configsResult, sourcesResult\)/)
  assert.match(dramaDetailSource, /target: 'readiness-dependencies'/)
  assert.match(dramaDetailSource, /@click="retryReadinessDependencies"/)
  assert.match(dramaDetailSource, /v-if="projectReadiness"/)
  assert.match(dramaDetailSource, /const infoSaveState = ref\('saved'\)/)
  assert.match(dramaDetailSource, /const infoSaveScheduled = ref\(false\)/)
  assert.match(dramaDetailSource, /const hasUnsavedInfoChanges = computed/)
  assert.match(dramaDetailSource, /function scheduleInfoSave\(\{ immediate = false \} = \{\}\)/)
  assert.match(dramaDetailSource, /async function flushInfoSave\(\)/)
  assert.match(dramaDetailSource, /async function retryInfoSave\(\)/)
  assert.match(dramaDetailSource, /onBeforeRouteLeave\(\(\) => confirmInfoLeave\(\)\)/)
  assert.match(dramaDetailSource, /window\.addEventListener\('beforeunload', handleInfoBeforeUnload\)/)
  assert.match(dramaDetailSource, /class="info-save-status"/)
  assert.match(dramaDetailSource, /class="dependency-status dependency-status--error"/)
})

test('Source intake workflow remains a valid SFC with poll failure status and recovery controls', () => {
  const parsed = parse(sourceWorkflowSource, { filename: 'SourceIntakeWorkflowPanel.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.match(sourceWorkflowSource, /workflowDataError = ref\(''\)/)
  assert.match(sourceWorkflowSource, /pollState = ref\('idle'\)/)
  assert.match(sourceWorkflowSource, /pollError = ref\(''\)/)
  assert.match(sourceWorkflowSource, /class="workflow-status-banner workflow-status-banner--error"/)
  assert.match(sourceWorkflowSource, /class="poll-status-banner"/)
  assert.match(sourceWorkflowSource, /async function resumePolling\(\)/)
  assert.match(sourceWorkflowSource, /pollState\.value = 'error'/)
  assert.match(sourceWorkflowSource, /pollError\.value = error\?\.message \|\| '处理状态刷新失败，自动轮询已暂停。'/)
  assert.match(sourceWorkflowSource, /workflowDataError\.value = e\.message \|\| '加载素材流程状态失败，请稍后重试。'/)
  assert.match(sourceWorkflowSource, /@click="resumePolling"/)
})
