/**
 * AI 配置变更总线：同页用 window 自定义事件，多标签用 BroadcastChannel。
 * 只广播无密钥的元数据，供已打开的制作页/画布页刷新能力缓存。
 */

export const AI_CONFIG_CHANGED_EVENT = 'localminidrama:ai-config-changed'
export const AI_CONFIG_CHANGED_CHANNEL = 'localminidrama-ai-config'

const ALLOWED_ACTIONS = new Set([
  'changed',
  'save',
  'create',
  'delete',
  'set-default',
  'import',
  'preset',
  'bulk-key',
])

const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|authorization|credential|private)/i
const localBus = new EventTarget()
let sharedChannel = null
let channelUnavailable = false

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getSameContextTarget() {
  const candidate = typeof window !== 'undefined' ? window : null
  if (
    candidate
    && typeof candidate.addEventListener === 'function'
    && typeof candidate.removeEventListener === 'function'
    && typeof candidate.dispatchEvent === 'function'
  ) {
    return candidate
  }
  return localBus
}

function getSharedChannel() {
  if (sharedChannel) return sharedChannel
  if (channelUnavailable) return null
  if (typeof BroadcastChannel !== 'function') {
    channelUnavailable = true
    return null
  }
  try {
    sharedChannel = new BroadcastChannel(AI_CONFIG_CHANGED_CHANNEL)
    if (typeof sharedChannel.unref === 'function') sharedChannel.unref()
    return sharedChannel
  } catch (_) {
    channelUnavailable = true
    return null
  }
}

export function sanitizeAiConfigChangeDetail(input) {
  const src = isPlainObject(input) ? input : {}
  const detail = {
    action: ALLOWED_ACTIONS.has(src.action) ? src.action : 'changed',
    serviceType: typeof src.serviceType === 'string' ? src.serviceType : '',
    configId: src.configId == null || src.configId === '' ? '' : String(src.configId),
  }
  if (typeof src.isDefault === 'boolean') detail.isDefault = src.isDefault
  for (const key of Object.keys(detail)) {
    if (SECRET_KEY_PATTERN.test(key)) delete detail[key]
  }
  return detail
}

function notifyHandler(handler, payload) {
  try {
    const result = handler(payload)
    if (result && typeof result.then === 'function') result.catch(() => {})
  } catch (_) {
    // 单个订阅者失败不应阻断其他页面刷新。
  }
}

export function publishAiConfigChanged(input) {
  const payload = sanitizeAiConfigChangeDetail(input)
  try {
    getSameContextTarget().dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT, { detail: payload }))
  } catch (_) {}
  try {
    getSharedChannel()?.postMessage(payload)
  } catch (_) {}
  return payload
}

export function subscribeAiConfigChanged(handler) {
  if (typeof handler !== 'function') return () => {}
  const target = getSameContextTarget()
  const onLocal = (event) => {
    notifyHandler(handler, sanitizeAiConfigChangeDetail(event?.detail))
  }
  const onChannel = (event) => {
    notifyHandler(handler, sanitizeAiConfigChangeDetail(event?.data))
  }
  target.addEventListener(AI_CONFIG_CHANGED_EVENT, onLocal)
  const channel = getSharedChannel()
  channel?.addEventListener('message', onChannel)
  return () => {
    target.removeEventListener(AI_CONFIG_CHANGED_EVENT, onLocal)
    channel?.removeEventListener('message', onChannel)
  }
}
