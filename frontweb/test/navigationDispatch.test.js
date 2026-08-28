import test from 'node:test'
import assert from 'node:assert/strict'

import { APP_NAV_ITEMS } from '../src/router/views.js'
import { resolveAppNavigation } from '../src/router/navigation.js'
import { openWorkspaceNavItem, resolveWorkspaceNavItem } from '../src/layouts/AppWorkspaceNav.js'

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
