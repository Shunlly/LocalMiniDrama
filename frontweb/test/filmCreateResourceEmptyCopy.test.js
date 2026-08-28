import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateNavSteps.js', import.meta.url), 'utf8')

test('资源面板标题与导航步骤一致，空态指向真实按钮', () => {
  assert.match(nav, /label: '角色'/)
  assert.match(nav, /label: '道具'/)
  assert.match(nav, /label: '场景'/)
  assert.match(panel, /class="resource-block-title">角色<\/span>/)
  assert.match(panel, /class="resource-block-title">道具<\/span>/)
  assert.match(panel, /class="resource-block-title">场景<\/span>/)
  assert.match(panel, /暂无角色，可用「剧本自动提取角色」或「添加角色」/)
  assert.match(panel, /暂无道具，可用「从剧本提取道具」或「添加道具」/)
  assert.match(panel, /暂无场景，可用「从剧本提取场景」或「添加场景」/)
  assert.doesNotMatch(panel, /class="resource-block-title">角色生成<\/span>/)
})
