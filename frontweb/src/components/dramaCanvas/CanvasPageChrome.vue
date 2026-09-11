<template>
  <CanvasPageHeader
    :page-title="drama?.title || '加载中…'"
    :episodes="drama?.episodes || []"
    :filter-episode-id="filterEpisodeId"
    :layout-save-state="layoutSaveState"
    :layout-save-error="layoutSaveError"
    :episode-generating="episodeGenerating"
    :free-canvas-read-only="freeCanvasReadOnly"
    :free-canvas-compatibility-message="freeCanvasCompatibilityMessage"
    :scoped-media-warning="scopedMediaWarning"
    :media-loading="mediaLoading"
    :go-project-list="goProjectList"
    :request-episode-filter-change="requestEpisodeFilterChange"
    :retry-canvas-save="retryCanvasSave"
    :cancel-episode-generate="cancelEpisodeGenerate"
    :go-list-mode="goListMode"
    :retry-unknown-storyboard-media="retryUnknownStoryboardMedia"
  >
    <template #toolbar>
      <CanvasDesktopToolbar
        :selected-storyboard-count="selectedStoryboardIds.length"
        :workflow-groups="workflowGroups"
        :active-group-id="activeGroupId"
        :pipeline-steps="pipelineSteps"
        :workflow-running="workflowRunning"
        :workflow-progress="workflowProgress"
        :episode-generating="episodeGenerating"
        :episode-gen-progress="episodeGenProgress"
        :action-reasons="actionReasons"
        :action-config-services="actionConfigServices"
        :aligning-nodes="aligningNodes"
        :is-dark="isDark"
        :canvas-mode="canvasMode"
        @edit-script="focusScriptNode"
        @create="openCreateDialog"
        @align="onAlignNodes"
        @list-mode="goListMode"
        @toggle-theme="toggleTheme"
        @set-mode="setCanvasMode"
        @update:pipeline-steps="setPipelineSteps"
        @update:active-group-id="setActiveGroupId"
        @create-workflow="onCreateWorkflowGroup"
        @run-workflow="onRunActiveGroup"
        @cancel-workflow="cancelActiveWorkflow"
        @delete-workflow="onDeleteActiveGroup"
        @generate-storyboards="aiGenerateStoryboards"
        @batch-images="batchGenerateImages"
        @batch-videos="batchGenerateVideos"
      />
    </template>
  </CanvasPageHeader>
</template>

<script setup>
import CanvasPageHeader from './CanvasPageHeader.vue'
import CanvasDesktopToolbar from './CanvasDesktopToolbar.vue'

/** 画布页头、集数筛选和桌面工具条的闭合区块 */
defineProps({
  drama: { type: Object, default: null },
  filterEpisodeId: { default: null },
  layoutSaveState: { type: String, default: '' },
  layoutSaveError: { type: String, default: '' },
  episodeGenerating: { type: Boolean, default: false },
  freeCanvasReadOnly: { type: Boolean, default: false },
  freeCanvasCompatibilityMessage: { type: String, default: '' },
  scopedMediaWarning: { type: String, default: '' },
  mediaLoading: { type: Boolean, default: false },
  goProjectList: { type: Function, required: true },
  requestEpisodeFilterChange: { type: Function, required: true },
  retryCanvasSave: { type: Function, required: true },
  cancelEpisodeGenerate: { type: Function, required: true },
  goListMode: { type: Function, required: true },
  retryUnknownStoryboardMedia: { type: Function, required: true },
  selectedStoryboardIds: { type: Array, default: () => [] },
  workflowGroups: { type: Array, default: () => [] },
  activeGroupId: { default: null },
  pipelineSteps: { type: Array, default: () => [] },
  workflowRunning: { type: Boolean, default: false },
  workflowProgress: { type: String, default: '' },
  episodeGenProgress: { type: String, default: '' },
  actionReasons: { type: Object, default: () => ({}) },
  actionConfigServices: { type: Object, default: () => ({}) },
  aligningNodes: { type: Boolean, default: false },
  isDark: { type: Boolean, default: false },
  canvasMode: { type: String, default: 'production' },
  focusScriptNode: { type: Function, required: true },
  openCreateDialog: { type: Function, required: true },
  onAlignNodes: { type: Function, required: true },
  toggleTheme: { type: Function, required: true },
  setCanvasMode: { type: Function, required: true },
  setPipelineSteps: { type: Function, required: true },
  setActiveGroupId: { type: Function, required: true },
  onCreateWorkflowGroup: { type: Function, required: true },
  onRunActiveGroup: { type: Function, required: true },
  cancelActiveWorkflow: { type: Function, required: true },
  onDeleteActiveGroup: { type: Function, required: true },
  aiGenerateStoryboards: { type: Function, required: true },
  batchGenerateImages: { type: Function, required: true },
  batchGenerateVideos: { type: Function, required: true },
})
</script>
