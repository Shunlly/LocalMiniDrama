import test from 'node:test'
import assert from 'node:assert/strict'

import {
  launchPage,
  startFrontendVite,
  stubFrontendApis,
  fulfillApi,
} from './browserHarness.js'

test('未知地址的 404 页焦点落在标题，项目列表按钮回到首页', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page)

  await page.goto(`${baseUrl}this-page-does-not-exist`, { waitUntil: 'domcontentloaded' })
  const title = page.getByRole('heading', { name: '页面不存在', exact: true })
  await title.waitFor({ timeout: 20000 })
  await page.waitForFunction(() => document.activeElement?.id === 'not-found-title', null, { timeout: 10000 })
  assert.match(page.url(), /\/not-found(?:\?|$)/)
  assert.equal(await page.locator('#not-found-reason').innerText(), '无法打开地址 /this-page-does-not-exist。这个地址不在应用里，可能是旧链接或输入错误。')
  assert.equal(await page.locator('#not-found-next-step').innerText(), '可以回到项目列表继续制作。')
  assert.equal(await page.getByRole('button', { name: '返回上一页', exact: true }).count(), 0)

  await page.locator('.not-found-page').getByRole('button', { name: '返回项目列表', exact: true }).click()
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
  await page.getByRole('heading', { name: '还没有短剧项目' }).waitFor({ timeout: 20000 })
})

test('非法项目编号进入 404 后可回到项目列表', { timeout: 90_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page)

  const cases = [
    {
      path: 'film/abc',
      reason: '无法打开地址 /film/abc。制作页深链接已失效，项目编号不正确，无法进入制作。',
      nextStep: '下一步：回到项目列表，从项目卡片重新打开制作页。',
      from: '/film/abc',
    },
    {
      path: 'drama/0',
      reason: '无法打开地址 /drama/0。项目详情深链接已失效，项目编号不正确，无法打开剧集管理。',
      nextStep: '下一步：回到项目列表，从项目卡片重新进入详情。',
      from: '/drama/0',
    },
    {
      path: 'film/abc/canvas',
      reason: '无法打开地址 /film/abc/canvas。画布深链接已失效，项目编号不正确，无法打开剧集画布。',
      nextStep: '下一步：回到项目列表，打开有效项目后再进入画布。',
      from: '/film/abc/canvas',
    },
  ]
  for (const item of cases) {
    await page.goto(`${baseUrl}${item.path}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '页面不存在', exact: true }).waitFor({ timeout: 20000 })
    const current = new URL(page.url())
    assert.equal(current.pathname, '/not-found')
    assert.equal(current.searchParams.get('from'), item.from)
    assert.equal(await page.locator('#not-found-reason').innerText(), item.reason)
    assert.equal(await page.locator('#not-found-next-step').innerText(), item.nextStep)
    const home = page.locator('.not-found-page').getByRole('button', { name: '返回项目列表', exact: true })
    await home.click()
    await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
  }
})

test('站内跳到未知路由后，404 页返回上一页回到项目列表', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page)

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
  await page.evaluate(async () => {
    const { default: router } = await import('/src/router/index.js')
    await router.push('/missing-internal-page')
  })
  await page.getByRole('heading', { name: '页面不存在', exact: true }).waitFor({ timeout: 20000 })
  assert.match(page.url(), /\/not-found/)
  assert.match(await page.locator('#not-found-reason').innerText(), /这个地址不在应用里/)
  await page.getByRole('button', { name: '返回上一页', exact: true }).click()
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
})

test('制作页遇到不存在的项目时返回项目列表', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page, {
    'GET /api/v1/dramas/4041': async (route) => {
      await fulfillApi(route, {
        status: 404,
        error: { code: 'NOT_FOUND', message: '该项目不存在，或已移入回收站。' },
      })
    },
  })

  await page.goto(`${baseUrl}film/4041`, { waitUntil: 'domcontentloaded' })
  const heading = page.getByRole('heading', { name: '制作项目不存在', exact: true })
  await heading.waitFor({ timeout: 30000 })
  const focusedInAlert = await page.evaluate(() => (
    Boolean(document.activeElement?.closest('.project-load-state--error'))
  ))
  assert.equal(focusedInAlert, true, '项目不存在时焦点必须落在失败提示')
  await page.locator('.project-load-state--error').getByRole('button', { name: '返回项目列表' }).click()
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
})

test('旧 /media 深链接进入素材中心', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page)

  await page.goto(`${baseUrl}media`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname === '/media-library', { timeout: 20000 })
  await page.getByRole('heading', { name: '素材中心', exact: true }).waitFor({ timeout: 20000 })
})

test('刷新后仍能进入制作、画布和 AI 配置', { timeout: 90_000 }, async (t) => {
  const projectId = 7
  const episodeId = 4
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t, { viewport: { width: 1280, height: 900 } })
  await stubFrontendApis(page, {
    [`GET /api/v1/dramas/${projectId}`]: async (route) => {
      await fulfillApi(route, {
        data: {
          id: projectId,
          title: '月光基地',
          description: '刷新恢复夹具',
          genre: 'drama',
          style: 'realistic',
          metadata: { aspect_ratio: '16:9' },
          characters: [],
          scenes: [],
          props: [],
          episodes: [{
            id: episodeId,
            episode_number: 1,
            title: '第 1 集',
            script_content: 'Aria finds a letter at the gate.',
            characters: [],
            scenes: [],
            storyboards: [],
          }],
        },
      })
    },
  })

  await page.goto(`${baseUrl}film/${projectId}?episode=${episodeId}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '返回剧集', exact: true }).waitFor({ timeout: 30000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname === `/film/${projectId}`, { timeout: 20000 })
  await page.getByRole('button', { name: '返回剧集', exact: true }).waitFor({ timeout: 30000 })

  await page.goto(`${baseUrl}film/${projectId}/canvas?episode=${episodeId}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '返回列表模式', exact: true }).waitFor({ timeout: 30000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname === `/film/${projectId}/canvas`, { timeout: 20000 })
  await page.getByRole('button', { name: '返回列表模式', exact: true }).waitFor({ timeout: 30000 })

  await page.goto(`${baseUrl}ai-config`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'AI 配置', exact: true }).waitFor({ timeout: 30000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname === '/ai-config', { timeout: 20000 })
  await page.getByRole('heading', { name: 'AI 配置', exact: true }).waitFor({ timeout: 30000 })
})
