import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const filmListSource = read('../src/views/FilmList.vue')
const dramaApiSource = read('../src/api/drama.js')

test('project API exposes a recoverable trash contract', () => {
  assert.match(dramaApiSource, /moveToTrash\(id\)[\s\S]*request\.delete\(`\/dramas\/\$\{id\}`\)/)
  assert.match(dramaApiSource, /listTrash\(params\)[\s\S]*request\.get\('\/dramas\/trash'/)
  assert.match(dramaApiSource, /restore\(id\)[\s\S]*request\.post\(`\/dramas\/\$\{id\}\/restore`\)/)
})

test('project removal copy consistently describes a recoverable operation', () => {
  assert.match(filmListSource, /<el-dropdown-item command="trash"[\s\S]*移入回收站/)
  assert.match(filmListSource, /项目内容和关联素材会完整保留，可随时恢复/)
  assert.match(filmListSource, /confirmButtonText: '移入回收站'/)
  assert.match(filmListSource, /dramaAPI\.moveToTrash\(d\.id\)/)
  assert.doesNotMatch(filmListSource, /此操作不可恢复/)
  assert.doesNotMatch(filmListSource, /dramaAPI\.delete\(d\.id\)/)
})

test('trash is discoverable and restoration is keyboard and screen-reader operable', () => {
  assert.match(filmListSource, /class="header-actions"[\s\S]*class="btn-trash[^"]*"[\s\S]*aria-label="打开项目回收站"/)
  assert.match(filmListSource, /title="项目回收站"/)
  assert.match(filmListSource, /role="note"[\s\S]*项目内容、剧集、分镜和关联素材会完整保留/)
  assert.match(filmListSource, /class="trash-list" aria-label="已移除项目"/)
  assert.match(filmListSource, /:aria-label="`恢复项目「\$\{item\.title \|\| '未命名项目'\}」`"/)
  assert.match(filmListSource, /@click="restoreFromTrash\(item\)"/)
  assert.match(filmListSource, /role="status" aria-live="polite"/)
  assert.match(filmListSource, /role="alert"/)
})
