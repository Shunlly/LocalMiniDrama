import { ref } from 'vue'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { propAPI as rawPropAPI } from '@/api/props'
import { propLibraryAPI as rawPropLibraryAPI } from '@/api/propLibrary'

/**
 * 道具资料库 Composable
 * 负责资料库加载、编辑、加入剧集与素材库。
 * @param {object} deps - 共享依赖
 */
export function usePropLibrary(deps) {
  const {
    store,
    dramaId,
    currentEpisodeId,
    loadDrama,
    hasAssetImage,
    ElMessage = RawElMessage,
    propAPI = rawPropAPI,
    propLibraryAPI = rawPropLibraryAPI,
  } = deps

  // ── 道具库状态 ────────────────────────────────────────
  const showPropLibrary = ref(false)
  const propLibraryList = ref([])
  const propLibraryLoading = ref(false)
  const propLibraryPage = ref(1)
  const propLibraryPageSize = ref(20)
  const propLibraryTotal = ref(0)
  const propLibraryKeyword = ref('')
  const showEditPropLibrary = ref(false)
  const editPropLibraryForm = ref(null)
  const editPropLibrarySaving = ref(false)
  const addingPropToLibraryId = ref(null)
  const addingPropToMaterialId = ref(null)
  const addingPropFromLibraryId = ref(null)
  let propLibraryKeywordTimer = null

  const propLibraryTab = ref('library')
  const dramaAllPropList = ref([])
  const dramaAllPropLoading = ref(false)
  const dramaAllPropPage = ref(1)
  const dramaAllPropPageSize = ref(20)
  const dramaAllPropTotal = ref(0)
  const dramaAllPropKeyword = ref('')
  let dramaAllPropKeywordTimer = null

  // ── 道具库函数 ────────────────────────────────────────
  async function loadPropLibraryList() {
    propLibraryLoading.value = true
    try {
      const res = await propLibraryAPI.list({
        drama_id: dramaId.value,
        page: propLibraryPage.value,
        page_size: propLibraryPageSize.value,
        keyword: propLibraryKeyword.value || undefined
      })
      propLibraryList.value = res?.items ?? []
      const pagination = res?.pagination ?? {}
      propLibraryTotal.value = pagination.total ?? 0
      if (pagination.page != null) propLibraryPage.value = pagination.page
      if (pagination.page_size != null) propLibraryPageSize.value = pagination.page_size
    } catch (e) {
      propLibraryList.value = []
    } finally {
      propLibraryLoading.value = false
    }
  }

  function debouncedLoadPropLibrary() {
    if (propLibraryKeywordTimer) clearTimeout(propLibraryKeywordTimer)
    propLibraryKeywordTimer = setTimeout(() => {
      propLibraryPage.value = 1
      loadPropLibraryList()
    }, 300)
  }

  async function loadDramaAllPropList() {
    if (!dramaId.value) {
      dramaAllPropList.value = []
      dramaAllPropTotal.value = 0
      return
    }
    dramaAllPropLoading.value = true
    try {
      const res = await propAPI.list(dramaId.value)
      let list = Array.isArray(res) ? res : (res?.items ?? res?.props ?? [])
      const kw = (dramaAllPropKeyword.value || '').trim().toLowerCase()
      if (kw) {
        list = list.filter((p) => {
          const name = (p.name || '').toLowerCase()
          const desc = (p.description || '').toLowerCase()
          const prompt = (p.prompt || '').toLowerCase()
          return name.includes(kw) || desc.includes(kw) || prompt.includes(kw)
        })
      }
      dramaAllPropTotal.value = list.length
      const start = (dramaAllPropPage.value - 1) * dramaAllPropPageSize.value
      dramaAllPropList.value = list.slice(start, start + dramaAllPropPageSize.value)
    } catch {
      dramaAllPropList.value = []
      dramaAllPropTotal.value = 0
    } finally {
      dramaAllPropLoading.value = false
    }
  }

  function debouncedLoadDramaAllPropList() {
    if (dramaAllPropKeywordTimer) clearTimeout(dramaAllPropKeywordTimer)
    dramaAllPropKeywordTimer = setTimeout(() => {
      dramaAllPropPage.value = 1
      loadDramaAllPropList()
    }, 300)
  }

  function onPropLibraryDialogOpen() {
    if (propLibraryTab.value === 'library') loadPropLibraryList()
    else if (propLibraryTab.value === 'drama') loadDramaAllPropList()
    
  }

  function onPropLibraryTabChange() {
    if (propLibraryTab.value === 'library') {
      propLibraryPage.value = 1
      loadPropLibraryList()
    } else if (propLibraryTab.value === 'drama') {
      dramaAllPropPage.value = 1
      loadDramaAllPropList()
    } 
  }

  function propAddToEpisodeLoadingKey(scope, id) {
    return `${scope}-${id}`
  }

  function isPropAddToEpisodeLoading(scope, id) {
    return addingPropFromLibraryId.value === propAddToEpisodeLoadingKey(scope, id)
  }

  function openEditPropLibrary(item) {
    editPropLibraryForm.value = {
      id: item.id,
      name: item.name ?? '',
      category: item.category ?? '',
      description: item.description ?? '',
      tags: item.tags ?? ''
    }
    showEditPropLibrary.value = true
  }

  async function submitEditPropLibrary() {
    if (!editPropLibraryForm.value?.id) return
    editPropLibrarySaving.value = true
    try {
      await propLibraryAPI.update(editPropLibraryForm.value.id, {
        name: editPropLibraryForm.value.name,
        category: editPropLibraryForm.value.category || null,
        description: editPropLibraryForm.value.description || null,
        tags: editPropLibraryForm.value.tags || null
      })
      ElMessage.success('已保存')
      showEditPropLibrary.value = false
      loadPropLibraryList()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      editPropLibrarySaving.value = false
    }
  }

  async function onDeletePropLibrary(item) {
    try {
      await ElMessageBox.confirm(
        `确定删除公共道具「${(item.name || '未命名').slice(0, 20)}」吗？`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
      await propLibraryAPI.delete(item.id)
      ElMessage.success('已删除')
      loadPropLibraryList()
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '删除失败'))
    }
  }

  async function onAddPropToLibrary(prop) {
    if (!hasAssetImage(prop)) { ElMessage.warning('请先为该道具生成或上传图片'); return }
    addingPropToLibraryId.value = prop.id
    try {
      await propAPI.addToLibrary(prop.id, {})
      ElMessage.success('已加入本剧道具库')
      if (showPropLibrary.value) loadPropLibraryList()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingPropToLibraryId.value = null
    }
  }

  async function onAddPropToMaterialLibrary(prop) {
    if (!hasAssetImage(prop)) { ElMessage.warning('请先为该道具生成或上传图片'); return }
    addingPropToMaterialId.value = prop.id
    try {
      await propAPI.addToMaterialLibrary(prop.id)
      ElMessage.success('已加入全局素材库')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingPropToMaterialId.value = null
    }
  }

  async function addPropToEpisode(item, scope) {
    if (!store.dramaId || !currentEpisodeId.value) {
      ElMessage.warning('请先选择本集')
      return
    }
    const loadingKey = propAddToEpisodeLoadingKey(scope, item.id)
    addingPropFromLibraryId.value = loadingKey
    try {
      const existingProp = (store.props || []).find((p) => p.name === item.name)
      if (existingProp) {
        await propAPI.update(existingProp.id, {
          name: item.name || existingProp.name,
          type: item.type || existingProp.type || undefined,
          description: item.description || existingProp.description || undefined,
          prompt: item.prompt || existingProp.prompt || undefined,
          image_url: item.image_url || existingProp.image_url || undefined,
          local_path: item.local_path || existingProp.local_path || undefined,
        })
        ElMessage.success(`「${item.name || '道具'}」已更新到本集`)
      } else {
        await propAPI.create({
          drama_id: store.dramaId,
          episode_id: currentEpisodeId.value,
          name: item.name || '',
          type: item.type || undefined,
          description: item.description || undefined,
          prompt: item.prompt || undefined,
          image_url: item.image_url || undefined,
          local_path: item.local_path || undefined,
        })
        ElMessage.success(`「${item.name || '道具'}」已加入本集`)
      }
      await loadDrama()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingPropFromLibraryId.value = null
    }
  }

  function onAddPropFromLibrary(item) {
    return addPropToEpisode(item, 'library')
  }

  function onAddDramaPropToEpisode(item) {
    return addPropToEpisode(item, 'drama')
  }

  function onAddTeamPropToEpisode(item) {
    return addPropToEpisode(item, 'team')
  }

  return {
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
  }
}
