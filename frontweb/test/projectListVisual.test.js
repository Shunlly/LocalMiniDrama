import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  filterProjectList,
  getProjectCover,
} from '../src/utils/projectList.js'

const filmListSource = readFileSync(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')

test('project cover prefers the first usable storyboard image', () => {
  const project = {
    episodes: [{ storyboards: [
      { image_url: 'placeholder://pending' },
      { local_path: 'uploads/storyboard-02.webp' },
    ] }],
    characters: [{ local_path: 'uploads/character.webp' }],
  }

  assert.deepEqual(getProjectCover(project), {
    url: '/static/uploads/storyboard-02.webp',
    source: 'storyboard',
  })
})

test('project cover falls back to a project asset and ignores placeholder media', () => {
  const project = {
    episodes: [{ storyboards: [{ image_url: 'mock://storyboard' }] }],
    characters: [{ image_url: 'placeholder://character' }],
    scenes: [{ image_url: 'https://cdn.example.test/scene.webp' }],
  }

  assert.deepEqual(getProjectCover(project), {
    url: 'https://cdn.example.test/scene.webp',
    source: 'asset',
  })
  assert.equal(getProjectCover({ episodes: [], characters: [] }), null)
})

test('project cover consumes the lightweight list fallback after storyboard media', () => {
  const project = {
    episodes: [{ storyboards: [{ image_url: 'placeholder://pending' }] }],
    fallback_cover_local_path: 'dramas/8/scenes/2.webp',
    fallback_cover_source: 'scene',
  }

  assert.deepEqual(getProjectCover(project), {
    url: '/static/dramas/8/scenes/2.webp',
    source: 'scene',
  })
})

test('project list filtering applies status and keyword before deterministic sorting', () => {
  const projects = [
    { id: 1, title: 'Beta', status: 'draft', updated_at: '2026-07-01T00:00:00Z' },
    { id: 2, title: 'Alpha', status: 'published', updated_at: '2026-07-03T00:00:00Z' },
    { id: 3, title: 'Alpha 2', status: 'draft', updated_at: '2026-07-02T00:00:00Z' },
  ]

  assert.deepEqual(
    filterProjectList(projects, { keyword: 'alpha', status: 'draft', sort: 'updated-desc' }).map((item) => item.id),
    [3],
  )
  assert.deepEqual(
    filterProjectList(projects, { status: 'all', sort: 'title-asc' }).map((item) => item.id),
    [2, 3, 1],
  )
  assert.deepEqual(
    filterProjectList(projects, { status: 'all', sort: 'server' }).map((item) => item.id),
    [1, 2, 3],
  )
})

test('project cards expose a visual cover, status filter, and explicit continue action', () => {
  assert.match(filmListSource, /class="project-card-cover"/)
  assert.match(filmListSource, /v-model="projectStatusFilter"/)
  assert.doesNotMatch(filmListSource, /value="archived"/)
  assert.match(filmListSource, /清除筛选/)
  assert.match(filmListSource, /继续制作/)
  assert.match(filmListSource, /class="project-card-assets"[\s\S]*素材/)
})

test('continue action enters the production workspace while edit remains a management action', () => {
  assert.match(
    filmListSource,
    /class="project-card-link"[\s\S]*:to="\{ name: 'film', params: \{ id: d\.id \}, query: \{ returnTo: projectListReturnTo \} \}"/,
  )
  assert.match(filmListSource, /if \(action === 'edit'\) return openEditDialog\(drama\)/)
  assert.match(
    filmListSource,
    /class="project-card-assets"[\s\S]*name: 'drama-detail'[\s\S]*returnTo: projectListReturnTo[\s\S]*hash: '#source-intake-workflow'/,
  )
})

test('project list uses server-backed pagination instead of truncating the first 50 projects', () => {
  assert.match(filmListSource, /const projectPage = ref\(1\)/)
  assert.match(filmListSource, /const projectPageSize = ref\(24\)/)
  assert.match(filmListSource, /<el-pagination[\s\S]*:total="total"[\s\S]*@current-change="loadProjectPage"/)
  assert.match(
    filmListSource,
    /dramaAPI\.list\(\{[\s\S]*page: requestedPage,[\s\S]*page_size: requestedPageSize,[\s\S]*keyword: normalizedProjectSearch\.value \|\| undefined,[\s\S]*status:[\s\S]*sort: projectSort\.value/,
  )
  assert.doesNotMatch(filmListSource, /dramaAPI\.list\(\{ page: 1, page_size: 50 \}\)/)
})

test('debounced project filters invalidate an in-flight list request immediately', () => {
  assert.match(
    filmListSource,
    /function scheduleProjectListReload\(\)\s*\{[\s\S]{0,120}listRequestSequence \+= 1[\s\S]{0,220}setTimeout/,
  )
})
