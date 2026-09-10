import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  describeMediaLibraryUserError,
  isMediaLibraryUserAbort,
} from '../src/utils/mediaLibraryUserError.js'

const source = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

test('网络素材英文技术错误转成中文，中文原文保留', () => {
  assert.equal(
    describeMediaLibraryUserError({ message: 'Network Error' }, { fallback: '暂时无法搜索网络素材，请稍后重试' }),
    '暂时无法搜索网络素材，请稍后重试',
  )
  assert.equal(
    describeMediaLibraryUserError(
      { response: { status: 500, data: { error: { message: 'Internal Server Error' } } } },
      { fallback: '网络素材导入失败' },
    ),
    '网络素材服务暂时不可用（HTTP 500）',
  )
  assert.equal(
    describeMediaLibraryUserError({ message: 'timeout of 15000ms exceeded' }),
    '连接网络素材服务超时，请稍后重试',
  )
  assert.equal(
    describeMediaLibraryUserError({ response: { status: 503 } }),
    '网络素材服务暂时不可用（HTTP 503）',
  )
  assert.equal(
    describeMediaLibraryUserError(
      { response: { data: { error: { message: '配额已用完' } } } },
      { fallback: '网络素材导入失败' },
    ),
    '配额已用完',
  )
  assert.equal(
    describeMediaLibraryUserError({ message: 'Wikimedia Commons 搜索请求失败' }, { fallback: '搜索失败' }),
    'Wikimedia Commons 搜索请求失败',
  )
  assert.match(source, /describeMediaLibraryUserError\(error, \{ serviceLabel: '网络素材服务', fallback \}\)/)
})

test('取消选择或中止请求不算网络素材失败', () => {
  assert.equal(isMediaLibraryUserAbort('cancel'), true)
  assert.equal(isMediaLibraryUserAbort('close'), true)
  assert.equal(isMediaLibraryUserAbort({ name: 'AbortError' }), true)
  assert.equal(isMediaLibraryUserAbort({ code: 'ERR_CANCELED' }), true)
  assert.equal(isMediaLibraryUserAbort({ message: 'Network Error' }), false)
  assert.equal(describeMediaLibraryUserError('cancel', { fallback: '搜索失败' }), '')
  assert.equal(describeMediaLibraryUserError({ name: 'AbortError' }, { fallback: '导入失败' }), '')
  assert.equal((source.match(/if \(isMediaLibraryUserAbort\(error\)\) return/g) || []).length, 2)
})

test('搜索失败和导入失败都提供中文可重点击的重试', () => {
  assert.match(source, /aria-label="重试搜索网络素材"/)
  assert.match(source, /aria-label="重试导入该网络素材"/)
  assert.match(source, /v-if="networkImportRetryItem"/)
  assert.match(source, /<el-icon><Refresh \/><\/el-icon>重试导入/)
  assert.match(source, /networkImportRetryItem\.value = item/)
  assert.match(source, /networkImportRetryItem\.value = null/)
})

test('网络空态区分未搜索和没有结果，并具备状态角色', () => {
  assert.match(source, /没有找到匹配的网络素材/)
  assert.match(source, /请更换关键词或素材类型后重试。/)
  assert.match(source, /搜索可导入的网络素材/)
  assert.match(source, /class="network-empty"\s*role="status"/)
  assert.match(source, /!networkSearched" class="network-empty" role="status"/)
})

test('导入中离开保护文案仍会拦住路由和刷新', () => {
  assert.match(source, /网络素材正在导入，请完成后再离开。/)
  assert.match(source, /onBeforeRouteLeave\(\(\) => confirmMediaLibraryLeave\(\)\)/)
  assert.match(source, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
})
