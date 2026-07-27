<template>
  <div class="app">
    <router-view v-slot="{ Component, route: matchedRoute }">
      <component :is="Component" :key="projectRouteInstanceKey(matchedRoute)" />
    </router-view>
    <div v-if="routeLoading" class="route-loading" role="status" aria-live="assertive" aria-atomic="true" @click.stop @mousedown.stop>
      正在切换页面
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { projectRouteInstanceKey } from '@/utils/projectListRoute.js'
import { createRouteLoadingState } from '@/utils/routeLoadingState.js'

const router = useRouter()
const routeLoading = ref(false)
const routeLoadingState = createRouteLoadingState()
const navigationTokens = new WeakMap()
function syncRouteLoading() {
  routeLoading.value = routeLoadingState.loading
}
const removeBeforeEach = router.beforeEach((to) => {
  navigationTokens.set(to, routeLoadingState.begin())
  syncRouteLoading()
})
const removeAfterEach = router.afterEach((to) => {
  routeLoadingState.complete(navigationTokens.get(to))
  syncRouteLoading()
})
const removeOnError = router.onError((_error, to) => {
  routeLoadingState.complete(navigationTokens.get(to))
  syncRouteLoading()
})

onBeforeUnmount(() => {
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
</style>
