import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'

const panelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateVideoSettingsPanel.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')

const describeVideoSettingsPanel = new Function(
  `'use strict'; ${remainingExtractNamedFunction(panelSource, 'describeVideoSettingsPanel')}; return describeVideoSettingsPanel;`,
)()

const DRAMA_ID = 'drama-11'
const EPISODE_ID = 'episode-22'
assert.notEqual(DRAMA_ID, EPISODE_ID)

test('视频设置面板可以独立编译', () => {
  const parsed = parse(panelSource, { filename: 'FilmCreateVideoSettingsPanel.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, {
    id: 'film-create-video-settings',
    inlineTemplate: true,
  }))
})

test('视频设置面板保留成片控件语义和无障碍标签', () => {
  assert.match(panelSource, /<el-form class="config-grid" label-position="top" @submit.prevent>/)
  assert.match(panelSource, /aria-label="成片分辨率"/)
  assert.match(panelSource, /aria-label="成片字幕"/)
  assert.match(panelSource, /aria-label="对白烧录"/)
  assert.match(panelSource, /aria-label="成片水印"/)
  assert.match(panelSource, /aria-label="水印文字"/)
  assert.match(panelSource, /label="字幕"/)
  assert.match(panelSource, /label="对白烧录"/)
  assert.match(panelSource, /label="水印"/)
  assert.match(panelSource, /placeholder="请选择成片分辨率"/)
  assert.match(panelSource, /placeholder="右下角水印文字"/)
  assert.match(panelSource, /active-text="开"/)
  assert.match(panelSource, /inactive-text="关"/)
  assert.match(panelSource, /<button type="button" class="ai-config-text-button" @click="emit\('open-ai-config'\)">AI 配置<\/button>/)
  assert.match(panelSource, /分辨率也会用于新生成的分镜视频；字幕、对白烧录和水印只影响合成整集。/)
  assert.match(panelSource, /分辨率会用于新生成的分镜视频。字幕、对白烧录和水印只在合成整集时生效，不会改已经生成的分镜视频。/)
  assert.match(panelSource, /id="video-settings-lock-reason"/)
  assert.match(panelSource, /:aria-describedby="subtitleDescribedBy"/)
  assert.match(panelSource, /:aria-describedby="burnDialogueDescribedBy"/)
})

test('关闭态说明始终可见，不再只在打开开关后才出现', () => {
  assert.doesNotMatch(panelSource, /v-if="subtitle"/)
  assert.doesNotMatch(panelSource, /v-if="burnDialogue"/)
  assert.match(panelSource, /panelState\.subtitleHint/)
  assert.match(panelSource, /panelState\.burnDialogueHint/)
  assert.match(panelSource, /panelState\.watermarkHint/)
  assert.match(panelSource, /id="video-subtitle-hint"/)
  assert.match(panelSource, /id="video-burn-dialogue-hint"/)
  assert.match(panelSource, /role="alert"/)
  assert.match(panelSource, /data-testid="video-settings-lock-reason"/)
  assert.match(panelSource, /:disabled="panelState\.settingsLocked"/)
})

test('空分辨率和不受支持分辨率给出中文原因', () => {
  const empty = describeVideoSettingsPanel({ resolution: '' })
  const blank = describeVideoSettingsPanel({ resolution: '   ' })
  const unsupported = describeVideoSettingsPanel({ resolution: '4k' })
  const hd = describeVideoSettingsPanel({ resolution: '720p' })
  const fullHd = describeVideoSettingsPanel({ resolution: '1080p' })

  assert.equal(empty.resolutionWarning, '还没有选择成片分辨率。')
  assert.equal(blank.resolutionWarning, '还没有选择成片分辨率。')
  assert.equal(unsupported.resolutionWarning, '当前分辨率不受支持，合成前请改成 480p、720p 或 1080p。')
  assert.equal(unsupported.unrecognizedResolution, true)
  assert.equal(unsupported.resolutionOptionLabel, '4k（不受支持）')
  assert.equal(hd.resolutionWarning, '')
  assert.equal(fullHd.resolutionWarning, '')
  assert.equal(hd.unrecognizedResolution, false)
  assert.notEqual(hd.resolutionWarning, unsupported.resolutionWarning)
})

test('字幕和对白烧录用中文说清实际效果', () => {
  const off = describeVideoSettingsPanel({ subtitle: false, burnDialogue: false })
  const on = describeVideoSettingsPanel({ subtitle: true, burnDialogue: true })

  assert.match(off.subtitleHint, /关闭时/)
  assert.match(off.subtitleHint, /解说旁白字幕/)
  assert.match(off.burnDialogueHint, /对白配音不会混入整集成片/)
  assert.match(off.burnDialogueHint, /不是把对白字烧到画面上/)
  assert.match(on.subtitleHint, /生成字幕文件/)
  assert.match(on.subtitleHint, /旁白语音/)
  assert.match(on.burnDialogueHint, /对白配音/)
  assert.match(on.burnDialogueHint, /叠混/)
  assert.doesNotMatch(off.subtitleHint, /\bSRT\b|\bTTS\b/)
  assert.doesNotMatch(on.subtitleHint, /\bSRT\b|\bTTS\b/)
  assert.notEqual(off.subtitleHint, on.subtitleHint)
  assert.notEqual(off.burnDialogueHint, on.burnDialogueHint)
})

