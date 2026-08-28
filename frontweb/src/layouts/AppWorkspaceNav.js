import { APP_NAV_ITEMS, isAllowedView } from '@/router/views.js'
import { dispatchAppNavigation, resolveAppNavigation } from '@/router/navigation.js'

export function listWorkspaceNavItems() {
  return APP_NAV_ITEMS.filter((item) => isAllowedView(item.view))
}

export function resolveWorkspaceNavItem(itemId, extras = {}) {
  const item = APP_NAV_ITEMS.find((entry) => entry.id === itemId)
  if (!item) {
    return resolveAppNavigation('not-found', {
      from: extras.from || '',
    })
  }
  return resolveAppNavigation(item.view, extras)
}

export function openWorkspaceNavItem(router, itemId, extras = {}) {
  const location = resolveWorkspaceNavItem(itemId, extras)
  if (!router) return location
  return extras.replace || location.replace
    ? router.replace(location)
    : router.push(location)
}

export { dispatchAppNavigation }
