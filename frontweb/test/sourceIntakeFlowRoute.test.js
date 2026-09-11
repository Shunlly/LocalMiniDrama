import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildInspectedFlowStepQuery,
  parseRequestedFlowStep,
} from '../src/components/sourceIntake/sourceIntakeFlowRoute.js'

test('素材流程步骤查询只认字符串 step，数组取第一项', () => {
  assert.equal(parseRequestedFlowStep({ step: 'qa' }), 'qa')
  assert.equal(parseRequestedFlowStep({ step: ['delivery', 'qa'] }), 'delivery')
  assert.equal(parseRequestedFlowStep({ step: 3 }), '')
  assert.equal(parseRequestedFlowStep({}), '')
})

test('检查中步骤与当前活动步骤相同时会清掉 step，且不改其它查询', () => {
  const current = buildInspectedFlowStepQuery({ intake: 'source-url', step: 'qa' }, 'qa', 'qa')
  assert.equal(current.unchanged, false)
  assert.equal(current.nextStepId, '')
  assert.equal(current.query.step, undefined)
  assert.equal(current.query.intake, 'source-url')

  const same = buildInspectedFlowStepQuery({ step: 'process' }, 'intake', 'process')
  assert.equal(same.unchanged, true)
  assert.equal(same.nextStepId, 'process')
})
