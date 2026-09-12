import { ElConfigProvider } from 'element-plus/es/components/config-provider/index.mjs'
import zhCn from 'element-plus/es/locale/lang/zh-cn.mjs'
import 'element-plus/es/components/config-provider/style/css'

export function createElementPlusProviderProps() {
  return {
    locale: zhCn,
    message: {
      duration: 5000,
      showClose: true,
      offset: 28,
    },
  }
}

export { ElConfigProvider, zhCn }
