import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const nodeSource = read('../src/components/dramaCanvas/FreeCanvasNode.vue')
const inspectorSource = read('../src/components/dramaCanvas/FreeCanvasInspector.vue')
const dramaCanvasSource = read('../src/views/DramaCanvas.vue')

test('config node controls describe stopping local waiting instead of cancelling provider work', () => {
  assert.match(nodeSource, /content="停止等待"/)
  assert.match(nodeSource, /aria-label="停止等待"/)
  assert.match(nodeSource, /title="停止等待"/)
  assert.doesNotMatch(nodeSource, /取消生成/)

  assert.match(inspectorSource, />\s*停止等待\s*</)
  assert.doesNotMatch(inspectorSource, /取消生成/)
})

test('stopping a config node preserves the cancelled status and warns that submitted work can continue', () => {
  const stopHandler = dramaCanvasSource.match(
    /function cancelFreeCanvasConfig\(nodeId\) \{[\s\S]*?\n\}/,
  )?.[0] || ''

  assert.match(stopHandler, /setFreeCanvasConfigOperationState\(nodeId, 'cancelled'/)
  assert.match(stopHandler, /已停止等待/)
  assert.match(stopHandler, /已提交/)
  assert.match(stopHandler, /可能继续执行/)
  assert.match(stopHandler, /计费/)
  assert.doesNotMatch(stopHandler, /已取消该配置节点的生成状态/)
})
