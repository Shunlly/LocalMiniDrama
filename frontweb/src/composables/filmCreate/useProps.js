import { ref, reactive, computed } from 'vue'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { propAPI as rawPropAPI } from '@/api/props'
import { propLibraryAPI as rawPropLibraryAPI } from '@/api/propLibrary'
import { uploadAPI as rawUploadAPI } from '@/api/upload'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { buildExtractTaskMeta, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { usePropLibrary } from './usePropLibrary.js'

/**
 * 道具管理 Composable
 * @param {object} deps - 共享依赖
 * @param {object} deps.store - Pinia store
 * @param {import('vue').ComputedRef} deps.dramaId
 * @param {import('vue').ComputedRef} deps.currentEpisodeId
 * @param {Function} deps.getSelectedStyle
 * @param {Function} deps.loadDrama
 * @param {Function} deps.pollTask
 * @param {Function} deps.pollUntilResourceHasImage
 * @param {Function} deps.hasAssetImage
 */
export function useProps(deps) {
  const {
    store,
    dramaId,
    currentEpisodeId,
    getSelectedStyle,
    loadDrama,
    pollTask,
    pollUntilResourceHasImage,
    hasAssetImage,
    ElMessage = RawElMessage,
    propAPI = rawPropAPI,
    propLibraryAPI = rawPropLibraryAPI,
    uploadAPI = rawUploadAPI,
  } = deps
  const genStore = useGenerationTaskStore()

  function buildPropImageMeta(prop) {
    const dramaTitle = store.drama?.title || ''
    const epNum = store.currentEpisode?.episode_number
    const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
    return {
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      dramaTitle,
      episodeNumber: epNum,
      resourceType: GEN_RESOURCE.PROP_IMAGE,
      resourceId: prop.id,
      label: `${epLabel} 道具图: ${prop.name || prop.id}`,
    }
  }

  function dataUrlToFile(dataUrl, filename) {
    const arr = dataUrl.split(',')
    const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) u8arr[n] = bstr.charCodeAt(n)
    return new File([u8arr], filename || 'reference.png', { type: mime })
  }

  // ── 道具弹窗状态 ──────────────────────────────────────
  const showAddProp = ref(false)
  const addPropSaving = ref(false)
  const addPropForm = ref({ name: '', type: '', description: '', prompt: '' })

  const showEditProp = ref(false)
  const editPropForm = ref(null)
  const editPropSaving = ref(false)
  const editPropPromptGenerating = ref(false)
  const extractingPropDesc = ref(false)
  const addPropRefImage = ref(null)   // { dataUrl, filename }
  const addPropRefFileInput = ref(null)
  let editPropPollTimer = null

  // 「添加道具」简单弹窗的独立参考图状态
  const addPropAddRefImage = ref(null)
  const addPropAddRefFileInput = ref(null)
  const extractingPropAddDesc = ref(false)

  // ── 道具生成状态 ──────────────────────────────────────
  const propsExtracting = computed(() =>
    isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.EXTRACT_PROPS)
  )
  const generatingPropIds = reactive(new Set())

  // 道具资料库：加载/编辑/加入剧集/素材库
  const {
    showPropLibrary,
    propLibraryList,
    propLibraryLoading,
    propLibraryPage,
    propLibraryPageSize,
    propLibraryTotal,
    propLibraryKeyword,
    showEditPropLibrary,
    editPropLibraryForm,
    editPropLibrarySaving,
    addingPropToLibraryId,
    addingPropToMaterialId,
    addingPropFromLibraryId,
    propLibraryTab,
    dramaAllPropList,
    dramaAllPropLoading,
    dramaAllPropPage,
    dramaAllPropPageSize,
    dramaAllPropTotal,
    dramaAllPropKeyword,
    loadPropLibraryList,
    debouncedLoadPropLibrary,
    loadDramaAllPropList,
    debouncedLoadDramaAllPropList,
    onPropLibraryDialogOpen,
    onPropLibraryTabChange,
    isPropAddToEpisodeLoading,
    openEditPropLibrary,
    submitEditPropLibrary,
    onDeletePropLibrary,
    onAddPropToLibrary,
    onAddPropToMaterialLibrary,
    onAddPropFromLibrary,
    onAddDramaPropToEpisode,
  } = usePropLibrary({
    store,
    dramaId,
    currentEpisodeId,
    loadDrama,
    hasAssetImage,
    ElMessage,
    propAPI,
    propLibraryAPI,
  })

  // ── 函数 ──────────────────────────────────────────────
  async function onExtractProps() {
    if (!currentEpisodeId.value) {
      ElMessage.warning('请先完成剧本并保存')
      return
    }
    const epId = currentEpisodeId.value
    const meta = buildExtractTaskMeta(store, dramaId.value, epId, GEN_RESOURCE.EXTRACT_PROPS, '提取道具')
    genStore.markRunning(meta)
    try {
      const res = await propAPI.extractFromScript(epId)
      const taskId = res?.task_id
      if (taskId) {
        const pollRes = await pollTask(taskId, () => loadDrama(), meta)
        if (pollRes?.status === 'completed') {
          ElMessage.success('道具提取完成')
        } else if (pollRes?.status === 'timeout') {
          ElMessage.warning(toUserFacingError(pollRes?.error, '道具提取超时，请稍后重试'))
        } else if (pollRes?.status === 'cancelled' || pollRes?.status === 'canceled') {
          ElMessage.info(toUserFacingError(pollRes?.error, '操作已取消'))
        } else {
          ElMessage.warning(toUserFacingError(pollRes?.error, '道具提取未完成'))
        }
      } else {
        await loadDrama()
        ElMessage.success('道具提取任务已提交')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '提取失败'))
    } finally {
      genStore.markDone(meta)
    }
  }

  function stopPropPromptPoll() {
    if (editPropPollTimer) { clearInterval(editPropPollTimer); editPropPollTimer = null }
  }

  function editProp(prop) {
    stopPropPromptPoll()
    editPropForm.value = {
      id: prop.id,
      name: prop.name || '',
      type: prop.type || '',
      description: prop.description || '',
      prompt: prop.prompt || '',
      image_url: prop.image_url || '',
      local_path: prop.local_path || '',
      ref_image: prop.ref_image || '',
    }
    showEditProp.value = true
    if (!prop.prompt && prop.id && prop.description) {
      editPropPromptGenerating.value = true
      let elapsed = 0
      editPropPollTimer = setInterval(async () => {
        elapsed += 3
        try {
          const res = await propAPI.get(prop.id)
          const p = res?.prop?.prompt
          if (p) {
            if (editPropForm.value?.id === prop.id) editPropForm.value.prompt = p
            stopPropPromptPoll()
            editPropPromptGenerating.value = false
          } else if (elapsed >= 60) {
            stopPropPromptPoll()
            editPropPromptGenerating.value = false
          }
        } catch (_) {
          stopPropPromptPoll()
          editPropPromptGenerating.value = false
        }
      }, 3000)
    }
  }

  async function doGeneratePropPrompt() {
    const form = editPropForm.value
    if (!form?.id) return
    editPropPromptGenerating.value = true
    try {
      const res = await propAPI.generatePrompt(form.id)
      if (res?.prompt) {
        form.prompt = res.prompt
        ElMessage.success('提示词已生成')
        await loadDrama()
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '生成提示词失败'))
    } finally {
      editPropPromptGenerating.value = false
    }
  }

  async function savePropRefImageIfAny(propId) {
    const refImg = addPropRefImage.value
    if (!refImg || !propId) return
    try {
      const file = dataUrlToFile(refImg.dataUrl, refImg.filename || 'reference.png')
      const uploadRes = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
      const refPath = uploadRes.local_path || uploadRes.url || ''
      await propAPI.putRefImage(propId, refPath)
    } catch (e) {
      console.warn('[savePropRefImage] 保存参考图失败:', e.message)
    }
  }

  async function clearPropRefImage() {
    const form = editPropForm.value
    if (!form?.id) return
    try {
      await propAPI.putRefImage(form.id, null)
      form.ref_image = ''
      ElMessage.success('参考图已移除')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '移除失败'))
    }
  }

  async function doExtractPropFromImage() {
    const form = editPropForm.value
    if (!form?.id) return
    extractingPropDesc.value = true
    try {
      const res = await propAPI.extractFromImage(form.id)
      if (res?.description) {
        form.description = res.description
        ElMessage.success('已从图片提取道具描述')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '提取失败，请检查道具是否已上传参考图片'))
    } finally {
      extractingPropDesc.value = false
    }
  }

  async function submitEditProp() {
    if (!editPropForm.value?.id) return
    editPropSaving.value = true
    try {
      await propAPI.update(editPropForm.value.id, {
        name: editPropForm.value.name?.trim(),
        type: editPropForm.value.type || undefined,
        description: editPropForm.value.description || undefined,
        prompt: editPropForm.value.prompt || undefined
      })
      await savePropRefImageIfAny(editPropForm.value.id)
      await loadDrama()
      showEditProp.value = false
      ElMessage.success('道具已保存')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      editPropSaving.value = false
    }
  }

  async function submitAddProp() {
    const name = (addPropForm.value.name || '').trim()
    if (!name || !store.dramaId) return
    addPropSaving.value = true
    try {
      await propAPI.create({
        drama_id: store.dramaId,
        episode_id: currentEpisodeId.value ?? undefined,
        name,
        type: addPropForm.value.type?.trim() || undefined,
        description: addPropForm.value.description?.trim() || undefined,
        prompt: addPropForm.value.prompt?.trim() || undefined
      })
      showAddProp.value = false
      await loadDrama()
      ElMessage.success('道具已添加')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '添加失败'))
    } finally {
      addPropSaving.value = false
    }
  }

  function onClosePropDialog() {
    showEditProp.value = false
    stopPropPromptPoll()
    editPropPromptGenerating.value = false
    addPropRefImage.value = null
  }

  async function onDeleteProp(prop) {
    try {
      await ElMessageBox.confirm(
        `确定要删除道具「${(prop.name || '未命名').slice(0, 20)}」吗？此操作不可恢复。`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
      await propAPI.delete(prop.id)
      await loadDrama()
      ElMessage.success('道具已删除')
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '删除失败'))
    }
  }

  async function onGeneratePropImage(prop, useQuadGrid = false) {
    prop.errorMsg = ''
    prop.error_msg = ''
    const meta = buildPropImageMeta(prop)
    generatingPropIds.add(prop.id)
    genStore.markRunning(meta)
    try {
      const res = await propAPI.generateImage(prop.id, undefined, getSelectedStyle(), !!useQuadGrid)
      const taskId = res?.task_id
      if (taskId) {
        const pollRes = await pollTask(taskId, () => loadDrama(), meta)
        if (pollRes?.status === 'failed') {
          prop.errorMsg = toUserFacingError(pollRes.error, '生成失败')
        } else if (pollRes?.status === 'completed') {
          ElMessage.success('道具图片已生成')
        } else if (pollRes?.status === 'timeout') {
          prop.errorMsg = toUserFacingError(pollRes?.error, '生成超时，请稍后重试')
          ElMessage.warning(prop.errorMsg)
        } else if (pollRes?.status === 'cancelled' || pollRes?.status === 'canceled') {
          prop.errorMsg = toUserFacingError(pollRes?.error, '操作已取消')
        } else {
          prop.errorMsg = toUserFacingError(pollRes?.error, '道具图片生成未完成')
          ElMessage.warning(prop.errorMsg)
        }
      } else {
        await loadDrama()
        await pollUntilResourceHasImage(() => {
          const list = store.drama?.props ?? store.currentEpisode?.props ?? []
          const p = list.find((x) => Number(x.id) === Number(prop.id))
          return !!(p && (p.image_url || p.local_path))
        })
        ElMessage.success('道具图片已生成')
      }
    } catch (e) {
      prop.errorMsg = toUserFacingError(e, '生成失败')
      if (isUserFacingAbort(e)) return
      console.error(e)
      ElMessage.error(toUserFacingError(e, '提交失败'))
    } finally {
      generatingPropIds.delete(prop.id)
      genStore.markDone(meta)
    }
  }

  // ── 添加道具简单弹窗的参考图 extract ─────────────────
  async function doExtractFromRef2(type) {
    if (type !== 'addProp') return
    const refImage = addPropAddRefImage.value
    if (!refImage) return
    extractingPropAddDesc.value = true
    try {
      const entityName = addPropForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('prop', refImage.dataUrl, entityName)
      if (res?.description) {
        addPropForm.value.description = res.description
        ElMessage.success('已从参考图提取特征描述')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '提取失败，请检查 AI 配置中是否有支持视觉的模型'))
    } finally {
      extractingPropAddDesc.value = false
    }
  }

  return {
    // 弹窗状态
    showAddProp,
    addPropSaving,
    addPropForm,
    showEditProp,
    editPropForm,
    editPropSaving,
    editPropPromptGenerating,
    extractingPropDesc,
    addPropRefImage,
    addPropRefFileInput,
    addPropAddRefImage,
    addPropAddRefFileInput,
    extractingPropAddDesc,
    // 生成状态
    propsExtracting,
    generatingPropIds,
    // 库状态
    showPropLibrary,
    propLibraryList,
    propLibraryLoading,
    propLibraryPage,
    propLibraryPageSize,
    propLibraryTotal,
    propLibraryKeyword,
    propLibraryTab,
    dramaAllPropList,
    dramaAllPropLoading,
    dramaAllPropPage,
    dramaAllPropPageSize,
    dramaAllPropTotal,
    dramaAllPropKeyword,






    showEditPropLibrary,
    editPropLibraryForm,
    editPropLibrarySaving,
    addingPropToLibraryId,
    addingPropToMaterialId,

    addingPropFromLibraryId,
    // 函数
    onExtractProps,
    stopPropPromptPoll,
    editProp,
    doGeneratePropPrompt,
    savePropRefImageIfAny,
    clearPropRefImage,
    doExtractPropFromImage,
    submitEditProp,
    submitAddProp,
    onClosePropDialog,
    onDeleteProp,
    onGeneratePropImage,
    loadPropLibraryList,
    debouncedLoadPropLibrary,
    loadDramaAllPropList,
    debouncedLoadDramaAllPropList,


    onPropLibraryDialogOpen,
    onPropLibraryTabChange,
    isPropAddToEpisodeLoading,
    openEditPropLibrary,
    submitEditPropLibrary,
    onDeletePropLibrary,
    onAddPropToLibrary,
    onAddPropToMaterialLibrary,



    onAddPropFromLibrary,
    onAddDramaPropToEpisode,

    doExtractFromRef2,
  }
}

export { usePropLibrary }
