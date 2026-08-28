import { watch } from 'vue'
import {
  buildEpisodeDraftPayload,
  createScriptDraftController,
} from '@/utils/scriptDraft'

export function useFilmCreateScriptDraft(deps = {}) {
  const {
    store,
    dramaAPI,
    scriptTitle,
    scriptContent,
    scriptDraftStatus,
    currentEpisodeId,
  } = deps

  function captureScriptDraft() {
    const episode = store.currentEpisode
    if (!store.dramaId || !episode?.id) return null
    return {
      dramaId: Number(store.dramaId),
      episodeId: Number(episode.id),
      episodeNumber: Number(episode.episode_number) || 1,
      title: scriptTitle.value || '',
      content: scriptContent.value || '',
    }
  }

  async function persistScriptDraftSnapshot(snapshot) {
    if (!snapshot || Number(store.dramaId) !== Number(snapshot.dramaId)) {
      throw new Error('项目已切换，草稿未自动保存')
    }
    const episodes = store.drama?.episodes || []
    const payload = buildEpisodeDraftPayload(episodes, snapshot)
    await dramaAPI.saveEpisodes(snapshot.dramaId, payload)

    const target = episodes.find((episode) => (
      Number(episode.id) === Number(snapshot.episodeId)
        || Number(episode.episode_number) === Number(snapshot.episodeNumber)
    ))
    if (target) {
      target.title = snapshot.title
      target.script_content = snapshot.content
    }
    if (Number(store.currentEpisode?.id) === Number(snapshot.episodeId)) {
      store.currentEpisode.title = snapshot.title
      store.currentEpisode.script_content = snapshot.content
    }
  }

  const scriptDraftController = createScriptDraftController({
    saveSnapshot: persistScriptDraftSnapshot,
    onStateChange: (state) => {
      scriptDraftStatus.value = state
    },
  })

  function markScriptDraftSaved() {
    scriptDraftController.markSaved(captureScriptDraft())
  }

  async function flushScriptDraft() {
    await scriptDraftController.flush()
  }

  watch(
    [scriptTitle, () => scriptContent.value, currentEpisodeId],
    () => scriptDraftController.queue(captureScriptDraft()),
    { flush: 'post' },
  )

  return {
    scriptDraftController,
    captureScriptDraft,
    markScriptDraftSaved,
    persistScriptDraftSnapshot,
    flushScriptDraft,
  }
}
