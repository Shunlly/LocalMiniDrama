import { runWithOwnedRequestErrorToast } from './request.js'

const PROJECT_INSTANCE_DISPOSED = 'PROJECT_INSTANCE_DISPOSED'

function disposedError() {
  const error = new Error('项目界面已切换。')
  error.name = 'ProjectInstanceDisposedError'
  error.code = PROJECT_INSTANCE_DISPOSED
  return error
}

export function isProjectInstanceDisposedError(error) {
  return error?.code === PROJECT_INSTANCE_DISPOSED
}

export function createProjectInstanceLifecycle() {
  let active = true
  const closeHandles = new Set()

  function retainCloseHandle(value) {
    try {
      if (value && typeof value.close === 'function') closeHandles.add(value)
    } catch {
      // A malformed third-party handle must not break project teardown.
    }
    return value
  }

  function assertActive() {
    if (!active) throw disposedError()
  }

  async function execute(operation) {
    assertActive()
    try {
      const result = await operation()
      assertActive()
      return result
    } catch (error) {
      if (!active) throw disposedError()
      throw error
    }
  }

  function run(operation) {
    if (!active || typeof operation !== 'function') return undefined
    return retainCloseHandle(operation())
  }

  function guardApi(api) {
    return new Proxy(api, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        return (...args) => execute(() => runWithOwnedRequestErrorToast(
          () => value.apply(target, args),
        ))
      },
    })
  }

  function guardNotifier(notifier) {
    return new Proxy(notifier, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        return (...args) => run(() => value.apply(target, args))
      },
    })
  }

  return {
    dispose() {
      if (!active) return
      active = false
      const handles = [...closeHandles]
      closeHandles.clear()
      for (const handle of handles) {
        try {
          handle.close()
        } catch {
          // Continue closing the remaining project-owned handles.
        }
      }
    },
    execute,
    guardApi,
    guardNotifier,
    isActive: () => active,
    run,
  }
}
