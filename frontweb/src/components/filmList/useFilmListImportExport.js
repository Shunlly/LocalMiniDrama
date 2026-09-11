/** 项目包导入、导出和导入失败横幅。 */
import { nextTick, ref } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { dramaAPI } from '@/api/drama'
import { normalizeImportFailureFilename, resolveImportFailureMessage } from '@/components/filmList/filmListFormatters.js'
import { sanitizeExportFilename, validateExportBlob, resolveExportFailureMessage } from '@/utils/projectExport'

export function useFilmListImportExport(deps = {}) {
  const {
    listWriteLocked,
    loadList,
    showNewDialog,
    headerRef,
    importFileInput,
  } = deps

  const exportingId = ref(null)
  const exportFailure = ref(null)
  const importing = ref(false)
  const importFailure = ref(null)

  async function onExport(d) {
    if (exportingId.value !== null) return
    exportingId.value = d.id
    let downloadUrl = ''
    let anchor = null
    try {
      const blob = await validateExportBlob(await dramaAPI.exportDrama(d.id))
      downloadUrl = URL.createObjectURL(blob)
      anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = sanitizeExportFilename(d.title)
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      exportFailure.value = null
      ElMessage.success('项目包已验证，下载已开始')
    } catch (error) {
      const message = await resolveExportFailureMessage(error)
      exportFailure.value = {
        drama: { id: d.id, title: d.title || '未命名项目' },
        message,
      }
      ElMessage.error(message)
    } finally {
      if (anchor?.isConnected) anchor.remove()
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
      exportingId.value = null
    }
  }

  function openSourceImportProject() {
    if (listWriteLocked.value) return
    showNewDialog.value = true
  }

  function clearImportFailure() {
    importFailure.value = null
  }

  async function dismissImportFailure() {
    clearImportFailure()
    await nextTick()
    const trigger = headerRef.value?.importTriggerButton?.$el || headerRef.value?.importTriggerButton
    trigger?.focus?.()
  }

  function setImportFailure(fileName, error) {
    importFailure.value = {
      fileName: normalizeImportFailureFilename(fileName),
      message: resolveImportFailureMessage(error),
    }
  }

  function triggerImport() {
    if (listWriteLocked.value) return
    importFileInput.value?.click()
  }

  async function onImportFile(e) {
    if (listWriteLocked.value) {
      if (e.target) e.target.value = ''
      return
    }
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    clearImportFailure()
    if (!/\.zip$/i.test(file.name || '')) {
      setImportFailure(file.name, new Error('请选择 .zip 格式的项目包'))
      return
    }
    importing.value = true
    try {
      const data = await dramaAPI.importDrama(file)
      importFailure.value = null
      ElMessage.success(`导入成功：${data?.title || '项目'}`)
      loadList()
    } catch (error) {
      setImportFailure(file.name, error)
    } finally {
      importing.value = false
    }
  }

  return {
    exportingId,
    exportFailure,
    importing,
    importFailure,
    onExport,
    setImportFailure,
    clearImportFailure,
    dismissImportFailure,
    triggerImport,
    onImportFile,
    openSourceImportProject,
  }
}
