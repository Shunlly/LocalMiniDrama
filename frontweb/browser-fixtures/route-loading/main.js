import { createApp, h } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from '../../src/App.vue'

const Surface = {
  setup() {
    return () => h('main', [
      h('button', {
        id: 'underlay-action',
        type: 'button',
        onClick: () => { window.__underlayClicks += 1 },
      }, 'Underlying action'),
    ])
  },
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Surface },
    { path: '/hold', name: 'hold', component: Surface },
    { path: '/redirect', name: 'redirect-source', component: Surface },
  ],
})

await router.push('/')
await router.isReady()
createApp(App).use(router).mount('#app')

const pending = new Map()
const results = []
window.__underlayClicks = 0

router.beforeEach((to) => {
  if (to.name === 'redirect-source') {
    return { name: 'hold', query: { key: 'redirect-leg' } }
  }
  if (to.name !== 'hold') return true
  const key = String(to.query.key || '')
  return new Promise((resolve, reject) => {
    pending.set(key, { resolve, reject })
  })
})

window.routeHarness = {
  navigate(label, target) {
    void router.push(target)
      .then((failure) => results.push({ label, result: failure ? 'failure' : 'success' }))
      .catch((error) => results.push({ label, result: 'error', message: error.message }))
  },
  release(key, outcome) {
    const control = pending.get(key)
    if (!control) throw new Error(`Missing pending navigation: ${key}`)
    pending.delete(key)
    if (outcome === 'error') control.reject(new Error(`route error: ${key}`))
    else control.resolve(outcome === 'abort' ? false : true)
  },
  pendingKeys() {
    return [...pending.keys()]
  },
  results,
}
