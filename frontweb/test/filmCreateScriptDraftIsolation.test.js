import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useFilmCreateScriptDraft } from '../src/composables/filmCreate/useFilmCreateScriptDraft.js'

test('制作页草稿回写只按剧集 id，不会命中同集号的另一集', async () => {
  const dramaId = 11
  const episodeId = 5
  const otherId = 2
  assert.notEqual(dramaId, episodeId)
  assert.notEqual(episodeId, otherId)
  const episodes = [
    { id: otherId, episode_number: 1, title: '错集', script_content: '旧A' },
    { id: episodeId, episode_number: 1, title: '对集', script_content: '旧B' },
  ]
  const store = {
    dramaId,
    currentEpisode: episodes[1],
    drama: { episodes },
  }
  const { persistScriptDraftSnapshot } = useFilmCreateScriptDraft({
    store,
    dramaAPI: {
      async saveEpisodes() {},
    },
    scriptTitle: ref('对集'),
    scriptContent: ref('新正文'),
    scriptDraftStatus: ref('saved'),
    currentEpisodeId: ref(episodeId),
  })
  await persistScriptDraftSnapshot({
    dramaId,
    episodeId,
    episodeNumber: 1,
    title: '新标题',
    content: '新正文',
  })
  assert.equal(episodes[0].script_content, '旧A')
  assert.equal(episodes[0].title, '错集')
  assert.equal(episodes[1].script_content, '新正文')
  assert.equal(episodes[1].title, '新标题')
})
