import { ref, reactive, computed } from 'vue'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ElMessage as RawElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { characterAPI as rawCharacterAPI } from '@/api/characters'
import { characterLibraryAPI as rawCharacterLibraryAPI } from '@/api/characterLibrary'
import { dramaAPI as rawDramaAPI } from '@/api/drama'
import { generationAPI as rawGenerationAPI } from '@/api/generation'
import { uploadAPI as rawUploadAPI } from '@/api/upload'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { buildExtractTaskMeta, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { useCharacterLibrary } from './useCharacterLibrary.js'

/**
 * 角色管理 Composable
 * @param {object} deps - 共享依赖
 * @param {object} deps.store - Pinia store
 * @param {import('vue').ComputedRef} deps.dramaId
 * @param {import('vue').ComputedRef} deps.currentEpisodeId
 * @param {Function} deps.getSelectedStyle - 获取当前生成风格
 * @param {Function} deps.loadDrama - 重新加载剧集数据
 * @param {Function} deps.pollTask - 轮询异步任务
 * @param {Function} deps.pollUntilResourceHasImage - 等待资源有图片
 * @param {Function} deps.hasAssetImage - 判断资源是否有图片
 */
export function useCharacters(deps) {
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
    characterAPI = rawCharacterAPI,
    characterLibraryAPI = rawCharacterLibraryAPI,
    dramaAPI = rawDramaAPI,
    generationAPI = rawGenerationAPI,
    uploadAPI = rawUploadAPI,
  } = deps
  const genStore = useGenerationTaskStore()

  function buildCharImageMeta(char) {
    const dramaTitle = store.drama?.title || ''
    const epNum = store.currentEpisode?.episode_number
    const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
    return {
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      dramaTitle,
      episodeNumber: epNum,
      resourceType: GEN_RESOURCE.CHAR_IMAGE,
      resourceId: char.id,
      label: `${epLabel} 角色图: ${char.name || char.id}`,
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

  // ── 角色弹窗状态 ─────────────────────────────────────
  const showEditCharacter = ref(false)
  const editCharacterForm = ref(null)
  const editCharacterSaving = ref(false)
  const editCharacterPromptGenerating = ref(false)
  const extractingCharAppearance = ref(false)
  const extractingAnchors = ref(false)
  const addCharRefImage = ref(null)   // { dataUrl, filename }
  const addCharRefFileInput = ref(null)
  let editCharacterPollTimer = null

  // ── 角色生成状态 ──────────────────────────────────────
  /** 仅当前集「提取角色」进行中时为 true（按集隔离，切集不误显示 loading） */
  const charactersGenerating = computed(() =>
    isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.EXTRACT_CHARACTERS)
  )
  const generatingCharIds = reactive(new Set())

  const {
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
  } = useCharacterLibrary({
    store,
    dramaId,
    currentEpisodeId,
    loadDrama,
    hasAssetImage,
    ElMessage,
    characterAPI,
    characterLibraryAPI,
    dramaAPI,
    notifySd2VoiceRefreshSuccess: (res) => {
      ElMessage.success(toUserFacingError(res?.data?.message, '音色状态已刷新'))
    },
  })

  // ── 常量 ──────────────────────────────────────────────
  const CHAR_ROLE_LABEL = { main: '主角', supporting: '配角', minor: '次要角色' }
  function charRoleLabel(role) { return CHAR_ROLE_LABEL[role] || role || '' }

  // ── 核心函数 ──────────────────────────────────────────
  async function onGenerateCharacters() {
    if (!store.dramaId) return
    const epId = currentEpisodeId.value
    if (!epId) {
      ElMessage.warning('请先选择剧集')
      return
    }
    const meta = buildExtractTaskMeta(store, dramaId.value, epId, GEN_RESOURCE.EXTRACT_CHARACTERS, '提取角色')
    genStore.markRunning(meta)
    try {
      const outline =
        (store.scriptContent || '').toString().trim() || undefined
      const res = await generationAPI.generateCharacters(store.dramaId, {
        episode_id: epId,
        outline: outline || undefined
      })
      const taskId = res?.task_id
      if (taskId) {
        const pollRes = await pollTask(taskId, () => loadDrama(), meta)
        if (pollRes?.status === 'completed') {
          ElMessage.success('角色生成完成')
        } else if (pollRes?.status === 'timeout') {
          ElMessage.warning(toUserFacingError(pollRes?.error, '角色生成超时，请稍后重试'))
        } else if (pollRes?.status === 'cancelled' || pollRes?.status === 'canceled') {
          ElMessage.info(toUserFacingError(pollRes?.error, '操作已取消'))
        } else {
          ElMessage.warning(toUserFacingError(pollRes?.error, '角色生成未完成'))
        }
      } else {
        await loadDrama()
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '生成失败'))
    } finally {
      genStore.markDone(meta)
    }
  }

  function openAddCharacter() {
    editCharacterForm.value = {
      name: '',
      role: '',
      appearance: '',
      personality: '',
      description: '',
      polished_prompt: ''
    }
    showEditCharacter.value = true
  }

  function stopCharacterPromptPoll() {
    if (editCharacterPollTimer) {
      clearInterval(editCharacterPollTimer)
      editCharacterPollTimer = null
    }
  }

  function editCharacter(char) {
    stopCharacterPromptPoll()
    editCharacterForm.value = {
      id: char.id,
      name: char.name || '',
      role: char.role || '',
      appearance: char.appearance || '',
      personality: char.personality || '',
      description: char.description || '',
      polished_prompt: char.polished_prompt || '',
      image_url: char.image_url || '',
      local_path: char.local_path || '',
      ref_image: char.ref_image || '',
      identity_anchors: char.identity_anchors || '',
      stages: char.stages ? (typeof char.stages === 'string' ? char.stages : JSON.stringify(char.stages, null, 2)) : '',
    }
    showEditCharacter.value = true
    if (!char.polished_prompt && char.id && (char.appearance || char.description)) {
      editCharacterPromptGenerating.value = true
      let elapsed = 0
      editCharacterPollTimer = setInterval(async () => {
        elapsed += 3
        try {
          const res = await characterAPI.get(char.id)
          const prompt = res?.character?.polished_prompt
          if (prompt) {
            if (editCharacterForm.value?.id === char.id) {
              editCharacterForm.value.polished_prompt = prompt
            }
            stopCharacterPromptPoll()
            editCharacterPromptGenerating.value = false
          } else if (elapsed >= 60) {
            stopCharacterPromptPoll()
            editCharacterPromptGenerating.value = false
          }
        } catch (_) {
          stopCharacterPromptPoll()
          editCharacterPromptGenerating.value = false
        }
      }, 3000)
    }
  }

  async function saveCharRefImageIfAny(characterId) {
    const refImg = addCharRefImage.value
    if (!refImg || !characterId) return
    try {
      const file = dataUrlToFile(refImg.dataUrl, refImg.filename || 'reference.png')
      const uploadRes = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
      const refPath = uploadRes.local_path || uploadRes.url || ''
      await characterAPI.putRefImage(characterId, refPath)
    } catch (e) {
      console.warn('[saveCharRefImage] 保存参考图失败:', e.message)
    }
  }

  async function submitEditCharacter() {
    const form = editCharacterForm.value
    if (!form?.name?.trim() || !store.dramaId) return
    editCharacterSaving.value = true
    try {
      if (form.id) {
        await characterAPI.update(form.id, {
          name: form.name.trim(),
          role: form.role || undefined,
          appearance: form.appearance || undefined,
          personality: form.personality || undefined,
          description: form.description || undefined,
          polished_prompt: form.polished_prompt || undefined,
          stages: form.stages ? form.stages.trim() || undefined : undefined
        })
        await saveCharRefImageIfAny(form.id)
        ElMessage.success('角色已保存')
      } else {
        const existing = (store.drama?.characters || []).map((c) => ({
          id: c.id,
          name: c.name || '',
          role: c.role || undefined,
          description: c.description || undefined,
          personality: c.personality || undefined,
          appearance: c.appearance || undefined,
          image_url: c.image_url || undefined,
          local_path: c.local_path || undefined
        }))
        await dramaAPI.saveCharacters(store.dramaId, {
          characters: [...existing, {
            name: form.name.trim(),
            role: form.role || undefined,
            appearance: form.appearance || undefined,
            personality: form.personality || undefined,
            description: form.description || undefined
          }],
          episode_id: currentEpisodeId.value ?? undefined
        })
        await loadDrama()
        if (addCharRefImage.value) {
          const newChar = (store.drama?.characters || []).find(c => c.name === form.name.trim())
          if (newChar?.id) await saveCharRefImageIfAny(newChar.id)
        }
        ElMessage.success('角色已添加')
      }
      await loadDrama()
      showEditCharacter.value = false
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, form.id ? '保存失败' : '添加失败'))
    } finally {
      editCharacterSaving.value = false
    }
  }

  async function doGenerateCharacterPrompt() {
    const form = editCharacterForm.value
    if (!form?.id) return
    editCharacterPromptGenerating.value = true
    try {
      const res = await characterAPI.generatePrompt(form.id)
      if (res?.polished_prompt) {
        form.polished_prompt = res.polished_prompt
        ElMessage.success('提示词已生成')
        await loadDrama()
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '生成提示词失败'))
    } finally {
      editCharacterPromptGenerating.value = false
    }
  }

  async function doExtractCharFromImage() {
    const form = editCharacterForm.value
    if (!form?.id) return
    extractingCharAppearance.value = true
    try {
      const res = await characterAPI.extractFromImage(form.id)
      if (res?.appearance) {
        form.appearance = res.appearance
        ElMessage.success('已从图片提取外貌描述')
      }
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '提取失败，请检查角色是否已上传参考图片'))
    } finally {
      extractingCharAppearance.value = false
    }
  }

  async function clearCharRefImage() {
    const form = editCharacterForm.value
    if (!form?.id) return
    try {
      await characterAPI.putRefImage(form.id, null)
      form.ref_image = ''
      ElMessage.success('参考图已移除')
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '移除失败'))
    }
  }

  function onCloseCharDialog() {
    showEditCharacter.value = false
    stopCharacterPromptPoll()
    editCharacterPromptGenerating.value = false
    addCharRefImage.value = null
  }

  async function onDeleteCharacter(char) {
    try {
      await ElMessageBox.confirm(
        `确定要删除角色「${(char.name || '未命名').slice(0, 20)}」吗？此操作不可恢复。`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
      await characterAPI.delete(char.id)
      await loadDrama()
      ElMessage.success('角色已删除')
    } catch (e) {
      if (e === 'cancel') return
      ElMessage.error(toUserFacingError(e, '删除失败'))
    }
  }

  async function onGenerateCharacterImage(char) {
    char.errorMsg = ''
    char.error_msg = ''
    const meta = buildCharImageMeta(char)
    generatingCharIds.add(char.id)
    genStore.markRunning(meta)
    try {
      const res = await characterAPI.generateImage(char.id, undefined, getSelectedStyle())
      const taskId = res?.image_generation?.task_id ?? res?.task_id
      if (taskId) {
        const pollRes = await pollTask(taskId, () => loadDrama(), meta)
        if (pollRes?.status === 'failed') {
          char.errorMsg = toUserFacingError(pollRes.error, '生成失败')
        } else if (pollRes?.status === 'completed') {
          ElMessage.success('角色图片已生成')
        } else if (pollRes?.status === 'timeout') {
          char.errorMsg = toUserFacingError(pollRes?.error, '生成超时，请稍后重试')
          ElMessage.warning(char.errorMsg)
        } else if (pollRes?.status === 'cancelled' || pollRes?.status === 'canceled') {
          char.errorMsg = toUserFacingError(pollRes?.error, '操作已取消')
        } else {
          char.errorMsg = toUserFacingError(pollRes?.error, '角色图片生成未完成')
          ElMessage.warning(char.errorMsg)
        }
      } else {
        await loadDrama()
        await pollUntilResourceHasImage(() => {
          const list = store.drama?.characters ?? store.currentEpisode?.characters ?? []
          const c = list.find((x) => Number(x.id) === Number(char.id))
          return !!(c && (c.image_url || c.local_path))
        })
        ElMessage.success('角色图片已生成')
      }
    } catch (e) {
      char.errorMsg = toUserFacingError(e, '生成失败')
      if (isUserFacingAbort(e)) return
      console.error(e)
      ElMessage.error(toUserFacingError(e, '提交失败'))
    } finally {
      generatingCharIds.delete(char.id)
      genStore.markDone(meta)
    }
  }


  async function extractIdentityAnchors() {
    const form = editCharacterForm.value
    if (!form?.id) return
    if (!form.appearance) {
      ElMessage.warning('请先填写角色外貌描述')
      return
    }
    extractingAnchors.value = true
    try {
      await characterAPI.extractAnchors(form.id)
      ElMessage.success('视觉锚点提炼已启动，请稍后查看')
      // 轮询等待锚点写入
      let elapsed = 0
      const timer = setInterval(async () => {
        elapsed += 3
        try {
          const res = await characterAPI.get(form.id)
          const anchors = res?.character?.identity_anchors
          if (anchors && editCharacterForm.value?.id === form.id) {
            editCharacterForm.value.identity_anchors = anchors
            clearInterval(timer)
            extractingAnchors.value = false
          } else if (elapsed >= 60) {
            clearInterval(timer)
            extractingAnchors.value = false
          }
        } catch (_) {
          clearInterval(timer)
          extractingAnchors.value = false
        }
      }, 3000)
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '提炼失败'))
      extractingAnchors.value = false
    }
  }

  return {
    // 弹窗状态
    showEditCharacter,
    editCharacterForm,
    editCharacterSaving,
    editCharacterPromptGenerating,
    extractingCharAppearance,
    extractingAnchors,
    addCharRefImage,
    addCharRefFileInput,
    // 生成状态
    charactersGenerating,
    generatingCharIds,
    sd2CertifyingId,
    showCharSd2Cert,
    charSd2CertPayload,
    sd2VoiceUploadingId,
    // 库状态
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
    // 函数
    charRoleLabel,
    onGenerateCharacters,
    openAddCharacter,
    stopCharacterPromptPoll,
    editCharacter,
    saveCharRefImageIfAny,
    submitEditCharacter,
    doGenerateCharacterPrompt,
    doExtractCharFromImage,
    extractIdentityAnchors,
    clearCharRefImage,
    onCloseCharDialog,
    onDeleteCharacter,
    onGenerateCharacterImage,
    onSd2CertifyCharacter,
    onSd2CertifyRefresh,
    sd2ActionLabel,
    onSd2PrimaryAction,
    openCharSd2CertDialog,
    onSd2VoicePrimaryAction,
    onSd2VoiceReplace,
    sd2VoiceActionLabel,
    playSd2Voice,
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

  }
}
