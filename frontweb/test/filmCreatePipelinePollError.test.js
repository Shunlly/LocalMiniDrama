import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  isCancelledPollStatus,
  toPipelinePollUserFacingError,
} from '../src/composables/filmCreate/filmCreatePipelinePollError.js'

test('流水线轮询取消会抛出中文 AbortError', () => {
  assert.equal(isCancelledPollStatus('cancelled'), true)
  assert.equal(isCancelledPollStatus('canceled'), true)
  assert.equal(isCancelledPollStatus('timeout'), false)
  assert.throws(
    () => toPipelinePollUserFacingError({ status: 'cancelled', error: 'canceled by user' }),
    (error) => error.name === 'AbortError' && error.message.includes('取消'),
  )
})

test('流水线轮询超时和失败收成中文，成功返回空字符串', () => {
  assert.equal(toPipelinePollUserFacingError(null), '')
  assert.equal(toPipelinePollUserFacingError({ status: 'success' }), '')
  assert.match(
    toPipelinePollUserFacingError({ status: 'timeout', error: 'timeout of 15000ms' }, '生成失败', '生成超时，请稍后重试'),
    /超时/,
  )
  assert.doesNotMatch(
    toPipelinePollUserFacingError({ status: 'timeout', error: 'timeout of 15000ms' }, '生成失败', '生成超时，请稍后重试'),
    /timeout of/,
  )
  assert.match(
    toPipelinePollUserFacingError({ status: 'failed', error: 'Network Error' }, '提取角色失败', '提取角色超时，请稍后重试'),
    /提取角色失败|网络/,
  )
  assert.doesNotMatch(
    toPipelinePollUserFacingError({ status: 'failed', error: 'Network Error' }, '提取角色失败'),
    /Network Error/,
  )
})

test('制作页流水线仍调用抽出的轮询错误收口', () => {
  const pipelineSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreatePipelineStages.js', import.meta.url), 'utf8')
  const helperSource = readFileSync(new URL('../src/composables/filmCreate/filmCreatePipelinePollError.js', import.meta.url), 'utf8')
  assert.match(pipelineSource, /import \{ toPipelinePollUserFacingError \} from '\.\/filmCreatePipelinePollError\.js'/)
  assert.match(pipelineSource, /toPipelinePollUserFacingError\(result, '提取角色失败', '提取角色超时，请稍后重试'\)/)
  assert.match(helperSource, /export function toPipelinePollUserFacingError/)
  assert.doesNotMatch(pipelineSource, /function toPipelinePollUserFacingError/)
})
