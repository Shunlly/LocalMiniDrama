import test from 'node:test'
import assert from 'node:assert/strict'

import {
  episodeHasProductionContent,
  getCanvasActionDisabledReasons,
  getCanvasStartMode,
} from '../src/utils/canvasActionState.js'

test('canvas actions explain missing workflow and episode prerequisites', () => {
  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: 0,
    pipelineSteps: ['image'],
    episodeCount: 0,
    storyboardCount: 0,
  })

  assert.match(reasons.editScript, /新建一集/)
  assert.match(reasons.createStoryboard, /新建一集/)
  assert.match(reasons.createAsset, /新建一集/)
  assert.match(reasons.createWorkflow, /选择分镜/)
  assert.match(reasons.runWorkflow, /选择一个工作流/)
  assert.match(reasons.deleteWorkflow, /选择一个工作流/)
  assert.match(reasons.generateStoryboards, /选择一集/)
  assert.match(reasons.batchImages, /选择一集/)
  assert.match(reasons.batchVideos, /选择一集/)
})

test('canvas actions expose exact content prerequisites after selecting an episode', () => {
  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: 2,
    pipelineSteps: ['image', 'video'],
    activeGroupId: 'wg-1',
    episodeCount: 2,
    episodeId: 12,
    episodeHasScript: false,
    storyboardCount: 0,
  })

  assert.equal(reasons.editScript, '')
  assert.equal(reasons.createStoryboard, '')
  assert.equal(reasons.createAsset, '')
  assert.equal(reasons.createWorkflow, '')
  assert.equal(reasons.runWorkflow, '')
  assert.equal(reasons.deleteWorkflow, '')
  assert.match(reasons.generateStoryboards, /还没有剧本/)
  assert.match(reasons.batchImages, /还没有分镜/)
  assert.match(reasons.batchVideos, /还没有分镜/)
})

test('canvas actions block conflicting generation work with a single reason', () => {
  const reasons = getCanvasActionDisabledReasons({
    selectedStoryboardCount: 1,
    pipelineSteps: ['image'],
    activeGroupId: 'wg-1',
    episodeCount: 1,
    episodeId: 12,
    episodeHasScript: true,
    storyboardCount: 3,
    episodeGenerating: true,
  })

  assert.equal(reasons.editScript, '')
  assert.equal(reasons.createWorkflow, '')
  assert.match(reasons.runWorkflow, /本集生成任务正在执行/)
  assert.equal(reasons.deleteWorkflow, '')
  assert.match(reasons.generateStoryboards, /本集生成任务正在执行/)
  assert.match(reasons.batchImages, /本集生成任务正在执行/)
})

test('canvas start mode keeps selection as the only empty-canvas gate', () => {
  assert.equal(getCanvasStartMode(null), 'unavailable')
  assert.equal(getCanvasStartMode({ episodes: [] }), 'create-episode')

  const emptyEpisodes = {
    episodes: [
      { id: 1, script_content: '', storyboards: [] },
      { id: 2, script_content: ' ', storyboards: [] },
    ],
  }
  assert.equal(getCanvasStartMode(emptyEpisodes), 'select-episode')
  assert.equal(getCanvasStartMode(emptyEpisodes, 1), '')
  assert.equal(getCanvasStartMode(emptyEpisodes, 999), 'select-episode')
  assert.equal(getCanvasStartMode({ episodes: [{ id: 1, script_content: '', storyboards: [] }] }), 'select-episode')
  assert.equal(getCanvasStartMode({ episodes: [{ id: 1, script_content: '', storyboards: [] }] }, 1), '')

  const populated = { episodes: [{ id: 1, script_content: '第一场', storyboards: [] }] }
  assert.equal(episodeHasProductionContent(populated.episodes[0]), true)
  assert.equal(getCanvasStartMode(populated, 1), '')
})
