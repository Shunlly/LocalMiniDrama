import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))

async function launchChromium(chromium) {
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

async function startPendingNavigation(page, label, key) {
  await page.evaluate(({ label, key }) => {
    window.routeHarness.navigate(label, `/hold?key=${encodeURIComponent(key)}`)
  }, { label, key })
  await page.waitForFunction((pendingKey) => window.routeHarness.pendingKeys().includes(pendingKey), key)
}

async function releaseAndWait(page, label, key, outcome) {
  await page.evaluate(({ key, outcome }) => window.routeHarness.release(key, outcome), { key, outcome })
  await page.waitForFunction((resultLabel) => (
    window.routeHarness.results.some((result) => result.label === resultLabel)
  ), label)
}

async function expectOverlay(page, visible) {
  if (visible) await page.locator('.route-loading').waitFor({ state: 'visible' })
  else await page.locator('.route-loading').waitFor({ state: 'detached' })
}

test('real App and Vue Router keep the newest loading overlay across stale abort, redirect, and error', { timeout: 60_000 }, async (t) => {
  const vite = await createViteServer({
    root: frontendRoot,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await vite.listen()
  t.after(() => vite.close())

  const { chromium } = await import('playwright')
  const browser = await launchChromium(chromium)
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.goto(`${vite.resolvedUrls.local[0]}browser-fixtures/route-loading/index.html`)
  await page.waitForFunction(() => Boolean(window.routeHarness))

  await startPendingNavigation(page, 'abort-old', 'abort-old')
  await startPendingNavigation(page, 'abort-new', 'abort-new')
  await expectOverlay(page, true)
  const underlay = page.locator('#underlay-action')
  const underlayBox = await underlay.boundingBox()
  assert.ok(underlayBox)
  await page.mouse.click(underlayBox.x + underlayBox.width / 2, underlayBox.y + underlayBox.height / 2)
  assert.equal(await page.evaluate(() => window.__underlayClicks), 0, 'loading overlay must intercept pointer input')
  await releaseAndWait(page, 'abort-old', 'abort-old', 'abort')
  await expectOverlay(page, true)
  await releaseAndWait(page, 'abort-new', 'abort-new', 'continue')
  await expectOverlay(page, false)

  await page.evaluate(() => window.routeHarness.navigate('redirect-old', '/redirect'))
  await page.waitForFunction(() => window.routeHarness.pendingKeys().includes('redirect-leg'))
  await startPendingNavigation(page, 'redirect-new', 'redirect-new')
  await releaseAndWait(page, 'redirect-old', 'redirect-leg', 'continue')
  await expectOverlay(page, true)
  await releaseAndWait(page, 'redirect-new', 'redirect-new', 'continue')
  await expectOverlay(page, false)

  await startPendingNavigation(page, 'error-old', 'error-old')
  await startPendingNavigation(page, 'error-new', 'error-new')
  await releaseAndWait(page, 'error-old', 'error-old', 'error')
  await expectOverlay(page, true)
  await releaseAndWait(page, 'error-new', 'error-new', 'continue')
  await expectOverlay(page, false)
})
