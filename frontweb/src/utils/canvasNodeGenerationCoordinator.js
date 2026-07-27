function abortReason(message) {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError')
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function createCanvasNodeGenerationCoordinator() {
  let sequence = 0
  let active = null

  function begin(info = {}) {
    if (active) return null
    const token = ++sequence
    const controller = new AbortController()
    active = { token, controller, info: { nodeId: info.nodeId || '', step: info.step || '' } }
    return {
      signal: controller.signal,
      abort(reason = abortReason('已停止等待，后台任务和计费可能继续')) {
        if (active?.token !== token) return false
        active = null
        controller.abort(reason)
        return true
      },
      finish() {
        if (active?.token === token) active = null
      },
    }
  }

  function stopWaiting(message = '已停止等待，后台任务和计费可能继续') {
    if (!active) return false
    const current = active
    active = null
    current.controller.abort(abortReason(message))
    return true
  }

  return {
    begin,
    hasActive: () => Boolean(active),
    getActiveInfo: () => (active ? { ...active.info } : null),
    stopWaiting,
  }
}
