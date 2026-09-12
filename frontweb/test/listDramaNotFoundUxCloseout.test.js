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

test('页头与 404 不出现微信我，404 主按钮仍是返回项目列表', () => {
  for (const source of [appSource, headerSource, dramaHeaderSource, notFoundSource, filmList.ui]) {
    assert.doesNotMatch(source, /微信我/)
    assert.doesNotMatch(source, /WeChat/i)
  }
  assert.match(notFoundSource, />返回项目列表<\/el-button>/)
  assert.match(notFoundSource, /aria-label="返回项目列表"/)
  assert.match(dramaHeaderSource, />返回项目列表/)
})

test('新建空白项目落到分集列表，0 集卡片只说去创建剧集', () => {
  assert.deepEqual(newProjectDestination({ id: 9 }, false, '/'), {
    name: 'drama-detail',
    params: { id: 9 },
    query: { returnTo: '/' },
    hash: '#episode-list',
  })
  assert.match(formsSource, /router\.push\(newProjectDestination\(drama, sourceImportIntent\.value, projectListReturnTo\.value\)\)/)
  assert.equal(projectCardContinueLabel({ episodes: [] }, false), '去创建剧集')
  assert.equal(projectCardContinueLabel({ episodes: [{ id: 'bad' }] }, false), '去创建剧集')
  assert.equal(projectCardContinueLabel({ episodes: [{ id: 3 }] }, false), '继续制作')
  assert.equal(projectCardOpenLabel({ title: '雨巷', episodes: [{ id: 3 }] }, false), '打开项目「雨巷」')
  assert.match(gridSource, /projectCardContinueLabel\(d, sourceImportIntent\)/)
  assert.match(gridSource, /projectCardOpenLabel\(d, sourceImportIntent\)/)
  assert.doesNotMatch(gridSource, /d\.episodes && d\.episodes\.length/)
  assert.match(gridSource, /countProjectEpisodes\(d\)/)
  assert.doesNotMatch(gridSource, /d\.episodes\?\.length/)
})

test('项目列表写锁禁用原因挂到 aria-describedby，空态可被读屏听到', () => {
  assert.match(headerSource, /id="project-list-write-lock-reason"/)
  assert.match(headerSource, /class="tooltip-trigger"/)
  assert.match(headerSource, /:tabindex="listWriteLocked \? 0 : undefined"/)
  assert.match(headerSource, /:aria-describedby="listWriteLocked && listWriteLockReason \? 'project-list-write-lock-reason' : undefined"/)
  assert.match(toolbarSource, /role="status" aria-live="polite"/)
  assert.match(toolbarSource, /action-card--search-empty"[\s\S]*aria-live="polite"/)
  assert.match(toolbarSource, /:aria-describedby="listWriteLocked && listWriteLockReason \? 'project-list-write-lock-reason' : undefined"/)
  assert.match(filmList.view, /id="project-new-submit-reason"/)
  assert.match(filmList.view, /id="project-edit-submit-reason"/)
  assert.match(trashSource, /关闭后可回到项目列表新建或导入项目/)
  assert.match(episodeListSource, /role="status" aria-live="polite"/)
  assert.match(episodeListSource, /create_blank_episode/)
  assert.match(dramaHeaderSource, /id="drama-header-episode-reason"/)
  assert.match(dramaHeaderSource, /:aria-describedby="currentEpisodeId \? undefined : 'drama-header-episode-reason'"/)
  assert.match(filmList.view, /确定新建项目不可用：\$\{newSubmitDisabledReason\}/)
  assert.match(filmList.view, /保存项目不可用：\$\{editSubmitDisabledReason\}/)
  assert.match(toolbarSource, /导入示例项目\$\{ex\.name\}不可用：\$\{listWriteLockReason\}/)
  assert.match(filmList.banners, /重试导出不可用：正在导出其他项目，请稍候/)
  assert.match(filmList.banners, /关闭导入失败提示不可用：正在导入项目包，请稍候/)
  assert.match(trashSource, /恢复项目「\$\{item\.title \|\| '未命名项目'\}」不可用/)
  assert.match(gridSource, /导出项目不可用：正在导出该项目，请稍候/)
  assert.match(gridSource, /编辑项目不可用：\$\{listWriteLockReason\}/)
  assert.match(gridSource, /移入回收站不可用：\$\{listWriteLockReason\}/)
})

test('剧集状态和项目卡片未知英文会收成中文', () => {
  const dramaDetailSource = read('../src/views/DramaDetail.vue')
  assert.match(dramaDetailSource, /未知状态/)
  assert.match(dramaDetailSource, /generating: '生成中'/)
  assert.match(filmList.formatters, /未知状态/)
  assert.match(filmList.formatters, /未知风格/)
  assert.match(filmList.formatters, /未知类型/)
})
