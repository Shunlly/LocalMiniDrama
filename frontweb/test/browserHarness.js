import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))

export async function launchChromium(chromium) {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    const systemChrome = process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ].find(existsSync)
      : null
    if (!systemChrome) throw error
    return chromium.launch({ headless: true, executablePath: systemChrome })
  }
}

export async function startFrontendVite(t) {
  const vite = await createViteServer({
    root: frontendRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await vite.listen()
  t.after(() => vite.close())
  return vite.resolvedUrls.local[0]
}

export async function launchPage(t, { viewport = { width: 1280, height: 800 } } = {}) {
  const { chromium } = await import('playwright')
  const browser = await launchChromium(chromium)
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport })
  await page.addInitScript(() => {
    window.__LMD_OPERATION_LOGS__ = []
  })
  return page
}

export function collectOperationLogs(page) {
  const records = []
  page.on('console', (msg) => {
    const text = msg.text()
    const marker = '[operation] '
    const index = text.indexOf(marker)
    if (index === -1) return
    const payload = text.slice(index + marker.length).trim()
    try {
      records.push(JSON.parse(payload))
    } catch (_) {
      records.push({ raw: payload })
    }
  })
  return records
}

export async function fulfillApi(route, { status = 200, data = {}, error } = {}) {
  if (error) {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error }),
    })
    return
  }
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  })
}

export function operationPhases(records, operation) {
  return records.filter((item) => item.operation === operation).map((item) => item.phase)
}