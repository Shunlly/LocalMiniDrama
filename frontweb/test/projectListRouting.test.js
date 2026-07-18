import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const routeUtilsUrl = new URL('../src/utils/projectListRoute.js', import.meta.url)
const filmCreateSourceForCanvas = read('../src/views/FilmCreate.vue')
const dramaDetailSourceForCanvas = read('../src/views/DramaDetail.vue')
const dramaCanvasSourceForReturn = read('../src/views/DramaCanvas.vue')

async function loadProjectListRouteUtils() {
  assert.ok(existsSync(routeUtilsUrl), 'project list route helpers must exist')
  return import(routeUtilsUrl.href)
}

test('project list filters normalize route query values and preserve unrelated query state', async () => {
  const {
    mergeProjectListFilters,
    normalizeProjectListFilters,
  } = await loadProjectListRouteUtils()

  assert.deepEqual(
    normalizeProjectListFilters({
      q: ['  moon base  ', 'ignored'],
      status: 'draft',
      sort: 'title-asc',
    }),
    { q: 'moon base', status: 'draft', sort: 'title-asc' },
  )
  assert.deepEqual(
    normalizeProjectListFilters({ q: '\n', status: 'unknown', sort: 'oldest' }),
    { q: '', status: 'all', sort: 'updated-desc' },
  )
  assert.deepEqual(
    normalizeProjectListFilters({ status: 'archived' }),
    { q: '', status: 'all', sort: 'updated-desc' },
  )

  assert.deepEqual(
    mergeProjectListFilters(
      { new: '1', q: 'old', status: 'unknown', sort: 'oldest', keep: 'yes' },
      { q: '  moon base  ', status: 'published', sort: 'created-desc' },
    ),
    {
      new: '1',
      keep: 'yes',
      q: 'moon base',
      status: 'published',
      sort: 'created-desc',
    },
  )
  assert.deepEqual(
    mergeProjectListFilters(
      { q: 'old', status: 'draft', sort: 'title-asc', keep: 'yes' },
      { q: '', status: 'all', sort: 'updated-desc' },
    ),
    { keep: 'yes' },
  )
})

test('project list returnTo keeps only safe first-party filter context', async () => {
  const { normalizeProjectListReturnTo } = await loadProjectListRouteUtils()

  assert.equal(normalizeProjectListReturnTo('/'), '/')
  assert.equal(
    normalizeProjectListReturnTo('/?q=moon%20base&status=draft&sort=title-asc&new=1#drop'),
    '/?q=moon+base&status=draft&sort=title-asc',
  )
  assert.equal(
    normalizeProjectListReturnTo(['/?status=published', 'https://evil.test/']),
    '/?status=published',
  )
  assert.equal(
    normalizeProjectListReturnTo('/?q=https%3A%2F%2Fevil.test%2Fstory'),
    '/?q=https%3A%2F%2Fevil.test%2Fstory',
  )
  assert.equal(normalizeProjectListReturnTo('/?status=all&sort=updated-desc'), '/')

  for (const value of [
    '',
    '/film/12?q=moon',
    '/drama/12',
    'https://evil.test/?q=moon',
    '//evil.test/?q=moon',
    'javascript:alert(1)',
    '/%2e%2e/film/12',
    '/%5c%5cevil.test/',
    '/\nevil',
    null,
    undefined,
  ]) {
    assert.equal(normalizeProjectListReturnTo(value), '', String(value))
  }
})

test('project detail resolves a valid current episode and falls back to the first episode', async () => {
  const { resolveProjectEpisodeId } = await loadProjectListRouteUtils()
  const episodes = [{ id: 21 }, { id: 22 }]

  assert.equal(resolveProjectEpisodeId(episodes, '22'), 22)
  assert.equal(resolveProjectEpisodeId(episodes, ['21', '22']), 21)
  assert.equal(resolveProjectEpisodeId(episodes, '999'), 21)
  assert.equal(resolveProjectEpisodeId([{ id: 31 }], undefined), 31)
  assert.equal(resolveProjectEpisodeId([], '22'), null)
})

test('project list and project workspaces wire safe return navigation through the route', () => {
  const filmListSource = read('../src/views/FilmList.vue')
  const filmCreateSource = read('../src/views/FilmCreate.vue')
  const dramaDetailSource = read('../src/views/DramaDetail.vue')
  const routerSource = read('../src/router/index.js')

  assert.match(filmListSource, /import \{[^}]*mergeProjectListFilters[^}]*normalizeProjectListFilters[^}]*normalizeProjectListReturnTo[^}]*\} from '@\/utils\/projectListRoute'/)
  assert.match(filmListSource, /watch\(\s*\(\) => route\.query/)
  assert.match(filmListSource, /router\.replace\(\{ path: route\.path, query: nextQuery, hash: route\.hash \}\)/)
  assert.match(filmListSource, /const projectListReturnTo = computed\(\(\) => normalizeProjectListReturnTo\(route\.fullPath\) \|\| '\/'\)/)
  assert.match(filmListSource, /name: 'film', params: \{ id: d\.id \}, query: \{ returnTo: projectListReturnTo \}/)
  assert.match(filmListSource, /path: `\/drama\/\$\{drama\.id\}`,[\s\S]{0,100}returnTo: projectListReturnTo\.value/)

  for (const source of [filmCreateSource, dramaDetailSource]) {
    assert.match(source, /normalizeProjectListReturnTo\(route\.query\.returnTo\)/)
    assert.match(source, /router\.push\(projectListReturnTo\.value \|\| \{ name: 'list' \}\)/)
  }
  assert.doesNotMatch(dramaDetailSource, /router\.push\('\/'\)/)
  assert.match(dramaDetailSource, /withProjectListReturnTo\(query\)/)

  assert.match(routerSource, /import \{ normalizeProjectListReturnTo \} from '@\/utils\/projectListRoute'/)
  assert.match(routerSource, /\['drama-detail', 'film'\]\.includes\(to\.name\)/)
  assert.match(routerSource, /delete query\.returnTo/)
})

test('entering canvas mode keeps the project-list return context', () => {
  assert.match(filmCreateSourceForCanvas, /function goCanvasMode\(\)[\s\S]*projectListReturnTo\.value[\s\S]*\/film\/\$\{dramaId\.value\}\/canvas/)
  assert.match(dramaDetailSourceForCanvas, /resolveProjectEpisodeId\(episodes\.value, route\.query\.episode\)/)
  assert.match(dramaDetailSourceForCanvas, /function goCanvasMode\(\)[\s\S]*episode: String\(canvasEpisodeId\.value\)[\s\S]*router\.push\(\{ path: `\/film\/\$\{dramaId\}\/canvas`/)
  assert.match(dramaCanvasSourceForReturn, /function goListMode\(\)[\s\S]*projectListReturnTo|normalizeProjectListReturnTo\(route\.query\.returnTo\)/)
})
