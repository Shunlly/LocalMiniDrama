import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { readFilmListSources } from './helpers/filmListSources.js'
import {
  projectCardContinueLabel,
  projectCardOpenLabel,
  newProjectDestination,
} from '../src/utils/sourceImportNavigation.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const filmList = readFilmListSources()
const headerSource = filmList.header
const toolbarSource = filmList.toolbar
const gridSource = filmList.grid
const trashSource = filmList.trash
const notFoundSource = read('../src/views/NotFound.vue')
const dramaHeaderSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const episodeListSource = read('../src/components/dramaDetail/DramaDetailEpisodeList.vue')
const appSource = read('../src/App.vue')
const formsSource = filmList.forms

test('\u9875\u5934\u4e0e 404 \u4e0d\u51fa\u73b0\u5fae\u4fe1\u6211\uff0c404 \u4e3b\u6309\u94ae\u4ecd\u662f\u8fd4\u56de\u9879\u76ee\u5217\u8868', () => {
  for (const source of [appSource, headerSource, dramaHeaderSource, notFoundSource, filmList.ui]) {
    assert.doesNotMatch(source, /\u5fae\u4fe1\u6211/)
    assert.doesNotMatch(source, /WeChat/i)
  }
  assert.match(notFoundSource, />\u8fd4\u56de\u9879\u76ee\u5217\u8868<\/el-button>/)
  assert.match(notFoundSource, /aria-label="\u8fd4\u56de\u9879\u76ee\u5217\u8868"/)
  assert.match(dramaHeaderSource, />\u8fd4\u56de\u9879\u76ee\u5217\u8868/)
})

test('\u65b0\u5efa\u7a7a\u767d\u9879\u76ee\u843d\u5230\u5206\u96c6\u5217\u8868\uff0c0 \u96c6\u5361\u7247\u53ea\u8bf4\u53bb\u521b\u5efa\u5267\u96c6', () => {
  assert.deepEqual(newProjectDestination({ id: 9 }, false, '/'), {
    name: 'drama-detail',
    params: { id: 9 },
    query: { returnTo: '/' },
    hash: '#episode-list',
  })
  assert.match(formsSource, /router\.push\(newProjectDestination\(drama, sourceImportIntent\.value, projectListReturnTo\.value\)\)/)
  assert.equal(projectCardContinueLabel({ episodes: [] }, false), '\u53bb\u521b\u5efa\u5267\u96c6')
  assert.equal(projectCardContinueLabel({ episodes: [{ id: 'bad' }] }, false), '\u53bb\u521b\u5efa\u5267\u96c6')
  assert.equal(projectCardContinueLabel({ episodes: [{ id: 3 }] }, false), '\u7ee7\u7eed\u5236\u4f5c')
  assert.equal(projectCardOpenLabel({ title: '\u96e8\u5df7', episodes: [{ id: 3 }] }, false), '\u6253\u5f00\u9879\u76ee\u300c\u96e8\u5df7\u300d\uff0c\u7ee7\u7eed\u5236\u4f5c')
  assert.match(gridSource, /projectCardContinueLabel\(d, sourceImportIntent\)/)
  assert.match(gridSource, /projectCardOpenLabel\(d, sourceImportIntent\)/)
  assert.doesNotMatch(gridSource, /d\.episodes && d\.episodes\.length/)
})

test('\u9879\u76ee\u5217\u8868\u5199\u9501\u7981\u7528\u539f\u56e0\u6302\u5230 aria-describedby\uff0c\u7a7a\u6001\u53ef\u88ab\u8bfb\u5c4f\u542c\u5230', () => {
  assert.match(headerSource, /id="project-list-write-lock-reason"/)
  assert.match(headerSource, /class="tooltip-trigger"/)
  assert.match(headerSource, /:tabindex="listWriteLocked \? 0 : undefined"/)
  assert.match(headerSource, /:aria-describedby="listWriteLocked && listWriteLockReason \? 'project-list-write-lock-reason' : undefined"/)
  assert.match(toolbarSource, /role="status" aria-live="polite"/)
  assert.match(toolbarSource, /action-card--search-empty"[\s\S]*aria-live="polite"/)
  assert.match(toolbarSource, /:aria-describedby="listWriteLocked && listWriteLockReason \? 'project-list-write-lock-reason' : undefined"/)
  assert.match(filmList.view, /id="project-new-submit-reason"/)
  assert.match(filmList.view, /id="project-edit-submit-reason"/)
  assert.match(trashSource, /\u5173\u95ed\u540e\u53ef\u56de\u5230\u9879\u76ee\u5217\u8868\u65b0\u5efa\u6216\u5bfc\u5165\u9879\u76ee/)
  assert.match(episodeListSource, /role="status" aria-live="polite"/)
  assert.match(episodeListSource, /create_blank_episode/)
})
