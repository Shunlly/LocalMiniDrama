import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const canvasSource = read('../src/views/DramaCanvas.vue')
const toolbarSource = read('../src/components/dramaCanvas/CanvasDesktopToolbar.vue')
const adapterSource = read('../src/utils/dramaCanvasAdapter.js')

const componentSources = {
  project: read('../src/components/dramaCanvas/CanvasDramaHeaderNode.vue'),
  episode: read('../src/components/dramaCanvas/CanvasEpisodeNode.vue'),
  add: read('../src/components/dramaCanvas/CanvasAddButtonNode.vue'),
  asset: read('../src/components/dramaCanvas/CanvasAssetNode.vue'),
  script: read('../src/components/dramaCanvas/CanvasScriptNode.vue'),
  storyboard: read('../src/components/dramaCanvas/CanvasStoryboardNode.vue'),
  media: read('../src/components/dramaCanvas/CanvasMediaNode.vue'),
  assetPanel: read('../src/components/dramaCanvas/CanvasAssetPanel.vue'),
  scriptPanel: read('../src/components/dramaCanvas/CanvasScriptPanel.vue'),
  storyboardPanel: read('../src/components/dramaCanvas/CanvasStoryboardPanel.vue'),
  mediaPanel: read('../src/components/dramaCanvas/CanvasMediaPanel.vue'),
}

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

async function loadDramaCanvasAdapter() {
  let executableSource = adapterSource
  for (const dependency of ['canvasLayout', 'canvasWorkflow', 'mediaUrl', 'storyboardMedia']) {
    const resolved = new URL(`../src/utils/${dependency}.js`, import.meta.url).href
    executableSource = executableSource
      .replaceAll(`from './${dependency}'`, `from '${resolved}'`)
      .replaceAll(`from "./${dependency}"`, `from "${resolved}"`)
  }
  return import(dataModule(executableSource))
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1]
  assert.ok(block, `missing CSS selector ${selector}`)
  return block
}

