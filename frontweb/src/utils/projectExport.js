export function sanitizeExportFilename(title) {
  let stem = String(title || 'drama')
    .replace(/\.zip$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80)
  if (!stem) stem = 'drama'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `project-${stem}`
  return `${stem}.zip`
}

export async function inspectExportJsonBlob(blob) {
  const contentType = String(blob?.type || '').toLowerCase()
  const prefix = await blob.slice(0, Math.min(blob.size, 2048)).text()
  const trimmed = prefix.trimStart()
  const looksLikeJson = contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')
  if (!looksLikeJson) return null
  try {
    const payload = JSON.parse(await blob.text())
    const message = payload?.error?.message || payload?.message || (typeof payload?.error === 'string' ? payload.error : '')
    return message || '导出服务返回了 JSON，而不是项目压缩包'
  } catch (_) {
    return '导出服务返回了无法识别的错误内容'
  }
}

export async function validateExportBlob(blob) {
  if (typeof Blob === 'undefined' || !(blob instanceof Blob)) throw new Error('导出服务未返回文件')
  if (blob.size <= 0) throw new Error('导出的项目包为空')
  const jsonError = await inspectExportJsonBlob(blob)
  if (jsonError) throw new Error(jsonError)
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  const isZip = signature[0] === 0x50 && signature[1] === 0x4b && (
    (signature[2] === 0x03 && signature[3] === 0x04)
    || (signature[2] === 0x05 && signature[3] === 0x06)
    || (signature[2] === 0x07 && signature[3] === 0x08)
  )
  if (!isZip) throw new Error('导出文件格式无效，请重试')
  return blob
}

export async function resolveExportFailureMessage(error) {
  const responseBody = error?.response?.data
  if (typeof Blob !== 'undefined' && responseBody instanceof Blob && responseBody.size > 0) {
    const blobMessage = await inspectExportJsonBlob(responseBody)
    if (blobMessage) return blobMessage
  }
  if (responseBody && typeof responseBody === 'object') {
    const responseMessage = responseBody?.error?.message || responseBody?.message
    if (responseMessage) return responseMessage
  }
  return error?.message || '项目包导出失败，请重试'
}
