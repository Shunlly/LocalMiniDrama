import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectOperationLogs,
  fulfillApi,
  launchPage,
  operationPhases,
  startFrontendVite,
} from './browserHarness.js'

test('项目列表加载失败会锁写、重试恢复，并留下错误/成功操作日志', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  const logs = collectOperationLogs(page)
  let listMode = 'fail'

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === '/api/v1/dramas' && method === 'GET') {
      if (listMode === 'fail') {
        await fulfillApi(route, {
          status: 502,
          error: { code: 'E2E_UPSTREAM_FAILURE', message: 'Injected list failure' },
        })
        return
      }
      await fulfillApi(route, {
        data: { items: [], total: 0, pagination: { page: 1, page_size: 24, total: 0 } },
      })
      return
    }
    if (url.pathname === '/api/v1/settings/prompts') {
      await fulfillApi(route, { data: { prompts: [] } })
      return
    }
    if (url.pathname === '/api/v1/settings/generation') {
      await fulfillApi(route, { data: { concurrency: 3, video_concurrency: 2 } })
      return
    }
    if (url.pathname === '/api/v1/ai-configs' || url.pathname === '/api/v1/scene-model-map' || url.pathname === '/api/v1/dramas/examples') {
      await fulfillApi(route, { data: url.pathname.endsWith('/examples') ? { examples: [] } : [] })
      return
    }
    if (url.pathname === '/api/v1/ai-configs/vendor-lock') {
      await fulfillApi(route, { data: { enabled: false, config_file: '' } })
      return
    }
    await fulfillApi(route, { data: {} })
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
  const failureState = page.locator('.data-load-state[role="alert"]')
  await failureState.waitFor({ state: 'visible', timeout: 20000 })
  await failureState.getByText(/项目数据没有被删除/).waitFor({ timeout: 10000 })
  assert.equal(
    await page.getByRole('button', { name: '新建项目', exact: true }).first().isDisabled(),
    true,
    '列表失败时必须锁写',
  )

  listMode = 'ok'
  await failureState.getByRole('button', { name: '重试加载', exact: true }).click()
  await failureState.waitFor({ state: 'hidden', timeout: 20000 })
  assert.equal(
    await page.getByRole('button', { name: '新建项目', exact: true }).first().isEnabled(),
    true,
    '重试成功后必须解锁写操作',
  )

  const phases = operationPhases(logs, 'project_list_load')
  assert.ok(phases.includes('start'), `缺少开始日志: ${JSON.stringify(logs)}`)
  assert.ok(phases.includes('error'), `缺少失败日志: ${JSON.stringify(logs)}`)
  assert.ok(phases.includes('success'), `缺少成功日志: ${JSON.stringify(logs)}`)
})