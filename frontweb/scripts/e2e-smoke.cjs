const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3013'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5679'

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/api/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    throw new Error(`API ${path} failed: ${res.status} ${JSON.stringify(body)}`)
  }
  return body.data
}

async function main() {
  const stamp = Date.now()
  const drama = await apiFetch('/dramas', {
    method: 'POST',
    body: JSON.stringify({
      title: `E2E Novel2Anime ${stamp}`,
      description: 'Browser smoke test drama',
      style: 'anime style',
      total_episodes: 1,
      metadata: { aspect_ratio: '16:9', e2e: true },
    }),
  })
  assert.ok(drama.id, 'created drama id is required')

  const source = await apiFetch(`/dramas/${drama.id}/story-sources`, {
    method: 'POST',
    body: JSON.stringify({
      title: `E2E Source ${stamp}`,
      source_type: 'storyboard',
      target_episode_count: 1,
      text: [
        'shot 1 Characters: Aria, Bo. Location: Gate. Aria finds a secret warning letter.',
        'shot 2 Because the guards arrive, Bo starts a fight and they escape.',
      ].join('\n'),
      metadata: { e2e: true },
    }),
  })
  assert.ok(source.source.id, 'created source id is required')

  const launchOptions = { headless: process.env.HEADED !== '1' }
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  } else if (process.env.PLAYWRIGHT_CHANNEL) {
    launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL
  } else if (process.platform === 'win32') {
    launchOptions.channel = 'msedge'
  }
  const browser = await chromium.launch(launchOptions)
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  try {
    await page.goto(`${FRONTEND_URL.replace(/\/$/, '')}/drama/${drama.id}`, { waitUntil: 'networkidle' })
    await page.getByText('故事素材流水线').waitFor({ timeout: 15000 })
    await page.getByText(`E2E Source ${stamp}`).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '启动流水线' }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'QA 审计' }).waitFor({ timeout: 15000 })
    await page.getByText('时间线摘要').waitFor({ timeout: 15000 })
    console.log(`E2E smoke passed for drama ${drama.id}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
