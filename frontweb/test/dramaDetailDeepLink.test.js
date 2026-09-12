import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  describeDramaDetailDeepLink,
  requestedEpisodeExists,
  stripDramaDetailDeepLinkQuery,
} from '../src/components/dramaDetail/dramaDetailDeepLink.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pageSource = read('../src/views/DramaDetail.vue')
const loadSource = read('../src/components/dramaDetail/DramaDetailLoadState.vue')
const headerSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const EPISODE_ID = 22
const OTHER_ID = 33

test('无效深链接与空剧集给出中文下一步，页面仍转发合法锚点', () => {
  assert.match(pageSource, /describeDramaDetailDeepLink\(/)
  assert.match(pageSource, /stripDramaDetailDeepLinkQuery\(/)
  assert.match(pageSource, /isDramaReady.value/)
  assert.match(pageSource, /DRAMA_DETAIL_SECTION_IDS.includes\(id\)/)
  assert.match(pageSource, /scrollToSection\(id, \{ focus: !\(id === 'source-intake-workflow' && sourceImportIntent\.value\) \}\)/)
  assert.match(loadSource, /请返回项目列表确认/)
  assert.match(headerSource, /aria-label="返回项目列表"/)
  assert.doesNotMatch(headerSource, /返回剧集/)

  const missingEpisode = describeDramaDetailDeepLink({
    hash: '#episode-list',
    episodeQuery: String(OTHER_ID),
    episodes: [{ id: EPISODE_ID, title: '第一集' }],
  })
  assert.equal(missingEpisode.kind, 'invalid-episode')
  assert.equal(missingEpisode.scrollTo, 'episode-list')
  assert.equal(missingEpisode.dropEpisode, true)
  assert.match(missingEpisode.message, /不存在或已删除/)
  assert.match(missingEpisode.message, /从分集列表/)
  assert.equal(requestedEpisodeExists([{ id: EPISODE_ID }], String(OTHER_ID)), false)
  assert.notEqual(EPISODE_ID, OTHER_ID)

  const empty = describeDramaDetailDeepLink({
    hash: '',
    episodeQuery: '999',
    episodes: [],
  })
  assert.equal(empty.kind, 'invalid-episode')
  assert.match(empty.message, /请先新增一集/)
  assert.match(empty.message, /批量导入剧本/)

  const invalidHash = describeDramaDetailDeepLink({
    hash: '#evil',
    episodeQuery: '',
    episodes: [{ id: EPISODE_ID }],
  })
  assert.equal(invalidHash.kind, 'invalid-hash')
  assert.equal(invalidHash.dropHash, true)
  assert.match(invalidHash.message, /位置无效/)
  assert.match(invalidHash.message, /返回项目列表/)

  const section = describeDramaDetailDeepLink({
    hash: '#episodes',
    episodeQuery: String(EPISODE_ID),
    episodes: [{ id: EPISODE_ID }],
  })
  assert.equal(section.kind, 'section')
  assert.equal(section.scrollTo, 'episode-list')
  assert.equal(section.message, '')

  const stripped = stripDramaDetailDeepLinkQuery({ episode: '999', returnTo: '/' }, { dropEpisode: true })
  assert.equal(stripped.episode, undefined)
  assert.equal(stripped.returnTo, '/')
})
