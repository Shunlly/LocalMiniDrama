import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectOperationLogs,
  dramaListPayload,
  fulfillApi,
  launchPage,
  operationPhases,
  startFrontendVite,
  stubFrontendApis,
} from './browserHarness.js'

function sampleProject(overrides = {}) {
  return {
    id: 7,
    title: '月光基地',
    description: '测试项目',
    status: 'draft',
    style: 'realistic',
    genre: 'drama',
    updated_at: '2026-08-01T00:00:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    episodes: [],
    ...overrides,
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

test('空项目展示起步入口，新建弹窗焦点落在标题并在关闭后回到触发按钮', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page)

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '还没有短剧项目' }).waitFor({ timeout: 20000 })
  const emptyNewButton = page.locator('.action-btn-new')
  assert.equal(await emptyNewButton.isEnabled(), true, '空项目时必须允许新建')

  await emptyNewButton.click()
  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await dialog.waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForFunction(() => {
    const active = document.activeElement
    return Boolean(active && active.getAttribute('aria-label') === '项目标题')
  }, null, { timeout: 10000 })

  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 10000 })
  const restored = await emptyNewButton.evaluate((button) => (
    button === document.activeElement || button.contains(document.activeElement)
  ))
  assert.equal(restored, true, '关闭新建弹窗后焦点必须回到触发按钮')
})

test('带筛选的空结果不会冒充空项目，清除筛选后回到起步入口', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page)

  await page.goto(`${baseUrl}?q=moon-base`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '没有匹配的项目' }).waitFor({ timeout: 20000 })
  assert.equal(await page.getByRole('heading', { name: '还没有短剧项目' }).count(), 0)
  assert.equal(await page.getByRole('textbox', { name: '搜索项目' }).inputValue(), 'moon-base')

  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByRole('heading', { name: '还没有短剧项目' }).waitFor({ timeout: 20000 })
  assert.equal(await page.getByRole('heading', { name: '没有匹配的项目' }).count(), 0)
})

test('已有项目刷新失败会保留过期列表，重试成功后解锁写操作', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  const logs = collectOperationLogs(page)
  let listMode = 'ok'

  await stubFrontendApis(page, {
    'GET /api/v1/dramas': async (route) => {
      if (listMode === 'fail') {
        await fulfillApi(route, {
          status: 502,
          error: { code: 'E2E_UPSTREAM_FAILURE', message: 'Injected refresh failure' },
        })
        return
      }
      await fulfillApi(route, { data: dramaListPayload([sampleProject()]) })
    },
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '月光基地' }).waitFor({ timeout: 20000 })

  listMode = 'fail'
  await page.getByRole('textbox', { name: '搜索项目' }).fill('月光')
  const failureState = page.locator('.data-load-state[role="alert"]')
  await failureState.waitFor({ state: 'visible', timeout: 20000 })
  await failureState.getByText('项目列表刷新失败', { exact: true }).waitFor({ timeout: 10000 })
  await page.getByRole('heading', { name: '月光基地' }).waitFor({ timeout: 5000 })
  assert.equal(
    await page.getByRole('button', { name: '新建项目', exact: true }).first().isDisabled(),
    true,
    '过期列表必须锁写',
  )

  listMode = 'ok'
  await failureState.getByRole('button', { name: '重试加载', exact: true }).click()
  await failureState.waitFor({ state: 'hidden', timeout: 20000 })
  await page.getByRole('heading', { name: '月光基地' }).waitFor({ timeout: 10000 })
  assert.equal(
    await page.getByRole('button', { name: '新建项目', exact: true }).first().isEnabled(),
    true,
    '重试成功后必须解锁写操作',
  )

  const phases = operationPhases(logs, 'project_list_load')
  assert.ok(phases.includes('error'), `缺少失败日志: ${JSON.stringify(logs)}`)
  assert.ok(phases.includes('success'), `缺少成功日志: ${JSON.stringify(logs)}`)
})

test('切换筛选会取消进行中的列表请求，且不会把取消当成加载失败', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  const logs = collectOperationLogs(page)
  const hangingRoutes = []
  let listMode = 'ok'
  let hangStarted = null
  const hangReady = new Promise((resolve) => { hangStarted = resolve })

  t.after(async () => {
    for (const route of hangingRoutes) {
      try { await route.abort() } catch (_) {}
    }
  })

  await stubFrontendApis(page, {
    'GET /api/v1/dramas': async (route) => {
      if (listMode === 'hang') {
        hangingRoutes.push(route)
        hangStarted?.()
        return
      }
      await fulfillApi(route, { data: dramaListPayload([sampleProject()]) })
    },
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '月光基地' }).waitFor({ timeout: 20000 })

  listMode = 'hang'
  await page.getByRole('textbox', { name: '搜索项目' }).fill('月光')
  await hangReady
  await wait(50)

  listMode = 'ok'
  await page.getByRole('textbox', { name: '搜索项目' }).fill('月光基地')
  await page.getByRole('heading', { name: '月光基地' }).waitFor({ timeout: 20000 })
  await wait(400)
  assert.equal(await page.locator('.data-load-state[role="alert"]').count(), 0, '取消中的请求不得变成错误空态')

  const phases = operationPhases(logs, 'project_list_load')
  assert.equal(phases.includes('error'), false, `取消不得留下失败日志: ${JSON.stringify(logs)}`)
  assert.ok(phases.includes('success'), `缺少成功日志: ${JSON.stringify(logs)}`)
})
