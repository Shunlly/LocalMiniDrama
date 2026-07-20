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

function boxesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}

function layoutFixtureResponse(pathname) {
  if (pathname === '/api/v1/dramas/24') {
    return {
      id: 24,
      title: '769px layout fixture',
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
        title: 'Episode 1',
        script_content: '',
        storyboards: [],
      }],
    }
  }
  if (pathname === '/api/v1/settings/generation') return { concurrency: 3, video_concurrency: 3 }
  if (pathname === '/api/v1/workflows/novel2anime/readiness') {
    return { ready: false, missing_capabilities: [] }
  }
  if (pathname === '/api/v1/images' || pathname === '/api/v1/videos') return { items: [] }
  return []
}

test('desktop FilmCreate layout assertion rejects header overlap after expanding the 180px sidebar', async () => {
  const { assertFilmCreateDesktopLayout } = await import('../scripts/e2e-production.cjs')
  const locator = (box) => ({ boundingBox: async () => box })
  const selectors = {
    '.film-create > .header': { x: 180, y: 0, width: 589, height: 128 },
    '#film-create-quick-nav': { x: 0, y: 0, width: 180, height: 900 },
    '.film-create > .header .header-episode-select': { x: 208, y: 46, width: 209, height: 32 },
    '.film-create > .header .btn-back-drama': { x: 208, y: 86, width: 102, height: 32 },
    '.film-create > .header .btn-canvas-mode': { x: 318, y: 86, width: 102, height: 32 },
    '.film-create > .header .btn-theme': { x: 480, y: 86, width: 74, height: 32 },
    '.film-create > .header .btn-ai-config': { x: 562, y: 86, width: 87, height: 32 },
  }
  const requestedSelectors = []
  const page = {
    locator: (selector) => {
      requestedSelectors.push(selector)
      return locator(selectors[selector])
    },
    evaluate: async () => ({ scrollWidth: 769, clientWidth: 769 }),
  }

  await assert.doesNotReject(() => assertFilmCreateDesktopLayout(page, { width: 769, sidebarWidth: 180 }))
  assert.deepEqual(requestedSelectors, Object.keys(selectors))

  const overlappingSelectors = {
    ...selectors,
    '.film-create > .header .btn-back-drama': { x: 386, y: 46, width: 102, height: 32 },
  }
  const overlappingPage = {
    locator: (selector) => locator(overlappingSelectors[selector]),
    evaluate: async () => ({ scrollWidth: 799, clientWidth: 769 }),
  }
  await assert.rejects(
    () => assertFilmCreateDesktopLayout(overlappingPage, { width: 769, sidebarWidth: 180 }),
    /overlaps|horizontal overflow/,
  )
})

test('real FilmCreate layout is stable and collision-free at 769px with an expanded 180px sidebar', { timeout: 60_000 }, async (t) => {
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
  const page = await browser.newPage({ viewport: { width: 769, height: 720 } })
  await page.addInitScript(() => {
    window.__filmCreateClassHistory = []
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target.matches?.('.film-create')) {
          if (record.oldValue) window.__filmCreateClassHistory.push(record.oldValue)
          window.__filmCreateClassHistory.push(record.target.className)
        }
        for (const node of record.addedNodes || []) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const target = node.matches?.('.film-create') ? node : node.querySelector?.('.film-create')
          if (target) window.__filmCreateClassHistory.push(target.className)
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] })
  })
  await page.route('**/api/v1/**', async (route) => {
    const data = layoutFixtureResponse(new URL(route.request().url()).pathname)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    })
  })

  const baseUrl = vite.resolvedUrls.local[0]
  await page.goto(`${baseUrl}film/24?episode=4`, { waitUntil: 'domcontentloaded' })
  await page.locator('#film-create-quick-nav').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('#film-create-quick-nav')?.getBoundingClientRect().width === 48)
  const initialClassHistory = await page.evaluate(() => window.__filmCreateClassHistory)

  await page.locator('.nav-toggle').click()
  await page.waitForFunction(() => Math.round(document.querySelector('#film-create-quick-nav')?.getBoundingClientRect().width || 0) === 180)

  const selectors = [
    '.header-episode-select',
    '.btn-back-drama',
    '.btn-canvas-mode',
    '.btn-theme',
    '.btn-ai-config',
  ]
  const geometry = await page.evaluate((controlSelectors) => {
    const box = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
    }
    return {
      header: box('.film-create > .header'),
      controls: Object.fromEntries(controlSelectors.map((selector) => [selector, box(selector)])),
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
    }
  }, selectors)

  const issues = []
  if (initialClassHistory.some((className) => !String(className).includes('sidebar-collapsed'))) {
    issues.push(`initial expanded render: ${JSON.stringify(initialClassHistory)}`)
  }
  assert.ok(geometry.header, 'FilmCreate header must render')
  for (const selector of selectors) {
    const box = geometry.controls[selector]
    if (!box) {
      issues.push(`${selector} did not render`)
      continue
    }
    if (box.x < geometry.header.x || box.y < geometry.header.y
      || box.x + box.width > geometry.header.x + geometry.header.width
      || box.y + box.height > geometry.header.y + geometry.header.height) {
      issues.push(`${selector} is outside header: ${JSON.stringify(box)}`)
    }
    if (box.x < 0 || box.x + box.width > geometry.viewport.width) {
      issues.push(`${selector} is outside viewport: ${JSON.stringify(box)}`)
    }
  }
  for (let index = 0; index < selectors.length; index += 1) {
    for (let other = index + 1; other < selectors.length; other += 1) {
      const left = geometry.controls[selectors[index]]
      const right = geometry.controls[selectors[other]]
      if (left && right && boxesOverlap(left, right)) {
        issues.push(`${selectors[index]} overlaps ${selectors[other]}`)
      }
    }
  }
  if (geometry.scrollWidth > geometry.viewport.width) {
    issues.push(`horizontal overflow: ${geometry.scrollWidth} > ${geometry.viewport.width}`)
  }

  assert.deepEqual(issues, [], JSON.stringify({ initialClassHistory, geometry }, null, 2))
})
