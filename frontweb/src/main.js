import { createApp, defineAsyncComponent, h } from 'vue'
import './styles/theme.css'
// 初始化主题（必须在挂载前执行）
import './composables/useTheme.js'
import { createPinia } from 'pinia'
import { ElConfigProvider, createElementPlusProviderProps } from './elementPlus/register.js'
import App from './App.vue'
import router from './router'

// 弹窗壳子跟路由页一起按需加载，避免把 ElDialog 打进首屏。
const AccessibleDialog = defineAsyncComponent(() => import('./components/AccessibleDialog.vue'))

const app = createApp({
  name: 'RootProvider',
  render() {
    return h(
      ElConfigProvider,
      createElementPlusProviderProps(),
      () => h(App)
    )
  },
})
const pinia = createPinia()

app.component('AccessibleDialog', AccessibleDialog)
app.use(pinia)
app.use(router)
app.mount('#app')
