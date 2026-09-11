/**
 * 剧集详情本剧资源库列表的加载、检索和增删改。
 * 列表请求始终带 drama_id，不把分集 ID 当成项目 ID。
 */
import { ref } from 'vue'

export function createDramaDetailResourceLists({
  dramaId,
  characterLibraryAPI,
  sceneLibraryAPI,
  propLibraryAPI,
  ElMessage,
  ElMessageBox,
  captureResourceEditorBaseline,
  editCharForm,
  editCharVisible,
  editCharSaving,
  editSceneForm,
  editSceneVisible,
  editSceneSaving,
  editPropForm,
  editPropVisible,
  editPropSaving,
  dramaDetailUserError,
} = {}) {
  // 角色
  const charList = ref([]), charLoading = ref(false), charError = ref(''), charPage = ref(1), charPageSize = ref(20), charTotal = ref(0), charKw = ref('')
  let charKwTimer = null
  async function loadCharList() {
    charLoading.value = true
    try {
      const res = await characterLibraryAPI.list({ drama_id: dramaId, page: charPage.value, page_size: charPageSize.value, keyword: charKw.value || undefined })
      charList.value = res?.items ?? []; charTotal.value = res?.pagination?.total ?? 0
      charError.value = ''
    } catch (error) {
      charError.value = dramaDetailUserError(error, '角色库加载失败，请重试', '角色库')
    } finally { charLoading.value = false }
  }
  function onCharKwInput() { if (charKwTimer) clearTimeout(charKwTimer); charKwTimer = setTimeout(() => { charPage.value = 1; loadCharList() }, 300) }
  function openEditChar(item) {
    editCharForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
    captureResourceEditorBaseline('char')
    editCharVisible.value = true
  }
  async function saveChar() {
    if (!editCharForm.value?.id) return; editCharSaving.value = true
    try {
      await characterLibraryAPI.update(editCharForm.value.id, { name: editCharForm.value.name, category: editCharForm.value.category || null, description: editCharForm.value.description || null, tags: editCharForm.value.tags || null, image_url: editCharForm.value.image_url || null, local_path: editCharForm.value.local_path ?? null })
      ElMessage.success('已保存'); editCharVisible.value = false; loadCharList()
    } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) } finally { editCharSaving.value = false }
  }
  async function deleteChar(item) {
    try { await ElMessageBox.confirm(`确定删除「${(item.name || '未命名').slice(0, 20)}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
    try { await characterLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadCharList() } catch (e) { ElMessage.error(dramaDetailUserError(e, '删除失败')) }
  }

  // 场景
  const sceneList = ref([]), sceneLoading = ref(false), sceneError = ref(''), scenePage = ref(1), scenePageSize = ref(20), sceneTotal = ref(0), sceneKw = ref('')
  let sceneKwTimer = null
  async function loadSceneList() {
    sceneLoading.value = true
    try {
      const res = await sceneLibraryAPI.list({ drama_id: dramaId, page: scenePage.value, page_size: scenePageSize.value, keyword: sceneKw.value || undefined })
      sceneList.value = res?.items ?? []; sceneTotal.value = res?.pagination?.total ?? 0
      sceneError.value = ''
    } catch (error) {
      sceneError.value = dramaDetailUserError(error, '场景库加载失败，请重试', '场景库')
    } finally { sceneLoading.value = false }
  }
  function onSceneKwInput() { if (sceneKwTimer) clearTimeout(sceneKwTimer); sceneKwTimer = setTimeout(() => { scenePage.value = 1; loadSceneList() }, 300) }
  function openEditScene(item) {
    editSceneForm.value = { id: item.id, location: item.location ?? '', time: item.time ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
    captureResourceEditorBaseline('scene')
    editSceneVisible.value = true
  }
  async function saveScene() {
    if (!editSceneForm.value?.id) return; editSceneSaving.value = true
    try {
      await sceneLibraryAPI.update(editSceneForm.value.id, { location: editSceneForm.value.location, time: editSceneForm.value.time || null, category: editSceneForm.value.category || null, description: editSceneForm.value.description || null, tags: editSceneForm.value.tags || null, image_url: editSceneForm.value.image_url || null, local_path: editSceneForm.value.local_path ?? null })
      ElMessage.success('已保存'); editSceneVisible.value = false; loadSceneList()
    } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) } finally { editSceneSaving.value = false }
  }
  async function deleteScene(item) {
    const n = (item.location || item.time || '未命名').slice(0, 20)
    try { await ElMessageBox.confirm(`确定删除「${n}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
    try { await sceneLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadSceneList() } catch (e) { ElMessage.error(dramaDetailUserError(e, '删除失败')) }
  }

  // 道具
  const propList = ref([]), propLoading = ref(false), propError = ref(''), propPage = ref(1), propPageSize = ref(20), propTotal = ref(0), propKw = ref('')
  let propKwTimer = null
  async function loadPropList() {
    propLoading.value = true
    try {
      const res = await propLibraryAPI.list({ drama_id: dramaId, page: propPage.value, page_size: propPageSize.value, keyword: propKw.value || undefined })
      propList.value = res?.items ?? []; propTotal.value = res?.pagination?.total ?? 0
      propError.value = ''
    } catch (error) {
      propError.value = dramaDetailUserError(error, '道具库加载失败，请重试', '道具库')
    } finally { propLoading.value = false }
  }
  function onPropKwInput() { if (propKwTimer) clearTimeout(propKwTimer); propKwTimer = setTimeout(() => { propPage.value = 1; loadPropList() }, 300) }
  function openEditProp(item) {
    editPropForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
    captureResourceEditorBaseline('prop')
    editPropVisible.value = true
  }
  async function saveProp() {
    if (!editPropForm.value?.id) return; editPropSaving.value = true
    try {
      await propLibraryAPI.update(editPropForm.value.id, { name: editPropForm.value.name, category: editPropForm.value.category || null, description: editPropForm.value.description || null, tags: editPropForm.value.tags || null, image_url: editPropForm.value.image_url || null, local_path: editPropForm.value.local_path ?? null })
      ElMessage.success('已保存'); editPropVisible.value = false; loadPropList()
    } catch (e) { ElMessage.error(dramaDetailUserError(e, '保存失败')) } finally { editPropSaving.value = false }
  }
  async function deleteProp(item) {
    try { await ElMessageBox.confirm(`确定删除「${(item.name || '未命名').slice(0, 20)}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
    try { await propLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadPropList() } catch (e) { ElMessage.error(dramaDetailUserError(e, '删除失败')) }
  }

  return {
    charList,
    charLoading,
    charError,
    charPage,
    charPageSize,
    charTotal,
    charKw,
    loadCharList,
    onCharKwInput,
    openEditChar,
    saveChar,
    deleteChar,
    sceneList,
    sceneLoading,
    sceneError,
    scenePage,
    scenePageSize,
    sceneTotal,
    sceneKw,
    loadSceneList,
    onSceneKwInput,
    openEditScene,
    saveScene,
    deleteScene,
    propList,
    propLoading,
    propError,
    propPage,
    propPageSize,
    propTotal,
    propKw,
    loadPropList,
    onPropKwInput,
    openEditProp,
    saveProp,
    deleteProp,
  }
}
