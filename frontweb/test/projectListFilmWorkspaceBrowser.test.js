import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectOperationLogs,
  dramaListPayload,
  fulfillApi,
  launchPage,
  startFrontendVite,
  stubFrontendApis,
} from './browserHarness.js'

// 覆盖项目列表进入制作页、制作页 AI 配置未保存保护、全流程暂停后取消这三条易回归路径。
const PROJECT_ID = 7
const EPISODE_ID = 4
const PROJECT_TITLE = '月光基地'
const TASK_ID = 'hang-1'

function listProject(overrides = {}) {
  return {
    id: PROJECT_ID,
    title: PROJECT_TITLE,
    description: '制作页入口夹具',
    status: 'draft',
    style: 'realistic',
    genre: 'drama',
    updated_at: '2026-08-01T00:00:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    episodes: [{ id: EPISODE_ID, episode_number: 1, title: '第 1 集' }],
    ...overrides,
  }
}

function productionDrama(overrides = {}) {
  return {
    id: PROJECT_ID,
    title: PROJECT_TITLE,
    description: '制作页入口夹具',
    genre: 'drama',
    style: 'realistic',
    metadata: { aspect_ratio: '16:9' },
    characters: [],
    scenes: [],
    props: [],
    episodes: [{
      id: EPISODE_ID,
      episode_number: 1,
      title: '第 1 集',
      script_content: 'Aria finds a letter at the gate.',
      characters: [],
      scenes: [],
      storyboards: [],
    }],
    ...overrides,
  }
}

const promptSettings = {
  prompts: [{
    key: 'story_outline',
    label: '故事大纲',
    description: '制作页未保存保护夹具',
    default_body: '原始提示词',
    locked_suffix: '',
    current_body: null,
    is_customized: false,
  }],
}

const savedTextConfig = {
  id: 1,
  name: '文本默认',
  service_type: 'text',
  provider: 'openai',
  enabled: true,
  is_active: true,
  is_default: true,
  default_model: 'qwen',
}

async function stubProductionWorkspace(page, extraHandlers = {}) {
  await stubFrontendApis(page, {
    'GET /api/v1/dramas': async (route) => {
      await fulfillApi(route, { data: dramaListPayload([listProject()]) })
    },
    [`GET /api/v1/dramas/${PROJECT_ID}`]: async (route) => {
      await fulfillApi(route, { data: productionDrama() })
    },
    'GET /api/v1/ai-configs': async (route) => {
      await fulfillApi(route, { data: [savedTextConfig] })
    },
    'GET /api/v1/settings/prompts': async (route) => {
      await fulfillApi(route, { data: promptSettings })
    },
    ...extraHandlers,
  })
}

async function openProductionFromList(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: PROJECT_TITLE, exact: true }).waitFor({ timeout: 20000 })
  await page.getByRole('link', { name: `打开项目「${PROJECT_TITLE}」`, exact: true }).click()
  await page.waitForURL((url) => url.pathname === `/film/${PROJECT_ID}`, { timeout: 20000 })
  await page.getByRole('button', { name: '返回剧集', exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('heading', { name: PROJECT_TITLE, exact: true }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'AI配置', exact: true }).waitFor({ timeout: 10000 })
}

async function expandPipelineDetails(page) {
  await page.getByRole('heading', { name: '全流程生成', exact: true }).waitFor({ timeout: 15000 })
  const startButton = page.getByRole('button', { name: '仅生成文本框架', exact: true })
  if (await startButton.isVisible()) return
  await page.getByRole('button', { name: '展开', exact: true }).click()
  await startButton.waitFor({ state: 'visible', timeout: 15000 })
}

test('项目列表点击项目卡片会打开制作页', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t, { viewport: { width: 1280, height: 900 } })
  await stubProductionWorkspace(page)

  await openProductionFromList(page, baseUrl)

  assert.match(page.url(), new RegExp(`/film/${PROJECT_ID}`))
  assert.match(page.url(), new RegExp(`episode=${EPISODE_ID}`))
  await page.getByRole('combobox', { name: '当前集', exact: true }).waitFor({ timeout: 10000 })
  await page.getByRole('heading', { name: '全流程生成', exact: true }).waitFor({ timeout: 10000 })
  assert.equal(await page.getByRole('link', { name: `打开项目「${PROJECT_TITLE}」`, exact: true }).count(), 0)
})

