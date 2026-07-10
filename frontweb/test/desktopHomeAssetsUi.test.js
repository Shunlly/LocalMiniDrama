import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { formatMediaSize, hasActiveMediaFilters, normalizeMediaItem } from '../src/utils/mediaLibrary.js'

const filmListSource = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')
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
})

test('desktop home exposes one material center entry and keeps semantic libraries grouped', () => {
  assert.match(filmListSource, /router\.push\('\/media-library'\)/)
  assert.match(filmListSource, /素材中心/)
  assert.match(filmListSource, />分类素材/)
  assert.match(filmListSource, /command="character"[\s\S]*角色素材库/)
  assert.match(filmListSource, /command="scene"[\s\S]*场景素材库/)
  assert.match(filmListSource, /command="prop"[\s\S]*道具素材库/)
  assert.match(routerSource, /path: '\/media-library'[\s\S]*meta: \{ title: '素材中心' \}/)
})

test('project cards use a stable action menu and the no-project state has direct actions', () => {
  assert.match(filmListSource, /class="project-card-header"/)
  assert.match(filmListSource, /class="project-menu-button"/)
  assert.match(filmListSource, /command="export"/)
  assert.match(filmListSource, /command="edit"/)
  assert.match(filmListSource, /command="delete"/)
  assert.doesNotMatch(filmListSource, /class="project-card-actions"/)
  assert.match(filmListSource, /还没有短剧项目/)
  assert.match(filmListSource, /新建项目/)
  assert.match(filmListSource, /导入项目包/)
  assert.match(filmListSource, /前往素材中心/)
  assert.match(filmListSource, /route\.query\.new/)
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
  assert.match(mediaLibrarySource, /新建项目后导入网页 URL/)
  assert.match(mediaLibrarySource, /加入素材库/)
  assert.match(mediaLibrarySource, /uploadAPI\.uploadAsset\(file\)/)
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
