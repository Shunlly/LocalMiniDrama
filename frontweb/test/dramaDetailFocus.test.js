import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { once } from 'node:events'

const dramaDetailSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const sectionFocusSource = readFileSync(new URL('../src/utils/sectionFocus.js', import.meta.url), 'utf8')

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

test('episode list receives programmatic focus after the no-episode production redirect', async () => {
  const { scrollAndFocusSection } = await import('../src/utils/sectionFocus.js')
  const focusCalls = []
  const section = {
    getBoundingClientRect: () => ({ top: 360 }),
    focus: (options) => focusCalls.push(options),
  }
  const documentRef = {
    getElementById: (id) => id === 'episode-list' ? section : null,
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 64 }) }),
  }
  const windowRef = {
    scrollY: 120,
    scrollTo: () => {},
    setTimeout: (callback) => callback(),
  }

  assert.equal(scrollAndFocusSection('episode-list', { documentRef, windowRef }), true)
  assert.deepEqual(focusCalls, [{ preventScroll: true }])
})

test('the real episode-list section becomes document.activeElement in Chromium', { timeout: 30_000 }, async (t) => {
  const episodeSectionTag = dramaDetailSource.match(/<section id="episode-list"[^>]*>/)?.[0]
  assert.ok(episodeSectionTag, 'DramaDetail must render the episode-list section')

  const server = createServer((request, response) => {
    if (request.url === '/sectionFocus.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(sectionFocusSource)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
      <main class="drama-detail">
        <header class="header"></header>
        ${episodeSectionTag}<h2>Episodes</h2></section>
      </main>
      <script type="module">
        import { scrollAndFocusSection } from '/sectionFocus.js'
        window.focusResult = scrollAndFocusSection('episode-list')
        window.focusReady = true
      </script>`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const { chromium } = await import('playwright')
  const browser = await launchChromium(chromium)
  t.after(() => browser.close())
  const page = await browser.newPage()
  const { port } = server.address()
  await page.goto(`http://127.0.0.1:${port}`)
  await page.waitForFunction(() => window.focusReady === true)
  await page.waitForTimeout(20)

  assert.equal(await page.evaluate(() => window.focusResult), true)
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'episode-list')
})

test('source-url intent keeps the URL input focused after the parent scroll delay', { timeout: 30_000 }, async (t) => {
  const sourceImportIntentSource = readFileSync(new URL('../src/utils/sourceImportIntent.js', import.meta.url), 'utf8')
  const server = createServer((request, response) => {
    if (request.url === '/sectionFocus.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(sectionFocusSource)
      return
    }
    if (request.url === '/sourceImportIntent.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(sourceImportIntentSource)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
      <main class="drama-detail">
        <header class="header"></header>
        <section id="source-intake-workflow" tabindex="-1"><input id="source-url" type="url"></section>
      </main>
      <script type="module">
        import { scrollAndFocusSection } from '/sectionFocus.js'
        import { revealSourceImportIntent } from '/sourceImportIntent.js'
        window.scrollTo = () => {}
        const sourceUrlInput = { value: document.getElementById('source-url') }
        const historyExpanded = { value: false }
        const selectedStepId = { value: 'delivery' }
        scrollAndFocusSection('source-intake-workflow', { focus: false, focusDelay: 250 })
        await revealSourceImportIntent({
          historyExpanded,
          selectedStepId,
          sourceUrlInput,
          nextTickFn: async () => {},
        })
        window.focusReady = true
      </script>`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const { chromium } = await import('playwright')
  const browser = await launchChromium(chromium)
  t.after(() => browser.close())
  const page = await browser.newPage()
  const { port } = server.address()
  await page.goto(`http://127.0.0.1:${port}`)
  await page.waitForFunction(() => window.focusReady === true)

  assert.equal(await page.evaluate(() => document.activeElement?.id), 'source-url')
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'source-url')
})
