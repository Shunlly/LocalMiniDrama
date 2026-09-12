/**
 * 从全局素材库导入角色、场景、道具到本剧资源库。
 * 列表请求不带 drama_id，写入时才带本剧项目 ID。
 */
import { ref } from 'vue'

export function createDramaDetailResourceImport({
  dramaId,
  characterLibraryAPI,
  sceneLibraryAPI,
  propLibraryAPI,
  loadCharList,
  loadSceneList,
  loadPropList,
  ElMessage,
  dramaDetailUserError,
} = {}) {
  const importVisible = ref(false)
  const importType = ref('char')
  const importList = ref([])
  const importLoading = ref(false)
  const importError = ref('')
  const importPage = ref(1)
  const importPageSize = ref(20)
  const importTotal = ref(0)
  const importKw = ref('')
  const importingId = ref(null)
  let importKwTimer = null

  function openImport(type) {
    importType.value = type
    importKw.value = ''
    importPage.value = 1
    importVisible.value = true
  }

  function apiForImportType() {
    if (importType.value === 'char') return characterLibraryAPI
    if (importType.value === 'scene') return sceneLibraryAPI
    return propLibraryAPI
  }

  async function loadImportList() {
    importLoading.value = true
    try {
      const api = apiForImportType()
      // 不传 drama_id，获取全局素材库（所有记录）
      const res = await api.list({ page: importPage.value, page_size: importPageSize.value, keyword: importKw.value || undefined, global: 1 })
      importList.value = res?.items ?? []
      importTotal.value = res?.pagination?.total ?? 0
      importError.value = ''
    } catch (error) {
      importError.value = dramaDetailUserError(error, '全局素材库加载失败，请重试', '素材库')
    } finally { importLoading.value = false }
  }

  function onImportKwInput() {
    if (importKwTimer) clearTimeout(importKwTimer)
    importKwTimer = setTimeout(() => { importPage.value = 1; loadImportList() }, 300)
  }

  async function doImport(item) {
    importingId.value = item.id
    try {
      if (importType.value === 'char') {
        await characterLibraryAPI.create({
          drama_id: dramaId,
          name: item.name || '',
          image_url: item.image_url || null,
          local_path: item.local_path || null,
          description: item.description || null,
          category: item.category || null,
          tags: item.tags || null,
          source_type: 'imported',
        })
        loadCharList()
      } else if (importType.value === 'scene') {
        await sceneLibraryAPI.create({
          drama_id: dramaId,
          location: item.location || '',
          time: item.time || null,
          prompt: item.prompt || null,
          description: item.description || null,
          image_url: item.image_url || null,
          local_path: item.local_path || null,
          category: item.category || null,
          tags: item.tags || null,
          source_type: 'imported',
        })
        loadSceneList()
      } else {
        await propLibraryAPI.create({
          drama_id: dramaId,
          name: item.name || '',
          description: item.description || null,
          prompt: item.prompt || null,
          image_url: item.image_url || null,
          local_path: item.local_path || null,
          category: item.category || null,
          tags: item.tags || null,
          source_type: 'imported',
        })
        loadPropList()
      }
      ElMessage.success('已导入到本剧资源库')
    } catch (e) {
      ElMessage.error(dramaDetailUserError(e, '导入失败', '素材库'))
    } finally {
      importingId.value = null
    }
  }

  return {
    importVisible,
    importType,
    importList,
    importLoading,
    importError,
    importPage,
    importPageSize,
    importTotal,
    importKw,
    importingId,
    openImport,
    loadImportList,
    onImportKwInput,
    doImport,
  }
}
