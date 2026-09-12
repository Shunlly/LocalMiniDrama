import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { once } from 'node:events'

import { readDramaDetailResourceDialogSources } from './helpers/dramaDetailResourceDialogSources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const dramaDetailPageSource = read('../src/views/DramaDetail.vue')
const dramaDetailEpisodeSource = read('../src/components/dramaDetail/DramaDetailEpisodeList.vue')
const dramaDetailResourceLibrarySource = read('../src/components/dramaDetail/DramaDetailResourceLibrary.vue')
const dramaDetailSource = [dramaDetailPageSource, dramaDetailEpisodeSource, dramaDetailResourceLibrarySource].join('\n')
const dramaDetailHeaderSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const dramaDetailDialogsSource = readDramaDetailResourceDialogSources(read)
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

test('DramaDetail 禁用按钮外包可焦点且空封面不再是 disabled button', () => {
  assert.match(dramaDetailHeaderSource, /class="tooltip-trigger"[\s\S]*:tabindex="currentEpisodeId \? undefined : 0"/)
  assert.match(dramaDetailSource, /:tabindex="episodeEmptyState.primaryDisabledReason \? 0 : undefined"/)
  assert.match(dramaDetailSource, /v-if="assetImageUrl\(item\)"[\s\S]*class="library-item-cover"/)
  assert.match(dramaDetailSource, /class="library-item-cover library-item-cover--empty"/)
  assert.match(dramaDetailSource, /class="drama-res-cover drama-res-cover--empty"/)
  assert.equal(dramaDetailSource.includes('class="library-item-cover" :disabled'), false)
  assert.equal(dramaDetailSource.includes('class="drama-res-cover" :disabled'), false)
  assert.match(dramaDetailHeaderSource, /id="drama-header-episode-reason"/)
  assert.match(dramaDetailHeaderSource, /:aria-describedby="currentEpisodeId \? undefined : 'drama-header-episode-reason'"/)
  assert.doesNotMatch(dramaDetailDialogsSource, /class="lib-img-thumb"[^>]*:disabled/)
  assert.match(dramaDetailDialogsSource, /class="lib-img-thumb lib-img-thumb--empty"/)
})



test('编辑弹窗无图缩略图禁用时给出中文原因', () => {
  assert.match(dramaDetailDialogsSource, /const previewTitle = computed\(\(\) => \(imageUrl\.value \? undefined : '暂无图片'\)\)/)
  assert.match(dramaDetailDialogsSource, /<DramaDetailResourceImageEditor\s+:form="editDramaCharForm"/)
  assert.match(dramaDetailDialogsSource, /<DramaDetailResourceImageEditor\s+:form="editPropForm"/)
})

test('focusSectionField puts keyboard focus on the source URL input', async () => {
  const { focusSectionField } = await import('../src/utils/sectionFocus.js')
  const focusCalls = []
  const input = {
    matches: (selector) => selector === 'input,textarea,select',
    focus: (options) => focusCalls.push(options),
  }
  const section = {
    querySelector: (selector) => selector === '[aria-label="网页 URL"]' ? input : null,
  }
  const documentRef = {
    getElementById: (id) => id === 'source-intake-workflow' ? section : null,
  }
  const windowRef = { setTimeout() {} }
  assert.equal(focusSectionField('source-intake-workflow', '[aria-label="网页 URL"]', { documentRef, windowRef }), true)
  assert.deepEqual(focusCalls, [{ preventScroll: true }])
})
