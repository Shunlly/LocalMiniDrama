import { ref } from 'vue'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ElMessageBox } from '@/utils/elementPlusFeedback.js'

/**
 * 场景资料库：加载、编辑、加入剧集与素材库。
 * @param {object} deps - 由 useScenes 注入的共享依赖
 */
export function useSceneLibrary(deps) {
  const {
    store,
    dramaId,
    currentEpisodeId,
    loadDrama,
    hasAssetImage,
    ElMessage,
    sceneAPI,
    sceneLibraryAPI,
  } = deps

  // ── 场景库状态 ────────────────────────────────────────
  const showSceneLibrary = ref(false)
  const sceneLibraryList = ref([])
  const sceneLibraryLoading = ref(false)
  const sceneLibraryPage = ref(1)
  const sceneLibraryPageSize = ref(20)
  const sceneLibraryTotal = ref(0)
  const sceneLibraryKeyword = ref('')
  const showEditSceneLibrary = ref(false)
  const editSceneLibraryForm = ref(null)
  const editSceneLibrarySaving = ref(false)
  const addingSceneToLibraryId = ref(null)
  const addingSceneToMaterialId = ref(null)
  const addingSceneFromLibraryId = ref(null)
  let sceneLibraryKeywordTimer = null

  const sceneLibraryTab = ref('library')
  const dramaAllSceneList = ref([])
  const dramaAllSceneLoading = ref(false)
  const dramaAllScenePage = ref(1)
  const dramaAllScenePageSize = ref(20)
  const dramaAllSceneTotal = ref(0)
  const dramaAllSceneKeyword = ref('')
  let dramaAllSceneKeywordTimer = null

  // ── 场景库函数 ────────────────────────────────────────
  async function loadSceneLibraryList() {
    sceneLibraryLoading.value = true
    try {
      const res = await sceneLibraryAPI.list({
        drama_id: dramaId.value,
        page: sceneLibraryPage.value,
        page_size: sceneLibraryPageSize.value,
        keyword: sceneLibraryKeyword.value || undefined
      })
      sceneLibraryList.value = res?.items ?? []
      const pagination = res?.pagination ?? {}
      sceneLibraryTotal.value = pagination.total ?? 0
      if (pagination.page != null) sceneLibraryPage.value = pagination.page
      if (pagination.page_size != null) sceneLibraryPageSize.value = pagination.page_size
    } catch (e) {
      sceneLibraryList.value = []
    } finally {
      sceneLibraryLoading.value = false
    }
  }

  function debouncedLoadSceneLibrary() {
    if (sceneLibraryKeywordTimer) clearTimeout(sceneLibraryKeywordTimer)
    sceneLibraryKeywordTimer = setTimeout(() => {
      sceneLibraryPage.value = 1
      loadSceneLibraryList()
    }, 300)
  }

  async function loadDramaAllSceneList() {
    if (!dramaId.value) {
      dramaAllSceneList.value = []
      dramaAllSceneTotal.value = 0
      return
    }
    dramaAllSceneLoading.value = true
    try {
      const res = await sceneAPI.list(dramaId.value)
      let list = Array.isArray(res) ? res : (res?.items ?? res?.scenes ?? [])
      const kw = (dramaAllSceneKeyword.value || '').trim().toLowerCase()
      if (kw) {
        list = list.filter((s) => {
          const loc = (s.location || '').toLowerCase()
          const time = (s.time || '').toLowerCase()
          const desc = (s.description || '').toLowerCase()
          const prompt = (s.prompt || '').toLowerCase()
          return loc.includes(kw) || time.includes(kw) || desc.includes(kw) || prompt.includes(kw)
        })
      }
      dramaAllSceneTotal.value = list.length
      const start = (dramaAllScenePage.value - 1) * dramaAllScenePageSize.value
      dramaAllSceneList.value = list.slice(start, start + dramaAllScenePageSize.value)
    } catch {
      dramaAllSceneList.value = []
      dramaAllSceneTotal.value = 0
    } finally {
      dramaAllSceneLoading.value = false
    }
  }

  function debouncedLoadDramaAllSceneList() {
    if (dramaAllSceneKeywordTimer) clearTimeout(dramaAllSceneKeywordTimer)
    dramaAllSceneKeywordTimer = setTimeout(() => {
      dramaAllScenePage.value = 1
      loadDramaAllSceneList()
    }, 300)
  }

  function onSceneLibraryDialogOpen() {
    if (sceneLibraryTab.value === 'library') loadSceneLibraryList()
    else if (sceneLibraryTab.value === 'drama') loadDramaAllSceneList()
  }

  function onSceneLibraryTabChange() {
    if (sceneLibraryTab.value === 'library') {
      sceneLibraryPage.value = 1
      loadSceneLibraryList()
    } else if (sceneLibraryTab.value === 'drama') {
      dramaAllScenePage.value = 1
      loadDramaAllSceneList()
    }
  }

  function sceneAddToEpisodeLoadingKey(scope, id) {
    return `${scope}-${id}`
  }

  function isSceneAddToEpisodeLoading(scope, id) {
    return addingSceneFromLibraryId.value === sceneAddToEpisodeLoadingKey(scope, id)
  }

  function openEditSceneLibrary(item) {
    editSceneLibraryForm.value = {
      id: item.id,
      location: item.location ?? '',
      time: item.time ?? '',
      category: item.category ?? '',
      description: item.description ?? '',
      tags: item.tags ?? ''
    }
    showEditSceneLibrary.value = true
  }

  async function submitEditSceneLibrary() {
    if (!editSceneLibraryForm.value?.id) return
    editSceneLibrarySaving.value = true
    try {
      await sceneLibraryAPI.update(editSceneLibraryForm.value.id, {
        location: editSceneLibraryForm.value.location,
        time: editSceneLibraryForm.value.time || null,
        category: editSceneLibraryForm.value.category || null,
        description: editSceneLibraryForm.value.description || null,
        tags: editSceneLibraryForm.value.tags || null
      })
      ElMessage.success('已保存')
      showEditSceneLibrary.value = false
      loadSceneLibraryList()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      editSceneLibrarySaving.value = false
    }
  }

  async function onDeleteSceneLibrary(item) {
    try {
      const name = (item.location || item.time || '未命名').slice(0, 20)
      await ElMessageBox.confirm(
        `确定删除公共场景「${name}」吗？`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
      await sceneLibraryAPI.delete(item.id)
      ElMessage.success('已删除')
      loadSceneLibraryList()
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '删除失败'))
    }
  }

  async function onAddSceneToLibrary(scene) {
    if (!hasAssetImage(scene)) { ElMessage.warning('请先为该场景生成或上传图片'); return }
    addingSceneToLibraryId.value = scene.id
    try {
      await sceneAPI.addToLibrary(scene.id, {})
      ElMessage.success('已加入本剧场景库')
      if (showSceneLibrary.value) loadSceneLibraryList()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingSceneToLibraryId.value = null
    }
  }

  async function onAddSceneToMaterialLibrary(scene) {
    if (!hasAssetImage(scene)) { ElMessage.warning('请先为该场景生成或上传图片'); return }
    addingSceneToMaterialId.value = scene.id
    try {
      await sceneAPI.addToMaterialLibrary(scene.id)
      ElMessage.success('已加入全局素材库')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingSceneToMaterialId.value = null
    }
  }

  async function addSceneToEpisode(item, scope) {
    if (!store.dramaId || !currentEpisodeId.value) {
      ElMessage.warning('请先选择本集')
      return
    }
    const loadingKey = sceneAddToEpisodeLoadingKey(scope, item.id)
    addingSceneFromLibraryId.value = loadingKey
    try {
      const existingScene = (store.scenes || []).find((s) => s.location === item.location)
      if (existingScene) {
        await sceneAPI.update(existingScene.id, {
          location: item.location || existingScene.location,
          time: item.time || existingScene.time,
          prompt: existingScene.prompt || item.prompt || '',
          image_url: item.image_url || existingScene.image_url || undefined,
          local_path: item.local_path || existingScene.local_path || undefined,
        })
        ElMessage.success(`「${item.location || '场景'}」已更新到本集`)
      } else {
        await sceneAPI.create({
          drama_id: store.dramaId,
          episode_id: currentEpisodeId.value,
          location: item.location || '',
          time: item.time || '',
          prompt: item.prompt || '',
          image_url: item.image_url || undefined,
          local_path: item.local_path || undefined,
        })
        ElMessage.success(`「${item.location || '场景'}」已加入本集`)
      }
      await loadDrama()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingSceneFromLibraryId.value = null
    }
  }

  function onAddSceneFromLibrary(item) {
    return addSceneToEpisode(item, 'library')
  }

  function onAddDramaSceneToEpisode(item) {
    return addSceneToEpisode(item, 'drama')
  }

  function onAddTeamSceneToEpisode(item) {
    return addSceneToEpisode(item, 'team')
  }

  return {
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
    onAddTeamSceneToEpisode,
  }
}
