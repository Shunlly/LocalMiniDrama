export const MAX_NOVEL_FILE_BYTES = 20 * 1024 * 1024
export const MAX_NOVEL_TEXT_BYTES = 2 * 1024 * 1024
export const NOVEL_INTAKE_EXTENSIONS = Object.freeze(['.txt', '.md'])

export const NOVEL_INTAKE_HINT = '当前只支持粘贴或上传 UTF-8 纯文本（.txt / .md）。当前没有图片 OCR，也不能识别 PDF 或扫描件。单次文本不超过 2MB。导入后会尝试按章节拆成剧本，请确认已有版权或授权。'

export const NOVEL_INTAKE_PLACEHOLDER = '粘贴小说正文。图片、PDF 和扫描件无法在此识别，请先转成文本。'

export const NOVEL_INTAKE_FILE_HELP = '仅接受 UTF-8 编码的 .txt / .md。空文件、非 UTF-8 编码或超过 2MB 的文本会被拒绝。当前没有 OCR。'

export const NOVEL_INTAKE_MESSAGES = Object.freeze({
  emptyFile: '文件为空，请选择包含小说正文的文本文件。',
  emptyText: '请粘贴小说正文后再导入。',
  emptyFileSubmit: '请先选择 UTF-8 文本文件。',
  oversizedFile: '文件超过 20MB，请拆分后再导入。',
  oversizedText: '小说文本超过 2MB，请拆分后再导入。',
  encoding: '无法按 UTF-8 读取该文件。请将文件转换为 UTF-8 后重试。',
  binary: '文件包含二进制数据，请改用 UTF-8 纯文本。',
  unsupportedType: '仅支持 .txt / .md 纯文本。当前没有图片 OCR，也不能导入 PDF 或扫描件。',
  readFailed: '读取文本文件失败，请重新选择。',
})

export const NOVEL_INTAKE_LEAVE_COPY = Object.freeze({
  busyMessage: '正在导入小说，请等待完成后再离开。',
  title: '离开导入？',
  message: '已填写的小说文本或已选文件尚未导入，离开后会丢失。',
  confirmButtonText: '放弃并离开',
  cancelButtonText: '继续编辑',
})

export function utf8ByteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length
}

export function novelIntakeExtension(filename) {
  const name = String(filename || '').trim().split(/[\\/]/).pop() || ''
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

export function resolveNovelIntakeFile(input) {
  if (!input) return null
  if (input.raw && typeof input.raw === 'object') return input.raw
  return input
}

export function novelIntakeHasDraft({ text, fileName, fileAccepted } = {}) {
  return Boolean(String(text || '').trim() || String(fileName || '').trim() || fileAccepted)
}

export function novelIntakeLeaveReason({ importing, hasDraft } = {}) {
  if (importing) return 'busy'
  if (hasDraft) return 'draft'
  return ''
}

export function buildNovelIntakeConfirmCopy({ maxChapters, aiSummarize } = {}) {
  const chapters = Math.max(1, Math.min(20, Math.floor(Number(maxChapters) || 10)))
  const extra = aiSummarize
    ? '已开启 AI 转剧本，会消耗 Token。'
    : '不会把图片或扫描件识别成文字。'
  return {
    title: '确认导入文本',
    message: `将把纯文本导入并尝试拆成最多 ${chapters} 集。${extra}当前没有图片 OCR。请确认内容已有版权或授权。`,
    confirmButtonText: '开始导入',
    cancelButtonText: '取消',
  }
}

function toUint8Array(bytes) {
  if (!bytes) return new Uint8Array()
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return new Uint8Array()
}

export function inspectNovelIntakeText(text, { allowEmpty = false } = {}) {
  const value = String(text ?? '')
  if (!value.trim()) {
    return allowEmpty ? { text: value, error: '' } : { error: NOVEL_INTAKE_MESSAGES.emptyText }
  }
  if (utf8ByteLength(value) > MAX_NOVEL_TEXT_BYTES) {
    return { error: NOVEL_INTAKE_MESSAGES.oversizedText }
  }
  return { text: value, error: '' }
}

export function inspectNovelIntakeBytes(bytes, { filename = '' } = {}) {
  const extension = novelIntakeExtension(filename)
  if (extension && !NOVEL_INTAKE_EXTENSIONS.includes(extension)) {
    return { error: NOVEL_INTAKE_MESSAGES.unsupportedType }
  }
  const data = toUint8Array(bytes)
  if (!data.length) return { error: NOVEL_INTAKE_MESSAGES.emptyFile }
  if (data.length > MAX_NOVEL_FILE_BYTES) return { error: NOVEL_INTAKE_MESSAGES.oversizedFile }
  if (data.length > MAX_NOVEL_TEXT_BYTES) return { error: NOVEL_INTAKE_MESSAGES.oversizedText }
  if (
    data.length >= 2
    && ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff))
  ) {
    return { error: NOVEL_INTAKE_MESSAGES.encoding }
  }
  if (data.includes(0)) return { error: NOVEL_INTAKE_MESSAGES.binary }
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    if (!text.trim()) return { error: NOVEL_INTAKE_MESSAGES.emptyFile }
    return { text, error: '' }
  } catch {
    return { error: NOVEL_INTAKE_MESSAGES.encoding }
  }
}

export async function inspectNovelIntakeFile(input) {
  const file = resolveNovelIntakeFile(input)
  if (!file) return { error: NOVEL_INTAKE_MESSAGES.emptyFileSubmit }
  const filename = String(file.name || input?.name || '')
  const extension = novelIntakeExtension(filename)
  if (!NOVEL_INTAKE_EXTENSIONS.includes(extension)) {
    return { error: NOVEL_INTAKE_MESSAGES.unsupportedType }
  }
  const size = Number(file.size)
  if (Number.isFinite(size)) {
    if (size <= 0) return { error: NOVEL_INTAKE_MESSAGES.emptyFile }
    if (size > MAX_NOVEL_FILE_BYTES) return { error: NOVEL_INTAKE_MESSAGES.oversizedFile }
    if (size > MAX_NOVEL_TEXT_BYTES) return { error: NOVEL_INTAKE_MESSAGES.oversizedText }
  }
  if (typeof file.arrayBuffer !== 'function') {
    return { error: NOVEL_INTAKE_MESSAGES.readFailed }
  }
  try {
    const buffer = await file.arrayBuffer()
    return inspectNovelIntakeBytes(buffer, { filename })
  } catch {
    return { error: NOVEL_INTAKE_MESSAGES.readFailed }
  }
}

export function inspectNovelIntakeSubmit({ mode, text, fileName, fileAccepted } = {}) {
  if (mode === 'file') {
    if (!fileAccepted || !String(fileName || '').trim()) {
      return { error: NOVEL_INTAKE_MESSAGES.emptyFileSubmit }
    }
    return { error: '' }
  }
  return inspectNovelIntakeText(text)
}

export function createNovelIntakeLeaveGuard({
  getVisible,
  getImporting,
  getHasDraft,
  confirmDraft,
  warnBusy,
} = {}) {
  let confirming = false

  async function confirmLeave() {
    if (getImporting?.()) {
      warnBusy?.()
      return false
    }
    if (!getHasDraft?.()) return true
    if (confirming) return false
    confirming = true
    try {
      await confirmDraft?.()
      return true
    } catch {
      return false
    } finally {
      confirming = false
    }
  }

  function handleBeforeUnload(event) {
    if (getVisible && !getVisible()) return
    if (!getImporting?.() && !getHasDraft?.()) return
    event.preventDefault()
    event.returnValue = ''
  }

  return { confirmLeave, handleBeforeUnload }
}
