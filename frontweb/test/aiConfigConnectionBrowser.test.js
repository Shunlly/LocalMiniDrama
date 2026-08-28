import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectOperationLogs,
  fulfillApi,
  launchPage,
  operationPhases,
  startFrontendVite,
} from './browserHarness.js'

const textConfig = {
  id: 11,
  name: '本地文本',
  service_type: 'text',
  provider: 'openai',
  is_active: true,
  is_default: true,
  default_model: 'qwen',
  base_url: 'http://127.0.0.1:9',
  api_key: '********',
  endpoint: '/v1/chat/completions',
  settings: {},
}

test('AI 配置连接测试失败会展示错误并留下 error 操作日志', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  const logs = collectOperationLogs(page)

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === '/api/v1/ai-configs/test' && method === 'POST') {
      await fulfillApi(route, {
        status: 502,
        error: { code: 'CONNECTION_FAILED', message: '网关拒绝连接' },
      })
      return
    }
    if (url.pathname === '/api/v1/ai-configs' && method === 'GET') {
      await fulfillApi(route, { data: [textConfig] })
      return
    }
    if (url.pathname === '/api/v1/ai-configs/vendor-lock') {
      await fulfillApi(route, { data: { enabled: false, config_file: '' } })
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
    if (url.pathname === '/api/v1/scene-model-map') {
      await fulfillApi(route, { data: [] })
      return
    }
    if (url.pathname === '/api/v1/dramas') {
      await fulfillApi(route, { data: { items: [], total: 0, pagination: { page: 1, page_size: 24, total: 0 } } })
      return
    }
    await fulfillApi(route, { data: {} })
  })

  await page.goto(`${baseUrl}ai-config`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'AI 服务配置与验证', exact: true }).waitFor({ timeout: 30000 })
  await page.getByTestId('ai-config-mode-configs').click()
  await page.locator('.config-list-section').waitFor({ state: 'visible', timeout: 30000 })
  const row = page.locator('.el-table__row').filter({ hasText: '本地文本' }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.getByRole('button', { name: '测试', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '测试连接', exact: true })
  await dialog.getByText('连接测试失败：网关拒绝连接', { exact: true }).waitFor({ timeout: 30000 })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()

  const phases = operationPhases(logs, 'ai_config_test')
  assert.ok(phases.includes('start'), `缺少开始日志: ${JSON.stringify(logs)}`)
  assert.ok(phases.includes('error'), `缺少失败日志: ${JSON.stringify(logs)}`)
})