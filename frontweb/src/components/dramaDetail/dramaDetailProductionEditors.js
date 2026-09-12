import {
  generateDramaDetailEditorImage,
  uploadDramaDetailEditorImage,
} from './dramaDetailResourceImages.js'

function buildDramaResourceForm(item, extra) {
  return {
    id: item.id,
    ...extra,
    image_url: item.image_url ?? '',
    local_path: item.local_path ?? null,
    imgUploading: false,
    imgGenerating: false,
  }
}

/**
 * 制作资源（本剧角色/场景/道具）的打开、保存、上传和生图。
 * 不创建新 ref，open/save 从页面已有状态装配。
 */
export function createDramaDetailProductionEditors({
  dramaId,
  loadDrama,
  captureResourceEditorBaseline,
  editDramaCharVisible,
  editDramaCharForm,
  editDramaCharSaving,
  editDramaSceneVisible,
  editDramaSceneForm,
  editDramaSceneSaving,
  editDramaPropVisible,
  editDramaPropForm,
  editDramaPropSaving,
  characterAPI,
  sceneAPI,
  propAPI,
  uploadAPI,
  taskAPI,
  ElMessage,
  toUserError,
} = {}) {
  function openEditDramaChar(item) {
    editDramaCharForm.value = buildDramaResourceForm(item, {
      name: item.name ?? '',
      role: item.role ?? 'minor',
      description: item.description ?? '',
      personality: item.personality ?? '',
      appearance: item.appearance ?? '',
    })
    captureResourceEditorBaseline('dramaChar')
    editDramaCharVisible.value = true
  }

  async function saveDramaChar() {
    if (!editDramaCharForm.value?.id) return
    editDramaCharSaving.value = true
    try {
      await characterAPI.update(editDramaCharForm.value.id, {
        name: editDramaCharForm.value.name,
        role: editDramaCharForm.value.role || null,
        description: editDramaCharForm.value.description || null,
        personality: editDramaCharForm.value.personality || null,
        appearance: editDramaCharForm.value.appearance || null,
      })
      ElMessage.success('已保存')
      editDramaCharVisible.value = false
      loadDrama()
    } catch (e) { ElMessage.error(toUserError(e, '保存失败')) }
    finally { editDramaCharSaving.value = false }
  }

  async function uploadDramaCharImg(event) {
    await uploadDramaDetailEditorImage({
      event,
      form: editDramaCharForm.value,
      dramaId,
      uploadAPI,
      persistImage: (form, url) => characterAPI.putImage(form.id, { image_url: url, local_path: null }),
      reloadFn: loadDrama,
      ElMessage,
      toUserError,
    })
  }

  async function generateDramaCharImg() {
    await generateDramaDetailEditorImage({
      form: editDramaCharForm.value,
      startGenerate: (form) => characterAPI.generateImage(form.id, null, null),
      taskAPI,
      reloadFn: loadDrama,
      ElMessage,
      toUserError,
    })
  }

  function openEditDramaScene(item) {
    editDramaSceneForm.value = buildDramaResourceForm(item, {
      location: item.location ?? '',
      time: item.time ?? '',
      description: item.description ?? '',
      prompt: item.prompt ?? '',
    })
    captureResourceEditorBaseline('dramaScene')
    editDramaSceneVisible.value = true
  }

  async function saveDramaScene() {
    if (!editDramaSceneForm.value?.id) return
    editDramaSceneSaving.value = true
    try {
      await sceneAPI.update(editDramaSceneForm.value.id, {
        location: editDramaSceneForm.value.location,
        time: editDramaSceneForm.value.time || null,
        description: editDramaSceneForm.value.description || null,
        prompt: editDramaSceneForm.value.prompt || null,
      })
      ElMessage.success('已保存')
      editDramaSceneVisible.value = false
      loadDrama()
    } catch (e) { ElMessage.error(toUserError(e, '保存失败')) }
    finally { editDramaSceneSaving.value = false }
  }

  async function uploadDramaSceneImg(event) {
    await uploadDramaDetailEditorImage({
      event,
      form: editDramaSceneForm.value,
      dramaId,
      uploadAPI,
      persistImage: (form, url) => sceneAPI.update(form.id, { image_url: url, local_path: null }),
      reloadFn: loadDrama,
      ElMessage,
      toUserError,
    })
  }

  async function generateDramaSceneImg() {
    const form = editDramaSceneForm.value
    if (!form?.id) return
    const prompt = [form.location, form.time, form.description].filter(Boolean).join(', ')
    if (!prompt) { ElMessage.warning('请先填写地点或描述'); return }
    await generateDramaDetailEditorImage({
      form,
      startGenerate: () => sceneAPI.generateImage({ scene_id: form.id, drama_id: dramaId, prompt }),
      taskAPI,
      reloadFn: loadDrama,
      ElMessage,
      toUserError,
    })
  }

  function openEditDramaProp(item) {
    editDramaPropForm.value = buildDramaResourceForm(item, {
      name: item.name ?? '',
      type: item.type ?? '',
      description: item.description ?? '',
      prompt: item.prompt ?? '',
    })
    captureResourceEditorBaseline('dramaProp')
    editDramaPropVisible.value = true
  }

  async function saveDramaProp() {
    if (!editDramaPropForm.value?.id) return
    editDramaPropSaving.value = true
    try {
      await propAPI.update(editDramaPropForm.value.id, {
        name: editDramaPropForm.value.name,
        type: editDramaPropForm.value.type || null,
        description: editDramaPropForm.value.description || null,
        prompt: editDramaPropForm.value.prompt || null,
      })
      ElMessage.success('已保存')
      editDramaPropVisible.value = false
      loadDrama()
    } catch (e) { ElMessage.error(toUserError(e, '保存失败')) }
    finally { editDramaPropSaving.value = false }
  }

  async function uploadDramaPropImg(event) {
    await uploadDramaDetailEditorImage({
      event,
      form: editDramaPropForm.value,
      dramaId,
      uploadAPI,
      persistImage: (form, url) => propAPI.update(form.id, { image_url: url, local_path: null }),
      reloadFn: loadDrama,
      ElMessage,
      toUserError,
    })
  }

  async function generateDramaPropImg() {
    await generateDramaDetailEditorImage({
      form: editDramaPropForm.value,
      startGenerate: (form) => propAPI.generateImage(form.id, null, null),
      taskAPI,
      reloadFn: loadDrama,
      ElMessage,
      toUserError,
    })
  }

  return {
    openEditDramaChar,
    saveDramaChar,
    uploadDramaCharImg,
    generateDramaCharImg,
    openEditDramaScene,
    saveDramaScene,
    uploadDramaSceneImg,
    generateDramaSceneImg,
    openEditDramaProp,
    saveDramaProp,
    uploadDramaPropImg,
    generateDramaPropImg,
  }
}
