import {
  GEN_RESOURCE,
  findAssetById,
  isActiveTaskStatus,
  sbImageResourceType,
} from './generationTaskStore.helpers.js'

export function buildEpisodeLabel(dramaTitle, episodeNumber, episodeId) {
  return dramaTitle
    ? `${dramaTitle} · 第${episodeNumber ?? ''}集`
    : `第${episodeNumber ?? episodeId}集`
}

export function buildEpisodeRecoveryScope({
  dramaId,
  episodeId,
  dramaTitle,
  episodeNumber,
  storyboards = [],
  characters = [],
  scenes = [],
  props = [],
}) {
  return {
    dramaId,
    episodeId,
    dramaTitle,
    episodeNumber,
    storyboards,
    characters,
    scenes,
    props,
    sbIdSet: new Set(storyboards.map((s) => Number(s.id))),
    charIdSet: new Set(characters.map((c) => Number(c.id))),
    sceneIdSet: new Set(scenes.map((s) => Number(s.id))),
    propIdSet: new Set(props.map((p) => Number(p.id))),
    epLabel: buildEpisodeLabel(dramaTitle, episodeNumber, episodeId),
  }
}

export function resolveReconcileAssets({
  characters = [],
  props = [],
  scenes = [],
  allCharacters = [],
  allProps = [],
  allScenes = [],
  storyboards = [],
}) {
  return {
    characters: allCharacters.length ? allCharacters : characters,
    props: allProps.length ? allProps : props,
    scenes: allScenes.length ? allScenes : scenes,
    storyboards,
  }
}

export function buildScopedTaskMeta(scope, { resourceType, resourceId, label, taskId }) {
  const meta = {
    dramaId: scope.dramaId,
    episodeId: scope.episodeId,
    dramaTitle: scope.dramaTitle,
    episodeNumber: scope.episodeNumber,
    resourceType,
    resourceId,
    label,
  }
  if (taskId !== undefined) meta.taskId = taskId
  return meta
}

export function buildStoryboardImageLabel(resourceType, epLabel, num) {
  if (resourceType === GEN_RESOURCE.SB_LAST_IMAGE) return `${epLabel} 尾帧 #${num}`
  if (resourceType === GEN_RESOURCE.SB_FIRST_IMAGE) return `${epLabel} 首帧 #${num}`
  return `${epLabel} 分镜图 #${num}`
}

export function buildAssetResourceRecoveryLabel(scope, resourceType, assetId) {
  if (resourceType === GEN_RESOURCE.CHAR_IMAGE) {
    const c = findAssetById(scope.characters, assetId)
    return `${scope.epLabel} 角色图: ${c?.name || assetId}`
  }
  if (resourceType === GEN_RESOURCE.PROP_IMAGE) {
    const p = findAssetById(scope.props, assetId)
    return `${scope.epLabel} 道具图: ${p?.name || assetId}`
  }
  if (resourceType === GEN_RESOURCE.SCENE_IMAGE) {
    const s = findAssetById(scope.scenes, assetId)
    return `${scope.epLabel} 场景图: ${s?.location || assetId}`
  }
  return `${scope.epLabel} ${assetId}`
}

export function episodeExtractTypeConfig(type, epLabel) {
  const extractTypeMap = {
    prop_extraction: { resourceType: GEN_RESOURCE.EXTRACT_PROPS, label: `${epLabel} 提取道具` },
    background_extraction: { resourceType: GEN_RESOURCE.EXTRACT_SCENES, label: `${epLabel} 提取场景` },
    storyboard_generation: { resourceType: GEN_RESOURCE.GENERATE_STORYBOARD, label: `${epLabel} AI生成分镜` },
  }
  return extractTypeMap[type] || null
}

