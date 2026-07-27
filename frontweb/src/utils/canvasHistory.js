function cloneSnapshot(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function snapshotsEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function finiteNonNegative(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function isTextReason(reason) {
  return typeof reason === 'string' && reason.startsWith('text:')
}

/**
 * Creates a bounded, snapshot-based history for serializable free-canvas state.
 */
export function createCanvasHistory(initial, options = {}) {
  const limit = positiveInteger(options.limit, 100)
  const coalesceMs = finiteNonNegative(options.coalesceMs, 600)
  const now = typeof options.now === 'function' ? options.now : Date.now
  let current = cloneSnapshot(initial)
  let past = []
  let future = []
  let lastCommit = null

  function present() {
    return cloneSnapshot(current)
  }

  function rememberCurrent() {
    past.push(cloneSnapshot(current))
    if (past.length > limit) past = past.slice(-limit)
  }

  function commit(next, reason = '') {
    const snapshot = cloneSnapshot(next)
    if (snapshotsEqual(current, snapshot)) return present()

    const timestamp = Number(now())
    const coalesced = isTextReason(reason)
      && lastCommit?.reason === reason
      && Number.isFinite(timestamp)
      && timestamp - lastCommit.timestamp <= coalesceMs
      && past.length > 0
    if (!coalesced) rememberCurrent()
    current = snapshot
    future = []
    lastCommit = {
      reason,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    }
    return present()
  }

  function undo() {
    if (!past.length) return present()
    future.unshift(cloneSnapshot(current))
    current = past.pop()
    lastCommit = null
    return present()
  }

  function redo() {
    if (!future.length) return present()
    rememberCurrent()
    current = future.shift()
    lastCommit = null
    return present()
  }

  function canUndo() {
    return past.length > 0
  }

  function canRedo() {
    return future.length > 0
  }

  function clear() {
    past = []
    future = []
    lastCommit = null
    return present()
  }

  return { present, commit, undo, redo, canUndo, canRedo, clear }
}
