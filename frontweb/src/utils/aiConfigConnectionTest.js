/**
 * AI 配置连接测试失败文案。openTest 仍留在页面里。
 */
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError.js'
import { isRequestTimeout, isSafeUserFacingMessage } from '@/utils/requestError.js'

export const CONNECTION_TEST_ENGLISH_RE = /network error|timeout of \d+ms|request failed with status code|failed to fetch|fetch failed|load failed|internal server error|err_network|econnaborted|etimedout|econnrefused|enotfound|econnreset|eai_again|socket hang up|getaddrinfo|und_err_|incorrect api key|invalid api key|unauthorized|forbidden|too many requests|the operation was aborted|this operation was aborted/i

export function stripConnectionTestDecorations(message) {
  return String(message || '')
    .replace(/^连接测试失败[:：]\s*/u, '')
    .replace(/\bProvider\s*/gi, '该厂商')
    .replace(/[;；,]?\s*response_bytes=\d+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([）)])/g, '$1')
    .replace(/（\s*;?\s*）/g, '')
    .replace(/\(\s*;?\s*\)/g, '')
    .trim()
}

export const CONNECTION_TEST_SECRET_RE = /password\s*=|client_secret|cookie\s*:|authorization\s*:|api[_-]?key\s*[:=]|secret[_-]?key\s*[:=]|\b(?:sk|rk|pk|ak|sess)-[A-Za-z0-9._-]{6,}\b|\b(Bearer|Basic|Token)\s+\S+|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i

export function connectionTestTextLeaksSecret(text) {
  return CONNECTION_TEST_SECRET_RE.test(String(text || ''))
}

function isSafeConnectionTestCopy(text) {
  const value = String(text || '').trim()
  if (!value) return false
  if (connectionTestTextLeaksSecret(value)) return false
  if (CONNECTION_TEST_ENGLISH_RE.test(value)) return false
  return isSafeUserFacingMessage(value)
}

export function pickConnectionTestTitle(message) {
  const parts = String(message || '').split(/[:：]/).map((item) => item.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    if (/[\u4e00-\u9fff]/.test(last) && last.length <= 80 && isSafeConnectionTestCopy(last)) {
      return last
    }
  }
  return message
}

function readHttpStatus(error) {
  if (error == null || typeof error === 'string') return 0
  const status = Number(error.response?.status || error.status)
  return Number.isInteger(status) && status > 0 ? status : 0
}

export function describeConnectionTestError(error, signal, serviceType = '') {
  if (isRequestTimeout(error, signal)) {
    return {
      title: '连接测试超时',
      detail: '请检查服务地址和网络后重试。如果只是模型目录不可用，仍可在配置中手工填写模型名。',
    }
  }
  if (isUserFacingAbort(error, signal)) {
    return {
      title: '连接测试已取消',
      detail: '本次测试已停止，可重新测试。',
    }
  }
  const original = typeof error === 'string' ? error : String(error?.message || '')
  const status = readHttpStatus(error)
  const raw = toUserFacingError(error, '暂时无法完成连接测试，请稍后重试。', {
    serviceLabel: 'AI 配置服务',
    signal,
  })
  const cleaned = stripConnectionTestDecorations(raw)
  const probeLike = /模型列表探测|ollama 模型列表|\/v1\/models|\b\/models\b/i.test(`${original}\n${cleaned}\n${raw}`)
  if (status === 401 || status === 403) {
    return {
      title: '认证失败',
      detail: '请检查 API 密钥、会话或访问密钥是否填写正确。如果该服务不提供模型目录，也可直接在配置里手工填写模型名。',
    }
  }
  if (probeLike) {
    return {
      title: '无法读取模型列表',
      detail: '连接测试会向该厂商请求可用模型。失败常见原因是密钥无效、地址不正确，或该服务不提供模型目录。你可以稍后重试，或直接在配置里手工填写模型名。',
    }
  }
  const hasSafeChinese = isSafeConnectionTestCopy(cleaned)
    && !/(认证失败，请检查密钥|未找到|请求过于频繁，请稍后重试|暂时不可用，请稍后重试|请求无效，请检查后重试)$/.test(cleaned)
  if (status === 404 && !hasSafeChinese) {
    return {
      title: '找不到该服务地址',
      detail: '请检查接口地址是否填写正确，然后重试。',
    }
  }
  if (status === 429 && !hasSafeChinese) {
    return {
      title: '请求过于频繁',
      detail: '请稍后再试，或降低并发后重新测试。',
    }
  }
  if (status >= 500 && !hasSafeChinese) {
    return {
      title: '服务暂时不可用',
      detail: '对方服务返回了错误，请稍后重试。如果只是模型目录不可用，仍可在配置中手工填写模型名。',
    }
  }
  let title = pickConnectionTestTitle(cleaned)
  if (!isSafeConnectionTestCopy(title)) {
    title = '暂时无法完成连接测试，请稍后重试。'
  }
  const authLike = /认证失败|凭据|API Key|密钥/i.test(`${title}\n${cleaned}`)
  const st = String(serviceType || '').toLowerCase()
  let detail = authLike
    ? '请检查 API 密钥、会话或访问密钥是否填写正确。如果该服务不提供模型目录，也可直接在配置里手工填写模型名。'
    : '请检查厂商地址、密钥和网络后重试。连接测试有时会读取模型目录；若该服务不提供模型列表，可直接在配置里手工填写模型名。'
  if (!authLike && st === 'ocr') {
    detail = '请检查厂商地址、密钥和网络后重试。图片识别用于 PDF/图片抽文字，通常走视觉对话接口；若该服务不提供模型列表，可直接在配置里手工填写模型名。'
  } else if (!authLike && st === 'transcription') {
    detail = '请检查厂商地址、密钥和网络后重试。语音转写用于音频/视频，通常走音频转写接口；若该服务不提供模型列表，可直接在配置里手工填写模型名。'
  }
  return { title, detail }
}
