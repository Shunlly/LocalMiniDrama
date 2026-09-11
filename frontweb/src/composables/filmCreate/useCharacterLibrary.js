import { ref } from 'vue'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ElMessageBox } from '@/utils/elementPlusFeedback.js'

/**
 * 角色资料库与即梦认证
 * @param {object} deps - 由 useCharacters 注入的共享依赖
 */
export function useCharacterLibrary(deps) {
  const {
    store,
    dramaId,
    currentEpisodeId,
    loadDrama,
    hasAssetImage,
    ElMessage,
    characterAPI,
    characterLibraryAPI,
    dramaAPI,
    notifySd2VoiceRefreshSuccess,
  } = deps

  const sd2CertifyingId = ref(null)
  const showCharSd2Cert = ref(false)
  const charSd2CertPayload = ref(null)
  const sd2VoiceUploadingId = ref(null)

  // ── 角色库状态 ────────────────────────────────────────
  const showCharLibrary = ref(false)
  const charLibraryList = ref([])
  const charLibraryLoading = ref(false)
  const charLibraryPage = ref(1)
  const charLibraryPageSize = ref(20)
  const charLibraryTotal = ref(0)
  const charLibraryKeyword = ref('')
  const showEditCharLibrary = ref(false)
  const editCharLibraryForm = ref(null)
  const editCharLibrarySaving = ref(false)
  const addingCharToLibraryId = ref(null)
  const addingCharToMaterialId = ref(null)
  const addingCharFromLibraryId = ref(null)
  let charLibraryKeywordTimer = null

  /** 角色库弹窗 Tab：library | drama | team */
  const charLibraryTab = ref('library')
  const dramaAllCharList = ref([])
  const dramaAllCharLoading = ref(false)
  const dramaAllCharPage = ref(1)
  const dramaAllCharPageSize = ref(20)
  const dramaAllCharTotal = ref(0)
  const dramaAllCharKeyword = ref('')
  let dramaAllCharKeywordTimer = null

  // ── 角色库函数 ────────────────────────────────────────
  async function loadCharLibraryList() {
    charLibraryLoading.value = true
    try {
      const res = await characterLibraryAPI.list({
        drama_id: dramaId.value,
        page: charLibraryPage.value,
        page_size: charLibraryPageSize.value,
        keyword: charLibraryKeyword.value || undefined
      })
      charLibraryList.value = res?.items ?? []
      const pagination = res?.pagination ?? {}
      charLibraryTotal.value = pagination.total ?? 0
      if (pagination.page != null) charLibraryPage.value = pagination.page
      if (pagination.page_size != null) charLibraryPageSize.value = pagination.page_size
    } catch (e) {
      charLibraryList.value = []
    } finally {
      charLibraryLoading.value = false
    }
  }

  function debouncedLoadCharLibrary() {
    if (charLibraryKeywordTimer) clearTimeout(charLibraryKeywordTimer)
    charLibraryKeywordTimer = setTimeout(() => {
      charLibraryPage.value = 1
      loadCharLibraryList()
    }, 300)
  }

  async function loadDramaAllCharList() {
    if (!dramaId.value) {
      dramaAllCharList.value = []
      dramaAllCharTotal.value = 0
      return
    }
    dramaAllCharLoading.value = true
    try {
      const res = await dramaAPI.getCharacters(dramaId.value)
      let list = Array.isArray(res) ? res : (res?.characters ?? res?.items ?? [])
      const kw = (dramaAllCharKeyword.value || '').trim().toLowerCase()
      if (kw) {
        list = list.filter((c) => {
          const name = (c.name || '').toLowerCase()
          const desc = (c.description || '').toLowerCase()
          const app = (c.appearance || '').toLowerCase()
          return name.includes(kw) || desc.includes(kw) || app.includes(kw)
        })
      }
      dramaAllCharTotal.value = list.length
      const start = (dramaAllCharPage.value - 1) * dramaAllCharPageSize.value
      dramaAllCharList.value = list.slice(start, start + dramaAllCharPageSize.value)
    } catch {
      dramaAllCharList.value = []
      dramaAllCharTotal.value = 0
    } finally {
      dramaAllCharLoading.value = false
    }
  }

  function debouncedLoadDramaAllCharList() {
    if (dramaAllCharKeywordTimer) clearTimeout(dramaAllCharKeywordTimer)
    dramaAllCharKeywordTimer = setTimeout(() => {
      dramaAllCharPage.value = 1
      loadDramaAllCharList()
    }, 300)
  }

  function onCharLibraryDialogOpen() {
    if (charLibraryTab.value === 'library') loadCharLibraryList()
    else if (charLibraryTab.value === 'drama') loadDramaAllCharList()
  }

  function onCharLibraryTabChange() {
    if (charLibraryTab.value === 'library') {
      charLibraryPage.value = 1
      loadCharLibraryList()
    } else if (charLibraryTab.value === 'drama') {
      dramaAllCharPage.value = 1
      loadDramaAllCharList()
    }
  }

  function charAddToEpisodeLoadingKey(scope, id) {
    return `${scope}-${id}`
  }

  function isCharAddToEpisodeLoading(scope, id) {
    return addingCharFromLibraryId.value === charAddToEpisodeLoadingKey(scope, id)
  }

  function openEditCharLibrary(item) {
    editCharLibraryForm.value = {
      id: item.id,
      name: item.name ?? '',
      category: item.category ?? '',
      description: item.description ?? '',
      tags: item.tags ?? ''
    }
    showEditCharLibrary.value = true
  }

  async function submitEditCharLibrary() {
    if (!editCharLibraryForm.value?.id) return
    editCharLibrarySaving.value = true
    try {
      await characterLibraryAPI.update(editCharLibraryForm.value.id, {
        name: editCharLibraryForm.value.name,
        category: editCharLibraryForm.value.category || null,
        description: editCharLibraryForm.value.description || null,
        tags: editCharLibraryForm.value.tags || null
      })
      ElMessage.success('已保存')
      showEditCharLibrary.value = false
      loadCharLibraryList()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '保存失败'))
    } finally {
      editCharLibrarySaving.value = false
    }
  }

  async function onDeleteCharLibrary(item) {
    try {
      await ElMessageBox.confirm(
        `确定删除公共角色「${(item.name || '未命名').slice(0, 20)}」吗？`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
      await characterLibraryAPI.delete(item.id)
      ElMessage.success('已删除')
      loadCharLibraryList()
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '删除失败'))
    }
  }

  async function onAddCharacterToLibrary(char) {
    if (!hasAssetImage(char)) { ElMessage.warning('请先为该角色生成或上传图片'); return }
    addingCharToLibraryId.value = char.id
    try {
      await characterAPI.addToLibrary(char.id, {})
      ElMessage.success('已加入本剧角色库')
      if (showCharLibrary.value) loadCharLibraryList()
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingCharToLibraryId.value = null
    }
  }

  async function onAddCharacterToMaterialLibrary(char) {
    if (!hasAssetImage(char)) { ElMessage.warning('请先为该角色生成或上传图片'); return }
    addingCharToMaterialId.value = char.id
    try {
      await characterAPI.addToMaterialLibrary(char.id)
      ElMessage.success('已加入全局素材库')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingCharToMaterialId.value = null
    }
  }

  async function addCharToEpisode(item, scope) {
    if (!store.dramaId) return
    if (!currentEpisodeId.value) {
      ElMessage.warning('请先选择本集')
      return
    }
    const loadingKey = charAddToEpisodeLoadingKey(scope, item.id)
    addingCharFromLibraryId.value = loadingKey
    try {
      const existing = (store.characters || []).map((c) => ({
        id: c.id,
        name: c.name || '',
        role: c.role || undefined,
        appearance: c.appearance || undefined,
        personality: c.personality || undefined,
        description: c.description || undefined,
        image_url: c.image_url || undefined,
        local_path: c.local_path || undefined,
      }))
      const newCharacters = [...existing]
      const existingChar = newCharacters.find((c) => c.name === (item.name || '未命名'))
      if (existingChar) {
        existingChar.description = item.description || existingChar.description
        existingChar.appearance = item.appearance || existingChar.appearance
        existingChar.image_url = item.image_url || existingChar.image_url
        existingChar.local_path = item.local_path || existingChar.local_path
        if (item.role && !existingChar.role) existingChar.role = item.role
      } else {
        newCharacters.push({
          name: item.name || '未命名',
          role: item.role || undefined,
          description: item.description || undefined,
          appearance: item.appearance || undefined,
          personality: item.personality || undefined,
          image_url: item.image_url || undefined,
          local_path: item.local_path || undefined,
        })
      }
      await dramaAPI.saveCharacters(store.dramaId, {
        characters: newCharacters,
        episode_id: currentEpisodeId.value ?? undefined,
      })
      await loadDrama()
      ElMessage.success(`「${item.name || '角色'}」已加入本集`)
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '加入失败'))
    } finally {
      addingCharFromLibraryId.value = null
    }
  }

  function onAddCharFromLibrary(item) {
    return addCharToEpisode(item, 'library')
  }

  function onAddDramaCharToEpisode(item) {
    return addCharToEpisode(item, 'drama')
  }


  async function onSd2CertifyCharacter(char) {
    if (!char?.id) return
    if (!hasAssetImage(char)) {
      ElMessage.warning('请先为该角色生成或上传主图')
      return
    }
    sd2CertifyingId.value = char.id
    try {
      await characterAPI.sd2Certify(char.id)
      await loadDrama()
      ElMessage.success('认证资产请求已提交')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      const msg = e?.message || ''
      if (/已存在|已认证|already/i.test(msg)) {
        try {
          await characterAPI.sd2CertifyRefresh(char.id)
          await loadDrama()
          ElMessage.success('认证资产状态已刷新')
          return
        } catch (_) {
          // fall through
        }
      }
      ElMessage.error(toUserFacingError(e, '认证资产失败'))
    } finally {
      sd2CertifyingId.value = null
    }
  }

  async function onSd2CertifyRefresh(char) {
    if (!char?.id) return
    sd2CertifyingId.value = char.id
    try {
      await characterAPI.sd2CertifyRefresh(char.id)
      await loadDrama()
      ElMessage.success('认证资产状态已刷新')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '刷新失败'))
    } finally {
      sd2CertifyingId.value = null
    }
  }

  function sd2ActionLabel(char) {
    const status = String(char?.seedance2_asset?.status || '').toLowerCase()
    if (status === 'active') return '查看认证'
    if (status === 'processing') return '刷新认证'
    if (status === 'failed') return '重新认证'
    return '认证资产'
  }

  async function onSd2PrimaryAction(char) {
    const status = String(char?.seedance2_asset?.status || '').toLowerCase()
    if (status === 'active') {
      openCharSd2CertDialog(char)
      return
    }
    if (status === 'processing') {
      await onSd2CertifyRefresh(char)
      return
    }
    await onSd2CertifyCharacter(char)
  }

  function openCharSd2CertDialog(char) {
    charSd2CertPayload.value = char?.seedance2_asset ? { ...char.seedance2_asset } : null
    showCharSd2Cert.value = true
  }

  function sd2VoiceActionLabel(char) {
    const status = String(char?.seedance2_voice_asset?.status || '').toLowerCase()
    if (status === 'active') return '音色参考'
    if (status === 'processing') return '刷新音色'
    if (status === 'failed') return '重新上传'
    return '上传音色'
  }

  async function onSd2VoicePrimaryAction(char) {
    const status = String(char?.seedance2_voice_asset?.status || '').toLowerCase()
    if (status === 'active') {
      ElMessage.info('音色参考已设置，将在 Seedance 2.0 模型中使用')
      return
    }
    if (status === 'processing' || status === 'stale') {
      await onSd2VoiceRefresh(char)
      return
    }
    // 触发文件选择上传
    await triggerSd2VoiceUpload(char)
  }

  // 专门用于“更换”：无论当前是否 active，都直接触发文件选择上传（覆盖）
  async function onSd2VoiceReplace(char) {
    await triggerSd2VoiceUpload(char)
  }

  async function onSd2VoiceRefresh(char) {
    if (!char?.id) return
    sd2VoiceUploadingId.value = char.id
    try {
      const res = await characterAPI.sd2VoiceRefresh(char.id)
      await loadDrama()
      if (typeof notifySd2VoiceRefreshSuccess === 'function') {
        notifySd2VoiceRefreshSuccess(res)
      } else {
        ElMessage.success(toUserFacingError(res?.data?.message, '音色状态已刷新'))
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '刷新失败'))
    } finally {
      sd2VoiceUploadingId.value = null
    }
  }

  async function triggerSd2VoiceUpload(char) {
    if (!char?.id) return
    // 创建隐藏的 file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return
      sd2VoiceUploadingId.value = char.id
      try {
        const res = await characterAPI.sd2VoiceUpload(char.id, file)
        ElMessage.success('Seedance 2.0 音色参考已上传')
        // 强制重新加载整个剧本数据，确保 seedance2_voice_asset 被正确解析并更新到 store
        await loadDrama()
      } catch (e) {
        if (isUserFacingAbort(e)) return
        ElMessage.error(toUserFacingError(e, '音色上传失败'))
      } finally {
        sd2VoiceUploadingId.value = null
      }
    }
    input.click()
  }

  // 播放 Seedance 2.0 音色参考（仅 active 状态）
  function playSd2Voice(char) {
    const url = char?.seedance2_voice_asset?.url
    if (!url) {
      ElMessage.warning('该角色暂无音色参考音频')
      return
    }
    try {
      // 统一使用相对 /static/...（与图片 assetImageUrl 一致），由当前页面 origin + Vite/后端代理或静态服务处理
      const audio = new Audio(url)
      audio.onerror = () => {
        // 常见原因：文件不在 static 根目录下（后端写盘路径与 express.static(storageRoot) 不一致）、404、格式不支持
        ElMessage.error('音频播放失败：文件可能不存在或路径不匹配，请尝试重新上传该音色参考')
      }
      audio.play().catch((err) => {
        ElMessage.error('音频播放失败，请检查文件或稍后重试')
      })
    } catch (e) {
      ElMessage.error('无法播放音频')
    }
  }


  return {
    sd2CertifyingId,
    showCharSd2Cert,
    charSd2CertPayload,
    sd2VoiceUploadingId,
    showCharLibrary,
    charLibraryList,
    charLibraryLoading,
    charLibraryPage,
    charLibraryPageSize,
    charLibraryTotal,
    charLibraryKeyword,
    charLibraryTab,
    dramaAllCharList,
    dramaAllCharLoading,
    dramaAllCharPage,
    dramaAllCharPageSize,
    dramaAllCharTotal,
    dramaAllCharKeyword,
    showEditCharLibrary,
    editCharLibraryForm,
    editCharLibrarySaving,
    addingCharToLibraryId,
    addingCharToMaterialId,
    addingCharFromLibraryId,
    loadCharLibraryList,
    debouncedLoadCharLibrary,
    loadDramaAllCharList,
    debouncedLoadDramaAllCharList,
    onCharLibraryDialogOpen,
    onCharLibraryTabChange,
    isCharAddToEpisodeLoading,
    openEditCharLibrary,
    submitEditCharLibrary,
    onDeleteCharLibrary,
    onAddCharacterToLibrary,
    onAddCharacterToMaterialLibrary,
    onAddCharFromLibrary,
    onAddDramaCharToEpisode,
    onSd2CertifyCharacter,
    onSd2CertifyRefresh,
    sd2ActionLabel,
    onSd2PrimaryAction,
    openCharSd2CertDialog,
    onSd2VoicePrimaryAction,
    onSd2VoiceReplace,
    sd2VoiceActionLabel,
    playSd2Voice,
  }
}
