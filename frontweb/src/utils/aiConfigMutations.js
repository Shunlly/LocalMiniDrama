export async function runAiConfigCreateBatch(items, createOne) {
  const source = Array.isArray(items) ? [...items] : []
  let success = 0
  let failed = 0
  const created = []

  for (const item of source) {
    try {
      created.push(await createOne(item))
      success += 1
    } catch (_) {
      failed += 1
    }
  }

  return { success, failed, created }
}

const MASKED_SECRET = '********'

function normalizeModels(value) {
  const source = Array.isArray(value) ? value : (value == null ? [] : [value])
  return [...new Set(source.map((item) => String(item ?? '').trim()).filter(Boolean))]
}

function normalizeUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).toString().replace(/\/$/, '')
  } catch (_) {
    return raw.replace(/\/$/, '')
  }
}

function normalizeSnapshot(config = {}) {
  return {
    service_type: String(config.service_type ?? '').trim(),
    provider: String(config.provider ?? '').trim(),
    api_protocol: String(config.api_protocol ?? '').trim(),
    name: String(config.name ?? '').trim(),
    base_url: normalizeUrl(config.base_url),
    endpoint: String(config.endpoint ?? '').trim(),
    query_endpoint: String(config.query_endpoint ?? '').trim(),
    model: normalizeModels(config.model),
    default_model: String(config.default_model ?? '').trim() || null,
    priority: Number(config.priority ?? 0),
    is_default: Boolean(config.is_default),
  }
}

function expectedApiKeySet(payload = {}, previous = {}) {
  const apiKey = String(payload.api_key ?? '').trim()
  if (apiKey === MASKED_SECRET) return Boolean(previous.api_key_set ?? previous.credential_set)
  return Boolean(apiKey)
}

function sameSnapshot(left, right) {
  return JSON.stringify(normalizeSnapshot(left)) === JSON.stringify(normalizeSnapshot(right))
}

/**
 * 校验写接口返回的服务端快照，避免用本地表单状态冒充保存成功。
 */
export function confirmAiConfigMutationResult(result, payload, previous = {}) {
  const id = Number(result?.id)
  if (!Number.isInteger(id) || !result?.updated_at) return null
  if (!sameSnapshot(result, payload)) return null
  if (Boolean(result.api_key_set) !== expectedApiKeySet(payload, previous)) return null
  return {
    id,
    updated_at: String(result.updated_at),
    api_key_set: Boolean(result.api_key_set),
  }
}

/**
 * 校验刷新后的列表仍保留同一版本，能识别刷新竞态或随后发生的覆盖。
 */
export function confirmAiConfigMutationInList(confirmation, list) {
  if (!confirmation || !Array.isArray(list)) return false
  const row = list.find((item) => Number(item?.id) === confirmation.id)
  return Boolean(row)
    && String(row.updated_at || '') === confirmation.updated_at
    && Boolean(row.api_key_set) === confirmation.api_key_set
}

export function confirmAiConfigBulkKeyResult(result, list) {
  const confirmations = Array.isArray(result?.confirmations) ? result.confirmations : []
  if (Number(result?.updated) !== confirmations.length) return false
  if (!Array.isArray(list)) return false
  return confirmations.every((confirmation) => {
    const row = list.find((item) => Number(item?.id) === Number(confirmation?.id))
    return Boolean(row)
      && String(row.updated_at || '') === String(confirmation?.updated_at || '')
      && row.api_key_set === true
      && confirmation.api_key_set === true
  })
}

export function isAiConfigBulkKeyResult(result) {
  const confirmations = Array.isArray(result?.confirmations) ? result.confirmations : []
  return Number.isInteger(Number(result?.updated))
    && Number(result.updated) === confirmations.length
    && confirmations.every((confirmation) => (
      Number.isInteger(Number(confirmation?.id))
      && Boolean(confirmation?.updated_at)
      && confirmation.api_key_set === true
    ))
}
