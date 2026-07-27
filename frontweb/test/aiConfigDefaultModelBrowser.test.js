import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const FRONTWEB_ROOT = fileURLToPath(new URL('..', import.meta.url))
const VITE_BIN = path.join(FRONTWEB_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForServer(url, process, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (code ${process.exitCode})`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (_) {
      // The server may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not become ready within ${timeoutMs}ms`)
}

async function startVite() {
  const port = await reservePort()
  const url = `http://127.0.0.1:${port}`
  const viteProcess = spawn(
    process.execPath,
    [VITE_BIN, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: FRONTWEB_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let output = ''
  viteProcess.stdout.on('data', (chunk) => { output += chunk })
  viteProcess.stderr.on('data', (chunk) => { output += chunk })
  try {
    await waitForServer(url, viteProcess)
    return {
      url,
      async stop() {
        if (viteProcess.exitCode === null) viteProcess.kill()
        await new Promise((resolve) => {
          if (viteProcess.exitCode !== null) return resolve()
          viteProcess.once('exit', resolve)
          setTimeout(resolve, 5000).unref()
        })
      },
    }
  } catch (error) {
    if (viteProcess.exitCode === null) viteProcess.kill()
    throw new Error(`${error.message}\n${output}`)
  }
}

const staleDefaultConfig = {
  id: 17,
  service_type: 'text',
  name: '默认模型失效配置',
  provider: 'openai',
  api_protocol: 'openai',
  base_url: 'https://example.invalid/v1',
  api_key: '********',
  endpoint: '',
  query_endpoint: '',
  model: ['current-model-a', 'current-model-b'],
  default_model: 'retired-model',
  priority: 0,
  is_active: true,
  is_default: true,
  settings: null,
}

async function installLocalApiFixtures(page, updateBodies) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    let data = {}

    if (url.pathname === '/api/v1/ai-configs' && request.method() === 'GET') {
      data = [staleDefaultConfig]
    } else if (url.pathname === `/api/v1/ai-configs/${staleDefaultConfig.id}` && request.method() === 'PUT') {
      updateBodies.push(request.postDataJSON())
      data = { ...staleDefaultConfig, ...updateBodies.at(-1) }
    } else if (url.pathname === '/api/v1/ai-configs/vendor-lock') {
      data = { enabled: false, config_file: '' }
    } else if (url.pathname === '/api/v1/settings/prompts') {
      data = { prompts: [] }
    } else if (url.pathname === '/api/v1/settings/generation') {
      data = { concurrency: 3, video_concurrency: 2 }
    } else if (url.pathname === '/api/v1/scene-model-map') {
      data = []
    } else if (url.pathname === '/api/v1/dramas/examples') {
      data = { examples: [] }
    } else if (url.pathname === '/api/v1/dramas') {
      data = { items: [], total: 0 }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    })
  })
}

test('editing preserves an unavailable default model until a valid model is explicitly selected', { timeout: 60000 }, async (t) => {
  const vite = await startVite()
  t.after(() => vite.stop())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const updateBodies = []
  await installLocalApiFixtures(page, updateBodies)

  await page.goto(`${vite.url}/ai-config`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: '配置管理' }).click()
  const configRow = page.getByRole('row').filter({ hasText: staleDefaultConfig.name })
  await configRow.getByRole('button', { name: '编辑' }).click()

  const dialog = page.getByRole('dialog', { name: '编辑配置' })
  await dialog.waitFor({ state: 'visible' })
  const modelSection = dialog.locator('.config-form-section').filter({
    has: page.locator('h4', { hasText: /^模型$/ }),
  })
  const defaultModelItem = modelSection.locator('.el-form-item').filter({
    has: page.locator('.form-label-tip', { hasText: /^默认模型/ }),
  })

  assert.match(await defaultModelItem.textContent(), /retired-model/)
  await dialog.getByText('当前默认模型已不在模型列表中，请显式选择有效模型后保存。').waitFor()

  await dialog.locator('[data-ai-config-field="name"]').fill('只修改名称的配置')
  await dialog.getByRole('button', { name: '确定' }).click()
  await dialog.locator('.ai-config-validation-summary').getByText(
    '默认模型：请选择模型列表中的有效默认模型',
    { exact: true },
  ).waitFor()
  assert.equal(updateBodies.length, 0)

  await defaultModelItem.locator('.el-select__wrapper').click()
  await page.getByRole('option', { name: 'current-model-b', exact: true }).click()

  const updateRequest = page.waitForRequest((request) => (
    request.method() === 'PUT'
    && new URL(request.url()).pathname === `/api/v1/ai-configs/${staleDefaultConfig.id}`
  ))
  await dialog.getByRole('button', { name: '确定' }).click()
  await updateRequest

  assert.equal(updateBodies.length, 1)
  assert.equal(updateBodies[0].name, '只修改名称的配置')
  assert.equal(updateBodies[0].default_model, 'current-model-b')
})
