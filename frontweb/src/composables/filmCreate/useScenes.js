import { ref, reactive, computed } from 'vue'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { sceneAPI as rawSceneAPI } from '@/api/scenes'
import { sceneLibraryAPI as rawSceneLibraryAPI } from '@/api/sceneLibrary'
import { useSceneLibrary } from './useSceneLibrary.js'
import { uploadAPI as rawUploadAPI } from '@/api/upload'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { buildExtractTaskMeta, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'

/**
 * 场景管理 Composable
 * @param {object} deps - 共享依赖
 * @param {object} deps.store - Pinia store
 * @param {import('vue').ComputedRef} deps.dramaId
 * @param {import('vue').ComputedRef} deps.currentEpisodeId
 * @param {Function} deps.getSelectedStyle
 * @param {Function} deps.scriptLanguage - ref
 * @param {Function} deps.loadDrama
 * @param {Function} deps.pollTask
 * @param {Function} deps.pollUntilResourceHasImage
 * @param {Function} deps.hasAssetImage
 * @param {object} deps.dramaAPI
 */
export function useScenes(deps) {
  const {
    store,
    dramaId,
    currentEpisodeId,
    getSelectedStyle,
    scriptLanguage,
    loadDrama,
    pollTask,
    pollUntilResourceHasImage,
    hasAssetImage,
    dramaAPI,
    ElMessage = RawElMessage,
    sceneAPI = rawSceneAPI,
    sceneLibraryAPI = rawSceneLibraryAPI,
    uploadAPI = rawUploadAPI,
  } = deps
  const genStore = useGenerationTaskStore()

  function buildSceneImageMeta(scene) {
    const dramaTitle = store.drama?.title || ''
    const epNum = store.currentEpisode?.episode_number
    const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
    return {
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      dramaTitle,
      episodeNumber: epNum,
      resourceType: GEN_RESOURCE.SCENE_IMAGE,
      resourceId: scene.id,
      label: `${epLabel} 场景图: ${scene.location || scene.id}`,
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

  // ── 场景弹窗状态 ──────────────────────────────────────
  const showEditScene = ref(false)
  const editSceneForm = ref(null)
  const editSceneSaving = ref(false)
  const editScenePromptGenerating = ref(false)
  const extractingSceneDesc = ref(false)
  const addSceneRefImage = ref(null)   // { dataUrl, filename }
  const addSceneRefFileInput = ref(null)
  let editScenePollTimer = null

  // ── 场景生成状态 ──────────────────────────────────────
  const scenesExtracting = computed(() =>
    isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.EXTRACT_SCENES)
  )
  const generatingSceneIds = reactive(new Set())
  const generatingPanoramaIds = reactive(new Set())

  const {
    showSceneLibrary,
    sceneLibraryList,
    sceneLibraryLoading,
    sceneLibraryPage,
    sceneLibraryPageSize,
    sceneLibraryTotal,
    sceneLibraryKeyword,
    sceneLibraryTab,
    dramaAllSceneList,
    dramaAllSceneLoading,
    dramaAllScenePage,
    dramaAllScenePageSize,
    dramaAllSceneTotal,
    dramaAllSceneKeyword,
    showEditSceneLibrary,
    editSceneLibraryForm,
    editSceneLibrarySaving,
    addingSceneToLibraryId,
    addingSceneToMaterialId,
    addingSceneFromLibraryId,
    loadSceneLibraryList,
    debouncedLoadSceneLibrary,
    loadDramaAllSceneList,
    debouncedLoadDramaAllSceneList,
    onSceneLibraryDialogOpen,
    onSceneLibraryTabChange,
    isSceneAddToEpisodeLoading,
    openEditSceneLibrary,
    submitEditSceneLibrary,
    onDeleteSceneLibrary,
    onAddSceneToLibrary,
    onAddSceneToMaterialLibrary,
    onAddSceneFromLibrary,
    onAddDramaSceneToEpisode,
  } = useSceneLibrary({
    store,
    dramaId,
    currentEpisodeId,
    loadDrama,
    hasAssetImage,
    ElMessage,
    sceneAPI,
    sceneLibraryAPI,
  })


  // ── 函数 ──────────────────────────────────────────────
  async function onExtractScenes() {
    if (!currentEpisodeId.value) return
    const epId = currentEpisodeId.value
    const meta = buildExtractTaskMeta(store, dramaId.value, epId, GEN_RESOURCE.EXTRACT_SCENES, '提取场景')
    genStore.markRunning(meta)
    try {
      const res = await dramaAPI.extractBackgrounds(epId, {
        model: undefined,
        style: getSelectedStyle(),
        language: scriptLanguage.value
      })
      const taskId = res?.task_id
      if (taskId) {
        const pollRes = await pollTask(taskId, () => loadDrama(), meta)
        if (pollRes?.status === 'completed') {
          ElMessage.success('场景提取完成')
        } else if (pollRes?.status === 'timeout') {
          ElMessage.warning(toUserFacingError(pollRes?.error, '场景提取超时，请稍后重试'))
        } else if (pollRes?.status === 'cancelled' || pollRes?.status === 'canceled') {
          ElMessage.info(toUserFacingError(pollRes?.error, '操作已取消'))
        } else {
          ElMessage.warning(toUserFacingError(pollRes?.error, '场景提取未完成'))
        }
      } else {
        await loadDrama()
        ElMessage.success('场景提取任务已提交')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '提取失败'))
    } finally {
      genStore.markDone(meta)
    }
  }

  function openAddScene() {
    editSceneForm.value = { location: '', time: '', prompt: '' }
    showEditScene.value = true
  }

  function stopScenePromptPoll() {
    if (editScenePollTimer) { clearInterval(editScenePollTimer); editScenePollTimer = null }
  }

  function editScene(scene) {
    stopScenePromptPoll()
    editSceneForm.value = {
      id: scene.id,
      location: scene.location || '',
      time: scene.time || '',
      prompt: scene.prompt || '',
      polished_prompt: scene.polished_prompt || '',
      polished_prompt_single: scene.polished_prompt_single || '',
      image_url: scene.image_url || '',
      local_path: scene.local_path || '',
      ref_image: scene.ref_image || '',
    }
    showEditScene.value = true
    if (!scene.polished_prompt && scene.id && (scene.location || scene.time)) {
      editScenePromptGenerating.value = true
      let elapsed = 0
      editScenePollTimer = setInterval(async () => {
        elapsed += 3
        try {
          const res = await sceneAPI.get(scene.id)
          const p = res?.scene?.polished_prompt
          if (p) {
            if (editSceneForm.value?.id === scene.id) editSceneForm.value.polished_prompt = p
            stopScenePromptPoll()
            editScenePromptGenerating.value = false
          } else if (elapsed >= 60) {
            stopScenePromptPoll()
            editScenePromptGenerating.value = false
          }
        } catch (_) {
          stopScenePromptPoll()
          editScenePromptGenerating.value = false
        }
      }, 3000)
    }
  }

  async function doGenerateScenePrompt() {
    const form = editSceneForm.value
    if (!form?.id) return
    editScenePromptGenerating.value = true
    try {
      const res = await sceneAPI.generatePrompt(form.id)
      if (res?.polished_prompt) {
        form.polished_prompt = res.polished_prompt
        ElMessage.success('提示词已生成')
        await loadDrama()
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '生成提示词失败'))
    } finally {
      editScenePromptGenerating.value = false
    }
  }

  async function doGenerateSceneSinglePrompt() {
    const form = editSceneForm.value
    if (!form?.id) return
    editScenePromptGenerating.value = true
    try {
      const res = await sceneAPI.generatePrompt(form.id, undefined, undefined, 'single')
      if (res?.polished_prompt_single) {
        form.polished_prompt_single = res.polished_prompt_single
        ElMessage.success('单图提示词已生成')
        await loadDrama()
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '生成提示词失败'))
    } finally {
      editScenePromptGenerating.value = false
    }
  }

  async function saveSceneRefImageIfAny(sceneId) {
    const refImg = addSceneRefImage.value
    if (!refImg || !sceneId) return
    try {
      const file = dataUrlToFile(refImg.dataUrl, refImg.filename || 'reference.png')
      const uploadRes = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
      const refPath = uploadRes.local_path || uploadRes.url || ''
      await sceneAPI.putRefImage(sceneId, refPath)
    } catch (e) {
      console.warn('[saveSceneRefImage] 保存参考图失败:', e.message)
    }
  }

  async function clearSceneRefImage() {
    const form = editSceneForm.value
    if (!form?.id) return
    try {
      await sceneAPI.putRefImage(form.id, null)
      form.ref_image = ''
      ElMessage.success('参考图已移除')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '移除失败'))
    }
  }

  async function doExtractSceneFromImage() {
    const form = editSceneForm.value
    if (!form?.id) return
    extractingSceneDesc.value = true
    try {
      const res = await sceneAPI.extractFromImage(form.id)
      if (res?.prompt) {
        form.prompt = res.prompt
        ElMessage.success('已从图片提取场景描述')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '提取失败，请检查场景是否已上传参考图片'))
    } finally {
      extractingSceneDesc.value = false
    }
  }

  async function submitEditScene() {
    const form = editSceneForm.value
    if (!form?.location?.trim() || !store.dramaId) return
    editSceneSaving.value = true
    try {
      if (form.id) {
        await sceneAPI.update(form.id, {
          location: form.location.trim(),
          time: form.time || undefined,
          prompt: form.prompt || undefined,
          polished_prompt: form.polished_prompt || undefined,
          polished_prompt_single: form.polished_prompt_single || undefined
        })
        await saveSceneRefImageIfAny(form.id)
        ElMessage.success('场景已保存')
      } else {
        await sceneAPI.create({
          drama_id: store.dramaId,
          episode_id: currentEpisodeId.value || undefined,
          location: form.location.trim(),
          time: form.time || undefined,
          prompt: form.prompt || undefined
        })
        await loadDrama()
        if (addSceneRefImage.value) {
          const newScene = (store.drama?.scenes || []).find(
            s => s.location === form.location.trim() && (s.time || '') === (form.time || '')
          )
          if (newScene?.id) await saveSceneRefImageIfAny(newScene.id)
        }
        ElMessage.success('场景已添加')
      }
      await loadDrama()
      showEditScene.value = false
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, form.id ? '保存失败' : '添加失败'))
    } finally {
      editSceneSaving.value = false
    }
  }

  function onCloseSceneDialog() {
    showEditScene.value = false
    stopScenePromptPoll()
    editScenePromptGenerating.value = false
    addSceneRefImage.value = null
  }

  async function onDeleteScene(scene) {
    try {
      await ElMessageBox.confirm(
        `确定要删除场景「${(scene.location || scene.time || '未命名').slice(0, 20)}」吗？此操作不可恢复。`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
      await sceneAPI.delete(scene.id)
      await loadDrama()
      ElMessage.success('场景已删除')
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '删除失败'))
    }
  }

  async function onGenerateSceneImage(scene, useQuadGrid = false) {
    scene.errorMsg = ''
    scene.error_msg = ''
    const meta = buildSceneImageMeta(scene)
    generatingSceneIds.add(scene.id)
    genStore.markRunning(meta)
    try {
      const res = await sceneAPI.generateImage({
        scene_id: scene.id,
        model: undefined,
        style: getSelectedStyle(),
        use_quad_grid: !!useQuadGrid
      })
      const taskId = res?.image_generation?.task_id ?? res?.task_id
      if (taskId) {
        const pollRes = await pollTask(taskId, () => loadDrama(), meta)
        if (pollRes?.status === 'failed') {
          scene.errorMsg = toUserFacingError(pollRes.error, '生成失败')
        } else if (pollRes?.status === 'completed') {
          ElMessage.success('场景图片已生成')
        } else if (pollRes?.status === 'timeout') {
          scene.errorMsg = toUserFacingError(pollRes?.error, '生成超时，请稍后重试')
          ElMessage.warning(scene.errorMsg)
        } else if (pollRes?.status === 'cancelled' || pollRes?.status === 'canceled') {
          scene.errorMsg = toUserFacingError(pollRes?.error, '操作已取消')
        } else {
          scene.errorMsg = toUserFacingError(pollRes?.error, '场景图片生成未完成')
          ElMessage.warning(scene.errorMsg)
        }
      } else {
        await loadDrama()
        await pollUntilResourceHasImage(() => {
          const list = store.drama?.scenes ?? store.currentEpisode?.scenes ?? []
          const s = list.find((x) => Number(x.id) === Number(scene.id))
          return !!(s && (s.image_url || s.local_path))
        })
        ElMessage.success('场景图片已生成')
      }
    } catch (e) {
      scene.errorMsg = toUserFacingError(e, '生成失败')
      if (isUserFacingAbort(e)) return
      console.error(e)
      ElMessage.error(toUserFacingError(e, '提交失败'))
    } finally {
      generatingSceneIds.delete(scene.id)
      genStore.markDone(meta)
    }
  }


  async function onGenerateScenePanorama(scene) {
    if (!scene?.id) return
    if (!hasAssetImage(scene)) {
      ElMessage.warning('请先为该场景生成或上传主图')
      return
    }
    const meta = {
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      resourceType: 'scene_panorama',
      resourceId: scene.id,
      label: `全景图: ${scene.location || scene.id}`,
    }
    generatingPanoramaIds.add(scene.id)
    genStore.markRunning(meta)
    try {
      const res = await sceneAPI.generatePanorama(scene.id)
      const taskId = res?.image_generation?.task_id ?? res?.task_id
      if (!taskId) throw new Error('全景图任务未返回')
      const pollRes = await pollTask(taskId, () => loadDrama(), meta)
      if (pollRes?.status === 'failed') {
        ElMessage.error(toUserFacingError(pollRes.error, '全景图生成失败'))
      } else if (pollRes?.status === 'completed') {
        ElMessage.success('全景图已生成')
      } else if (pollRes?.status === 'timeout') {
        ElMessage.warning(toUserFacingError(pollRes?.error, '全景图生成超时，请稍后重试'))
      } else if (pollRes?.status === 'cancelled' || pollRes?.status === 'canceled') {
        ElMessage.info(toUserFacingError(pollRes?.error, '操作已取消'))
      } else {
        ElMessage.warning(toUserFacingError(pollRes?.error, '全景图生成未完成'))
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '全景图生成失败'))
    } finally {
      generatingPanoramaIds.delete(scene.id)
      genStore.markDone(meta)
    }
  }

  return {
    // 弹窗状态
    showEditScene,
    editSceneForm,
    editSceneSaving,
    editScenePromptGenerating,
    extractingSceneDesc,
    addSceneRefImage,
    addSceneRefFileInput,
    // 生成状态
    scenesExtracting,
    generatingSceneIds,
    generatingPanoramaIds,
    // 库状态
    showSceneLibrary,
    sceneLibraryList,
    sceneLibraryLoading,
    sceneLibraryPage,
    sceneLibraryPageSize,
    sceneLibraryTotal,
    sceneLibraryKeyword,
    sceneLibraryTab,
    dramaAllSceneList,
    dramaAllSceneLoading,
    dramaAllScenePage,
    dramaAllScenePageSize,
    dramaAllSceneTotal,
    dramaAllSceneKeyword,






    showEditSceneLibrary,
    editSceneLibraryForm,
    editSceneLibrarySaving,
    addingSceneToLibraryId,
    addingSceneToMaterialId,

    addingSceneFromLibraryId,
    // 函数
    onExtractScenes,
    openAddScene,
    stopScenePromptPoll,
    editScene,
    doGenerateScenePrompt,
    doGenerateSceneSinglePrompt,
    saveSceneRefImageIfAny,
    clearSceneRefImage,
    doExtractSceneFromImage,
    submitEditScene,
    onCloseSceneDialog,
    onDeleteScene,
    onGenerateSceneImage,
    onGenerateScenePanorama,
    loadSceneLibraryList,
    debouncedLoadSceneLibrary,
    loadDramaAllSceneList,
    debouncedLoadDramaAllSceneList,


    onSceneLibraryDialogOpen,
    onSceneLibraryTabChange,
    isSceneAddToEpisodeLoading,
    openEditSceneLibrary,
    submitEditSceneLibrary,
    onDeleteSceneLibrary,
    onAddSceneToLibrary,
    onAddSceneToMaterialLibrary,



    onAddSceneFromLibrary,
    onAddDramaSceneToEpisode,

  }
}
