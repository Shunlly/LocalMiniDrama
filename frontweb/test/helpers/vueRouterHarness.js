/**
 * 组件测试用的 vue-router 轻量桩：把 route / router 挂到 globalThis，供编译后的页面 setup 读取。
 */
import { dataModule } from './vueComponentHarness.js'

export function compileVueRouterStub() {
  return dataModule(`
    export function useRoute() {
      return globalThis.__vueRouterHarness.route
    }
    export function useRouter() {
      return globalThis.__vueRouterHarness.router
    }
    export function onBeforeRouteLeave(guard) {
      const harness = globalThis.__vueRouterHarness
      if (harness) harness.leaveGuards.push(guard)
    }
  `)
}

export function installVueRouterHarness(initial = {}) {
  const calls = []
  const harness = {
    calls,
    leaveGuards: [],
    route: {
      name: initial.name || '',
      fullPath: initial.fullPath || '/',
      query: { ...(initial.query || {}) },
      meta: { ...(initial.meta || {}) },
    },
    router: {
      options: {
        history: {
          state: { back: Object.prototype.hasOwnProperty.call(initial, 'back') ? initial.back : null },
        },
      },
      async replace(to) {
        calls.push(['replace', to])
      },
      async push(to) {
        calls.push(['push', to])
      },
      back() {
        calls.push(['back'])
      },
    },
  }
  globalThis.__vueRouterHarness = harness
  return harness
}

export function resetVueRouterHarness() {
  delete globalThis.__vueRouterHarness
}

export function ensureWindowShim() {
  if (!globalThis.window) {
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      confirm() { return true },
    }
    return
  }
  if (typeof globalThis.window.addEventListener !== 'function') {
    globalThis.window.addEventListener = () => {}
  }
  if (typeof globalThis.window.removeEventListener !== 'function') {
    globalThis.window.removeEventListener = () => {}
  }
  if (typeof globalThis.window.confirm !== 'function') {
    globalThis.window.confirm = () => true
  }
}
