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
  assert.equal(await page.getByRole('button', { name: '返回上一页', exact: true }).count(), 0)

  await page.getByRole('button', { name: '项目列表', exact: true }).click()
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
  await page.getByRole('heading', { name: '还没有短剧项目' }).waitFor({ timeout: 20000 })
})

test('非法项目编号进入 404 后可回到项目列表', { timeout: 60_000 }, async (t) => {
  const baseUrl = await startFrontendVite(t)
  const page = await launchPage(t)
  await stubFrontendApis(page)

  await page.goto(`${baseUrl}film/abc`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '页面不存在', exact: true }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: '项目列表', exact: true }).click()
  await page.locator('.film-list').waitFor({ state: 'visible', timeout: 20000 })
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
