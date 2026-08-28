const SNAPSHOT_ERROR = 'Canvas history snapshots must be JSON-compatible and acyclic.'

function snapshotError() {
  return new TypeError(SNAPSHOT_ERROR)
}

function cloneSnapshotValue(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    throw snapshotError()
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw snapshotError()

  const isArray = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (!isArray && prototype !== Object.prototype && prototype !== null) throw snapshotError()
  if (Object.getOwnPropertySymbols(value).length) throw snapshotError()

  ancestors.add(value)
  try {
    if (isArray) return value.map((entry) => cloneSnapshotValue(entry, ancestors))
    const copy = {}
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(copy, key, {
        value: cloneSnapshotValue(entry, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return copy
  } finally {
    ancestors.delete(value)
  }
}

function cloneSnapshot(value) {
  return cloneSnapshotValue(value, new WeakSet())
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
    const delta = timestamp - lastCommit?.timestamp
    const coalesced = isTextReason(reason)
      && lastCommit?.reason === reason
      && Number.isFinite(timestamp)
      && Number.isFinite(delta)
      && delta >= 0
      && delta <= coalesceMs
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
