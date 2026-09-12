import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  describeActionAriaLabel,
  describeActionTitle,
  toFilmCreateDisabledReasonText,
  toFilmCreateUserFacingText,
} from '../src/components/filmCreate/filmCreateActionCopy.js'
import { describeDeliveryPanelState } from '../src/components/filmCreate/filmCreateDeliveryPanelCopy.js'
import { describeOutputVideoSettingsLock } from '../src/components/filmCreate/filmCreateOutputSectionCopy.js'
import {
  describeOverflowTaskCopy,
  navStepLabel,
  navStepStatusLabel,
} from '../src/components/filmCreate/filmCreateQuickNavCopy.js'
import { describeAddToEpisodeDisabledReason } from '../src/components/filmCreate/filmCreateResourceDialogsCopy.js'
import {
  describeMissingScenePanoramaReason,
  describeResourceMissingAssetImageReason,
  describeSd2CertActionTitle,
} from '../src/components/filmCreate/filmCreateResourcePanelCopy.js'
import { describeStoryboardConfigControls } from '../src/components/filmCreate/filmCreateStoryboardConfigBarCopy.js'
import {
  episodeResourceDisabledReason,
  pipelineDisabledReason,
  storyboardDisabledReason,
} from '../src/utils/filmCreateActionState.js'
import { getPipelineCompactAction } from '../src/utils/filmPipelineAction.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

test('空剧本仍禁用生成分镜和提取，并挡住一键成片', () => {
  assert.equal(episodeResourceDisabledReason({
    hasEpisode: true,
    hasScript: false,
    label: '角色',
  }), '当前集还没有剧本，请先编写或导入剧本')
  assert.equal(storyboardDisabledReason({
    hasEpisode: true,
    hasScript: false,
    storyboardGenerating: false,
    omniPolishing: false,
  }), '当前集还没有剧本，请先编写或导入剧本')
  assert.equal(pipelineDisabledReason({
    hasEpisode: true,
    hasScript: false,
    pipelineRunning: false,
  }), '当前集还没有剧本，请先编写或导入剧本')
})

test('缺配置时全流程主按钮仍是先跑草稿预演', () => {
  const action = getPipelineCompactAction({
    running: false,
    hasEpisode: true,
    readinessState: 'missing',
  })
  assert.equal(action?.label, '先跑草稿预演')
  assert.equal(action?.event, 'start-text-framework')
})

test('交付面板空态和英文错误仍收成中文', () => {
  const empty = describeDeliveryPanelState({
    playableStoryboardVideoCount: 0,
    storyboardCount: 0,
    composeActionDisabledReason: '请先生成或添加分镜',
  })
  const english = describeDeliveryPanelState({
    composeActionDisabledReason: 'Network Error',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })
  assert.equal(empty.guidanceKind, 'empty')
  assert.match(empty.guidanceText, /还没有可播放的分镜视频/)
  assert.equal(empty.guidanceActionLabel, '去分镜面板添加分镜')
  assert.equal(empty.guidanceAnchor, 'anchor-storyboard')
  assert.equal(english.composeDisabledReason, '当前不能合成成片')
  assert.match(english.composeButtonAriaLabel, /合成成片不可用/)
  assert.doesNotMatch(JSON.stringify(english), /Network Error/i)
})

test('输出区只在合成进行中锁定设置', () => {
  assert.equal(describeOutputVideoSettingsLock({
    composeActionDisabledReason: `请先为全部分镜生成可播放视频（已完成 0/${EPISODE_ID}）`,
    videoStatus: 'idle',
  }), '')
  assert.equal(describeOutputVideoSettingsLock({
    composeActionDisabledReason: '',
    videoStatus: 'generating',
  }), '正在合成视频，请等待当前任务完成')
})

