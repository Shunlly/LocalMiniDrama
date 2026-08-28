/**
 * 本地操作生命周期日志。
 * 只记录开始 / 成功 / 失败 / 取消，不向远端上报，也不写入密钥或提示词正文。
 */

const MAX_RECORDS = 200
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|authorization|token|secret|password|cookie|prompt|raw_preview|output_json)/i

const records = []
let sink = null
let sequence = 0

function nowIso() {
  return new Date().toISOString()
}

export function createOperationId(prefix = 'op') {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

function sanitizeDetails(value, depth = 0) {
  if (value == null) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (depth >= 3 || typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeDetails(item, depth + 1))
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[已脱敏]' : sanitizeDetails(child, depth + 1)
  }
  return out
}

export function installOperationLogSink(nextSink) {
  const previous = sink
  sink = typeof nextSink === 'function' ? nextSink : null
  return () => {
    sink = previous
  }
}

export function resetOperationLogs() {
  records.length = 0
}

export function getOperationLogs() {
  return records.map((item) => ({ ...item }))
}

export function logOperation(event = {}) {
  const phase = String(event.phase || 'info')
  const record = {
    event: 'operation',
    ts: event.ts || nowIso(),
    operation: String(event.operation || 'unknown'),
    operationId: event.operationId || null,
    phase,
    status: event.status || phase,
    durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
    error: event.error ? String(event.error) : null,
  }
  const skip = new Set(['event', 'ts', 'operation', 'operationId', 'phase', 'status', 'durationMs', 'error'])
  const details = {}
  for (const [key, value] of Object.entries(event)) {
    if (skip.has(key) || value === undefined) continue
    details[key] = value
  }
  if (Object.keys(details).length) record.details = sanitizeDetails(details)

  records.push(record)
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
  sink?.(record)

  if (typeof window !== 'undefined' && Array.isArray(window.__LMD_OPERATION_LOGS__)) {
    window.__LMD_OPERATION_LOGS__.push(record)
  }

  const line = `[operation] ${JSON.stringify(record)}`
  if (typeof console !== 'undefined') {
    if (phase === 'error') console.warn(line)
    else console.info(line)
  }
  return record
}

function detailsFrom(extra = {}) {
  const details = { ...extra }
  delete details.event
  delete details.ts
  delete details.operation
  delete details.operationId
  delete details.phase
  delete details.status
  delete details.durationMs
  delete details.error
  return details
}

export async function runLoggedOperation(operation, execute, extra = {}) {
  if (typeof execute !== 'function') throw new TypeError('runLoggedOperation 需要可执行函数')
  const operationId = extra.operationId || createOperationId(operation)
  const startedAt = Date.now()
  const details = detailsFrom(extra)
  logOperation({ operation, operationId, phase: 'start', ...details })
  try {
    const result = await execute({ operationId })
    logOperation({
      operation,
      operationId,
      phase: 'success',
      status: 'success',
      durationMs: Date.now() - startedAt,
      ...details,
    })
    return result
  } catch (error) {
    const cancelled = extra.cancelled === true
      || error?.pipelineAborted === true
      || error?.name === 'AbortError'
      || /cancel|取消|停止/i.test(String(error?.message || ''))
    logOperation({
      operation,
      operationId,
      phase: cancelled ? 'cancel' : 'error',
      status: cancelled ? 'cancelled' : 'error',
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
      ...details,
    })
    throw error
  }
}
