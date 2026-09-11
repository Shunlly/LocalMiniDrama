import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFilmListSources } from './helpers/filmListSources.js'

import { normalizeBackupReturnTo } from '../src/composables/useBackupSettings.js'
import {
  APP_NAV_ITEMS,
  isAllowedView,
  isPersistableView,
} from '../src/router/views.js'
import { resolveAppNavigation } from '../src/router/navigation.js'
import {
  persistWorkspaceLocation,
  restoreWorkspaceLocation,
} from '../src/router/routeRestore.js'
import { openWorkspaceNavItem, resolveWorkspaceNavItem } from '../src/layouts/AppWorkspaceNav.js'

const filmListSource = readFilmListSources().ui

test('workspace nav dispatches only registered views', () => {
  assert.deepEqual(
    APP_NAV_ITEMS.map((item) => resolveWorkspaceNavItem(item.id).name),
    APP_NAV_ITEMS.map((item) => item.view),
  )
  const backup = resolveAppNavigation('backup')
  assert.equal(backup.name, 'backup')
  const pushed = []
  const router = { push: (location) => pushed.push(location) }
  openWorkspaceNavItem(router, 'media-library')
  assert.equal(pushed[0].name, 'media-library')
})

test('project list backup entry dispatches the registered view with a safe returnTo', () => {
  const backupNav = APP_NAV_ITEMS.find((item) => item.id === 'backup')
  assert.equal(backupNav?.view, 'backup')
  assert.equal(backupNav?.label, '数据备份')
  assert.equal(isAllowedView('backup'), true)
  assert.equal(isPersistableView('backup'), true)

  assert.match(filmListSource, /v-if="backupNavItem"/)
  assert.match(filmListSource, /class="btn-library btn-backup"/)
  assert.match(filmListSource, /title="打开数据备份"/)
  assert.match(filmListSource, /aria-label="打开数据备份与维护"/)
  assert.match(filmListSource, /@click="goBackup"/)
  assert.match(filmListSource, /<el-icon><Download \/><\/el-icon>数据备份/)
  assert.match(filmListSource, /const backupNavItem = listWorkspaceNavItems\(\)\.find\(\(item\) => item\.id === 'backup'\) \|\| null/)
  assert.match(
    filmListSource,
    /function goBackup\(\) \{[\s\S]*normalizeBackupReturnTo\(projectListReturnTo\.value\) \|\| '\/'[\s\S]*openWorkspaceNavItem\(router, backupNavItem\.id, \{ query: \{ returnTo \} \}/,
  )
  assert.doesNotMatch(filmListSource, /微信我/)
  assert.doesNotMatch(filmListSource, /WeChat/i)

  const returnTo = normalizeBackupReturnTo('/?q=moon&status=draft') || '/'
  assert.equal(returnTo, '/')
  const location = resolveWorkspaceNavItem('backup', { query: { returnTo } })
  assert.equal(location.name, 'backup')
  assert.equal(location.query.returnTo, '/')

  const rejected = normalizeBackupReturnTo('https://evil.test/steal') || '/'
  assert.equal(rejected, '/')
  const pushed = []
  openWorkspaceNavItem({ push: (item) => pushed.push(item) }, 'backup', { query: { returnTo: rejected } })
  assert.equal(pushed[0].name, 'backup')
  assert.equal(pushed[0].query.returnTo, '/')
  assert.notEqual(pushed[0].query.returnTo, 'https://evil.test/steal')
})

test('backup deep link refresh restore keeps the registered view and safe returnTo', () => {
  const storage = new Map()
  const fakeStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value) },
  }
  const location = {
    name: 'backup',
    params: {},
    query: { returnTo: '/' },
    hash: '',
  }
  assert.equal(persistWorkspaceLocation(location, fakeStorage), true)
  const restored = restoreWorkspaceLocation(fakeStorage, (to) => {
    const safeReturnTo = normalizeBackupReturnTo(to.query?.returnTo)
    if (!Object.prototype.hasOwnProperty.call(to.query || {}, 'returnTo')) return null
    if (to.query.returnTo === safeReturnTo) return null
    const query = { ...to.query }
    if (safeReturnTo) query.returnTo = safeReturnTo
    else delete query.returnTo
    return { name: to.name, params: to.params || {}, query, hash: to.hash || '', replace: true }
  })
  assert.equal(restored.name, 'backup')
  assert.equal(restored.query.returnTo, '/')

  const unsafeLocation = {
    name: 'backup',
    params: {},
    query: { returnTo: '/film/12' },
    hash: '',
  }
  assert.equal(persistWorkspaceLocation(unsafeLocation, fakeStorage), true)
  const sanitized = restoreWorkspaceLocation(fakeStorage, (to) => {
    const safeReturnTo = normalizeBackupReturnTo(to.query?.returnTo)
    const query = { ...to.query }
    if (safeReturnTo) query.returnTo = safeReturnTo
    else delete query.returnTo
    return { name: to.name, params: to.params || {}, query, hash: to.hash || '', replace: true }
  })
  assert.equal(sanitized.name, 'backup')
  assert.equal(sanitized.query.returnTo, undefined)
  assert.notEqual(sanitized.query.returnTo, '/film/12')
})
