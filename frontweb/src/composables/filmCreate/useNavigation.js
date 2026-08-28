import { ref, onMounted, onBeforeUnmount } from 'vue'

const NAV_AUTO_COLLAPSE_WIDTH = 960
const NAV_STICKY_OFFSET = 96

export function pickActiveNavigationAnchor(entries, offset = NAV_STICKY_OFFSET) {
  const candidates = (entries || []).filter((entry) => entry?.id)
  const measured = candidates
    .filter((entry) => entry.top !== null && entry.top !== '' && Number.isFinite(Number(entry.top)))
    .map((entry) => ({ id: entry.id, top: Number(entry.top) }))
    .sort((left, right) => left.top - right.top)

  if (measured.length === 0) return candidates[0]?.id || ''

  let active = measured[0]
  for (const entry of measured) {
    if (entry.top > offset) break
    active = entry
  }
  return active.id
}

/**
 * 左侧导航折叠/展开逻辑
 */
export function useNavigation({ getAnchorIds = () => [] } = {}) {
  const initiallyNarrow = typeof window !== 'undefined' && window.innerWidth < NAV_AUTO_COLLAPSE_WIDTH
  const navCollapsed = ref(initiallyNarrow)
  const storyboardMenuExpanded = ref(false)
  const activeNavAnchor = ref('')
  let _navAutoCollapsed = initiallyNarrow
  let _scrollFrame = null

  function _syncNavCollapse() {
    const narrow = window.innerWidth < NAV_AUTO_COLLAPSE_WIDTH
    if (narrow && !_navAutoCollapsed && !navCollapsed.value) {
      _navAutoCollapsed = true
      navCollapsed.value = true
    } else if (!narrow && _navAutoCollapsed) {
      _navAutoCollapsed = false
      navCollapsed.value = false
    }
  }

  function _syncActiveNavigation() {
    _scrollFrame = null
    const anchorIds = [...new Set(getAnchorIds())]
    const entries = anchorIds.map((id) => {
      const element = document.getElementById(id)
      return { id, top: element?.getBoundingClientRect().top ?? Number.NaN }
    })
    const nextAnchor = pickActiveNavigationAnchor(entries, NAV_STICKY_OFFSET)
    if (nextAnchor) activeNavAnchor.value = nextAnchor
  }

  function _scheduleActiveNavigationSync() {
    if (_scrollFrame !== null) return
    _scrollFrame = window.requestAnimationFrame(_syncActiveNavigation)
  }

  function _handleResize() {
    _syncNavCollapse()
    _scheduleActiveNavigationSync()
  }

  function toggleNav() {
    navCollapsed.value = !navCollapsed.value
    _navAutoCollapsed = false
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function scrollToAnchor(id, activeId = id) {
    activeNavAnchor.value = activeId
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  onMounted(() => {
    _syncNavCollapse()
    _syncActiveNavigation()
    window.addEventListener('resize', _handleResize)
    window.addEventListener('scroll', _scheduleActiveNavigationSync, { passive: true })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', _handleResize)
    window.removeEventListener('scroll', _scheduleActiveNavigationSync)
    if (_scrollFrame !== null) {
      window.cancelAnimationFrame(_scrollFrame)
      _scrollFrame = null
    }
  })

  return {
    navCollapsed,
    storyboardMenuExpanded,
    activeNavAnchor,
    toggleNav,
    scrollToTop,
    scrollToAnchor,
  }
}
