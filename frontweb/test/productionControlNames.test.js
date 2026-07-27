import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function readComponentDirectory(path) {
  const directory = new URL(path, import.meta.url)
  return readdirSync(directory)
    .filter((name) => name.endsWith('.vue'))
    .sort()
    .map((name) => ({
      name: `${path}${name}`,
      source: read(`${path}${name}`),
    }))
}

const targetSources = [
  { name: '../src/views/FilmCreate.vue', source: read('../src/views/FilmCreate.vue') },
  { name: '../src/views/DramaCanvas.vue', source: read('../src/views/DramaCanvas.vue') },
  ...readComponentDirectory('../src/components/filmCreate/'),
  ...readComponentDirectory('../src/components/dramaCanvas/'),
]

const filmCreateSource = targetSources.find(({ name }) => name.endsWith('/FilmCreate.vue')).source
const pipelineSource = targetSources.find(({ name }) => name.endsWith('/FilmCreatePipelinePanel.vue')).source
const storyboardPanelSource = targetSources.find(({ name }) => name.endsWith('/CanvasStoryboardPanel.vue')).source
const workflowToolbarSource = targetSources.find(({ name }) => name.endsWith('/CanvasWorkflowToolbarGroup.vue')).source

function templateOnly(source) {
  const start = source.indexOf('<template')
  const end = source.indexOf('<script', start)
  assert.ok(start >= 0 && end > start, 'Vue source must contain template and script blocks')
  return source
    .slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function openingTags(source, tagNames) {
  const template = templateOnly(source)
  const names = new Set(tagNames)
  const tags = []
  const matcher = /<([a-z][\w-]*)\b/g
  let match

  while ((match = matcher.exec(template))) {
    if (!names.has(match[1])) continue

    let quote = ''
    let index = matcher.lastIndex
    for (; index < template.length; index += 1) {
      const character = template[index]
      if (quote) {
        if (character === quote) quote = ''
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
    }

    const opening = template.slice(match.index, index + 1)
    tags.push({
      tag: match[1],
      opening,
      innerStart: index + 1,
      line: template.slice(0, match.index).split('\n').length,
      template,
    })
    matcher.lastIndex = index + 1
  }

  return tags
}

function namedOnControl(opening) {
  return /\s(?::|v-bind:)?aria-(?:label|labelledby)\s*=/.test(opening)
}

function buttonElements(source) {
  return openingTags(source, ['button', 'el-button']).map((button) => {
    const selfClosing = /\/\s*>$/.test(button.opening)
    const closing = `</${button.tag}>`
    const closeIndex = selfClosing ? button.innerStart : button.template.indexOf(closing, button.innerStart)
    assert.ok(closeIndex >= button.innerStart, `Missing ${closing} near template line ${button.line}`)
    return {
      ...button,
      inner: selfClosing ? '' : button.template.slice(button.innerStart, closeIndex),
    }
  })
}

function visibleButtonText(inner) {
  return inner
    .replace(/<el-icon\b[\s\S]*?<\/el-icon>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function controlBy(source, tagName, marker) {
  const control = openingTags(source, [tagName]).find(({ opening }) => opening.includes(marker))
  assert.ok(control, `Missing <${tagName}> containing ${marker}`)
  return control.opening
}

test('visible production selects and number inputs own an accessible name', () => {
  const unnamed = []

  for (const { name, source } of targetSources) {
    for (const control of openingTags(source, ['el-select', 'el-input-number'])) {
      if (!namedOnControl(control.opening)) {
        unnamed.push(`${name}:${control.line} ${control.opening.replace(/\s+/g, ' ')}`)
      }
    }
  }

  assert.deepEqual(unnamed, [], `Controls without names:\n${unnamed.join('\n')}`)
})

test('visible icon-only and plus buttons own an accessible name', () => {
  const unnamed = []

  for (const { name, source } of targetSources) {
    for (const button of buttonElements(source)) {
      const text = visibleButtonText(button.inner)
      const showsPlus = /<Plus\b/.test(button.inner) || /^[+＋]/.test(text)
      const symbolOnly = /^[+＋×✕✖−-]$/.test(text)
      if ((!text || showsPlus || symbolOnly) && !namedOnControl(button.opening)) {
        unnamed.push(`${name}:${button.line} ${button.opening.replace(/\s+/g, ' ')}`)
      }
    }
  }

  assert.deepEqual(unnamed, [], `Buttons without names:\n${unnamed.join('\n')}`)
})

test('production control names preserve generation and item context', () => {
  assert.match(controlBy(filmCreateSource, 'el-select', 'v-model="storyStyle"'), /aria-label="故事风格"/)
  assert.match(controlBy(filmCreateSource, 'el-select', 'v-model="storyType"'), /aria-label="故事生成剧本类型"/)
  assert.match(controlBy(filmCreateSource, 'el-input-number', 'v-model="storyEpisodeCount"'), /aria-label="故事生成集数"/)
  assert.match(controlBy(filmCreateSource, 'el-input-number', 'v-model="storyboardCount"'), /aria-label="分镜数量（生成设置）"/)
  assert.match(controlBy(filmCreateSource, 'el-input-number', 'v-model="novelMaxChapters"'), /aria-label="最多导入集数"/)
  assert.match(controlBy(workflowToolbarSource, 'el-button', "emit('create-workflow')"), /aria-label="创建分组（工作流）"/)

  for (const [marker, semantic] of [
    ['getSbCharacterIds(sb.id)', '角色'],
    ['v-model="sbSceneId[sb.id]"', '场景'],
    ['getSbPropIds(sb.id)', '道具'],
  ]) {
    const select = controlBy(filmCreateSource, 'el-select', marker)
    assert.match(select, /:aria-label="`分镜\$\{sb\.storyboard_number \|\| i \+ 1\}/)
    assert.match(select, new RegExp(`${semantic}\``))
  }

  assert.match(controlBy(pipelineSource, 'el-select', ':model-value="aspectRatio"'), /aria-label="生成设置：画面比例"/)
  assert.match(controlBy(pipelineSource, 'el-select', ':model-value="clipDuration"'), /aria-label="生成设置：单镜时长"/)
  assert.match(controlBy(pipelineSource, 'el-select', ':model-value="scriptLanguage"'), /aria-label="生成设置：分镜语言"/)

  for (const semantic of ['角色', '场景', '道具', '时长', '视频参考图']) {
    assert.match(storyboardPanelSource, new RegExp(`:aria-label="storyboardControlLabel\\('${semantic}'\\)"`))
  }
})

test('history image operations include a stable per-list index in every accessible name', () => {
  assert.equal(
    (filmCreateSource.match(/v-for="\(item, historyIndex\) in getStripItems\(sb\.id\)"/g) || []).length,
    2,
  )
  assert.match(filmCreateSource, /function historyImageLabel\(sb, storyboardIndex, item, historyIndex\)/)
  assert.ok(
    (filmCreateSource.match(/historyImageLabel\(sb, i, item, historyIndex\)/g) || []).length >= 6,
    'primary, preview, and delete actions in both history strips must use the indexed label',
  )
})