function cssPixelValue(source, selector, property) {
  const block = cssBlock(source, selector)
  const value = block.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*(\\d+)px(?:;|\\s)`))?.[1]
  assert.ok(value, `missing ${property} for ${selector}`)
  return Number(value)
}

function canvasFixture() {
  const storyboard = (id, episodeId) => ({
    id,
    episode_id: episodeId,
    action: `Action ${id}`,
    dialogue: `Dialogue ${id}`,
    characters: [1],
    scene_id: 2,
    prop_ids: [3],
  })
  return {
    id: 7,
    title: 'Geometry fixture',
    metadata: {},
    characters: [{ id: 1, name: 'Lead' }],
    scenes: [{ id: 2, name: 'Studio' }],
    props: [{ id: 3, name: 'Key' }],
    episodes: [
      {
        id: 11,
        episode_number: 1,
        title: 'Episode one',
        script_content: 'First script',
        storyboards: [storyboard(101, 11), storyboard(102, 11)],
      },
      {
        id: 12,
        episode_number: 2,
        title: 'Episode two',
        script_content: 'Second script',
        storyboards: [storyboard(201, 12), storyboard(202, 12), storyboard(203, 12)],
      },
      {
        id: 13,
        episode_number: 3,
        title: 'Episode three',
        script_content: 'Third script',
        storyboards: [],
      },
    ],
  }
}

function rgb(hex) {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
}

function luminance(hex) {
  const channels = rgb(hex).map((value) => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function lightThemeValue(name) {
  const lightBlock = canvasSource.match(/html\.light \.drama-canvas-page \{([\s\S]*?)\n\}/)?.[1] || ''
  const value = lightBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
  assert.ok(value, `missing light canvas token ${name}`)
  return value
}

test('light canvas semantic text colors meet WCAG AA against their node surfaces', () => {
  const pairs = [
    ['--canvas-project-title', '#eef2ff'],
    ['--canvas-episode-text', '#f5f3ff'],
    ['--canvas-text-primary', '#ffffff'],
    ['--canvas-text-secondary', '#ffffff'],
    ['--canvas-text-muted', '#ffffff'],
    ['--canvas-text-subtle', '#ffffff'],
    ['--canvas-indigo-text', '#eef2ff'],
    ['--canvas-violet-text', '#faf5ff'],
    ['--canvas-amber-text', '#fffbeb'],
    ['--canvas-emerald-text', '#f0fdf4'],
    ['--canvas-blue-text', '#eff6ff'],
    ['--canvas-pink-text', '#fdf2f8'],
    ['--canvas-danger-text', '#ffffff'],
  ]

  for (const [token, surface] of pairs) {
    const ratio = contrast(lightThemeValue(token), surface)
    assert.ok(ratio >= 4.5, `${token} contrast ${ratio.toFixed(2)} is below 4.5:1`)
  }
})

test('every canvas node family uses theme-aware surfaces and readable text tokens', () => {
  assert.match(componentSources.project, /--canvas-project-surface/)
  assert.match(componentSources.project, /--canvas-project-title/)
  assert.match(componentSources.episode, /--canvas-episode-surface/)
  assert.match(componentSources.episode, /--canvas-episode-text/)

  for (const token of [
    '--canvas-add-character-surface',
    '--canvas-add-scene-surface',
    '--canvas-add-prop-surface',
    '--canvas-add-storyboard-surface',
  ]) {
    assert.match(componentSources.add, new RegExp(token))
  }

  assert.match(componentSources.asset, /--canvas-card-surface/)
  assert.match(componentSources.asset, /--canvas-media-well/)
  assert.match(componentSources.script, /--canvas-script-surface/)
  assert.match(componentSources.script, /--canvas-text-primary/)
  assert.match(componentSources.storyboard, /--canvas-card-surface/)
  assert.match(componentSources.storyboard, /--canvas-chip-surface-soft/)

  for (const token of [
    '--canvas-media-text-surface',
    '--canvas-media-universal-surface',
    '--canvas-media-image-surface',
    '--canvas-media-video-surface',
    '--canvas-media-audio-surface',
  ]) {
    assert.match(componentSources.media, new RegExp(token))
  }
})

test('expanded canvas panels use the theme surface instead of a fixed dark background', () => {
  for (const name of ['assetPanel', 'scriptPanel', 'storyboardPanel', 'mediaPanel']) {
    assert.match(componentSources[name], /background: var\(--canvas-panel-surface/)
    assert.match(componentSources[name], /box-shadow: var\(--canvas-raised-shadow/)
  }
})

test('desktop canvas toolbar exposes focus rings and width containment', () => {
  assert.match(toolbarSource, /\.canvas-desktop-toolbar \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/)
  assert.match(toolbarSource, /\.toolbar-main-row > \* \{[\s\S]*?max-width: 100%;/)
  assert.match(toolbarSource, /:deep\(\.el-button:focus-visible\)/)
  assert.match(toolbarSource, /:deep\(\.el-checkbox__input\.is-focus \.el-checkbox__inner\)/)
  assert.match(toolbarSource, /--canvas-focus-ring/)
  assert.match(canvasSource, /html\.light \.drama-canvas-page \.vue-flow__controls button/)
  assert.match(canvasSource, /html\.light \.drama-canvas-page \.vue-flow__minimap/)
})

test('executed auto-layout preserves CSS-derived asset, script, and episode column gutters', async () => {
  const { computeAutoLayoutPositions } = await loadDramaCanvasAdapter()
  const { positions } = computeAutoLayoutPositions(canvasFixture())
  const addWidth = cssPixelValue(componentSources.add, '.canvas-add-node', 'width')
  const assetWidth = cssPixelValue(componentSources.asset, '.canvas-asset-node', 'width')
  const scriptWidth = cssPixelValue(componentSources.script, '.canvas-script-node', 'width')
  const assetColumnWidth = Math.max(addWidth, assetWidth)
  const assetNodeIds = ['char:1', 'scene:2', 'prop:3', 'add:character', 'add:scene', 'add:prop']

  for (const episodeId of [11, 12, 13]) {
    const scriptPosition = positions[`script:${episodeId}`]
    const episodePosition = positions[`episode:${episodeId}`]
    assert.ok(scriptPosition, `missing script node for episode ${episodeId}`)
    assert.ok(episodePosition, `missing episode node for episode ${episodeId}`)

    for (const assetNodeId of assetNodeIds) {
      const gap = scriptPosition.x - (positions[assetNodeId].x + assetColumnWidth)
      assert.ok(gap >= 24, `${assetNodeId} to script:${episodeId} gap is ${gap}px`)
    }

    const episodeGap = episodePosition.x - (scriptPosition.x + scriptWidth)
    assert.ok(episodeGap >= 24, `script:${episodeId} to episode:${episodeId} gap is ${episodeGap}px`)
  }
})

test('executed multi-episode auto-layout keeps episode bands from overlapping', async () => {
  const { buildDramaCanvasGraph } = await loadDramaCanvasAdapter()
  const graph = buildDramaCanvasGraph(canvasFixture(), {
    savedLayout: { version: 1, nodes: {} },
  })
  const positions = Object.fromEntries(graph.nodes.map((node) => [node.id, node.position]))
  const addBlock = cssBlock(componentSources.add, '.canvas-add-node')
  const addIconHeight = cssPixelValue(componentSources.add, '.add-icon', 'height')
  const verticalPadding = Number(addBlock.match(/padding:\s*(\d+)px/)?.[1])
  const borderWidth = Number(addBlock.match(/border:\s*(\d+)px/)?.[1])
  assert.ok(Number.isFinite(verticalPadding), 'missing add-node vertical padding')
  assert.ok(Number.isFinite(borderWidth), 'missing add-node border width')
  const addNodeHeight = addIconHeight + (2 * verticalPadding) + (2 * borderWidth)

  for (const [currentId, nextId] of [[11, 12], [12, 13]]) {
    const currentBandEnd = positions[`add:storyboard:${currentId}`].y + addNodeHeight
    const nextBandStart = Math.min(
      positions[`script:${nextId}`].y,
      positions[`episode:${nextId}`].y,
    )
    const gap = nextBandStart - currentBandEnd
    assert.ok(gap >= 24, `episode ${currentId} to ${nextId} vertical gap is ${gap}px`)
  }

  const primaryNodePositions = graph.nodes
    .filter((node) => /^(script|episode|sb|add:storyboard):/.test(node.id))
    .map((node) => `${node.position.x},${node.position.y}`)
  assert.equal(
    new Set(primaryNodePositions).size,
    primaryNodePositions.length,
    'primary nodes must not share the same layout origin',
  )
})
