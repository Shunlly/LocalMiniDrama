import {
  createTimeoutController,
  DEFAULT_JSON_TIMEOUT_MS,
  isRequestTimeout,
} from './requestError.js'

export function coreRequestError(status, message = 'PROJECT_LOAD_FAILED') {
  const error = new Error(message)
  error.status = Number(status) || 0
  return error
}

export async function requestCoreJson(path, {
  method = 'GET',
  body,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_JSON_TIMEOUT_MS,
  signal,
} = {}) {
  const timeout = createTimeoutController(timeoutMs, signal)
  let response
  try {
    response = await fetchImpl(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      signal: timeout.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (timeout.didTimeout() || isRequestTimeout(error)) throw coreRequestError(0)
    throw coreRequestError(0)
  } finally {
    timeout.dispose()
  }

  let payload = null
  try {
    payload = response.status === 204 ? null : await response.json()
  } catch (_) {
    throw coreRequestError(response.status)
  }
  if (!response.ok || payload?.success === false) throw coreRequestError(response.status)
  return payload?.data !== undefined ? payload.data : payload
}
