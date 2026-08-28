export function useFilmCreateRefImageDrop(deps = {}) {
  const {
    ElMessage,
    uploadAPI,
    addCharRefImage,
    addPropRefImage,
    addSceneRefImage,
    addPropAddRefImage,
    extractingCharAppearance,
    extractingPropDesc,
    extractingSceneDesc,
    editCharacterForm,
    editPropForm,
    editSceneForm,
    dragOverResourceKey,
    dragOverSbId,
    doUploadResourceImage,
    doUploadSbImage,
  } = deps
  function getFirstImageFile(dataTransfer) {
    if (!dataTransfer?.files?.length) return null
    const file = Array.from(dataTransfer.files).find((f) => f.type.startsWith('image/'))
    return file || null
  }

  // ── 参考图文件读取工具 ──────────────────────────────────
  function readFileAsRefImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (ev) => resolve({ dataUrl: ev.target.result, filename: file.name })
      reader.readAsDataURL(file)
    })
  }

  /**
   * 处理角色/道具/场景参考图文件选择（<input type="file"> change 事件）
   * type: 'character' | 'prop' | 'scene'
   */
  async function onRefImageFileChange(type, event) {
    const file = event.target?.files?.[0]
    if (!file) return
    const result = await readFileAsRefImage(file)
    if (type === 'character') addCharRefImage.value = result
    else if (type === 'prop') addPropRefImage.value = result
    else if (type === 'scene') addSceneRefImage.value = result
    event.target.value = ''
  }

  /**
   * 处理角色/道具/场景参考图拖放（drop 事件）
   * type: 'character' | 'prop' | 'scene'
   */
  async function onRefImageDrop(type, event) {
    const file = getFirstImageFile(event.dataTransfer)
    if (!file) return
    const result = await readFileAsRefImage(file)
    if (type === 'character') addCharRefImage.value = result
    else if (type === 'prop') addPropRefImage.value = result
    else if (type === 'scene') addSceneRefImage.value = result
  }

  /**
   * 处理"添加道具"简单弹窗的参考图文件选择
   * type: 'addProp'
   */
  async function onRefImageFileChange2(type, event) {
    const file = event.target?.files?.[0]
    if (!file) return
    const result = await readFileAsRefImage(file)
    if (type === 'addProp') addPropAddRefImage.value = result
    event.target.value = ''
  }

  /**
   * 处理"添加道具"简单弹窗的参考图拖放
   * type: 'addProp'
   */
  async function onRefImageDrop2(type, event) {
    const file = getFirstImageFile(event.dataTransfer)
    if (!file) return
    const result = await readFileAsRefImage(file)
    if (type === 'addProp') addPropAddRefImage.value = result
  }

  /**
   * 从本地选择（尚未保存到服务器）的参考图中提取特征描述
   * type: 'character' | 'prop' | 'scene'
   */
  async function doExtractFromRef(type) {
    if (type === 'character') {
      const refImage = addCharRefImage.value
      if (!refImage) return
      extractingCharAppearance.value = true
      try {
        const name = editCharacterForm.value?.name || ''
        const res = await uploadAPI.extractDescriptionFromImage('character', refImage.dataUrl, name)
        if (res?.description && editCharacterForm.value) {
          editCharacterForm.value.appearance = res.description
          ElMessage.success('已从参考图提取外貌描述')
        }
      } catch (e) {
        ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
      } finally {
        extractingCharAppearance.value = false
      }
    } else if (type === 'prop') {
      const refImage = addPropRefImage.value
      if (!refImage) return
      extractingPropDesc.value = true
      try {
        const name = editPropForm.value?.name || ''
        const res = await uploadAPI.extractDescriptionFromImage('prop', refImage.dataUrl, name)
        if (res?.description && editPropForm.value) {
          editPropForm.value.description = res.description
          ElMessage.success('已从参考图提取特征描述')
        }
      } catch (e) {
        ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
      } finally {
        extractingPropDesc.value = false
      }
    } else if (type === 'scene') {
      const refImage = addSceneRefImage.value
      if (!refImage) return
      extractingSceneDesc.value = true
      try {
        const name = editSceneForm.value?.name || ''
        const res = await uploadAPI.extractDescriptionFromImage('scene', refImage.dataUrl, name)
        if (res?.description && editSceneForm.value) {
          editSceneForm.value.description = res.description
          ElMessage.success('已从参考图提取场景描述')
        }
      } catch (e) {
        ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
      } finally {
        extractingSceneDesc.value = false
      }
    }
  }

  function onResourceDragOver(e, type, id) {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    const key = type === 'character' ? 'char-' : type === 'prop' ? 'prop-' : 'scene-'
    dragOverResourceKey.value = key + id
  }
  function onResourceDragLeave(e, key) {
    e.preventDefault()
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
    if (key && dragOverResourceKey.value !== key) return
    dragOverResourceKey.value = null
  }
  function onResourceDrop(e, type, id) {
    e.preventDefault()
    e.stopPropagation()
    dragOverResourceKey.value = null
    const file = getFirstImageFile(e.dataTransfer)
    if (file) doUploadResourceImage(type, id, file)
  }
  function onSbImageDragOver(e, sbId) {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dragOverSbId.value = sbId
  }
  function onSbImageDragLeave(e, sbId) {
    e.preventDefault()
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
    if (sbId != null && dragOverSbId.value !== sbId) return
    dragOverSbId.value = null
  }
  function onSbImageDrop(e, sb) {
    e.preventDefault()
    e.stopPropagation()
    dragOverSbId.value = null
    const file = getFirstImageFile(e.dataTransfer)
    if (file && sb?.id) doUploadSbImage(sb.id, file)
  }
  return {
    getFirstImageFile,
    readFileAsRefImage,
    onRefImageFileChange,
    onRefImageDrop,
    onRefImageFileChange2,
    onRefImageDrop2,
    doExtractFromRef,
    onResourceDragOver,
    onResourceDragLeave,
    onResourceDrop,
    onSbImageDragOver,
    onSbImageDragLeave,
    onSbImageDrop,
  }
}