test('水印空文字会警告，不会假装已经生效', () => {
  const off = describeVideoSettingsPanel({ watermark: false, watermarkText: '' })
  const empty = describeVideoSettingsPanel({ watermark: true, watermarkText: '   ' })
  const filled = describeVideoSettingsPanel({ watermark: true, watermarkText: '本地短剧' })

  assert.equal(off.watermarkWarning, '')
  assert.match(off.watermarkHint, /不会叠加文字水印/)
  assert.equal(empty.watermarkWarning, '已开启水印，但还没填写文字。合成时不会叠加水印。')
  assert.equal(empty.watermarkHint, '')
  assert.equal(filled.watermarkWarning, '')
  assert.match(filled.watermarkHint, /右下角/)
  assert.notEqual(empty.watermarkWarning, filled.watermarkWarning)
})

test('禁用原因优先用传入中文，空原因才回退默认文案', () => {
  const enabled = describeVideoSettingsPanel({ disabled: false, disabledReason: '' })
  const locked = describeVideoSettingsPanel({ disabled: true, disabledReason: '' })
  const explained = describeVideoSettingsPanel({
    disabled: false,
    disabledReason: '正在合成成片，当前不能改成片选项。',
  })
  const both = describeVideoSettingsPanel({
    disabled: true,
    disabledReason: `项目 ${DRAMA_ID} 正在导出，不能改成片选项。`,
  })
  const otherProject = describeVideoSettingsPanel({
    disabled: true,
    disabledReason: `项目 ${EPISODE_ID} 正在导出，不能改成片选项。`,
  })

  assert.equal(enabled.settingsLocked, false)
  assert.equal(enabled.settingsLockedReason, '')
  assert.equal(locked.settingsLocked, true)
  assert.equal(locked.settingsLockedReason, '当前不能修改视频配置。')
  assert.equal(explained.settingsLockedReason, '正在合成成片，当前不能改成片选项。')
  assert.equal(both.settingsLockedReason, `项目 ${DRAMA_ID} 正在导出，不能改成片选项。`)
  assert.notEqual(both.settingsLockedReason, otherProject.settingsLockedReason)
  assert.match(both.settingsLockedReason, new RegExp(DRAMA_ID))
  assert.doesNotMatch(both.settingsLockedReason, new RegExp(EPISODE_ID))

  const english = describeVideoSettingsPanel({
    disabled: false,
    disabledReason: 'Network Error',
  })
  const mixed = describeVideoSettingsPanel({
    disabled: true,
    disabledReason: `HTTP Error for ${DRAMA_ID}`,
  })
  assert.equal(english.settingsLocked, true)
  assert.equal(english.settingsLockedReason, '当前不能修改视频配置。')
  assert.equal(mixed.settingsLockedReason, '当前不能修改视频配置。')
  assert.doesNotMatch(mixed.settingsLockedReason, /HTTP Error/i)
  assert.doesNotMatch(mixed.settingsLockedReason, new RegExp(DRAMA_ID))
})

test('面板用户可见文案保持简体中文', () => {
  assert.doesNotMatch(panelSource, /\bSRT\b/)
  assert.doesNotMatch(panelSource, /\bTTS\b/)
  assert.doesNotMatch(panelSource, /\bPlease\b|\bFailed\b|\bThe\s/)
  assert.match(panelSource, /当前不能修改视频配置。/)
  assert.match(panelSource, /已开启水印，但还没填写文字。合成时不会叠加水印。/)
  assert.match(panelSource, /此项是混音，不是把对白字烧到画面上。/)
})

test('合成禁用原因会锁住分辨率字幕和水印', () => {
  const composing = describeVideoSettingsPanel({
    disabled: true,
    disabledReason: '正在合成视频，请等待当前任务完成',
  })
  const missingVideos = describeVideoSettingsPanel({
    disabled: true,
    disabledReason: '请先为全部分镜生成可播放视频（已完成 1/3）',
  })
  const idle = describeVideoSettingsPanel({
    disabled: false,
    disabledReason: '',
    resolution: '720p',
  })

  assert.equal(composing.settingsLocked, true)
  assert.equal(composing.settingsLockedReason, '正在合成视频，请等待当前任务完成')
  assert.equal(missingVideos.settingsLocked, true)
  assert.match(missingVideos.settingsLockedReason, /可播放视频/)
  assert.equal(idle.settingsLocked, false)
  assert.equal(idle.settingsLockedReason, '')
  assert.notEqual(composing.settingsLockedReason, idle.settingsLockedReason)
})
