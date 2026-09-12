import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCanvasEpisodeId,
  parseCanvasFocusNodeId,
  parseCanvasRouteContext,
} from '../src/components/dramaCanvas/dramaCanvasRoute.js'

test('画布路由焦点只接受安全节点编号', () => {
  assert.equal(parseCanvasFocusNodeId({ query: { focus: 'storyboard:12' } }), 'storyboard:12')
  assert.equal(parseCanvasFocusNodeId({ query: { focus: ['free:abc'] } }), 'free:abc')
  assert.equal(parseCanvasFocusNodeId({ query: { focus: '../etc/passwd' } }), '')
  assert.equal(parseCanvasFocusNodeId({ query: {} }), '')
})

test('画布剧集编号只认正整数，不把项目 ID 混进去', () => {
  assert.equal(parseCanvasEpisodeId({ query: { episode: '22' } }), 22)
  assert.equal(parseCanvasEpisodeId({ query: { episode: ['7'] } }), 7)
  assert.equal(parseCanvasEpisodeId({ query: { episode: '0' } }), null)
  assert.equal(parseCanvasEpisodeId({ query: { episode: '-1' } }), null)
  assert.equal(parseCanvasEpisodeId({ query: { episode: '11abc' } }), null)
  assert.equal(parseCanvasEpisodeId({ query: {} }), null)
})

test('画布路由上下文把项目、焦点、剧集分开，同值也不混用', () => {
  const context = parseCanvasRouteContext({
    params: { id: '11' },
    query: { focus: 'storyboard:11', episode: '22' },
  })
  assert.equal(context.projectId, '11')
  assert.equal(context.focusNodeId, 'storyboard:11')
  assert.equal(context.episodeId, 22)
  assert.notEqual(context.projectId, String(context.episodeId))
})
