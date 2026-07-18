import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const filmCreateSource = readFileSync(
  new URL('../src/views/FilmCreate.vue', import.meta.url),
  'utf8',
)
const stylePickerSource = readFileSync(
  new URL('../src/components/StylePickerButton.vue', import.meta.url),
  'utf8',
)

test('film create navigation and resource disclosure controls use native buttons', () => {
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-toggle"[\s\S]*?:aria-expanded="!navCollapsed"/)
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-step"[\s\S]*?@click="scrollToAnchor\(step\.anchor\)"/)
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-sub-toggle"[\s\S]*?:aria-expanded="storyboardMenuExpanded"/)
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-sub-item"[\s\S]*?@click="scrollToAnchor\('sb-' \+ sb\.id\)"/)

  const disclosureButtons = filmCreateSource.match(
    /<button\b[^>]*class="collapse-header(?: resource-block-header)?"[^>]*>/g,
  ) || []
  assert.equal(disclosureButtons.length, 4)
  for (const button of disclosureButtons) {
    assert.match(button, /:aria-expanded=/)
    assert.match(button, /aria-controls=/)
  }
})

test('film create keeps the episode selector only in the page header', () => {
  assert.equal((filmCreateSource.match(/v-model="selectedEpisodeId"/g) || []).length, 1)
  assert.equal((filmCreateSource.match(/class="header-episode-select"/g) || []).length, 1)
})

test('film create navigation names and reports the final delivery step accurately', () => {
  assert.match(
    filmCreateSource,
    /label: '交付与导出',\s+anchor: 'anchor-video',\s+status: compositeStatus/,
  )
  assert.match(filmCreateSource, /if \(isPlaceholderMediaUrl\(s\)\) return ''/)
  assert.match(filmCreateSource, /currentEpisodeVideoUrl\.value\s*\? 'done'/)
  assert.doesNotMatch(
    filmCreateSource,
    /label: '分镜视频',\s+anchor: 'anchor-video'/,
  )
})

test('delivery stage consolidates composite readiness and user-facing export actions', () => {
  assert.match(filmCreateSource, /<section id="anchor-video" class="section card delivery-section">/)
  assert.match(filmCreateSource, /<h2 class="section-title">交付与导出<\/h2>/)
  assert.match(filmCreateSource, /分镜视频[\s\S]*playableStoryboardVideoCount[\s\S]*整集合成[\s\S]*可交付文件/)
  assert.match(filmCreateSource, /@click="downloadCurrentEpisodeVideo"/)
  assert.match(filmCreateSource, /@click="downloadCurrentEpisodeSubtitle"/)
  assert.match(filmCreateSource, /@click="exportCurrentProjectPackage"/)
  assert.match(filmCreateSource, /const deliverySubtitleAvailable = computed\(\(\) => storyboards\.value\.some/)
  assert.match(filmCreateSource, /:disabled="!currentEpisodeId \|\| !deliverySubtitleAvailable"/)
  assert.match(filmCreateSource, /import \{ timelinesAPI \} from '@\/api\/timelines'/)
})

test('storyboard video controls expose a focusable missing-prompt reason', () => {
  assert.match(
    filmCreateSource,
    /<ActionGate :reason="sbVideoGenerationDisabledReason\(sb\)" label="生成分镜视频">/,
  )
  assert.match(filmCreateSource, /class="sb-video-disabled-reason"[\s\S]*?role="status"[\s\S]*?tabindex="0"/)
  assert.match(filmCreateSource, /function sbVideoGenerationDisabledReason\(sb\)[\s\S]*?请先填写视频提示词/)
})

test('script and character library empty states provide direct actions', () => {
  assert.match(filmCreateSource, /class="select-script-empty"[\s\S]*?@click="returnToScriptCreation"/)
  assert.match(filmCreateSource, /class="library-empty"[\s\S]*?@click="returnToCharacterPanel"/)
  assert.match(filmCreateSource, /function returnToScriptCreation\(\)/)
  assert.match(filmCreateSource, /function returnToCharacterPanel\(\)/)
})

test('every FilmCreate ActionGate identifies its button action', () => {
  const actionGates = filmCreateSource.match(/<ActionGate\b[^>]*>/g) || []
  assert.ok(actionGates.length >= 13)
  for (const gate of actionGates) {
    assert.match(gate, /(?:^|\s):?label=/)
  }
})

test('style picker toolbar and options are keyboard-operable buttons', () => {
  assert.match(stylePickerSource, /<button[\s\S]*?class="style-picker-trigger"[\s\S]*?aria-haspopup="dialog"/)
  assert.match(stylePickerSource, /<button[\s\S]*?class="spt-clear"[\s\S]*?aria-label="清除生成风格"/)
  assert.match(stylePickerSource, /<button[\s\S]*?class="spd-item"[\s\S]*?:aria-pressed=/)
  assert.doesNotMatch(stylePickerSource, /<div\b[^>]*class="(?:style-picker-trigger|spd-item)"/)
})
