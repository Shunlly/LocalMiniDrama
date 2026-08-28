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
  const viteProcess = spawn(process.execPath, [VITE_BIN, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: FRONTWEB_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
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

const promptFixture = {
  prompts: [{
    key: 'story_outline',
    label: '故事大纲',
    description: '浏览器未保存保护测试',
    default_body: '原始提示词',
    locked_suffix: '',
    current_body: null,
    is_customized: false,
  }],
}

async function installLocalApiFixtures(page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let data = {}
    if (url.pathname === '/api/v1/settings/prompts') data = promptFixture
    else if (url.pathname === '/api/v1/settings/generation') data = { concurrency: 3, video_concurrency: 2 }
    else if (url.pathname === '/api/v1/scene-model-map') data = []
    else if (url.pathname === '/api/v1/ai-configs/vendor-lock') data = { enabled: false, config_file: '' }
    else if (url.pathname === '/api/v1/ai-configs') data = [{
      id: 1,
      name: '文本默认',
      service_type: 'text',
      provider: 'openai',
      enabled: true,
      is_default: true,
    }]
    else if (url.pathname === '/api/v1/dramas/examples') data = { examples: [] }
    else if (url.pathname === '/api/v1/dramas') data = { items: [], total: 0 }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    })
  })
}

async function makePromptDirty(page) {
  await page.getByRole('tab', { name: '高级设置（提示词）' }).click()
  const textarea = page.locator('.prompt-textarea textarea')
  await textarea.waitFor({ state: 'visible' })
  await textarea.fill('尚未保存的提示词')
  await page.locator('.dirty-indicator').waitFor({ state: 'visible' })
  return textarea
}

async function continueEditing(page) {
  const warning = page.getByRole('dialog', { name: '放弃未保存修改？' })
  await warning.waitFor({ state: 'visible' })
  await warning.getByRole('button', { name: '继续编辑' }).click()
  await warning.waitFor({ state: 'hidden' })
}

async function discardChanges(page) {
  const warning = page.getByRole('dialog', { name: '放弃未保存修改？' })
  await warning.waitFor({ state: 'visible' })
  await warning.getByRole('button', { name: '放弃修改' }).click()
  await warning.waitFor({ state: 'hidden' })
}

test('PromptEditor keeps dirty state after cancelled navigation and only leaves after discard', { timeout: 60000 }, async (t) => {
  const vite = await startVite()
  t.after(() => vite.stop())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await installLocalApiFixtures(page)

  await page.goto(`${vite.url}/ai-config`, { waitUntil: 'domcontentloaded' })
  const textarea = await makePromptDirty(page)

  await page.locator('.ai-config .btn-back').click()
  await continueEditing(page)

  assert.equal(new URL(page.url()).pathname, '/ai-config')
  assert.equal(await textarea.inputValue(), '尚未保存的提示词')
  assert.equal(await page.locator('.dirty-indicator').isVisible(), true)

  await page.locator('.ai-config .btn-back').click()
  await discardChanges(page)
  await page.waitForURL((url) => url.pathname === '/')
  assert.equal(new URL(page.url()).pathname, '/')
})

test('AI config modal keeps dirty PromptEditor mounted when closing is cancelled', { timeout: 60000 }, async (t) => {
  const vite = await startVite()
  t.after(() => vite.stop())
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await installLocalApiFixtures(page)

  await page.goto(vite.url, { waitUntil: 'domcontentloaded' })
  await page.locator('.btn-settings').click()
  const workspace = page.getByRole('dialog', { name: 'AI 配置' })
  await workspace.waitFor({ state: 'visible' })
  const textarea = await makePromptDirty(page)

  await workspace.locator('.el-dialog__headerbtn').click()
  await continueEditing(page)

  assert.equal(await workspace.isVisible(), true)
  assert.equal(await textarea.inputValue(), '尚未保存的提示词')
  assert.equal(await page.locator('.dirty-indicator').isVisible(), true)

  await workspace.locator('.el-dialog__headerbtn').click()
  await discardChanges(page)
  await workspace.waitFor({ state: 'hidden' })
})
