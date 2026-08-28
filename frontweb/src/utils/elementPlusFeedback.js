import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'

if (import.meta.env) {
  import('element-plus/es/components/message/style/css')
  import('element-plus/es/components/message-box/style/css')
}

export { ElMessage, ElMessageBox }
