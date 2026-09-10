import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateNavSteps } from '../src/composables/filmCreate/useFilmCreateNavSteps.js'

const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')
const dialogs = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourceDialogs.vue', import.meta.url), 'utf8')

function refOf(value) {
  return { value }
}

function createNav(overrides = {}) {
  return useFilmCreateNavSteps({
    genStore: { getRunningForEpisode() { return [] } },
    dramaId: refOf(11),
    currentEpisodeId: refOf(22),
    scriptContent: refOf(''),
    isStoryGenRunning: refOf(false),
    characters: refOf([]),
    hasAssetImage: () => false,
    charactersGenerating: refOf(false),
    generatingCharIds: new Set(),
    props: refOf([]),
    propsExtracting: refOf(false),
    generatingPropIds: new Set(),
    scenes: refOf([]),
    scenesExtracting: refOf(false),
    generatingSceneIds: new Set(),
    storyboards: refOf([]),
    storyboardGenerating: refOf(false),
    universalOmniPolishRunning: refOf(false),
    hasSbImage: () => false,
    generatingSbImageIds: new Set(),
    batchImageRunning: refOf(false),
    getSbAllVideos: () => [],
    batchVideoRunning: refOf(false),
    generatingSbVideoIds: new Set(),
    videoStatus: refOf('idle'),
    currentEpisodeVideoUrl: refOf(''),
    ...overrides,
  })
}

test('资源面板标题与导航步骤一致，空态指向真实按钮', () => {
  const { navSteps } = createNav()
  const labels = Object.fromEntries(navSteps.value.map((step) => [step.key, step.label]))
  assert.equal(labels.chars, '角色')
  assert.equal(labels.props, '道具')
  assert.equal(labels.scenes, '场景')
  assert.match(panel, /class="resource-block-title">角色<\/span>/)
  assert.match(panel, /class="resource-block-title">道具<\/span>/)
  assert.match(panel, /class="resource-block-title">场景<\/span>/)
  assert.match(panel, /暂无角色，可用「剧本自动提取角色」或「添加角色」/)
  assert.match(panel, /暂无道具，可用「从剧本提取道具」或「添加道具」/)
  assert.match(panel, /暂无场景，可用「从剧本提取场景」或「添加场景」/)
  assert.doesNotMatch(panel, /class="resource-block-title">角色生成<\/span>/)
  assert.match(panel, /正在提取角色，请稍候/)
  assert.match(panel, /正在提取道具，请稍候/)
  assert.match(panel, /正在提取场景，请稍候/)
})

test('资源弹窗空名称禁用确定保存时给出中文原因', () => {
  const addPropTitle = dialogs.match(/:disabled="!addPropForm.name.trim\(\)" :title="([^"]+)"/)?.[1]
  const editPropTitle = dialogs.match(/:disabled="!editPropForm\?\.name\?\.trim\(\)" :title="([^"]+)"/)?.[1]
  const editSceneTitle = dialogs.match(/:disabled="!editSceneForm\?\.location\?\.trim\(\)" :title="([^"]+)"/)?.[1]
  const addToEpisodeTitle = dialogs.match(/:disabled="Boolean\(addToEpisodeDisabledReason\)" :title="([^"]+)"/)?.[1]
  assert.equal(addPropTitle, "addPropSaving ? '正在保存道具，请稍候' : (addPropForm.name.trim() ? undefined : '请先填写名称')")
  assert.equal(editPropTitle, "editPropSaving ? '正在保存道具，请稍候' : (editPropForm?.name?.trim() ? undefined : '请先填写名称')")
  assert.equal(editSceneTitle, "editSceneSaving ? '正在保存场景，请稍候' : (editSceneForm?.location?.trim() ? undefined : '请先填写地点')")
  assert.equal(addToEpisodeTitle, 'addToEpisodeDisabledReason || undefined')
  assert.equal(
    [...dialogs.matchAll(/:disabled="Boolean\(addToEpisodeDisabledReason\)" :title="addToEpisodeDisabledReason \|\| undefined"/g)].length,
    6,
  )
  assert.doesNotMatch(dialogs, /:disabled="!addPropForm.name.trim\(\)" @click="submitAddProp"/)
  assert.doesNotMatch(dialogs, /:disabled="!editPropForm\?\.name\?\.trim\(\)" @click="submitEditProp"/)
  assert.doesNotMatch(dialogs, /:disabled="!editSceneForm\?\.location\?\.trim\(\)" @click="submitEditScene"/)
  assert.doesNotMatch(dialogs, /:disabled="Boolean\(addToEpisodeDisabledReason\)" @click=/)

  const evalExpr = (expr, scope) => Function(...Object.keys(scope), `"use strict"; return (${expr});`)(...Object.values(scope))
  assert.equal(evalExpr(addPropTitle, { addPropSaving: false, addPropForm: { name: '' } }), '请先填写名称')
  assert.equal(evalExpr(addPropTitle, { addPropSaving: false, addPropForm: { name: '  ' } }), '请先填写名称')
  assert.equal(evalExpr(addPropTitle, { addPropSaving: false, addPropForm: { name: '茶杯' } }), undefined)
  assert.equal(evalExpr(addPropTitle, { addPropSaving: true, addPropForm: { name: '茶杯' } }), '正在保存道具，请稍候')
  assert.equal(evalExpr(editPropTitle, { editPropSaving: false, editPropForm: null }), '请先填写名称')
  assert.equal(evalExpr(editPropTitle, { editPropSaving: false, editPropForm: { name: '灯笼' } }), undefined)
  assert.equal(evalExpr(editPropTitle, { editPropSaving: true, editPropForm: { name: '灯笼' } }), '正在保存道具，请稍候')
  assert.equal(evalExpr(editSceneTitle, { editSceneSaving: false, editSceneForm: { location: '' } }), '请先填写地点')
  assert.equal(evalExpr(editSceneTitle, { editSceneSaving: false, editSceneForm: { location: '教室' } }), undefined)
  assert.equal(evalExpr(editSceneTitle, { editSceneSaving: true, editSceneForm: { location: '教室' } }), '正在保存场景，请稍候')
  assert.equal(evalExpr(addToEpisodeTitle, { addToEpisodeDisabledReason: '请先创建或选择剧集' }), '请先创建或选择剧集')
  assert.equal(evalExpr(addToEpisodeTitle, { addToEpisodeDisabledReason: '' }), undefined)
})
