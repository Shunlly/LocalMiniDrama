import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFilmListSources } from './helpers/filmListSources.js'

import {
  formatMediaSize,
  getMediaLibraryDramaId,
  hasActiveMediaFilters,
  normalizeMediaItem,
} from '../src/utils/mediaLibrary.js'

const filmListSource = readFilmListSources().ui
const sourceIntakeWorkflowSource = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')
const mediaLibrarySource = [
  readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryHeader.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryFilterBar.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryLocalGrid.vue', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/components/mediaLibrary/MediaLibraryNetworkPanel.vue', import.meta.url), 'utf8'),
].join('\n')
const filmCreateHeaderSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateHeader.vue', import.meta.url), 'utf8')
const backupSource = readFileSync(new URL('../src/views/Backup.vue', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const themeSource = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')

test('media library helpers normalize media metadata and active filters', () => {
  assert.deepEqual(
    normalizeMediaItem({ id: 1, url: 'https://cdn.test/video/scene.mp4?token=abc' }),
    { id: 1, url: 'https://cdn.test/video/scene.mp4?token=abc', type: 'video', name: 'scene.mp4' },
  )
  assert.equal(normalizeMediaItem({ filename: 'poster.png', image_url: '/poster.png' }).type, 'image')
  assert.equal(normalizeMediaItem({ type: 'video', url: '/stream/asset' }).type, 'video')
  assert.equal(formatMediaSize(0), '0 B')
  assert.equal(formatMediaSize(2048), '2 KB')
  assert.equal(formatMediaSize(2 * 1024 * 1024), '2.0 MB')
  assert.equal(hasActiveMediaFilters('all', '  '), false)
  assert.equal(hasActiveMediaFilters('video', ''), true)
  assert.equal(hasActiveMediaFilters('all', '人物'), true)
  assert.equal(getMediaLibraryDramaId('/film/12?episode=4'), 12)
  assert.equal(getMediaLibraryDramaId('/film/12/canvas?episode=4'), 12)
  assert.equal(getMediaLibraryDramaId('/media-library'), null)
})

test('desktop home exposes one material center entry and keeps semantic libraries grouped', () => {
  const headerLibrarySource = filmListSource.match(/<div class="header-library">[\s\S]*?<\/div>/)?.[0] || ''
  assert.match(headerLibrarySource, /<div class="header-library">/)
  assert.doesNotMatch(headerLibrarySource, /<!-- 右侧操作区 -->/)
  assert.match(
    headerLibrarySource,
    /<el-button class="btn-library btn-material-center" title="打开素材中心" aria-label="打开素材中心" @click="goMaterialCenter">\s*<el-icon><Files \/><\/el-icon>素材中心\s*<\/el-button>/,
  )
  assert.match(
    headerLibrarySource,
    /<el-button class="btn-library btn-semantic-library" :disabled="listWriteLocked" aria-label="打开分类素材"[^>]*>\s*<el-icon><Collection \/><\/el-icon>分类素材\s*<el-icon class="dropdown-caret"><ArrowDown \/><\/el-icon>\s*<\/el-button>/,
  )
  assert.match(headerLibrarySource, /<el-dropdown-item command="character"><el-icon><User \/><\/el-icon>角色素材库<\/el-dropdown-item>/)
  assert.match(headerLibrarySource, /<el-dropdown-item command="scene"><el-icon><PictureFilled \/><\/el-icon>场景素材库<\/el-dropdown-item>/)
  assert.match(headerLibrarySource, /<el-dropdown-item command="prop"><el-icon><Box \/><\/el-icon>道具素材库<\/el-dropdown-item>/)
  assert.match(routerSource, /path: '\/media-library'[\s\S]*meta: \{ title: '素材中心',/)
  assert.match(filmListSource, /function goMaterialCenter\(\) \{\s*openWorkspaceNavItem\(router, 'media-library'\)\s*\}/)
})

test('project list exposes a reachable Chinese backup entry on the home header', () => {
  assert.match(
    filmListSource,
    /class="btn-library btn-backup"[\s\S]*title="打开数据备份"[\s\S]*aria-label="打开数据备份与维护"[\s\S]*@click="goBackup"[\s\S]*数据备份/,
  )
  assert.match(filmListSource, /function goBackup\(\)/)
  assert.match(filmListSource, /openWorkspaceNavItem\(router, backupNavItem\.id, \{ query: \{ returnTo \} \}/)
  assert.doesNotMatch(filmListSource, /微信我/)
  assert.match(routerSource, /path: '\/backup'[\s\S]*name: 'backup'/)
  assert.match(routerSource, /meta: \{ title: '数据备份',/)
})

test('页头产品入口已去掉微信我，且不影响备份导航', () => {
  for (const source of [filmListSource, filmCreateHeaderSource, backupSource, appSource]) {
    assert.doesNotMatch(source, /微信我/)
    assert.doesNotMatch(source, /btn-wechat/)
    assert.doesNotMatch(source, /showWechat/)
    assert.doesNotMatch(source, /扫码联系作者/)
    assert.doesNotMatch(source, /微信联系作者/)
    assert.doesNotMatch(source, /ChatDotSquare/)
  }
  assert.match(filmCreateHeaderSource, /class="btn-ai-config"/)
  assert.match(backupSource, /数据备份与维护/)
  assert.match(appSource, /<router-view/)
  assert.match(routerSource, /path: '\/backup'[\s\S]*name: 'backup'/)
})

test('story-source actions use the scoped story-material terminology', () => {
  assert.match(sourceIntakeWorkflowSource, /<ActionGate label="导入故事素材" :reason="actionReasons.import">/)
  assert.match(sourceIntakeWorkflowSource, /<el-button\b[^>]*>\s*导入故事素材\s*<\/el-button>/)
  assert.doesNotMatch(sourceIntakeWorkflowSource, /仅导入素材/)
  assert.match(sourceIntakeWorkflowSource, /<el-button\b[^>]*>\s*继续导入故事素材\s*<\/el-button>/)
})

test('project cards use a stable action menu and the no-project state has direct actions', () => {
  assert.match(filmListSource, /class="project-card-header"/)
  assert.match(filmListSource, /class="project-menu-button"/)
  assert.match(filmListSource, /command="export"/)
  assert.match(filmListSource, /command="edit"/)
  assert.match(filmListSource, /command="trash"[\s\S]*移入回收站/)
  assert.doesNotMatch(filmListSource, /class="project-card-actions"/)
  assert.match(filmListSource, /还没有短剧项目/)
  assert.match(filmListSource, /新建项目/)
  assert.match(filmListSource, /导入项目包/)
  assert.match(filmListSource, /前往素材中心/)
  assert.match(filmListSource, /route\.query\.new/)
})

test('project list exposes source import intent with a direct project command', () => {
  assert.match(filmListSource, /const sourceImportIntent = computed\(\(\) => route\.query\.intent === 'source-import'\)/)
  assert.match(filmListSource, /v-if="sourceImportIntent"[\s\S]*?role="status"[\s\S]*?@click="openSourceImportProject"/)
  assert.match(filmListSource, /function openSourceImportProject\(\) \{[\s\S]*?showNewDialog\.value = true/)
})

test('project workspace list has server-backed filtering, sorting, quiet utility controls and stronger card hierarchy', () => {
  assert.match(filmListSource, /class="workspace-overview"[\s\S]*class="workspace-title"[\s\S]*>项目列表<\/h2>/)
  assert.match(filmListSource, /class="workspace-count"[\s\S]*\{\{ projectListCountLabel \}\}/)
  assert.match(filmListSource, /v-model="projectSearch"[\s\S]*placeholder="搜索项目标题、描述、风格或类型"/)
  assert.match(filmListSource, /v-model="projectSort"[\s\S]*更新时间优先[\s\S]*创建时间优先[\s\S]*标题升序/)
  assert.match(filmListSource, /v-if="!loading && hasSuccessfulListLoad && !listError && hasProjectFilters && filteredDramas\.length === 0"/)
  assert.match(filmListSource, /没有匹配的项目/)
  assert.match(filmListSource, /function clearProjectFilters\(\)/)
  assert.match(filmListSource, /v-model="projectStatusFilter"/)
  assert.match(filmListSource, /class="project-card-cover"/)
  assert.match(filmListSource, /继续制作/)
  assert.match(filmListSource, /v-for="d in filteredDramas"/)
  assert.match(filmListSource, /<el-pagination[\s\S]*:total="total"/)
  assert.match(filmListSource, /class="project-card-topline"[\s\S]*class="project-updated"/)
  assert.match(filmListSource, /class="project-card-stats"[\s\S]*class="project-stat"/)
  assert.match(filmListSource, /class="visually-hidden">\{\{ isDark \? '切换到浅色模式' : '切换到暗色模式' \}\}/)
  assert.match(filmListSource, /class="visually-hidden">打开项目回收站<\/span>/)
  assert.match(filmListSource, /\.project-card-link:focus-visible[\s\S]*box-shadow:/)
})

test('material center frames upload and project-only flows with direct CTAs', () => {
  assert.match(mediaLibrarySource, /<h1 class="page-title">素材中心<\/h1>/)
  assert.match(mediaLibrarySource, /项目首页/)
  assert.match(mediaLibrarySource, /上传后的图片和视频会在所有项目里复用/)
  assert.match(mediaLibrarySource, /网页 URL 导入/)
  assert.match(mediaLibrarySource, /角色 \/ 场景 \/ 道具入库/)
  assert.match(mediaLibrarySource, /素材中心还是空的/)
  assert.match(mediaLibrarySource, /没有匹配的素材/)
  assert.match(mediaLibrarySource, /@click="clearFilters">清除筛选/)
  assert.match(mediaLibrarySource, /<el-icon><Upload \/><\/el-icon>上传素材/)
  assert.match(mediaLibrarySource, /选择项目后导入网页 URL/)
  assert.match(mediaLibrarySource, /加入素材库/)
  assert.match(mediaLibrarySource, /uploadAPI\.uploadAsset\(file, \{ suppressErrorToast: true \}\)/)
  assert.doesNotMatch(mediaLibrarySource, /uploadAPI\.uploadImage\(file\)/)
})

test('theme keeps enabled primary styling while disabled buttons get global muted treatment', () => {
  assert.match(
    themeSource,
    /\.el-button--primary:not\(\.is-link\):not\(\.is-plain\):not\(\.is-disabled\):not\(:disabled\) \{/,
  )
  assert.match(themeSource, /--button-disabled-bg:/)
  assert.match(themeSource, /\.el-button\.is-disabled:not\(\.is-link\):not\(\.is-text\)/)
  assert.match(themeSource, /\.el-button--primary\.is-disabled:not\(\.is-link\):not\(\.is-plain\)/)
  assert.match(themeSource, /\.el-button--primary:disabled:not\(\.is-link\):not\(\.is-plain\)/)
  assert.match(themeSource, /background: #e4e1ea !important;/)
  assert.match(themeSource, /box-shadow: none !important;/)
})
