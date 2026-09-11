import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  describeMediaLibraryUserError,
  isMediaLibraryUserAbort,
} from '../src/utils/mediaLibraryUserError.js'
import { describeNetworkError } from '../src/components/mediaLibrary/mediaLibraryNetworkActions.js'
import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'
import { readMediaLibrarySources } from './helpers/mediaLibrarySources.js'

const source = readMediaLibrarySources()

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
    describeNetworkError({ message: 'Wikimedia Commons 搜索请求失败' }, '搜索失败'),
    'Wikimedia Commons 搜索请求失败',
  )
  assert.equal(
    describeMediaLibraryUserError({ message: 'Failed to fetch' }, { fallback: '暂时无法搜索网络素材，请稍后重试' }),
    '暂时无法搜索网络素材，请稍后重试',
  )
  assert.doesNotMatch(
    describeMediaLibraryUserError(
      { response: { status: 400, data: { error: { message: '缺少 drama_id' } } } },
      { fallback: '网络素材导入失败' },
    ),
    /drama_id/,
  )
  assert.match(source, /describeMediaLibraryUserError\(error, \{ serviceLabel: '网络素材服务', fallback \}\)/)
  const utilSource = readFileSync(new URL('../src/utils/mediaLibraryUserError.js', import.meta.url), 'utf8')
  assert.match(utilSource, /toUserFacingError\(error/)
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
  assert.match(source, /networkSearchDisableReason \|\| '重试搜索网络素材'/)
  assert.match(source, /aria-label="取消网络素材搜索"/)
  assert.match(source, /aria-label="重试导入该网络素材"/)
  assert.match(source, /v-if="networkImportRetryItem"/)
  assert.match(source, /<el-icon><Refresh \/><\/el-icon>重试导入/)
  assert.match(source, /networkImportRetryItem\.value = item/)
  assert.match(source, /networkImportRetryItem\.value = null/)
})

test('网络空态区分未搜索和没有结果，并具备状态角色', () => {
  assert.match(source, /没有找到匹配的网络素材/)
  assert.match(source, /请更换关键词或素材类型后重试。/)
  assert.match(source, /aria-label="清除网络素材搜索"/)
  assert.match(source, /function clearNetworkSearch/)
  assert.match(source, /function cancelNetworkSearch/)
  assert.match(source, /@click="cancelNetworkSearch"/)
  assert.match(source, /搜索可导入的网络素材/)
  assert.match(source, /class="network-empty"\s*role="status"/)
  assert.match(source, /!networkSearched" class="network-empty" role="status"/)
})

test('导入中离开保护文案仍会拦住路由和刷新', () => {
  assert.match(source, /网络素材正在导入，请完成后再离开。/)
  assert.match(source, /onBeforeRouteLeave\(\(\) => confirmMediaLibraryLeave\(\)\)/)
  assert.match(source, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
})


test('\u7f51\u7edc\u7d20\u6750\u9875\u53ef\u7b5b\u9009 Commons \u4e0e Openverse\uff0c\u5e76\u8bf4\u660e\u516c\u5f00\u8bb8\u53ef\u9700\u81ea\u884c\u6838\u5bf9', () => {
  assert.match(source, /v-model="networkSource"/)
  assert.match(source, /@change="handleNetworkSourceChange"/)
  assert.match(source, />Wikimedia Commons</)
  assert.match(source, />Openverse</)
  assert.match(source, /\u8fd9\u4e9b\u662f\u516c\u5f00\u8bb8\u53ef\u7d20\u6750/)
  assert.match(source, /\u81ea\u884c\u6838\u5bf9/)
  assert.match(source, /networkItemSourceLabel\(item\)/)
  assert.match(source, /item.author \|\| '作者未知'/)
  assert.match(source, /\u8bb8\u53ef\uff1a\{\{ item.license/)
  assert.match(source, /params = \{ keyword: query, source: networkSource.value \}/)
  assert.match(source, /function handleNetworkSourceChange\(\) \{[\s\S]*?invalidateNetworkSearch\(\)[\s\S]*?searchNetworkMedia\(\)/)
  assert.equal((source.match(/:disabled="!networkKeyword.trim\(\) \|\| networkLoading"/g) || []).length, 2)
  assert.equal((source.match(/:title="networkSearchDisableReason \|\| undefined"/g) || []).length, 2)
})

test('Openverse \u7f29\u7565\u56fe\u4e0d\u76f4\u8fde CDN\uff0c\u7a7a\u89c6\u9891\u7ed3\u679c\u4f1a\u8bf4\u660e\u800c\u4e0d\u4f2a\u9020', () => {
  assert.match(source, /networkCardImageUrl\(item\)/)
  assert.match(source, /networkNotice/)
  assert.match(source, /item\?\.thumbnail_url/)
  assert.doesNotMatch(source, /source_url \u5fc5\u987b/)
})

test('取消搜索会立刻把 loading 设为 false，不把 abort 写成失败', () => {
  const cancelSource = remainingExtractNamedFunction(source, 'cancelNetworkSearch')
  assert.match(cancelSource, /networkAbortController\?\.abort\(\)/)
  assert.match(cancelSource, /networkRequestGuard\.begin\(\)/)
  assert.match(cancelSource, /networkLoading\.value = false/)
  assert.doesNotMatch(cancelSource, /networkError\.value =/)
  assert.doesNotMatch(cancelSource, /await /)
  assert.match(source, /aria-label="取消网络素材搜索"/)
  assert.match(source, /v-if="networkLoading"/)
  assert.match(source, /@click="cancelNetworkSearch"/)
})
