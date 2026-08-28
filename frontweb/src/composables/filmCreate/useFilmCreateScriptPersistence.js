import { ElMessage } from 'element-plus'
import { parseScriptIntoEpisodes } from '@/utils/scriptEpisodes'
import { runGenerateStoryFromPremise } from '@/composables/useStoryGeneration'

export function useFilmCreateScriptPersistence(deps = {}) {
  const {
    store,
    dramaAPI,
    router,
    route,
    scriptTitle,
    storyType,
    generationStyle,
    storyStyle,
    storyInput,
    projectAspectRatio,
    videoClipDuration,
    storyboardIncludeNarration,
    storyboardUniversalOmni,
    storyboardUseFirstLastFrame,
    lastFrameUseFirstLayoutLock,
    projectStylePromptMetadata,
    loadDrama,
    savedCurrentEpisodeNumber,
    selectedEpisodeId,
    onEpisodeSelect,
    storyGenerating,
    scriptGenerating,
    pollTask,
    trackFilmCreateAction,
    storyEpisodeCount,
  } = deps

  /** 将当前剧本内容保存到后端（创建/更新项目与集数），供「保存剧本」与「AI 生成」后自动保存共用 */
  async function saveScriptToBackend(content) {
    const trimmed = (content ?? '').toString().trim()
    if (!trimmed) return
    const parsed = parseScriptIntoEpisodes(trimmed)
    const multiFromMarkers = parsed.split && parsed.episodes.length >= 2
    const toPayload = (list) =>
      list.map((e, i) => ({
        episode_number: i + 1,
        title: (e.title && String(e.title).trim()) || '第' + (i + 1) + '集',
        script_content: e.script_content ?? '',
        description: null,
        duration: 0,
      }))

    let dramaId = store.dramaId
    const curEp = store.currentEpisode
    if (!dramaId) {
      const drama = await dramaAPI.create({
        title: scriptTitle.value || '新故事',
        description: '',
        genre: storyType.value || undefined,
        style: generationStyle.value || undefined,
        metadata: {
          ...projectStylePromptMetadata(),
          story_style: storyStyle.value || undefined,
          story_generation_draft: storyInput.value?.trim() || undefined,
          aspect_ratio: projectAspectRatio.value || '16:9',
        },
      })
      store.setDrama(drama)
      dramaId = drama.id
      savedCurrentEpisodeNumber.value = 1
      const first = parsed.episodes[0] || { title: '', script_content: trimmed }
      const episodes = multiFromMarkers
        ? toPayload(parsed.episodes)
        : [
            {
              episode_number: 1,
              title: scriptTitle.value || first.title || '第1集',
              script_content: trimmed,
            },
          ]
      await dramaAPI.saveEpisodes(dramaId, episodes)
      await loadDrama()
      if (route.params.id === 'new') {
        router.replace('/film/' + dramaId)
      }
      if (multiFromMarkers) {
        ElMessage.success(`已按「第N集/章/节」拆分为 ${episodes.length} 集`)
      }
      return { created: true }
    }
    if (multiFromMarkers) {
      savedCurrentEpisodeNumber.value = 1
      const payload = toPayload(parsed.episodes)
      await dramaAPI.saveEpisodes(dramaId, payload)
      if (storyInput.value?.trim()) {
        await dramaAPI.saveOutline(dramaId, {
          genre: storyType.value || undefined,
          style: generationStyle.value || undefined,
          metadata: {
            ...projectStylePromptMetadata(),
            story_style: storyStyle.value || undefined,
            story_generation_draft: storyInput.value?.trim() || undefined,
            aspect_ratio: projectAspectRatio.value || '16:9',
          },
        }).catch(() => {})
      }
      await loadDrama()
      ElMessage.success(`已按「第N集/章/节」拆分为 ${payload.length} 集`)
      return { created: false, splitEpisodes: true }
    }
    const episodes = store.drama?.episodes || []
    savedCurrentEpisodeNumber.value = curEp?.episode_number ?? 1
    const updated = episodes.map((ep, i) => {
      const num = ep.episode_number ?? i + 1
      const isCurrent = curEp && Number(ep.id) === Number(curEp.id)
      return {
        episode_number: num,
        title: isCurrent
          ? scriptTitle.value || ep.title || '第' + num + '集'
          : ep.title || '',
        script_content: isCurrent ? trimmed : (ep.script_content || ''),
        description: ep.description,
        duration: ep.duration,
      }
    })
    if (updated.length === 0) {
      updated.push({ episode_number: 1, title: scriptTitle.value || '第1集', script_content: trimmed })
    }
    await dramaAPI.saveEpisodes(dramaId, updated)
    if (storyInput.value?.trim()) {
      await dramaAPI.saveOutline(dramaId, {
        genre: storyType.value || undefined,
        style: generationStyle.value || undefined,
        metadata: {
          ...projectStylePromptMetadata(),
          story_style: storyStyle.value || undefined,
          story_generation_draft: storyInput.value?.trim() || undefined,
          aspect_ratio: projectAspectRatio.value || '16:9',
        },
      }).catch(() => {})
    }
    await loadDrama()
    return { created: false }
  }

  /**
   * @param {boolean} includeGenerationStyle - 仅在选择「画面风格」为 true：写入 dramas.style 与 style_prompt_*。
   * 其它项目设置改为 false，避免界面未刷新时仍用旧的 generationStyle 覆盖外部已更新的画风（如直接调 API PUT outline）。
   */
  async function saveProjectSettings(includeGenerationStyle = false) {
    if (!store.dramaId) return
    const metadata = {
      story_style: storyStyle.value || undefined,
      story_generation_draft: storyInput.value?.trim() || undefined,
      aspect_ratio: projectAspectRatio.value || '16:9',
      video_clip_duration: videoClipDuration.value || 5,
      storyboard_include_narration: !!storyboardIncludeNarration.value,
      storyboard_universal_omni: !!storyboardUniversalOmni.value,
      storyboard_use_first_last_frame: !!storyboardUseFirstLastFrame.value,
      last_frame_use_first_layout_lock: !!lastFrameUseFirstLayoutLock.value,
    }
    if (includeGenerationStyle) {
      Object.assign(metadata, projectStylePromptMetadata())
    }
    const payload = {
      genre: storyType.value || undefined,
      metadata,
    }
    if (includeGenerationStyle) {
      payload.style = generationStyle.value || undefined
    }
    dramaAPI.saveOutline(store.dramaId, payload).catch(e => console.error('Settings auto-save failed', e))
  }

  async function onGenerateStory() {
    trackFilmCreateAction('generate_script_click')
    await runGenerateStoryFromPremise({
      premise: storyInput.value,
      storyStyle: storyStyle.value,
      storyType: storyType.value,
      storyEpisodeCount: storyEpisodeCount.value,
      scriptTitle: scriptTitle.value,
      generationStyle: generationStyle.value,
      projectAspectRatio: projectAspectRatio.value,
      store,
      router,
      route,
      loadDrama,
      savedCurrentEpisodeNumber,
      selectedEpisodeId,
      onEpisodeSelect,
    storyGenerating,
    scriptGenerating,
    pollTask,
    replaceRouteWhenNew: true,
      skipPostLoad: false,
      onComplete: ({ episodeCount }) => {
        trackFilmCreateAction('generate_script_complete', {
          extra: { episode_count: episodeCount },
        })
      },
    })
  }

  return {
    saveScriptToBackend,
    saveProjectSettings,
    onGenerateStory,
  }
}
