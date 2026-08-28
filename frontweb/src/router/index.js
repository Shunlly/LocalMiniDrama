import { createRouter, createWebHistory } from 'vue-router'
import { requireValidDramaId } from '@/utils/routeValidation'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import { createLocationSanitizer } from './navigation.js'
import { normalizeBackupReturnTo } from '@/composables/useBackupSettings.js'

export function normalizeAiConfigReturnTo(value) {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (typeof rawValue !== 'string') return ''
  const candidate = rawValue.trim()
  if (!candidate || candidate.length > 2048 || !candidate.startsWith('/') || /[\u0000-\u001f\u007f]/.test(candidate)) return ''

  try {
    const decodedPath = decodeURIComponent(candidate.split(/[?#]/, 1)[0])
    if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return ''
    const appOrigin = 'https://localminidrama.invalid'
    const parsed = new URL(candidate, appOrigin)
    if (parsed.origin !== appOrigin) return ''
    if (/^\/drama\/[1-9]\d*$/.test(parsed.pathname)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    }
    if (/^\/film\/[1-9]\d*$/.test(parsed.pathname)) {
      const query = new URLSearchParams()
      const episode = parsed.searchParams.get('episode')
      const focus = parsed.searchParams.get('focus')
      if (/^[1-9]\d*$/.test(episode || '')) query.set('episode', episode)
      if (/^[A-Za-z0-9:_-]{1,128}$/.test(focus || '')) query.set('focus', focus)
      const search = query.toString()
      return `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`
    }
    if (/^\/film\/[1-9]\d*\/canvas$/.test(parsed.pathname)) {
      const query = new URLSearchParams()
      const episode = parsed.searchParams.get('episode')
      const focus = parsed.searchParams.get('focus')
      if (/^[1-9]\d*$/.test(episode || '')) query.set('episode', episode)
      if (/^[A-Za-z0-9:_-]{1,128}$/.test(focus || '')) query.set('focus', focus)
      const search = query.toString()
      return `${parsed.pathname}${search ? `?${search}` : ''}`
    }
    if (parsed.pathname === '/free-create') {
      const mode = parsed.searchParams.get('mode')
      return mode === 'image' || mode === 'video'
        ? `/free-create?mode=${mode}`
        : '/free-create'
    }
    return ''
  } catch (_) {
    return ''
  }
}

export function normalizeMediaLibraryReturnTo(value) {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (typeof rawValue !== 'string') return ''
  const candidate = rawValue.trim()
  if (!candidate || candidate.length > 2048 || !candidate.startsWith('/') || /[\u0000-\u001f\u007f]/.test(candidate)) return ''

  try {
    const decodedPath = decodeURIComponent(candidate.split(/[?#]/, 1)[0])
    if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return ''
    const appOrigin = 'https://localminidrama.invalid'
    const parsed = new URL(candidate, appOrigin)
    const filmMatch = parsed.pathname.match(/^\/film\/[1-9]\d*(\/canvas)?$/)
    if (parsed.origin !== appOrigin || !filmMatch) return ''
    const episode = parsed.searchParams.get('episode')
    const query = new URLSearchParams()
    if (/^[1-9]\d*$/.test(episode || '')) query.set('episode', episode)
    if (filmMatch[1]) {
      const focus = parsed.searchParams.get('focus')
      if (/^[A-Za-z0-9:_-]{1,128}$/.test(focus || '')) query.set('focus', focus)
    }
    const search = query.toString()
    return `${parsed.pathname}${search ? `?${search}` : ''}`
  } catch (_) {
    return ''
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'list',
      component: () => import('@/views/FilmList.vue'),
      meta: { title: '项目列表' }
    },
    {
      path: '/drama/:id',
      name: 'drama-detail',
      component: () => import('@/views/DramaDetail.vue'),
      beforeEnter: requireValidDramaId,
      meta: { title: '剧集管理' }
    },
    {
      path: '/film/:id',
      name: 'film',
      component: () => import('@/views/FilmCreate.vue'),
      beforeEnter: requireValidDramaId,
      meta: { title: 'AI 视频生成' }
    },
    {
      path: '/film/:id/canvas',
      name: 'film-canvas',
      component: () => import('@/views/DramaCanvas.vue'),
      beforeEnter: requireValidDramaId,
      meta: { title: '画布模式' }
    },
    {
      path: '/ai-config',
      name: 'ai-config',
      component: () => import('@/views/AiConfig.vue'),
      meta: { title: 'AI 配置', normalizeReturnTo: normalizeAiConfigReturnTo }
    },
    {
      path: '/backup',
      name: 'backup',
      component: () => import('@/views/Backup.vue'),
      meta: { title: '数据备份', normalizeReturnTo: normalizeBackupReturnTo }
    },
    {
      path: '/settings',
      redirect: '/backup'
    },
    {
      path: '/free-create',
      name: 'free-create',
      component: () => import('@/views/FreeCreate.vue'),
      meta: { title: '自由创作' }
    },
    {
      path: '/media-library',
      name: 'media-library',
      component: () => import('@/views/MediaLibrary.vue'),
      meta: { title: '素材中心', normalizeReturnTo: normalizeMediaLibraryReturnTo }
    },
    {
      path: '/not-found',
      name: 'not-found',
      component: () => import('@/views/NotFound.vue'),
      meta: { title: '页面不存在' }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found-catchall',
      component: () => import('@/views/NotFound.vue'),
      meta: { title: '页面不存在' }
    }
  ]
})

const sanitizeAppLocation = createLocationSanitizer({
  normalizeProjectListReturnTo,
  normalizeAiConfigReturnTo,
  normalizeMediaLibraryReturnTo,
  normalizeBackupReturnTo,
})

router.beforeEach((to) => {
  if (['drama-detail', 'film', 'film-canvas'].includes(to.name) && Object.prototype.hasOwnProperty.call(to.query, 'returnTo')) {
    const rawReturnTo = Array.isArray(to.query.returnTo) ? to.query.returnTo[0] : to.query.returnTo
    const returnTo = normalizeProjectListReturnTo(to.query.returnTo)
    if (Array.isArray(to.query.returnTo) || returnTo !== rawReturnTo) {
      const query = { ...to.query }
      if (returnTo) query.returnTo = returnTo
      else delete query.returnTo
      return { name: to.name, params: to.params, query, hash: to.hash, replace: true }
    }
  }
  if (to.name === 'ai-config' && Object.prototype.hasOwnProperty.call(to.query, 'returnTo')) {
    const rawReturnTo = Array.isArray(to.query.returnTo) ? to.query.returnTo[0] : to.query.returnTo
    const returnTo = normalizeAiConfigReturnTo(to.query.returnTo)
    if (Array.isArray(to.query.returnTo) || returnTo !== rawReturnTo) {
      const query = { ...to.query }
      if (returnTo) query.returnTo = returnTo
      else delete query.returnTo
      return { name: 'ai-config', query, hash: to.hash, replace: true }
    }
  }
  if (to.name === 'media-library' && Object.prototype.hasOwnProperty.call(to.query, 'returnTo')) {
    const rawReturnTo = Array.isArray(to.query.returnTo) ? to.query.returnTo[0] : to.query.returnTo
    const returnTo = normalizeMediaLibraryReturnTo(to.query.returnTo)
    if (Array.isArray(to.query.returnTo) || returnTo !== rawReturnTo) {
      const query = { ...to.query }
      if (returnTo) query.returnTo = returnTo
      else delete query.returnTo
      return { name: 'media-library', query, hash: to.hash, replace: true }
    }
  }
  if (to.name === 'backup' && Object.prototype.hasOwnProperty.call(to.query, 'returnTo')) {
    const rawReturnTo = Array.isArray(to.query.returnTo) ? to.query.returnTo[0] : to.query.returnTo
    const returnTo = normalizeBackupReturnTo(to.query.returnTo)
    if (Array.isArray(to.query.returnTo) || returnTo !== rawReturnTo) {
      const query = { ...to.query }
      if (returnTo) query.returnTo = returnTo
      else delete query.returnTo
      return { name: 'backup', query, hash: to.hash, replace: true }
    }
  }
  const redirected = sanitizeAppLocation(to)
  if (redirected) return redirected
  if (to.meta.title) {
    document.title = `${to.meta.title} - LocalMiniDrama`
  }
  return true
})

export default router
