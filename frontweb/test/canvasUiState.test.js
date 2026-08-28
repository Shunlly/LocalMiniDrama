import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createCanvasEpisodeDraft,
  getCanvasEmptyStateActions,
  getStoryboardInspectorNavigation,
  getCanvasWorkflowUiState,
  getStoryboardInspectorMediaSummary,
  reconcileCanvasEpisodeDraft,
  resolveCanvasEpisodeId,
  storyboardShotTypeLabel,
} from '../src/utils/canvasUiState.js'

test('storyboard shot types are localized without exposing storage enums', () => {
  assert.equal(storyboardShotTypeLabel('medium'), '中景')
  assert.equal(storyboardShotTypeLabel('close_up'), '特写')
  assert.equal(storyboardShotTypeLabel('wide'), '远景')
  assert.equal(storyboardShotTypeLabel('大远景'), '大远景')
  assert.equal(storyboardShotTypeLabel('vendor_specific'), '其他景别')
  assert.equal(storyboardShotTypeLabel(''), '')
})

test('storyboard inspector media summary never counts unusable cache records', () => {
  assert.deepEqual(getStoryboardInspectorMediaSummary({
    imageRecords: [{ id: 1 }],
    videoRecords: [{ id: 2 }],
    imageReady: false,
    videoReady: false,
    audioReady: false,
  }), {
    imageCount: 0,
    videoCount: 0,
    audioReady: false,
  })
  assert.deepEqual(getStoryboardInspectorMediaSummary({
    imageRecords: [
      { id: 1, status: 'completed', local_path: 'images/shot-1.webp' },
      { id: 2, status: 'completed', image_url: 'placeholder://shot-2' },
      { id: 3, status: 'failed', image_url: 'https://example.test/failed.webp' },
    ],
    videoRecords: [
      { id: 4, status: 'completed', local_path: 'videos/shot-1.mp4' },
      { id: 5, status: 'completed', video_url: 'mock://shot-2' },
    ],
    imageReady: true,
    videoReady: true,
    audioRecords: ['placeholder://dialogue', 'audio/narration.wav'],
  }), {
    imageCount: 1,
    videoCount: 1,
    audioReady: true,
  })
  assert.equal(getStoryboardInspectorMediaSummary({
    audioRecords: ['placeholder://dialogue', 'mock://narration'],
  }).audioReady, false)
})

test('storyboard inspector navigation stays within the current episode and reports progress', () => {
  const episodes = [
    { id: 1, storyboards: [{ id: 11 }, { id: 12 }, { id: 13 }] },
    { id: 2, storyboards: [{ id: 21 }] },
  ]

  assert.deepEqual(getStoryboardInspectorNavigation(episodes, 1, 12), {
    index: 2,
    total: 3,
    previousId: 11,
    nextId: 13,
  })
  assert.deepEqual(getStoryboardInspectorNavigation(episodes, '1', '11'), {
    index: 1,
    total: 3,
    previousId: null,
    nextId: 12,
  })
  assert.deepEqual(getStoryboardInspectorNavigation(episodes, 2, 21), {
    index: 1,
    total: 1,
    previousId: null,
    nextId: null,
  })
  assert.deepEqual(getStoryboardInspectorNavigation(episodes, 1, 99), {
    index: 0,
    total: 3,
    previousId: null,
    nextId: null,
  })
})

test('workflow toolbar hides controls until selection or saved workflow state makes them useful', () => {
  const idle = getCanvasWorkflowUiState({
    selectedStoryboardCount: 0,
    workflowGroupCount: 0,
    actionReasons: { createWorkflow: '请先选择分镜' },
  })

  assert.equal(idle.showCreateControls, false)
  assert.equal(idle.showManagementControls, false)
  assert.equal(idle.showAnyControls, false)

  const selectionOnly = getCanvasWorkflowUiState({
    selectedStoryboardCount: 2,
    workflowGroupCount: 0,
    actionReasons: {},
  })

  assert.equal(selectionOnly.showCreateControls, true)
  assert.equal(selectionOnly.showManagementControls, false)

  const savedWorkflow = getCanvasWorkflowUiState({
    selectedStoryboardCount: 0,
    workflowGroupCount: 1,
    actionReasons: { runWorkflow: '请先选择一个工作流' },
  })

  assert.equal(savedWorkflow.showCreateControls, false)
  assert.equal(savedWorkflow.showManagementControls, true)
  assert.match(savedWorkflow.helperText, /选择一个工作流|创建新的工作流分组/)
})

test('empty canvas state keeps one primary action and one secondary list-mode route', () => {
  assert.deepEqual(getCanvasEmptyStateActions('create-episode'), {
    primaryAction: 'create-episode',
    secondaryAction: 'go-list',
  })
  assert.deepEqual(getCanvasEmptyStateActions('select-episode'), {
    primaryAction: 'confirm-episode',
    secondaryAction: 'go-list',
  })
  assert.deepEqual(getCanvasEmptyStateActions('select-episode', 0), {
    primaryAction: 'create-episode',
    secondaryAction: 'go-list',
  })
  assert.deepEqual(getCanvasEmptyStateActions('unavailable'), {
    primaryAction: '',
    secondaryAction: 'go-list',
  })
})

test('episode draft initializes from a valid prop without committing a parent selection', () => {
  const episodes = [{ id: 11 }, { id: 12 }]

  assert.equal(createCanvasEpisodeDraft(episodes), null)
  assert.equal(createCanvasEpisodeDraft(episodes, '12'), 12)
  assert.equal(createCanvasEpisodeDraft([{ id: 11 }]), 11)
  assert.equal(createCanvasEpisodeDraft(episodes, 99), null)
  assert.equal(resolveCanvasEpisodeId(episodes, '11'), 11)
  assert.equal(resolveCanvasEpisodeId(episodes, ''), null)
})

test('episode draft survives list updates and falls back when its option disappears', () => {
  assert.equal(reconcileCanvasEpisodeDraft([{ id: 11 }, { id: 12 }, { id: 13 }], 12), 12)
  assert.equal(reconcileCanvasEpisodeDraft([{ id: 11 }, { id: 13 }], 12, 13), 13)
  assert.equal(reconcileCanvasEpisodeDraft([{ id: 11 }, { id: 13 }], 12), null)
  assert.equal(reconcileCanvasEpisodeDraft([{ id: 11 }], 12), 11)
  assert.equal(reconcileCanvasEpisodeDraft([], 12), null)
})
