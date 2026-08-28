export async function runConcurrently(items, concurrency, fn, options = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length))
  const getLabel = options.getLabel || (() => null)
  const activeTasks = options.activeTasks
  let index = 0

  async function worker() {
    while (index < list.length) {
      const current = index
      index += 1
      const item = list[current]
      const label = getLabel(item, current)
      if (label && activeTasks) activeTasks.add(label)
      try {
        await fn(item, current)
      } finally {
        if (label && activeTasks) activeTasks.delete(label)
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker())
  const results = await Promise.allSettled(workers)
  const rejected = results.find((result) => result.status === 'rejected')
  if (rejected) throw rejected.reason
}
