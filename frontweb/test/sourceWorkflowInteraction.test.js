import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildSourceWorkflowState,
  selectInspectedWorkflowStep,
} from '../src/utils/sourceWorkflowState.js'

const source = readFileSync(
  new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url),
  'utf8',
)

test('source workflow separates actual progress from inspected history', () => {
  assert.match(source, /\{ 'is-current': flowState\.activeStepId === step\.id \}/)
  assert.match(source, /\{ 'is-selected': inspectedFlowStep\.id === step\.id \}/)
  assert.match(source, /:aria-current="flowState\.activeStepId === step\.id \? 'step' : undefined"/)
  assert.match(source, /:aria-pressed="inspectedFlowStep\.id === step\.id"/)
  assert.match(source, /const actualFlowStep = computed/)
  assert.match(source, /const inspectedFlowStep = computed/)
  assert.match(source, /watch\(\s*\(\) => flowState\.value\.activeStepId/)
})

test('source workflow details follow the inspected stage only', () => {
  assert.doesNotMatch(source, /activeFlowStep/)
  assert.match(source, /inspectedFlowStep\.id === 'intake'/)
  assert.match(source, /inspectedFlowStep\.id === 'process'/)
  assert.match(source, /inspectedFlowStep\.id === 'qa'/)
  assert.match(source, /inspectedFlowStep\.id === 'remediation'/)
})

test('selecting workflow history does not mutate the actual delivered stage', () => {
  assert.match(
    source,
    /selectedFlowStepId\.value = selectInspectedWorkflowStep\(\s*flowState\.value,\s*selectedFlowStepId\.value,\s*stepId,\s*\)/,
  )
  const delivered = buildSourceWorkflowState({
    sourceCount: 1,
    hasSourceInput: false,
    run: { id: 'run-complete', status: 'completed', mode: 'draft' },
    qa: { id: 8, passed: true, score: 95, mode: 'draft', remediationActions: [] },
    timeline: { episodeCount: 2, trackCount: 8 },
    episodeCount: 2,
    actionReasons: {},
  })
  const inspectedStepId = selectInspectedWorkflowStep(delivered, 'delivery', 'intake')
  assert.equal(inspectedStepId, 'intake')
  assert.equal(delivered.activeStepId, 'delivery')
  assert.equal(selectInspectedWorkflowStep(delivered, inspectedStepId, 'unknown'), 'intake')
  assert.equal(delivered.activeStepId, 'delivery')
})

test('source workflow current and selected stages have distinct visual markers', () => {
  assert.match(source, /\.flow-step\.is-current\s*\{[\s\S]*?box-shadow:\s*inset 3px 0/)
  assert.match(source, /\.flow-step\.is-selected\s*\{[\s\S]*?outline:/)
  assert.match(source, /\.flow-step\.is-selected:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--el-color-primary\)/)
})
