import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

const pageSource = read('../src/views/DramaDetail.vue')
const headerSource = read('../src/components/dramaDetail/DramaDetailHeader.vue')
const loadSource = read('../src/components/dramaDetail/DramaDetailLoadState.vue')
const episodeSource = read('../src/components/dramaDetail/DramaDetailEpisodeList.vue')
const emptySource = read('../src/components/dramaDetail/DramaDetailResourceEmptyState.vue')
const dialogsSource = read('../src/components/dramaDetail/DramaDetailResourceDialogs.vue')
const infoSource = read('../src/components/dramaDetail/DramaDetailInfoCard.vue')
const readinessSource = read('../src/components/dramaDetail/DramaDetailReadinessSection.vue')
const libraryListSource = read('../src/components/dramaDetail/DramaDetailResourceLibraryList.vue')
const productionListSource = read('../src/components/dramaDetail/DramaDetailResourceProductionList.vue')

function solidPrimaryCount(source) {
  const buttons = [...source.matchAll(/<el-button\b[\s\S]*?>/g)].map((match) => match[0])
  return buttons.filter((tag) => /(?:^|\s)type="primary"/.test(tag) && !/(?:^|\s)plain(?:\s|=|>)/.test(tag)).length
}

test('剧详情 Logo 读屏名带产品前缀，返回项目列表名称保持独立', () => {
  assert.match(headerSource, /<button type="button" class="logo" aria-label="本地短剧助手，返回项目列表"/)
  assert.match(headerSource, /<el-button class="btn-back-list" aria-label="返回项目列表"/)
  assert.match(headerSource, />返回项目列表/)
  assert.doesNotMatch(headerSource, /返回剧集/)
  assert.match(pageSource, /@go-list="goList"/)
  assert.match(loadSource, /aria-label="返回项目列表"/)
  assert.doesNotMatch(pageSource, /<button type="button" class="logo"/)
})

test('剧详情空态有独立读屏名，空分集区只保留一个实心主按钮', () => {
  assert.match(episodeSource, /aria-label="空剧集下一步"/)
  assert.match(emptySource, /aria-label="空资源下一步"/)
  assert.match(dialogsSource, /aria-label="空资源下一步"/)
  assert.match(episodeSource, /v-if="episodes\.length > 0"[\s\S]*aria-label="新增一集"/)
  assert.match(
    episodeSource,
    /v-if="episodeEmptyState\.primaryAction\?\.id !== 'create_blank_episode' && episodeEmptyState\.primaryAction\?\.target !== 'add-episode'"/,
  )
  const emptyBlock = episodeSource.match(/class="empty-state"[\s\S]*?class="episode-grid"/)?.[0] || ''
  assert.equal(solidPrimaryCount(emptyBlock), 1)
  assert.match(emptyBlock, /type="primary"/)
  assert.match(loadSource, /:type="notFound \? 'primary' : undefined"/)
  assert.match(loadSource, /aria-labelledby="drama-load-loading-title"/)
})

test('剧详情页头与主栏在窄屏裁切横向溢出，不再用 96vw 撑出滚动', () => {
  assert.doesNotMatch(pageSource, /96vw/)
  assert.doesNotMatch(headerSource, /96vw/)
  assert.match(pageSource, /\.drama-detail \{[\s\S]*?overflow-x: clip;/)
  assert.match(pageSource, /@media \(max-width: 760px\) \{[\s\S]*?\.drama-detail \{[\s\S]*?overflow-x: clip;/)
  assert.match(pageSource, /@media \(max-width: 760px\) \{[\s\S]*?\.main \{[\s\S]*?width: calc\(100% - 24px\);[\s\S]*?overflow-x: hidden;/)
  assert.match(headerSource, /\.header \{[\s\S]*?overflow-x: clip;/)
  assert.match(headerSource, /\.header-inner \{[\s\S]*?max-width: min\(1200px, 100%\);[\s\S]*?flex-wrap: wrap;/)
  assert.match(headerSource, /@media \(max-width: 1100px\) \{[\s\S]*?\.header-actions \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
  assert.match(infoSource, /:xs="24"/)
  assert.match(readinessSource, /flex-wrap: wrap;/)
  assert.match(libraryListSource, /overflow-x: hidden;/)
  assert.match(productionListSource, /min-width: 0;/)
  assert.match(episodeSource, /class="empty-state"[\s\S]*?max-width: 100%;/)
})