test('快捷导航步骤和溢出任务给出中文读屏名称', () => {
  assert.equal(navStepStatusLabel('pending'), '未开始')
  assert.equal(navStepLabel({ label: '故事剧本', status: 'done' }), '跳转到故事剧本（已完成）')
  const overflow = describeOverflowTaskCopy(Array.from({ length: 9 }, (_, index) => ({
    id: `task-${index + 1}`,
    label: `任务${index + 1}`,
  })))
  assert.equal(overflow.count, 1)
  assert.match(overflow.ariaLabel, /还有 1 个任务未列出：任务9/)
})

test('素材缺图和认证帮助不再写 SD2', () => {
  assert.equal(describeResourceMissingAssetImageReason({}, 'character', false), '请先为该角色生成或上传主图')
  assert.equal(describeResourceMissingAssetImageReason({}, 'prop', true), '')
  assert.equal(describeMissingScenePanoramaReason(false), '请先为该场景生成或上传主图')
  assert.equal(describeSd2CertActionTitle({}), '将角色主图登记为认证资产')
  assert.doesNotMatch(describeSd2CertActionTitle({ seedance2_asset: { status: 'active' } }), /SD2/)
  assert.equal(describeAddToEpisodeDisabledReason(null), '请先创建或选择剧集')
  assert.equal(describeAddToEpisodeDisabledReason(EPISODE_ID), '')
})

test('分镜配置条首尾帧下禁用序列宫格', () => {
  const idle = describeStoryboardConfigControls({ storyboardUseFirstLastFrame: false })
  const locked = describeStoryboardConfigControls({ storyboardUseFirstLastFrame: true })
  assert.equal(idle.gridModeDisabledReason, '')
  assert.equal(locked.gridModeDisabledReason, '首尾帧模式下使用单张图，序列宫格暂不可用')
  assert.match(locked.gridModeAriaLabel, /不可用/)
})

test('按钮读屏名称把禁用原因读出来', () => {
  assert.equal(describeActionAriaLabel('合成成片', {
    disabledReason: '请先创建或选择剧集',
  }), '合成成片不可用：请先创建或选择剧集')
  assert.equal(describeActionAriaLabel('生成剧本', {
    loading: true,
    loadingLabel: '正在生成剧本',
  }), '正在生成剧本')
  assert.equal(describeActionTitle({
    loading: true,
    loadingLabel: '正在合成成片',
  }), '正在合成成片，请稍候')
  assert.equal(toFilmCreateUserFacingText('Network Error', '操作失败，请稍后重试'), '操作失败，请稍后重试')
  assert.equal(toFilmCreateUserFacingText('素材读取失败（HTTP 503）', '操作失败，请稍后重试'), '操作失败，请稍后重试')
  assert.equal(toFilmCreateUserFacingText('HTTP 404', '操作失败，请稍后重试'), '操作失败，请稍后重试')
  assert.equal(
    describeActionAriaLabel('重试加载素材', { disabledReason: '加载失败 HTTP 502' }),
    '重试加载素材不可用：当前不可用',
  )
  assert.equal(describeActionTitle({ disabledReason: '加载失败（HTTP 502）' }), '当前不可用')
  assert.equal(toFilmCreateDisabledReasonText('', '当前不可用'), '')
})

test('制作页仍把禁用原因和收尾留在页面接线里', () => {
  const filmCreate = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  assert.equal((filmCreate.match(/const pipelineRun = /g) || []).length, 1)
  assert.doesNotMatch(filmCreate, /useFilmCreateWorkspaceBootstrap/)
  assert.match(filmCreate, /createFilmCreateCloseoutBindings/)
  assert.match(filmCreate, /mountWorkspace/)
  assert.match(filmCreate, /unmountWorkspace/)
  assert.match(filmCreate, /useFilmCreatePipelineActions\(\{[\s\S]*composeActionDisabledReason/)
  assert.match(filmCreate, /useFilmCreatePipelineActions\(\{[\s\S]*productionCapabilityGaps/)
  assert.match(filmCreate, /useFilmCreateActionDisabledReasons\(\{[\s\S]*scriptContent/)
})
