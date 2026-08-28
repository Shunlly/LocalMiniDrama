import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url),
  'utf8',
)

function templateOnly(source) {
  const start = source.indexOf('<template')
  const end = source.indexOf('<script', start)
  assert.ok(start >= 0 && end > start, '分镜面板必须包含 template 与 script')
  return source.slice(start, end)
}

function selectByPlaceholder(source, placeholder) {
  const marker = `placeholder="${placeholder}"`
  const markerIndex = source.indexOf(marker)
  assert.ok(markerIndex >= 0, `缺少 placeholder="${placeholder}" 的选择器`)
  const start = source.lastIndexOf('<el-select', markerIndex)
  const end = source.indexOf('</el-select>', markerIndex)
  assert.ok(start >= 0 && end > start, `无法截取 placeholder="${placeholder}" 的 el-select`)
  return source.slice(start, end + '</el-select>'.length)
}

function emptySlot(selectSource) {
  const match = selectSource.match(/<template\b[^>]*#empty[^>]*>[\s\S]*?<\/template>/)
  assert.ok(match, '选择器缺少 #empty 空槽')
  return match[0]
}

test('分镜角色/场景/道具选择器空态指向真实面板名称', () => {
  const template = templateOnly(panelSource)
  const expected = [
    ['选择角色', '角色', 'characters', '请先在「角色」面板添加角色'],
    ['选择场景', '场景', 'scenes', '请先在「场景」面板添加场景'],
    ['选择道具', '道具', 'propItems', '请先在「道具」面板添加道具'],
  ]

  for (const [placeholder, semantic, listName, emptyCopy] of expected) {
    const select = selectByPlaceholder(template, placeholder)
    assert.match(select, new RegExp(`:aria-label="\`分镜\\$\\{sb\\.storyboard_number \\|\\| i \\+ 1\\}${semantic}\`"`))
    assert.match(select, new RegExp(`placeholder="${placeholder}"`))
    const empty = emptySlot(select)
    assert.match(empty, new RegExp(`v-if="!\\(${listName} \\|\\| \\[\\]\\)\\.length"`))
    assert.match(empty, new RegExp(`class="sb-select-empty">${emptyCopy}<`))
  }

  assert.doesNotMatch(template, /请先在「角色生成」中添加角色/)
  assert.doesNotMatch(template, /请先在「道具生成」中添加物品/)
  assert.doesNotMatch(template, /请先在「场景生成」/)
})

test('道具空槽读取 propItems，不会误用组件 props 对象', () => {
  const template = templateOnly(panelSource)
  const propSelect = selectByPlaceholder(template, '选择道具')
  assert.match(propSelect, /v-for="p in \(propItems \|\| \[\]\)"/)
  assert.match(propSelect, /<template v-if="!\(propItems \|\| \[\]\)\.length" #empty>/)
  assert.doesNotMatch(propSelect, /v-if="!\(props \|\| \[\]\)\.length"/)
  assert.match(panelSource, /propItems:\s*\{\s*type:\s*Array/)
  assert.doesNotMatch(panelSource, /defineProps\(\{[\s\S]*?\bprops:\s*\{/)
})

test('分镜已选缩略图把道具称作道具，而不是物品', () => {
  const template = templateOnly(panelSource)
  assert.match(
    template,
    /getSbSelectedProps\(sb\.id\)\.length[\s\S]*?<span class="sb-thumb-label">道具<\/span>/,
  )
  assert.doesNotMatch(template, /<span class="sb-thumb-label">物品<\/span>/)
  assert.doesNotMatch(template, /添加物品/)
})
