import test from 'node:test'
import assert from 'node:assert/strict'

import {
  accessibleItemName,
  actionLabel,
  describeNetworkSearchAnnouncement,
  formatSourceTimestamp,
  itemUrl,
  mediaOriginLabel,
  mediaSelectionLabel,
  networkItemSourceLabel,
  networkItemTitle,
  normalizeNetworkSourceQuery,
  previewAlt,
  safeExternalUrl,
  sourceEvidence,
  thumbnailAlt,
  videoPreviewLabel,
} from '../src/components/mediaLibrary/mediaLibraryFormatters.js'

test('本地素材无障碍名称和图片替代文本保持简体中文', () => {
  assert.equal(accessibleItemName({ name: ' 夜戏 ' }), '夜戏')
  assert.equal(accessibleItemName({}), '未命名素材')
  assert.equal(thumbnailAlt({ name: '夜戏' }), '素材缩略图：夜戏')
  assert.equal(previewAlt({ name: '夜戏' }), '素材预览图：夜戏')
  assert.equal(videoPreviewLabel({ name: '夜戏' }), '素材视频预览：夜戏')
  assert.equal(actionLabel('删除', { name: '夜戏' }), '删除素材：夜戏')
})

test('网络素材标题、来源和证据字段不会把不同 ID 混用', () => {
  assert.equal(networkItemTitle({ title: ' 雨巷 ' }), '雨巷')
  assert.equal(networkItemTitle({}), '未命名网络素材')
  assert.equal(networkItemSourceLabel(null), '未知来源')
  assert.equal(networkItemSourceLabel({ source: 'openverse', source_site: 'Flickr' }), 'Openverse · Flickr')
  assert.equal(sourceEvidence({ source_metadata: { source_url: 'https://example.com/a' }, source_url: 'https://other.example/b' }, 'source_url'), 'https://example.com/a')
  assert.equal(itemUrl({ local_path: '/media/a.png', url: 'https://cdn.example/a.png' }), '/static/media/a.png')
})

test('网络来源查询和外部链接校验保持原语义', () => {
  assert.equal(normalizeNetworkSourceQuery('openverse'), 'openverse')
  assert.equal(normalizeNetworkSourceQuery(['commons']), 'commons')
  assert.equal(normalizeNetworkSourceQuery('wikimedia'), 'all')
  assert.equal(safeExternalUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(safeExternalUrl('http://example.com/a', true), '')
  assert.equal(safeExternalUrl('https://user:pass@example.com/a'), '')
  assert.equal(safeExternalUrl('javascript:alert(1)'), '')
})

test('素材来源标签和本地时间格式化为简体中文', () => {
  assert.equal(mediaOriginLabel({ drama_id: 11 }), '项目素材（ID 11）')
  assert.notEqual(mediaOriginLabel({ drama_id: 22 }), mediaOriginLabel({ drama_id: 11 }))
  assert.equal(mediaOriginLabel({}), '全局上传，可跨项目复用')
  assert.match(formatSourceTimestamp('2026-09-11T03:00:00.000Z'), /2026/)
  assert.equal(formatSourceTimestamp('not-a-date'), '')
})

test('选择标签和网络搜索公告保持简体中文，且不会把不同素材混在一起', () => {
  assert.equal(mediaSelectionLabel({ name: '雨巷' }, false), '选择素材：雨巷')
  assert.equal(mediaSelectionLabel({ name: '雨巷' }, true), '取消选择素材：雨巷')
  assert.equal(mediaSelectionLabel({ name: '月光' }, false), '选择素材：月光')
  assert.doesNotMatch(mediaSelectionLabel({ name: '雨巷' }, false), /月光/)
  assert.equal(describeNetworkSearchAnnouncement({ loading: true, keyword: ' 雨巷 ', error: '', searched: false, count: 0 }), '正在搜索：雨巷')
  assert.equal(describeNetworkSearchAnnouncement({ loading: false, keyword: '雨巷', error: '网络素材服务暂时不可用', searched: false, count: 0 }), '搜索失败：网络素材服务暂时不可用')
  assert.equal(describeNetworkSearchAnnouncement({ loading: false, keyword: '雨巷', error: '', searched: false, count: 0 }), '尚未执行网络素材搜索')
  assert.equal(describeNetworkSearchAnnouncement({ loading: false, keyword: '雨巷', error: '', searched: true, count: 3 }), '搜索完成，找到 3 项素材')
  assert.equal(describeNetworkSearchAnnouncement({ loading: false, keyword: '月光', error: '', searched: true, count: 0 }), '搜索完成，没有找到匹配素材')
})
