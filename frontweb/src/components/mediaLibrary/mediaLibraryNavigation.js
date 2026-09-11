/**
 * 素材中心返回导航。无 returnTo 回项目首页，有则回制作台；不要改这个产品契约。
 */
import { openWorkspaceNavItem as defaultOpenWorkspaceNavItem } from '@/layouts/AppWorkspaceNav.js'

export function createMediaLibraryNavigation(ctx = {}) {
  const router = ctx.router
  const returnTo = ctx.returnTo
  const openWorkspaceNavItem = ctx.openWorkspaceNavItem || defaultOpenWorkspaceNavItem

  function goHome() {
    openWorkspaceNavItem(router, 'list')
  }

  function goBack() {
    if (returnTo.value) router.push(returnTo.value)
    else openWorkspaceNavItem(router, 'list')
  }

  return { goHome, goBack }
}
