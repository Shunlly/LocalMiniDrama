import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectOperationLogs,
  fulfillApi,
  launchPage,
  startFrontendVite,
} from './browserHarness.js'

function dramaFixture() {
  return {
    id: 24,
    title: '制作页停止夹具',
    description: '',
    genre: 'drama',
    style: 'realistic',
    metadata: { aspect_ratio: '16:9' },
    characters: [],
    scenes: [],
    props: [],
    episodes: [{
      id: 4,
      episode_number: 1,
      title: '第 1 集',
      script_content: 'Aria finds a letter at the gate.',
      storyboards: [],
    }],
  }
}

test('制作页文本框架流程可停止，并留下取消生命周期日志', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t, { viewport: { width: 1280, height: 900 } })
  const logs = collectOperationLogs(page)
  const cancelCalls = []

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === '/api/v1/dramas/24' && method === 'GET') {
      await fulfillApi(route, { data: dramaFixture() })
      return
    }
    if (url.pathname === '/api/v1/generation/characters' && method === 'POST') {
      await fulfillApi(route, { data: { task_id: 'hang-1', status: 'processing' } })
      return
    }
    if (url.pathname === '/api/v1/tasks/hang-1' && method === 'GET') {
      await fulfillApi(route, { data: { id: 'hang-1', status: 'processing' } })
      return
    }
    if (url.pathname === '/api/v1/tasks/hang-1/cancel' && method === 'POST') {
      cancelCalls.push(route.request().postDataJSON())
      await fulfillApi(route, { data: { id: 'hang-1', status: 'cancelled' } })
      return
    }
    if (url.pathname === '/api/v1/settings/generation') {
      await fulfillApi(route, { data: { concurrency: 3, video_concurrency: 3 } })
      return
    }
    if (url.pathname === '/api/v1/workflows/novel2anime/readiness') {
      await fulfillApi(route, { data: { ready: false, missing_capabilities: [] } })
      return
    }
    if (url.pathname === '/api/v1/images' || url.pathname === '/api/v1/videos') {
      await fulfillApi(route, { data: { items: [] } })
      return
    }
    await fulfillApi(route, { data: [] })
  })

  await page.goto(`${baseUrl}film/24?episode=4`, { waitUntil: 'domcontentloaded' })
  await page.locator('#film-create-quick-nav').waitFor({ state: 'visible', timeout: 30000 })
  const toggle = page.getByTestId('film-pipeline-toggle')
  await toggle.waitFor({ state: 'visible', timeout: 30000 })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  const details = page.getByTestId('film-pipeline-details')
  await details.waitFor({ state: 'visible', timeout: 10000 })
  await details.getByRole('button', { name: '仅生成文本框架', exact: true }).click()
  await details.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await details.getByRole('button', { name: '停止', exact: true }).click()
  await page.getByText(/本地全流程已停止/).waitFor({ timeout: 20000 })
  assert.equal(cancelCalls.length > 0, true, '停止必须向任务取消接口发出请求')

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
  assert.ok(cancelSweep.some((item) => item.phase === 'success' || item.phase === 'error'), `缺少任务取消结果: ${JSON.stringify(logs)}`)
})