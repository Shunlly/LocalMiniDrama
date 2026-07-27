function createProjectState() {
  return {
    pendingCount: 0,
    settlementWaiters: new Set(),
    navigationBarrier: null,
  }
}

export function createCanvasSaveCoordinator() {
  const projects = new Map()

  function getOrCreateProject(projectId) {
    let state = projects.get(projectId)
    if (!state) {
      state = createProjectState()
      projects.set(projectId, state)
    }
    return state
  }

  function releaseProjectIfIdle(projectId, state) {
    if (
      state.pendingCount === 0
      && state.settlementWaiters.size === 0
      && state.navigationBarrier === null
      && projects.get(projectId) === state
    ) {
      projects.delete(projectId)
    }
  }

  function begin(projectId) {
    const state = getOrCreateProject(projectId)
    state.pendingCount += 1
    let completed = false

    return function complete() {
      if (completed) return
      completed = true
      state.pendingCount -= 1

      if (state.pendingCount === 0) {
        const waiters = [...state.settlementWaiters]
        state.settlementWaiters.clear()
        for (const resolve of waiters) resolve()
      }

      releaseProjectIfIdle(projectId, state)
    }
  }

  function hasPending(projectId) {
    return (projects.get(projectId)?.pendingCount || 0) > 0
  }

  function waitForSettlement(projectId) {
    const state = projects.get(projectId)
    if (!state || state.pendingCount === 0) return Promise.resolve()

    return new Promise((resolve) => {
      state.settlementWaiters.add(resolve)
    })
  }

  function runNavigationBarrier(projectId, task) {
    const state = getOrCreateProject(projectId)
    if (state.navigationBarrier) return state.navigationBarrier

    const barrier = Promise.resolve().then(task)
    state.navigationBarrier = barrier
    barrier.then(
      () => {
        if (state.navigationBarrier === barrier) state.navigationBarrier = null
        releaseProjectIfIdle(projectId, state)
      },
      () => {
        if (state.navigationBarrier === barrier) state.navigationBarrier = null
        releaseProjectIfIdle(projectId, state)
      },
    )
    return barrier
  }

  return {
    begin,
    hasPending,
    waitForSettlement,
    runNavigationBarrier,
  }
}
