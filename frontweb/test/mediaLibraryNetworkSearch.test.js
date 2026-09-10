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


test('\u7f51\u7edc\u7d20\u6750\u9875\u53ef\u7b5b\u9009 Commons \u4e0e Openverse\uff0c\u5e76\u8bf4\u660e\u516c\u5f00\u8bb8\u53ef\u9700\u81ea\u884c\u6838\u5bf9', () => {
  assert.match(source, /v-model="networkSource"/)
  assert.match(source, /@change="handleNetworkSourceChange"/)
  assert.match(source, />Wikimedia Commons</)
  assert.match(source, />Openverse</)
  assert.match(source, /\u8fd9\u4e9b\u662f\u516c\u5f00\u8bb8\u53ef\u7d20\u6750/)
  assert.match(source, /\u81ea\u884c\u6838\u5bf9/)
  assert.match(source, /networkItemSourceLabel\(item\)/)
  assert.match(source, /\u8bb8\u53ef\uff1a\{\{ item.license/)
  assert.match(source, /params = \{ keyword: query, source: networkSource.value \}/)
  assert.match(source, /function handleNetworkSourceChange\(\) \{[\s\S]*?invalidateNetworkSearch\(\)[\s\S]*?searchNetworkMedia\(\)/)
  assert.match(source, /:title="!networkKeyword.trim\(\) \? '\u8bf7\u8f93\u5165\u5173\u952e\u8bcd\u540e\u518d\u641c\u7d22'/)
})

test('Openverse \u7f29\u7565\u56fe\u4e0d\u76f4\u8fde CDN\uff0c\u7a7a\u89c6\u9891\u7ed3\u679c\u4f1a\u8bf4\u660e\u800c\u4e0d\u4f2a\u9020', () => {
  assert.match(source, /networkCardImageUrl\(item\)/)
  assert.match(source, /networkNotice/)
  assert.match(source, /item\?\.thumbnail_url/)
  assert.doesNotMatch(source, /source_url \u5fc5\u987b/)
})
