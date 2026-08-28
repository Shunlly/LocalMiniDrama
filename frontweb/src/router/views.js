/**
 * 应用视图注册表：路由名、是否允许打开、是否持久化、离开保护、主导航项。
 * 所有入口（菜单、深链接、刷新恢复、404）必须查这里，不能各写各的分支。
 */
export const APP_VIEW_DEFINITIONS = {
  list: {
    name: 'list',
    path: '/',
    title: '项目列表',
    allowed: true,
    persist: true,
    leaveProtection: true,
    resourceId: false,
    component: 'FilmList.vue',
  },
  'drama-detail': {
    name: 'drama-detail',
    path: '/drama/:id',
    title: '剧集管理',
    allowed: true,
    persist: true,
    leaveProtection: true,
    resourceId: true,
    component: 'DramaDetail.vue',
  },
  film: {
    name: 'film',
    path: '/film/:id',
    title: 'AI 视频生成',
    allowed: true,
    persist: true,
    leaveProtection: true,
    resourceId: true,
    component: 'FilmCreate.vue',
  },
  'film-canvas': {
    name: 'film-canvas',
    path: '/film/:id/canvas',
    title: '画布模式',
    allowed: true,
    persist: true,
    leaveProtection: true,
    resourceId: true,
    component: 'DramaCanvas.vue',
  },
  'ai-config': {
    name: 'ai-config',
    path: '/ai-config',
    title: 'AI 配置',
    allowed: true,
    persist: true,
    leaveProtection: true,
    resourceId: false,
    component: 'AiConfig.vue',
  },
  'free-create': {
    name: 'free-create',
    path: '/free-create',
    title: '自由创作',
    allowed: true,
    persist: true,
    leaveProtection: true,
    resourceId: false,
    component: 'FreeCreate.vue',
  },
  'media-library': {
    name: 'media-library',
    path: '/media-library',
    title: '素材中心',
    allowed: true,
    persist: true,
    leaveProtection: true,
    resourceId: false,
    component: 'MediaLibrary.vue',
  },
  backup: {
    name: 'backup',
    path: '/backup',
    title: '数据备份',
    allowed: true,
    persist: true,
    leaveProtection: false,
    resourceId: false,
    component: 'Backup.vue',
  },
  'not-found': {
    name: 'not-found',
    path: '/not-found',
    title: '页面不存在',
    allowed: true,
    persist: false,
    leaveProtection: false,
    resourceId: false,
    component: 'NotFound.vue',
  },
}

export const APP_NAV_ITEMS = [
  { id: 'list', view: 'list', label: '项目列表' },
  { id: 'media-library', view: 'media-library', label: '素材中心' },
  { id: 'free-create', view: 'free-create', label: '自由创作' },
  { id: 'ai-config', view: 'ai-config', label: 'AI 配置' },
  { id: 'backup', view: 'backup', label: '数据备份' },
]

export function getViewDefinition(name) {
  const key = String(name || '')
  return Object.prototype.hasOwnProperty.call(APP_VIEW_DEFINITIONS, key)
    ? APP_VIEW_DEFINITIONS[key]
    : null
}

export function isAllowedView(name) {
  return getViewDefinition(name)?.allowed === true
}

export function isPersistableView(name) {
  return getViewDefinition(name)?.persist === true
}

export function listAllowedViews() {
  return Object.values(APP_VIEW_DEFINITIONS).filter((view) => view.allowed)
}
