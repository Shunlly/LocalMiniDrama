import test from 'node:test'
import assert from 'node:assert/strict'

import { createSourceIntakeMessageHelpers, formatTime, qaIssueDisplayMessage } from '../src/components/sourceIntake/sourceIntakeMessages.js'

test('QA 问题展示把未知错误收成中文', () => {
  assert.equal(qaIssueDisplayMessage('镜头不连贯'), '镜头不连贯')
  assert.match(qaIssueDisplayMessage(new Error('ECONNREFUSED')), /[\u4e00-\u9fff]/)
})

test('素材流程时间格式化为中文区域，无效值留空', () => {
  assert.equal(formatTime(''), '')
  assert.equal(formatTime('not-a-date'), '')
  assert.match(formatTime('2026-09-11T03:00:00.000Z'), /2026/)
})


test('空消息不会发出提示，中止错误不会生成导入失败文案', () => {
  const events = []
  const helpers = createSourceIntakeMessageHelpers({
    lifecycle: {
      run(callback) {
        events.push('run')
        return callback()
      },
    },
    emit: () => events.push('refresh'),
    getFailureContext: () => ({ filename: 'story.txt' }),
  })
  assert.equal(helpers.showWorkflowMessage('success', '   '), undefined)
  assert.deepEqual(events, [])
  helpers.emitRefresh()
  assert.deepEqual(events, ['run', 'refresh'])
  assert.equal(helpers.sourceIntakeFailureMessage({ name: 'AbortError' }, '导入失败'), '')
  assert.match(helpers.sourceIntakeFailureMessage(new Error('ECONNREFUSED'), '导入失败'), /[\u4e00-\u9fff]/)
})
