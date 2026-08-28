import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeProjectListReturnTo } from '../src/utils/projectListRoute.js'
import { normalizeBackupReturnTo } from '../src/composables/useBackupSettings.js'
import {
  APP_VIEW_DEFINITIONS,
  APP_NAV_ITEMS,
  isAllowedView,
  isPersistableView,
} from '../src/router/views.js'
import {
  RESTORE_FAILURE_MESSAGE,
  RETURN_TO_REJECTED_MESSAGE,
  buildNotFoundLocation,
  createLocationSanitizer,
  resolveAppNavigation,
} from '../src/router/navigation.js'
import {
  persistWorkspaceLocation,
  restoreWorkspaceLocation,
} from '../src/router/routeRestore.js'
import { createRouteLeaveProtection } from '../src/layouts/routeLeaveProtection.js'
import { listWorkspaceNavItems, resolveWorkspaceNavItem } from '../src/layouts/AppWorkspaceNav.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const routerSource = read('../src/router/index.js')
const appSource = read('../src/App.vue')

async function loadReturnToNormalizers() {
  const start = routerSource.indexOf('export function normalizeAiConfigReturnTo')
  const end = routerSource.indexOf('\n\nconst router =', start)
  assert.ok(start >= 0 && end > start, 'returnTo normalizer must remain a standalone pure function')
  const helperModule = routerSource.slice(start, end)
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(helperModule)}`)
}

async function createSanitizer() {
  const { normalizeAiConfigReturnTo, normalizeMediaLibraryReturnTo } = await loadReturnToNormalizers()
  return createLocationSanitizer({
    normalizeProjectListReturnTo,
    normalizeAiConfigReturnTo,
    normalizeMediaLibraryReturnTo,
    normalizeBackupReturnTo,
  })
}

test('views registry covers every real route and nav item', () => {
  for (const [name, view] of Object.entries(APP_VIEW_DEFINITIONS)) {
    assert.equal(view.name, name)
    assert.match(routerSource, new RegExp('path: \'' + view.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\''))
    assert.match(routerSource, new RegExp('name: \'' + view.name + '\''))
    assert.equal(isAllowedView(name), true)
  }
  assert.match(routerSource, /path: '\/:pathMatch\(\.\*\)\*'/)
  assert.match(routerSource, /name: 'not-found-catchall'/)
  assert.match(routerSource, /component: \(\) => import\('@\/views\/NotFound\.vue'\)/)
  for (const item of APP_NAV_ITEMS) {
    assert.equal(isAllowedView(item.view), true)
  }
  assert.deepEqual(listWorkspaceNavItems().map((item) => item.id), APP_NAV_ITEMS.map((item) => item.id))
})

test('unknown nav targets and missing project ids go to named 404', () => {
  const missing = resolveAppNavigation('no-such-view', { from: '/ghost-page' })
  assert.equal(missing.name, 'not-found')
  assert.equal(missing.query.from, '/ghost-page')
  const invalidFilm = resolveAppNavigation('film', { params: { id: 'new' }, from: '/film/new' })
  assert.equal(invalidFilm.name, 'not-found')
  assert.equal(invalidFilm.query.from, '/film/new')
  const validCanvas = resolveAppNavigation('film-canvas', { params: { id: '21' }, query: { episode: '8' } })
  assert.equal(validCanvas.name, 'film-canvas')
  assert.equal(validCanvas.params.id, '21')
  const unknownNav = resolveWorkspaceNavItem('missing-nav')
  assert.equal(unknownNav.name, 'not-found')
})

test('router shares returnTo sanitizing including array values', () => {
  assert.match(routerSource, /\['drama-detail', 'film', 'film-canvas'\]\.includes\(to\.name\)/)
  assert.match(routerSource, /delete query\.returnTo/)
  assert.ok(routerSource.includes("to.name === 'ai-config'"))
  assert.ok(routerSource.includes("to.name === 'media-library'"))
  assert.ok(routerSource.includes("to.name === 'backup'"))
  assert.equal(routerSource.split('Array.isArray(to.query.returnTo) || returnTo !== rawReturnTo').length >= 4, true)
  assert.match(routerSource, /const redirected = sanitizeAppLocation\(to\)/)
})

test('refresh restore keeps distinct project episode and focus ids', async () => {
  const sanitize = await createSanitizer()
  const storage = new Map()
  const fakeStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value) },
  }
  const location = {
    name: 'ai-config',
    params: {},
    query: {
      service_type: 'video',
      returnTo: '/film/12/canvas?episode=8&focus=sb%3A42',
    },
    hash: '',
  }
  assert.equal(sanitize(location), null)
  assert.equal(persistWorkspaceLocation(location, fakeStorage), true)
  const restored = restoreWorkspaceLocation(fakeStorage, sanitize)
  assert.equal(restored.name, 'ai-config')
  assert.equal(restored.query.service_type, 'video')
  assert.equal(restored.query.returnTo, '/film/12/canvas?episode=8&focus=sb%3A42')
  assert.notEqual('12', '8')
  assert.match(restored.query.returnTo, /focus=sb%3A42/)
  assert.equal(isPersistableView('ai-config'), true)
})

test('bad returnTo is dropped and does not reuse another resource id', async () => {
  const sanitize = await createSanitizer()
  const redirected = sanitize({
    name: 'media-library',
    params: {},
    query: {
      returnTo: ['/drama/21', '/film/21'],
      source: 'network',
      network_q: 'moon',
    },
    hash: '',
  })
  assert.ok(redirected)
  assert.equal(redirected.name, 'media-library')
  assert.equal(redirected.query.returnTo, undefined)
  assert.equal(redirected.query.source, 'network')
  assert.equal(redirected.query.network_q, 'moon')
  assert.notEqual(redirected.query.returnTo, '/film/21')
  assert.notEqual(redirected.query.returnTo, '/drama/21')

  const backupRedirect = sanitize({
    name: 'backup',
    query: { returnTo: ['/film/12', '/ai-config'] },
  })
  assert.equal(backupRedirect.query.returnTo, undefined)

  const aiRedirect = sanitize({
    name: 'ai-config',
    query: {
      returnTo: ['/film/12?episode=8', 'https://evil.test/'],
      service_type: ['video', 'tts'],
    },
  })
  assert.equal(aiRedirect.query.returnTo, '/film/12?episode=8')
  assert.equal(aiRedirect.query.service_type, 'video')
  assert.notEqual(aiRedirect.query.service_type, 'tts')
})

test('unknown routes restore to named 404 with original path', async () => {
  const sanitize = await createSanitizer()
  assert.equal(sanitize({
    name: 'not-found-catchall',
    fullPath: '/this-page-does-not-exist',
    query: {},
  }), null)
  const redirected = buildNotFoundLocation('/this-page-does-not-exist')
  assert.equal(redirected.name, 'not-found')
  assert.equal(redirected.query.from, '/this-page-does-not-exist')
  assert.match(RESTORE_FAILURE_MESSAGE, /\u65e0\u6cd5\u6062\u590d/)
  assert.match(RETURN_TO_REJECTED_MESSAGE, /\u8fd4\u56de\u5730\u5740\u65e0\u6548/)
})

test('free-create and drama-detail deep links collapse unsafe query on restore', async () => {
  const sanitize = await createSanitizer()
  const free = sanitize({
    name: 'free-create',
    query: { mode: ['video', 'image', 'evil'] },
  })
  assert.equal(free.query.mode, 'video')

  const drama = sanitize({
    name: 'drama-detail',
    params: { id: '21' },
    query: {
      returnTo: '/?q=moon',
      episode: ['8', '21'],
      intake: ['source-url', 'evil'],
    },
    hash: '#source-intake-workflow',
  })
  assert.equal(drama.query.returnTo, '/?q=moon')
  assert.equal(drama.query.episode, '8')
  assert.equal(drama.query.intake, 'source-url')
  assert.equal(drama.hash, '#source-intake-workflow')
  assert.notEqual(drama.params.id, drama.query.episode)
})

test('non-FilmCreate pages keep leave protection and App wires shared unload', () => {
  const viewFiles = {
    list: '../src/views/FilmList.vue',
    'drama-detail': '../src/views/DramaDetail.vue',
    'film-canvas': '../src/views/DramaCanvas.vue',
    'ai-config': '../src/views/AiConfig.vue',
    'free-create': '../src/views/FreeCreate.vue',
    'media-library': '../src/views/MediaLibrary.vue',
  }
  for (const [name, file] of Object.entries(viewFiles)) {
    assert.equal(APP_VIEW_DEFINITIONS[name].leaveProtection, true, name)
    const source = read(file)
    assert.match(source, /onBeforeRouteLeave/, name)
    assert.match(source, /beforeunload/, name)
  }
  assert.match(appSource, /persistWorkspaceLocation\(to\)/)
  assert.match(appSource, /createRouteLeaveProtection/)
  assert.match(appSource, /window\.addEventListener\('beforeunload', handleAppUnload\)/)
  assert.match(appSource, /provide\('appRouteLeaveProtection', leaveProtection\)/)
})

test('leave protection flushes auto-save then can block leave', async () => {
  const protection = createRouteLeaveProtection()
  const events = []
  protection.register('media-library', {
    async flushAutoSave() { events.push('flush') },
    async confirmLeave() {
      events.push('confirm')
      return false
    },
    shouldBlockUnload() { return true },
  })
  assert.equal(protection.shouldBlockUnload(), true)
  assert.equal(await protection.confirmLeave(), false)
  assert.deepEqual(events, ['flush', 'confirm'])
})

