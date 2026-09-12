import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
import {
  createMessageBoxFocusSession,
  queryOpenMessageBoxes,
} from './dialogAccessibility.js'

if (import.meta.env) {
  import('element-plus/es/components/message/style/css')
  import('element-plus/es/components/message-box/style/css')
}

const MESSAGE_BOX_METHODS = ['alert', 'confirm', 'prompt']
const INSTALLED = Symbol('messageBoxAccessibility')

function whenSettled(result, onSettle) {
  const settle = () => {
    try {
      onSettle()
    } catch (_) {
      // 确认框已经关掉后，焦点恢复失败不能把确认/取消结果改写成异常。
    }
  }
  if (result && typeof result.finally === 'function') {
    return result.finally(settle)
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(settle)
  }
  settle()
  return result
}

function runWithMessageBoxAccessibility(invoke) {
  const document = globalThis.document
  const opener = document?.activeElement || null
  const knownElements = queryOpenMessageBoxes(document)
  const result = invoke()
  const session = createMessageBoxFocusSession({
    document,
    opener,
    knownElements,
  })
  return whenSettled(result, () => session.dispose())
}

function wrapMessageBoxMethod(box, methodName) {
  // 用 getter/setter 包装，测试仍可直接赋值 ElMessageBox.confirm 替换实现。
  const native = box[methodName]
  if (typeof native !== 'function') return

  let impl = native
  function wrapped(message, title, options, appContext, ...rest) {
    return runWithMessageBoxAccessibility(() => (
      impl.call(this ?? box, message, title, options, appContext, ...rest)
    ))
  }
  try {
    Object.defineProperty(wrapped, 'name', { value: methodName })
  } catch {
    // 部分运行时不允许改写函数名，不影响包装行为。
  }

  const enumerable = Object.getOwnPropertyDescriptor(box, methodName)?.enumerable ?? true
  try {
    Object.defineProperty(box, methodName, {
      configurable: true,
      enumerable,
      get() {
        return wrapped
      },
      set(value) {
        if (value === wrapped) {
          impl = native
          return
        }
        impl = typeof value === 'function' ? value : native
      },
    })
  } catch {
    box[methodName] = wrapped
  }
}

export function installMessageBoxAccessibility(box = ElMessageBox) {
  if (!box || box[INSTALLED]) return box
  box[INSTALLED] = true
  for (const methodName of MESSAGE_BOX_METHODS) {
    wrapMessageBoxMethod(box, methodName)
  }
  return box
}

installMessageBoxAccessibility(ElMessageBox)

export { ElMessage, ElMessageBox }
