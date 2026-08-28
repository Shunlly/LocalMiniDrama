import { createApp, h } from 'vue'
import './styles/theme.css'
// 初始化主题（必须在挂载前执行）
import './composables/useTheme.js'
import { createPinia } from 'pinia'
import { ElConfigProvider, createElementPlusProviderProps } from './elementPlus/register.js'
import App from './App.vue'
import AccessibleDialog from './components/AccessibleDialog.vue'
import router from './router'

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
