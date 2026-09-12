/**
 * AI 配置 JSON 请求的默认选项。页面和厂商锁定读取共用。
 */
import { DEFAULT_JSON_TIMEOUT_MS } from '@/utils/requestError.js'

export function jsonRequestOptions(signal, timeout = DEFAULT_JSON_TIMEOUT_MS) {
  return { signal, timeout, suppressErrorToast: true }
}
