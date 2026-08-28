/**
 * 非制作页共用的离开保护分发点。页面通过 register 挂上自动保存 / 确认离开。
 * App.vue 的 beforeunload 走这里，避免只在某个入口写死。
 */
export function createRouteLeaveProtection() {
  const handlers = new Map()
  let pendingConfirm = null

  async function runConfirm() {
    for (const handler of handlers.values()) {
      if (typeof handler.flushAutoSave === 'function') {
        await handler.flushAutoSave()
      }
    }
    for (const handler of handlers.values()) {
      if (typeof handler.confirmLeave !== 'function') continue
      if (await handler.confirmLeave() === false) return false
    }
    return true
  }

  return {
    register(id, handler) {
      const key = String(id || '')
      const record = handler && typeof handler === 'object' ? handler : {}
      if (!key) return () => {}
      handlers.set(key, record)
      return () => {
        if (handlers.get(key) === record) handlers.delete(key)
      }
    },
    shouldBlockUnload() {
      for (const handler of handlers.values()) {
        if (handler.shouldBlockUnload?.() === true) return true
      }
      return false
    },
    confirmLeave() {
      if (!pendingConfirm) {
        pendingConfirm = runConfirm().finally(() => {
          pendingConfirm = null
        })
      }
      return pendingConfirm
    },
  }
}
