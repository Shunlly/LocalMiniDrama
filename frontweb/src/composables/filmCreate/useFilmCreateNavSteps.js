import { computed } from 'vue'
import { GEN_RESOURCE } from '@/stores/generationTaskStore'

export function useFilmCreateNavSteps(deps = {}) {
  const {
    genStore,
    dramaId,
    currentEpisodeId,
    scriptContent,
    isStoryGenRunning,
    characters,
    hasAssetImage,
    charactersGenerating,
    generatingCharIds,
    props,
    propsExtracting,
    generatingPropIds,
    scenes,
    scenesExtracting,
    generatingSceneIds,
    storyboards,
    storyboardGenerating,
    universalOmniPolishRunning,
    hasSbImage,
    generatingSbImageIds,
    batchImageRunning,
    getSbAllVideos,
    batchVideoRunning,
    generatingSbVideoIds,
    videoStatus,
    currentEpisodeVideoUrl,
  } = deps

  const navSteps = computed(() => {
    const epRunning = genStore.getRunningForEpisode(dramaId.value, currentEpisodeId.value)
    const hasScript = !!(scriptContent?.value?.trim())
    const scriptStatus = isStoryGenRunning.value
      ? 'generating'
      : hasScript ? 'done' : 'pending'

    const charList = characters.value || []
    const charDone = charList.length > 0 && charList.every((c) => hasAssetImage(c))
    const charGen = charactersGenerating.value || generatingCharIds.size > 0
      || epRunning.some((t) => t.resourceType === GEN_RESOURCE.CHAR_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_CHARACTERS)
    const charStatus = charGen ? 'generating' : charDone ? 'done' : charList.length > 0 ? 'partial' : 'pending'

    const propList = props.value || []
    const propDone = propList.length > 0 && propList.every((p) => hasAssetImage(p))
    const propGen = propsExtracting.value || generatingPropIds.size > 0
      || epRunning.some((t) => t.resourceType === GEN_RESOURCE.PROP_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_PROPS)
    const propStatus = propGen ? 'generating' : propDone ? 'done' : propList.length > 0 ? 'partial' : 'pending'

    const sceneList = scenes.value || []
    const sceneDone = sceneList.length > 0 && sceneList.every((s) => hasAssetImage(s))
    const sceneGen = scenesExtracting.value || generatingSceneIds.size > 0
      || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SCENE_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_SCENES)
    const sceneStatus = sceneGen ? 'generating' : sceneDone ? 'done' : sceneList.length > 0 ? 'partial' : 'pending'

    const sbList = storyboards.value || []
    const sbScriptDone = sbList.length > 0
    const sbScriptGen = storyboardGenerating.value || universalOmniPolishRunning.value
      || epRunning.some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORYBOARD)
    const sbScriptStatus = sbScriptGen ? 'generating' : sbScriptDone ? 'done' : 'pending'

    const sbImgDone = sbList.length > 0 && sbList.every((sb) => hasSbImage(sb))
    const sbImgGen = generatingSbImageIds.size > 0 || batchImageRunning.value || epRunning.some((t) =>
      t.resourceType === GEN_RESOURCE.SB_IMAGE
      || t.resourceType === GEN_RESOURCE.SB_FIRST_IMAGE
      || t.resourceType === GEN_RESOURCE.SB_LAST_IMAGE
    )
    const sbImgStatus = sbImgGen ? 'generating' : sbImgDone ? 'done' : sbList.length > 0 ? 'partial' : 'pending'

    const sbVideoAllDone = sbList.length > 0 && sbList.every((sb) => getSbAllVideos(sb.id).length > 0)
    const sbVideoSome = sbList.some((sb) => getSbAllVideos(sb.id).length > 0)
    const sbVideoGen = batchVideoRunning.value || generatingSbVideoIds.size > 0
      || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SB_VIDEO)
    const compositeStatus = videoStatus.value === 'generating'
      ? 'generating'
      : currentEpisodeVideoUrl.value
        ? 'done'
        : (sbVideoGen || sbVideoAllDone || sbVideoSome) ? 'partial' : 'pending'

    return [
      { key: 'script', label: '故事剧本', anchor: 'anchor-script', status: scriptStatus, count: hasScript ? 1 : 0 },
      { key: 'chars', label: '角色', anchor: 'anchor-characters', status: charStatus, count: charList.length },
      { key: 'props', label: '道具', anchor: 'anchor-props', status: propStatus, count: propList.length },
      { key: 'scenes', label: '场景', anchor: 'anchor-scenes', status: sceneStatus, count: sceneList.length },
      { key: 'sb', label: '分镜脚本', anchor: 'anchor-storyboard', status: sbScriptStatus, count: sbList.length },
      { key: 'sbimg', label: '分镜图', anchor: 'anchor-storyboard-images', status: sbImgStatus, count: sbList.length },
      { key: 'video', label: '交付与导出', anchor: 'anchor-video', status: compositeStatus, count: 0 },
    ]
  })

  return { navSteps }
}
