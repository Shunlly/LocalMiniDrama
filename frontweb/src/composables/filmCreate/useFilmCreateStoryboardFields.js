import { ref } from 'vue'

/** 分镜行内编辑字段袋，一律按 storyboard id 索引，禁止用 dramaId / episodeId 当 key */
export const FILM_CREATE_STORYBOARD_FIELD_KEYS = [
  'sbCharacterIds',
  'sbPropIds',
  'sbSceneId',
  'sbDialogue',
  'sbNarration',
  'sbShotType',
  'sbTitle',
  'sbLocation',
  'sbTime',
  'sbDuration',
  'sbAction',
  'sbResult',
  'sbAtmosphere',
  'sbAngle',
  'sbAngleH',
  'sbAngleV',
  'sbAngleS',
  'sbMovement',
  'sbLighting',
  'sbDof',
  'sbLayoutDescription',
  'sbCreationMode',
  'sbUniversalSegmentText',
  'sbVideoReferenceImageId',
]

export function snapshotFilmCreateStoryboardFields(fields) {
  const snapshot = {}
  for (const key of FILM_CREATE_STORYBOARD_FIELD_KEYS) {
    snapshot[key] = { ...(fields?.[key]?.value || {}) }
  }
  return snapshot
}

export function applyFilmCreateStoryboardFieldsSnapshot(fields, snapshot = {}) {
  for (const key of FILM_CREATE_STORYBOARD_FIELD_KEYS) {
    fields[key].value = { ...(snapshot?.[key] || {}) }
  }
}

export function writeFilmCreateStoryboardField(fields, fieldKey, storyboardId, value) {
  if (!FILM_CREATE_STORYBOARD_FIELD_KEYS.includes(fieldKey)) {
    throw new Error(`未知分镜字段: ${fieldKey}`)
  }
  if (storyboardId == null || storyboardId === '') {
    throw new Error('分镜字段只能按 storyboard id 写入')
  }
  const bag = fields[fieldKey]
  bag.value = {
    ...(bag.value || {}),
    [storyboardId]: value,
  }
}

export function useFilmCreateStoryboardFields() {
  const sbCharacterIds = ref({}) // sbId -> number[] 多选角色
  const sbPropIds = ref({}) // sbId -> number[] 多选道具
  const sbSceneId = ref({})
  const sbDialogue = ref({})
  const sbNarration = ref({})
  const sbShotType = ref({})
  /** 视频提示词组成（可编辑），key 为分镜 id */
  const sbTitle = ref({})
  const sbLocation = ref({})
  const sbTime = ref({})
  const sbDuration = ref({})
  const sbAction = ref({})
  const sbResult = ref({})
  const sbAtmosphere = ref({})
  const sbAngle = ref({})
  const sbAngleH = ref({}) // 结构化视角：水平方向
  const sbAngleV = ref({}) // 结构化视角：俯仰角度
  const sbAngleS = ref({}) // 结构化视角：景别
  const sbMovement = ref({})
  const sbLighting = ref({}) // 灯光风格
  const sbDof = ref({}) // 景深
  const sbLayoutDescription = ref({}) // 空间布局与人物站位描述
  /** 分镜创作模式：classic | universal（默认 classic，存库 storyboards.creation_mode） */
  const sbCreationMode = ref({})
  /** 全能模式片段描述（存库 universal_segment_text，与经典参考图字段独立） */
  const sbUniversalSegmentText = ref({})
  const sbVideoReferenceImageId = ref({})

  return {
    sbCharacterIds,
    sbPropIds,
    sbSceneId,
    sbDialogue,
    sbNarration,
    sbShotType,
    sbTitle,
    sbLocation,
    sbTime,
    sbDuration,
    sbAction,
    sbResult,
    sbAtmosphere,
    sbAngle,
    sbAngleH,
    sbAngleV,
    sbAngleS,
    sbMovement,
    sbLighting,
    sbDof,
    sbLayoutDescription,
    sbCreationMode,
    sbUniversalSegmentText,
    sbVideoReferenceImageId,
  }
}
