<template>
  <header class="header">
    <div class="header-inner">
      <button type="button" class="logo" aria-label="本地短剧助手，返回项目列表" title="返回项目列表" @click="goProjectList">
        <span class="logo-main">本地短剧助手</span>
        <span class="logo-sub">画布模式</span>
      </button>
      <span class="breadcrumb-sep">›</span>
      <span class="page-title">{{ pageTitle }}</span>

      <el-select
        :model-value="filterEpisodeId"
        aria-label="筛选画布集数"
        title="筛选画布集数"
        @update:model-value="requestEpisodeFilterChange"
        class="episode-select"
        placeholder="全部集数"
        clearable
        size="small"
      >
        <el-option
          v-for="ep in episodes"
          :key="ep.id"
          :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
          :value="ep.id"
        />
      </el-select>

      <span v-if="layoutSaveState === 'saving'" class="layout-status saving" aria-live="polite">保存中…</span>
      <span v-else-if="layoutSaveState === 'saved'" class="layout-status saved" aria-live="polite">已保存</span>
      <span v-else-if="layoutSaveState === 'error'" class="layout-status error" role="alert">保存失败</span>
      <span
        v-if="layoutSaveError"
        class="layout-save-error"
        role="alert"
        :title="displayLayoutSaveError"
      >{{ displayLayoutSaveError }}</span>
      <el-button
        v-if="layoutSaveState === 'error'"
        link
        size="small"
        type="warning"
        aria-label="重试保存画布"
        title="重试保存画布"
        @click="retryCanvasSave"
      >
        重试保存
      </el-button>
      <el-button
        v-if="episodeGenerating"
        type="warning"
        plain
        size="small"
        aria-label="取消批量生成"
        title="取消批量生成"
        @click="cancelEpisodeGenerate"
      >
        取消批量生成
      </el-button>
    </div>
    <slot name="toolbar" />
    <div
      v-if="freeCanvasReadOnly"
      class="canvas-warning-bar free-canvas-version-warning"
      role="alert"
    >
      <span>{{ freeCanvasCompatibilityMessage }}</span>
      <div class="canvas-warning-actions">
        <el-button link size="small" aria-label="返回列表模式" title="返回列表模式" @click="goListMode">列表模式</el-button>
      </div>
    </div>
    <div
      v-if="scopedMediaWarning"
      class="canvas-warning-bar"
      role="alert"
    >
      <span>{{ scopedMediaWarning }}</span>
      <div class="canvas-warning-actions">
        <el-button
          link
          size="small"
          :loading="mediaLoading"
          :aria-label="mediaLoading ? '正在重试媒体查询' : '重试媒体查询'"
          :title="mediaLoading ? '正在重试媒体查询' : '重试媒体查询'"
          @click="retryUnknownStoryboardMedia"
        >
          重试媒体查询
        </el-button>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { toCanvasChineseMessage } from './canvasExperienceCopy.js'

const props = defineProps({
  pageTitle: { type: String, default: '加载中…' },
  episodes: { type: Array, default: () => [] },
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
})

const displayLayoutSaveError = computed(() => (
  props.layoutSaveError
    ? toCanvasChineseMessage(props.layoutSaveError, '画布布局保存失败，请稍后重试')
    : ''
))
</script>


<style scoped>
.header {
  box-sizing: border-box;
  flex-shrink: 0;
  min-width: 0;
  max-width: 100%;
  border-bottom: 1px solid var(--border-color, #27272a);
  background: var(--bg-card, #18181b);
  overflow-x: clip;
}

.header-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px 6px;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}

.episode-select {
  width: min(150px, 100%);
  min-width: 0;
  max-width: 100%;
}

.canvas-warning-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 20px 12px;
  border-top: 1px solid rgba(251, 191, 36, 0.18);
  color: var(--canvas-amber-text, #fcd34d);
  font-size: 12px;
  background: rgba(251, 191, 36, 0.06);
  min-width: 0;
  flex-wrap: wrap;
  max-width: 100%;
}

.canvas-warning-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

@media (max-width: 769px) {
  .header-inner,
  .canvas-warning-bar {
    padding-left: 12px;
    padding-right: 12px;
  }
}

.logo {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.logo-main {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-bright, #fafafa);
}

.logo-sub {
  font-size: 11px;
  color: var(--canvas-indigo-strong);
}

.breadcrumb-sep { color: var(--text-faint, #52525b); }

.page-title {
  font-size: 14px;
  color: var(--text-muted, #a1a1aa);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-status { font-size: 12px; }
.layout-status.saving { color: var(--canvas-info-text); }
.layout-status.saved { color: var(--canvas-success-text); }
.layout-status.error { color: var(--canvas-danger-text); }
.layout-save-error {
  max-width: 320px;
  color: var(--canvas-danger-text);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.logo:focus-visible { outline: 2px solid var(--canvas-indigo-strong); outline-offset: 4px; }
</style>