export function buildPendingImageRecovery(img, scope) {
  if (!img || !['pending', 'processing'].includes(img.status)) return null
  if (!img.task_id) return null

  let resourceType = GEN_RESOURCE.SB_IMAGE
  let resourceId = null
  let label = ''

  if (img.storyboard_id != null && scope.sbIdSet.has(Number(img.storyboard_id))) {
    resourceType = sbImageResourceType(img.frame_type)
    resourceId = Number(img.storyboard_id)
    const sb = findAssetById(scope.storyboards, resourceId)
    const num = sb?.storyboard_number ?? resourceId
    label = buildStoryboardImageLabel(resourceType, scope.epLabel, num)
  } else if (img.character_id != null && scope.charIdSet.has(Number(img.character_id))) {
    resourceType = GEN_RESOURCE.CHAR_IMAGE
    resourceId = Number(img.character_id)
    const c = findAssetById(scope.characters, resourceId)
    label = `${scope.epLabel} 角色图: ${c?.name || resourceId}`
  } else if (img.scene_id != null && scope.sceneIdSet.has(Number(img.scene_id))) {
    resourceType = GEN_RESOURCE.SCENE_IMAGE
    resourceId = Number(img.scene_id)
    const s = findAssetById(scope.scenes, resourceId)
    label = `${scope.epLabel} 场景图: ${s?.location || resourceId}`
  } else {
    return null
  }

  return {
    meta: buildScopedTaskMeta(scope, { resourceType, resourceId, label }),
    refreshKind: resourceType.startsWith('sb_') ? 'storyboard' : 'drama',
  }
}

export function buildPendingVideoRecovery(vid, scope) {
  if (!vid?.storyboard_id || !scope.sbIdSet.has(Number(vid.storyboard_id))) return null
  if (!['pending', 'processing'].includes(vid.status)) return null
  if (!vid.task_id) return null
  const resourceId = Number(vid.storyboard_id)
  const sb = findAssetById(scope.storyboards, resourceId)
  const num = sb?.storyboard_number ?? resourceId
  return {
    meta: buildScopedTaskMeta(scope, {
      resourceType: GEN_RESOURCE.SB_VIDEO,
      resourceId,
      label: `${scope.epLabel} 分镜视频 #${num}`,
    }),
    refreshKind: 'storyboard',
  }
}

export function buildEpisodeBackendTaskRecovery(t, scope) {
  if (!isActiveTaskStatus(t.status)) return null
  if (t.type === 'video_merge') {
    return {
      meta: buildScopedTaskMeta(scope, {
        resourceType: GEN_RESOURCE.EPISODE_MERGE,
        resourceId: Number(scope.episodeId),
        label: `${scope.epLabel} 合成视频`,
        taskId: t.id,
      }),
      refreshKind: 'drama',
    }
  }
  const extractCfg = episodeExtractTypeConfig(t.type, scope.epLabel)
  if (!extractCfg) return null
  return {
    meta: buildScopedTaskMeta(scope, {
      resourceType: extractCfg.resourceType,
      resourceId: Number(scope.episodeId),
      label: extractCfg.label,
      taskId: t.id,
    }),
    refreshKind: 'drama',
  }
}

export function shouldRecoverDramaLevelTask(t, type, recoveredTaskIds, pollPromises) {
  if (!isActiveTaskStatus(t.status)) return false
  if (t.type !== type) return false
  if (recoveredTaskIds.has(t.id)) return false
  if (pollPromises.has(t.id)) return false
  return true
}

export function buildCharacterExtractionRecovery(t, scope) {
  return {
    meta: buildScopedTaskMeta(scope, {
      resourceType: GEN_RESOURCE.EXTRACT_CHARACTERS,
      resourceId: Number(scope.episodeId),
      label: `${scope.epLabel} 提取角色`,
      taskId: t.id,
    }),
    refreshKind: 'drama',
  }
}

export function buildStoryGenerationRecovery(t, scope) {
  return {
    meta: buildScopedTaskMeta(scope, {
      resourceType: GEN_RESOURCE.GENERATE_STORY,
      resourceId: Number(scope.dramaId),
      label: `${scope.dramaTitle || '项目'} 生成剧本`,
      taskId: t.id,
    }),
    refreshKind: 'drama',
  }
}

export function buildResourceTaskRecovery(t, scope, resourceType, resourceId, label) {
  if (!isActiveTaskStatus(t.status)) return null
  return {
    meta: buildScopedTaskMeta(scope, {
      resourceType,
      resourceId: Number(resourceId),
      label,
      taskId: t.id,
    }),
    refreshKind: 'drama',
  }
}