test('制作页 AI 配置弹窗未保存时继续编辑会保留内容，放弃后才关闭', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t, { viewport: { width: 1280, height: 900 } })
  await stubProductionWorkspace(page)

  await openProductionFromList(page, baseUrl)
  await page.getByRole('button', { name: 'AI配置', exact: true }).click()

  const workspace = page.getByRole('dialog', { name: 'AI 配置', exact: true })
  await workspace.waitFor({ state: 'visible', timeout: 20000 })
  await workspace.getByRole('tab', { name: '高级设置（提示词）', exact: true }).waitFor({ timeout: 20000 })
  await workspace.getByRole('tab', { name: '高级设置（提示词）', exact: true }).click()

  const textarea = workspace.getByPlaceholder('原始提示词')
  await textarea.waitFor({ state: 'visible', timeout: 15000 })
  await textarea.fill('尚未保存的提示词')
  assert.equal(await textarea.inputValue(), '尚未保存的提示词')

  await workspace.getByRole('button', { name: '返回制作', exact: true }).click()
  const warning = page.getByRole('dialog', { name: '放弃未保存修改？', exact: true })
  await warning.waitFor({ state: 'visible', timeout: 10000 })
  await warning.getByRole('button', { name: '继续编辑', exact: true }).click()
  await warning.waitFor({ state: 'hidden', timeout: 10000 })

  assert.equal(await workspace.isVisible(), true)
  assert.equal(await textarea.inputValue(), '尚未保存的提示词')

  await workspace.getByRole('button', { name: '返回制作', exact: true }).click()
  await warning.waitFor({ state: 'visible', timeout: 10000 })
  await warning.getByRole('button', { name: '放弃修改', exact: true }).click()
  await workspace.waitFor({ state: 'hidden', timeout: 15000 })
})

test('制作页全流程可暂停后再停止，并真正请求取消任务', { timeout: 90_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t, { viewport: { width: 1280, height: 900 } })
  const logs = collectOperationLogs(page)
  const cancelCalls = []

  await stubProductionWorkspace(page, {
    'POST /api/v1/generation/characters': async (route) => {
      await fulfillApi(route, { data: { task_id: TASK_ID, status: 'processing' } })
    },
    [`GET /api/v1/tasks/${TASK_ID}`]: async (route) => {
      await fulfillApi(route, { data: { id: TASK_ID, status: 'processing' } })
    },
    [`POST /api/v1/tasks/${TASK_ID}/cancel`]: async (route) => {
      cancelCalls.push(route.request().postDataJSON() || {})
      await fulfillApi(route, { data: { id: TASK_ID, status: 'cancelled' } })
    },
  })

  await page.goto(`${baseUrl}film/${PROJECT_ID}?episode=${EPISODE_ID}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '返回剧集', exact: true }).waitFor({ timeout: 30000 })
  await expandPipelineDetails(page)

  const characterTaskStarted = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST'
      && url.pathname === '/api/v1/generation/characters'
      && response.ok()
  })
  await page.getByRole('button', { name: '仅生成文本框架', exact: true }).click()
  await characterTaskStarted
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  assert.equal(await page.getByRole('button', { name: '暂停', exact: true }).count(), 0)

  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.getByText(/本地全流程已停止/).waitFor({ timeout: 20000 })
  assert.equal(cancelCalls.length > 0, true, '停止必须向任务取消接口发出请求')
  assert.equal(cancelCalls.some((body) => body?.reason === '用户停止全流程'), true, '取消请求必须带上停止原因')

  const filmEvents = logs.filter((item) => item.operation === 'film_create')
  const stopEvents = filmEvents.filter((item) => String(item.details?.action || '').includes('pipeline_stop'))
  const cancelSweep = logs.filter((item) => item.operation === 'pipeline_task_cancel')
  assert.ok(
    stopEvents.some((item) => item.details?.action === 'pipeline_stop_start' && item.phase === 'start'),
    `缺少停止开始: ${JSON.stringify(filmEvents)}`,
  )
  assert.ok(
    stopEvents.some((item) => item.details?.action === 'pipeline_stop_complete' && item.phase === 'cancel'),
    `缺少停止结果: ${JSON.stringify(filmEvents)}`,
  )
  assert.ok(cancelSweep.some((item) => item.phase === 'start'), `缺少任务取消开始: ${JSON.stringify(logs)}`)
  assert.ok(
    cancelSweep.some((item) => item.phase === 'success' || item.phase === 'error'),
    `缺少任务取消结果: ${JSON.stringify(logs)}`,
  )
})