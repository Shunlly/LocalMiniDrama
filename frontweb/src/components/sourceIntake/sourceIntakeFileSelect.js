import { inferSourceTypeFromFilename } from '@/utils/sourceIntakeAdapter'
import {
  SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE,
  sourceFileExtension,
} from '@/utils/sourceWorkflowState'
import { isUserFacingAbort, toUserFacingError } from '@/utils/userFacingError'

export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024
export const SOURCE_FILE_EXTENSIONS = Object.freeze([
  '.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json',
  '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
])
export const SOURCE_FILE_ACCEPT = SOURCE_FILE_EXTENSIONS.join(',')
export const SOURCE_FILE_EXTENSION_SET = new Set(SOURCE_FILE_EXTENSIONS)
export const TEXT_SOURCE_FILE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json'])

export function createSourceIntakeFileSelectController({
  form,
  sourceFile,
  selectedFilename,
  sourceFileReading,
  sourceOperationMessage,
  sourceOperationError,
  sourceFileInput,
  showWorkflowMessage,
} = {}) {
  function clearSelectedFile() {
    sourceFile.value = null
    selectedFilename.value = ''
    sourceOperationMessage.value = ''
    sourceOperationError.value = ''
    if (sourceFileInput.value) sourceFileInput.value.value = ''
  }

  async function handleSourceFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    sourceOperationMessage.value = ''
    sourceOperationError.value = ''
    const extension = sourceFileExtension(file.name)
    if (!SOURCE_FILE_EXTENSION_SET.has(extension)) {
      clearSelectedFile()
      sourceOperationError.value = SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE
      showWorkflowMessage('warning', sourceOperationError.value)
      return
    }
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      clearSelectedFile()
      sourceOperationError.value = '单个素材文件最大 20MB，请拆分或压缩后再导入。'
      showWorkflowMessage('warning', sourceOperationError.value)
      return
    }
    if (file.size === 0) {
      clearSelectedFile()
      sourceOperationError.value = '素材文件为空，请重新选择。'
      showWorkflowMessage('warning', sourceOperationError.value)
      return
    }
    sourceFile.value = file
    selectedFilename.value = file.name
    if (!form.title) form.title = file.name.replace(/\.[^.]+$/, '')
    const inferredType = inferSourceTypeFromFilename(file.name)
    if (inferredType && !form.source_type) form.source_type = inferredType
    const mime = String(file.type || '').toLowerCase()
    const looksLikeBinaryMedia = mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')
    if (TEXT_SOURCE_FILE_EXTENSIONS.has(extension) && file.size <= 2 * 1024 * 1024 && !looksLikeBinaryMedia) {
      sourceFileReading.value = true
      try {
        form.text = await file.text()
      } catch (error) {
        clearSelectedFile()
        if (isUserFacingAbort(error)) return
        sourceOperationError.value = toUserFacingError(error, '读取文本文件失败，请重新选择。')
        showWorkflowMessage('error', sourceOperationError.value)
        return
      } finally {
        sourceFileReading.value = false
      }
    } else {
      form.text = ''
    }
    sourceOperationMessage.value = `${file.name} 已选择，导入时将上传并解析。`
    showWorkflowMessage('success', `已选择 ${file.name}`)
  }

  return { clearSelectedFile, handleSourceFile }
}
