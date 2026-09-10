import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readStoryboardFile(name) {
  return readFileSync(new URL(`../src/components/filmCreate/${name}`, import.meta.url), 'utf8')
}

const panelSource = [
  'FilmCreateStoryboardPanel.vue',
  'FilmCreateStoryboardPanel.css',
  'FilmCreateStoryboardScriptColumn.vue',
  'FilmCreateStoryboardScriptColumn.css',
].map(readStoryboardFile).join('\n')

function allTemplates(source) {
  const blocks = []
  let from = 0
  while (from < source.length) {
    const start = source.indexOf('<template', from)
    if (start < 0) break
    const scriptAt = source.indexOf('<script', start)
    assert.ok(scriptAt > start, '分镜面板必须包含 template 与 script')
    blocks.push(source.slice(start, scriptAt))
    from = scriptAt + 7
  }
  assert.ok(blocks.length > 0, '分镜面板必须包含 template 与 script')
  return blocks.join('\n')
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
  const template = allTemplates(panelSource)
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
  const template = allTemplates(panelSource)
  const propSelect = selectByPlaceholder(template, '选择道具')
  assert.match(propSelect, /v-for="p in \(propItems \|\| \[\]\)"/)
  assert.match(propSelect, /<template v-if="!\(propItems \|\| \[\]\)\.length" #empty>/)
  assert.doesNotMatch(propSelect, /v-if="!\(props \|\| \[\]\)\.length"/)
  assert.match(panelSource, /propItems:\s*\{\s*type:\s*Array/)
  assert.doesNotMatch(panelSource, /defineProps\(\{[\s\S]*?\bprops:\s*\{/)
})

test('分镜已选缩略图把道具称作道具，而不是物品', () => {
  const template = allTemplates(panelSource)
  assert.match(
    template,
    /getSbSelectedProps\(sb\.id\)\.length[\s\S]*?<span class="sb-thumb-label">道具<\/span>/,
  )
  assert.doesNotMatch(template, /<span class="sb-thumb-label">物品<\/span>/)
  assert.doesNotMatch(template, /添加物品/)
})

test('分镜空状态提供可点击的生成、添加和创建剧集入口', () => {
  const template = allTemplates(panelSource)
  assert.match(template, /class="empty-tip"/)
  assert.match(template, /还没有分镜，可生成分镜或添加一个分镜/)
  assert.match(template, /请先创建或选择剧集，再生成或添加分镜/)
  assert.match(template, /@click="onGenerateStoryboard"/)
  assert.match(template, /@click="onAddSingleStoryboard"/)
  assert.match(template, /@click="onAddEpisode"/)
  assert.match(template, />生成分镜<\/el-button>/)
  assert.match(template, />添加一个分镜<\/el-button>/)
  assert.match(template, />去创建剧集<\/el-button>/)
  assert.match(panelSource, /onAddEpisode:\s*\{\s*type:\s*Function/)
})


test('分镜行头提供可键盘操作的上移、下移和拖拽手柄', () => {
  const template = allTemplates(panelSource)
  assert.match(template, /class="sb-reorder-handle"/)
  assert.match(template, /reorderHandleReason\(\)/)
  assert.match(template, /@keydown\.up\.prevent\.stop="onMoveStoryboardUp\(sb, i\)"/)
  assert.match(template, /@keydown\.down\.prevent\.stop="onMoveStoryboardDown\(sb, i\)"/)
  assert.match(template, /:title="storyboardMoveCopies\[i\]\.up\.title"/)
  assert.match(template, /:aria-label="storyboardMoveCopies\[i\]\.up\.ariaLabel"/)
  assert.match(template, /:title="storyboardMoveCopies\[i\]\.down\.title"/)
  assert.match(template, /:aria-label="storyboardMoveCopies\[i\]\.down\.ariaLabel"/)
  assert.match(template, /class="sb-ctrl-reorder-wrap"/)
  assert.match(template, /@click="onMoveStoryboardUp\(sb, i\)"/)
  assert.match(template, /@click="onMoveStoryboardDown\(sb, i\)"/)
  assert.match(template, /@dragstart\.stop="onReorderDragStart\(\$event, i\)"/)
  assert.match(template, /@drop="onReorderDrop\(\$event, i\)"/)
  assert.match(template, /<Rank \/>/)
  assert.match(template, /<ArrowUp \/>/)
  assert.match(template, /<ArrowDown \/>/)
})

test('空分镜列表下一步是可点击按钮，而不是一句空文案', () => {
  const template = allTemplates(panelSource)
  const emptyStart = template.indexOf('class="empty-tip"')
  assert.ok(emptyStart >= 0)
  const emptyBlock = template.slice(emptyStart, emptyStart + 1800)
  assert.match(emptyBlock, /还没有分镜，可生成分镜或添加一个分镜/)
  assert.match(emptyBlock, /@click="onGenerateStoryboard"/)
  assert.match(emptyBlock, /@click="onAddSingleStoryboard"/)
  assert.match(emptyBlock, /@click="onAddEpisode"/)
  assert.match(emptyBlock, />生成分镜<\/el-button>/)
  assert.match(emptyBlock, />添加一个分镜<\/el-button>/)
  assert.match(emptyBlock, />去创建剧集<\/el-button>/)
  assert.match(emptyBlock, /:disabled="Boolean\(storyboardActionDisabledReason\)"/)
  assert.match(emptyBlock, /:disabled="Boolean\(episodeActionDisabledReason\)"/)
  assert.doesNotMatch(emptyBlock, /disabled="true"/)
})

test('分镜脚本列占位是中文 UI，提示词内容仍绑定数据', () => {
  const script = readStoryboardFile('FilmCreateStoryboardScriptColumn.vue')
  const template = allTemplates(script)
  assert.match(template, /placeholder="选择角色"/)
  assert.match(template, /placeholder="选择场景"/)
  assert.match(template, /placeholder="选择道具"/)
  assert.match(template, /placeholder="本镜解说文案（画外音 \/ 纪录片式旁白，可生成配音或导出字幕）"/)
  assert.match(template, /sb\.image_prompt \|\| '暂无图片提示词'/)
  assert.doesNotMatch(template, /consistent character design/i)
  assert.doesNotMatch(template, /placeholder="[^"\n]*consistent[^"\n]*"/i)
  assert.doesNotMatch(script, /sb\.image_prompt\s*=/)
})
