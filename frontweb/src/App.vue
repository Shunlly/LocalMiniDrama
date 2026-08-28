<template>
  <div class="app">
    <router-view v-slot="{ Component, route: matchedRoute }">
      <component :is="Component" :key="projectRouteInstanceKey(matchedRoute)" />
    </router-view>
    <div v-if="routeLoading"
      ref="routeLoadingRef"
      class="route-loading"
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      aria-modal="true"
      tabindex="-1"
      @click.stop
      @mousedown.stop
      @keydown="onRouteLoadingKeydown"
    >
      正在切换页面
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { projectRouteInstanceKey } from '@/utils/projectListRoute.js'
import { persistWorkspaceLocation } from '@/router/routeRestore.js'
import { createRouteLeaveProtection } from '@/layouts/routeLeaveProtection.js'
import { createRouteLoadingState } from '@/utils/routeLoadingState.js'

const router = useRouter()
const routeLoading = ref(false)
const routeLoadingRef = ref(null)
const routeLoadingState = createRouteLoadingState()
const navigationTokens = new WeakMap()
const leaveProtection = createRouteLeaveProtection()
provide('appRouteLeaveProtection', leaveProtection)
function handleAppUnload(event) {
  if (!leaveProtection.shouldBlockUnload()) return
  event.preventDefault()
  event.returnValue = ''
}
function syncRouteLoading() {
  routeLoading.value = routeLoadingState.loading
}
function onRouteLoadingKeydown(event) {
  if (event.key !== 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  routeLoadingRef.value?.focus({ preventScroll: true })
}
watch(routeLoading, (loading) => {
  if (!loading) return
  nextTick(() => {
    routeLoadingRef.value?.focus({ preventScroll: true })
  })
})
const removeBeforeEach = router.beforeEach((to) => {
  navigationTokens.set(to, routeLoadingState.begin())
  syncRouteLoading()
})
const removeAfterEach = router.afterEach((to) => {
  persistWorkspaceLocation(to)
  routeLoadingState.complete(navigationTokens.get(to))
  syncRouteLoading()
})
const removeOnError = router.onError((_error, to) => {
  routeLoadingState.complete(navigationTokens.get(to))
  syncRouteLoading()
})

onMounted(() => {
  window.addEventListener('beforeunload', handleAppUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleAppUnload)
  removeBeforeEach()
  removeAfterEach()
  removeOnError()
})
</script>

<style>
* {
  box-sizing: border-box;
}
html, body, #app, .app {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
  transition: background 0.25s, color 0.25s;
}
.route-loading {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bg-page) 72%, transparent);
  color: var(--text-primary);
  font-size: 14px;
  pointer-events: auto;
}
.route-loading:focus {
  outline: none;
}
.route-loading:focus-visible {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: -8px;
}
</style>
