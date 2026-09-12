export function useFilmCreateStoryboardStateSync(deps = {}) {
  const {
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
  } = deps
  function syncStoryboardStateFromEpisode(ep) {
    const boards = ep?.storyboards || []
    const nextCharIds = {}
    const nextPropIds = {}
    const nextScene = {}
    const nextDialogue = {}
    const nextNarration = {}
    const nextShot = {}
    const nextTitle = {}
    const nextLocation = {}
    const nextTime = {}
    const nextDuration = {}
    const nextAction = {}
    const nextResult = {}
    const nextAtmosphere = {}
    const nextAngle = {}
    const nextAngleH = {}
    const nextAngleV = {}
    const nextAngleS = {}
    const nextMovement = {}
    const nextLighting = {}
    const nextDof = {}
    const nextLayoutDescription = {}
    const nextCreationMode = {}
    const nextUniversalSegment = {}
    const nextVideoReferenceImageId = {}
    for (const sb of boards) {
      nextScene[sb.id] = sb.scene_id ?? null
      nextDialogue[sb.id] = sb.dialogue ?? ''
      nextNarration[sb.id] = sb.narration ?? ''
      nextShot[sb.id] = (sb.shot_type ?? '').toString() || ''
      nextTitle[sb.id] = (sb.title ?? '').toString()
      nextLocation[sb.id] = (sb.location ?? '').toString()
      nextTime[sb.id] = (sb.time ?? '').toString()
      nextDuration[sb.id] = sb.duration != null ? Number(sb.duration) : 5
      nextAction[sb.id] = (sb.action ?? '').toString()
      nextResult[sb.id] = (sb.result ?? '').toString()
      nextAtmosphere[sb.id] = (sb.atmosphere ?? '').toString()
      nextAngle[sb.id] = (sb.angle ?? '').toString()
      nextAngleH[sb.id] = sb.angle_h || ''
      nextAngleV[sb.id] = sb.angle_v || ''
      nextAngleS[sb.id] = sb.angle_s || ''
      nextMovement[sb.id] = (sb.movement ?? '').toString()
      nextLighting[sb.id] = sb.lighting_style || ''
      nextDof[sb.id] = sb.depth_of_field || ''
      nextLayoutDescription[sb.id] = (sb.layout_description ?? '').toString()
      const charList = Array.isArray(sb.characters) ? sb.characters : (sb.characters != null ? [sb.characters] : [])
      nextCharIds[sb.id] = charList.map((c) => (typeof c === 'object' && c != null ? Number(c.id) : Number(c))).filter((n) => Number.isFinite(n))
      nextPropIds[sb.id] = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
      nextCreationMode[sb.id] = sb.creation_mode === 'universal' ? 'universal' : 'classic'
      nextUniversalSegment[sb.id] = (sb.universal_segment_text ?? '').toString()
      nextVideoReferenceImageId[sb.id] = sb.video_reference_image_id ? Number(sb.video_reference_image_id) : ''
    }
    sbCharacterIds.value = nextCharIds
    sbPropIds.value = nextPropIds
    sbSceneId.value = nextScene
    sbDialogue.value = nextDialogue
    sbNarration.value = nextNarration
    sbShotType.value = nextShot
    sbTitle.value = nextTitle
    sbLocation.value = nextLocation
    sbTime.value = nextTime
    sbDuration.value = nextDuration
    sbAction.value = nextAction
    sbResult.value = nextResult
    sbAtmosphere.value = nextAtmosphere
    sbAngle.value = nextAngle
    sbAngleH.value = nextAngleH
    sbAngleV.value = nextAngleV
    sbAngleS.value = nextAngleS
    sbMovement.value = nextMovement
    sbLighting.value = nextLighting
    sbDof.value = nextDof
    sbLayoutDescription.value = nextLayoutDescription
    sbCreationMode.value = nextCreationMode
    sbUniversalSegmentText.value = nextUniversalSegment
    sbVideoReferenceImageId.value = nextVideoReferenceImageId
  }
  return {
    syncStoryboardStateFromEpisode,
  }
}
