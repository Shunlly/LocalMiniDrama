import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { storyboardsAPI } from '@/api/storyboards'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'

/** 合并 drama 级与本集已关联角色，避免 drama.characters 被布局保存截断后漏传 */
function collectExistingCharacters(dramaData, episodeId) {
  const map = new Map()
  for (const c of dramaData?.characters || []) {
    if (c?.id != null) map.set(Number(c.id), c)
  }
  if (episodeId != null) {
    const ep = (dramaData?.episodes || []).find((e) => Number(e.id) === Number(episodeId))
    for (const c of ep?.characters || []) {
      if (c?.id != null && !map.has(Number(c.id))) map.set(Number(c.id), c)
    }
  }
  return [...map.values()]
}

function toCharacterSavePayload(c) {
  return {
    id: c.id,
    name: c.name || '',
    role: c.role || undefined,
    description: c.description || undefined,
    personality: c.personality || undefined,
    appearance: c.appearance || undefined,
    image_url: c.image_url || undefined,
    local_path: c.local_path || undefined,
  }
}

/** 画布内新建实体（复用列表模式同款 API） */
export function useCanvasCrud(deps) {
  const {
    drama,
    routeProjectId,
    canvasMode,
    filterEpisodeId,
    layoutCache,
    focusedNodeId,
    setFocusedNode,
    setEpisodeFilter,
    refreshCanvas,
    persistCanvasState,
  } = deps

  const createDialogVisible = ref(false)
  const createDialogType = ref('storyboard')
  const createDialogProjectId = ref(null)
  /** 右键菜单创建时在画布上的坐标 { x, y } */
  const pendingFlowPosition = ref(null)

  function resolveEpisodeId() {
    if (filterEpisodeId.value) return filterEpisodeId.value
    const eps = drama.value?.episodes || []
    if (eps.length === 1) return eps[0].id
    return null
  }

  function openCreateDialog(type, flowPosition = null) {
    if (canvasMode?.value === 'free') {
      ElMessage.info('自由模式只支持创建自由节点')
      return
    }
    if (['storyboard', 'character', 'scene', 'prop'].includes(type) && !resolveEpisodeId()) {
      ElMessage.warning('请先选择集数（或确保项目至少有一集）')
      return
    }
    createDialogType.value = type
    createDialogProjectId.value = Number(drama.value?.id)
    pendingFlowPosition.value = flowPosition
    createDialogVisible.value = true
  }

  function closeCreateDialog() {
    createDialogVisible.value = false
    createDialogProjectId.value = null
    pendingFlowPosition.value = null
  }

  watch(
    [() => routeProjectId?.value, () => drama.value?.id],
    () => {
      if (!createDialogVisible.value) return
      const projectId = Number(createDialogProjectId.value)
      if (Number(routeProjectId?.value) !== projectId || Number(drama.value?.id) !== projectId) {
        closeCreateDialog()
      }
    },
  )

  function createOperationContext() {
    const projectId = Number(drama.value?.id)
    return {
      projectId,
      isCurrent: () => Number.isFinite(projectId)
        && projectId > 0
        && Number(routeProjectId?.value) === projectId
        && Number(drama.value?.id) === projectId,
    }
  }

  async function saveNodePosition(nodeId, pos, operation) {
    if (!pos || !nodeId) return operation.isCurrent()
    if (!operation.isCurrent()) return false
    const prev = layoutCache.value || { version: 1, nodes: {} }
    layoutCache.value = {
      ...prev,
      version: 1,
      nodes: {
        ...(prev.nodes || {}),
        [nodeId]: { x: pos.x, y: pos.y },
      },
    }
    const result = await persistCanvasState({ layoutOnly: true })
    return result?.ok !== false && operation.isCurrent()
  }

  async function focusAfterCreate(nodeId, operation) {
    if (!operation.isCurrent()) return false
    await refreshCanvas()
    if (!operation.isCurrent()) return false
    if (nodeId && setFocusedNode) {
      await setFocusedNode(nodeId)
      if (!operation.isCurrent()) return false
    }
    else if (nodeId) focusedNodeId.value = nodeId
    pendingFlowPosition.value = null
    return operation.isCurrent()
  }

  function reportCreateResult(successMessage, positionSaved) {
    if (positionSaved) ElMessage.success(successMessage)
    else ElMessage.warning(`${successMessage.replace(/已添加$/, '已创建')}，但画布位置尚未保存，请使用画布保存重试`)
  }

  async function finalizeCreatedNode({ nodeId, position, operation, successMessage }) {
    let positionSaved = true
    if (nodeId && position) {
      positionSaved = await saveNodePosition(nodeId, position, operation)
      if (!operation.isCurrent()) return false
    }
    if (!await focusAfterCreate(nodeId, operation)) return false
    reportCreateResult(successMessage, positionSaved)
    return true
  }

  async function createStoryboard(form, operation) {
    const episodeId = resolveEpisodeId()
    if (!episodeId) throw new Error('请先选择集数')

    const boards = (drama.value?.episodes || [])
      .find((ep) => ep.id === episodeId)?.storyboards || []
    const maxNum = boards.reduce((max, sb) => Math.max(max, sb.storyboard_number || 0), 0)
    const nextNum = maxNum + 1
    const title = (form.title || '').trim() || `镜头 ${nextNum}`

    const sb = await storyboardsAPI.create({
      episode_id: episodeId,
      storyboard_number: nextNum,
      title,
      description: (form.description || '').trim() || '',
    })
    if (!operation.isCurrent()) return false

    const nodeId = `sb:${sb.id}`
    const pos = pendingFlowPosition.value
    return finalizeCreatedNode({
      nodeId,
      position: pos,
      operation,
      successMessage: '分镜已添加',
    })
  }

  async function createEpisode(form, operation) {
    const dramaId = operation.projectId
    if (!dramaId) throw new Error('项目未加载')

    const list = drama.value.episodes || []
    const nextNum = list.length > 0
      ? Math.max(...list.map((ep) => Number(ep.episode_number) || 0), 0) + 1
      : 1
    const title = (form.title || '').trim() || `第${nextNum}集`

    const updated = list.map((ep, i) => ({
      episode_number: ep.episode_number ?? i + 1,
      title: ep.title || `第${ep.episode_number ?? i + 1}集`,
      script_content: ep.script_content || '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0,
    }))
    updated.push({
      episode_number: nextNum,
      title,
      script_content: '',
      description: null,
      duration: 0,
    })

    await dramaAPI.saveEpisodes(dramaId, updated)
    if (!operation.isCurrent()) return false
    await refreshCanvas()
    if (!operation.isCurrent()) return false

    const newEp = (drama.value?.episodes || []).find((ep) => Number(ep.episode_number) === nextNum)
    let positionSaved = true
    if (newEp?.id) {
      if (setEpisodeFilter) {
        await setEpisodeFilter(newEp.id)
        if (!operation.isCurrent()) return false
      }
      else filterEpisodeId.value = newEp.id
      const pos = pendingFlowPosition.value
      if (pos) {
        positionSaved = await saveNodePosition(`episode:${newEp.id}`, pos, operation)
        if (!operation.isCurrent()) return false
      }
      await refreshCanvas()
      if (!operation.isCurrent()) return false
    }
    pendingFlowPosition.value = null
    reportCreateResult(`已添加${title}`, positionSaved)
    return true
  }

  async function createCharacter(form, operation) {
    const dramaId = operation.projectId
    const episodeId = resolveEpisodeId()
    if (!dramaId) throw new Error('项目未加载')

    const beforeIds = new Set((drama.value?.characters || []).map((c) => c.id))

    const existing = collectExistingCharacters(drama.value, episodeId).map(toCharacterSavePayload)

    const name = form.name.trim()
    await dramaAPI.saveCharacters(dramaId, {
      characters: [...existing, {
        name,
        role: form.role?.trim() || undefined,
        description: form.description?.trim() || undefined,
        appearance: form.appearance?.trim() || undefined,
      }],
      episode_id: episodeId ?? undefined,
    })
    if (!operation.isCurrent()) return false

    await refreshCanvas()
    if (!operation.isCurrent()) return false
    const newChar = (drama.value?.characters || []).find((c) => !beforeIds.has(c.id))
      || (drama.value?.characters || []).find((c) => c.name === name)
    const nodeId = newChar?.id ? `char:${newChar.id}` : null
    const pos = pendingFlowPosition.value
    return finalizeCreatedNode({
      nodeId,
      position: pos,
      operation,
      successMessage: '角色已添加',
    })
  }

  async function createScene(form, operation) {
    const dramaId = operation.projectId
    const episodeId = resolveEpisodeId()
    if (!dramaId) throw new Error('项目未加载')

    const scene = await sceneAPI.create({
      drama_id: dramaId,
      episode_id: episodeId ?? undefined,
      location: form.location.trim(),
      time: form.time?.trim() || undefined,
      prompt: form.prompt?.trim() || undefined,
    })
    if (!operation.isCurrent()) return false

    const sceneId = scene?.id ?? scene?.scene?.id
    const nodeId = sceneId ? `scene:${sceneId}` : null
    const pos = pendingFlowPosition.value
    return finalizeCreatedNode({
      nodeId,
      position: pos,
      operation,
      successMessage: '场景已添加',
    })
  }

  async function createProp(form, operation) {
    const dramaId = operation.projectId
    const episodeId = resolveEpisodeId()
    if (!dramaId) throw new Error('项目未加载')

    const prop = await propAPI.create({
      drama_id: dramaId,
      episode_id: episodeId ?? undefined,
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      prompt: form.prompt?.trim() || undefined,
    })
    if (!operation.isCurrent()) return false

    const propId = prop?.id ?? prop?.prop?.id
    const nodeId = propId ? `prop:${propId}` : null
    const pos = pendingFlowPosition.value
    return finalizeCreatedNode({
      nodeId,
      position: pos,
      operation,
      successMessage: '道具已添加',
    })
  }

  async function submitCreate(form) {
    const operation = createOperationContext()
    if (!operation.isCurrent() || operation.projectId !== Number(createDialogProjectId.value)) return false
    const type = createDialogType.value
    let created = false
    if (type === 'storyboard') created = await createStoryboard(form, operation)
    else if (type === 'episode') created = await createEpisode(form, operation)
    else if (type === 'character') created = await createCharacter(form, operation)
    else if (type === 'scene') created = await createScene(form, operation)
    else if (type === 'prop') created = await createProp(form, operation)
    if (!created || !operation.isCurrent()) return false
    closeCreateDialog()
    return true
  }

  return {
    createDialogVisible,
    createDialogType,
    pendingFlowPosition,
    openCreateDialog,
    closeCreateDialog,
    submitCreate,
    resolveEpisodeId,
  }
}
