<template>
  <header class="header">
    <div class="header-inner">
      <button type="button" class="logo" aria-label="本地短剧助手，返回项目列表" @click="emit('go-list')">
        <span class="logo-main">本地短剧助手</span>
        <span class="logo-sub">LocalMiniDrama</span>
      </button>
      <span class="breadcrumb-sep">›</span>
      <div class="header-context">
        <span class="header-context-label">项目</span>
        <h1 class="page-title" :title="projectPageTitle">{{ projectPageTitle }}</h1>
      </div>
      <div class="workspace-actions">
      <div v-if="projectLoadState === 'ready' && dramaId" class="header-context">
        <span class="header-context-label">当前集</span>
        <el-select
          v-if="hasAnyEpisode"
          ref="episodeSelectRef"
          class="header-episode-select"
          :model-value="selectedEpisodeId"
          aria-label="当前集"
          :aria-busy="episodeSwitching"
          :title="episodeSwitching ? '正在切换剧集，请稍候' : selectedEpisodeContextLabel"
          :loading="episodeSwitching"
          :disabled="episodeSwitching"
          placeholder="选择集数"
          @change="emit('episode-select', $event)"
        >
          <el-option
            v-for="(ep, index) in episodes"
            :key="ep.id"
            :label="formatEpisodeContextLabel(ep, index)"
            :value="ep.id"
          />
        </el-select>
        <el-button
          v-else
          type="primary"
          plain
          class="header-add-episode"
          aria-label="添加一集"
          @click="emit('add-episode')"
        >
          <el-icon aria-hidden="true"><Plus /></el-icon>添加一集
        </el-button>
      </div>
      <el-button v-if="projectLoadState === 'ready' && dramaId" class="btn-back-drama" aria-label="返回剧集" @click="emit('go-to-drama')">
        <el-icon aria-hidden="true"><ArrowLeft /></el-icon>
        返回剧集
      </el-button>
      <el-button v-if="projectLoadState === 'ready' && dramaId" type="primary" plain class="btn-canvas-mode" aria-label="画布模式" @click="emit('go-canvas-mode')">
        <el-icon aria-hidden="true"><Grid /></el-icon>
        画布模式
      </el-button>
      <div class="header-actions">
        <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" :aria-label="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="emit('toggle-theme')">
          <el-icon aria-hidden="true"><Sunny v-if="isDark" /><Moon v-else /></el-icon>
          {{ isDark ? '浅色' : '暗色' }}
        </el-button><el-button
          class="btn-ai-config"
          :disabled="projectLoadState !== 'ready'"
          :title="projectLoadState !== 'ready' ? '项目加载完成后才能打开 AI 配置' : '打开 AI 配置'"
          :aria-label="projectLoadState !== 'ready' ? 'AI 配置不可用：项目加载完成后才能打开' : '打开 AI 配置'"
          @click="emit('open-ai-config')"
        >
          <el-icon aria-hidden="true"><Setting /></el-icon>
          AI 配置
        </el-button>
      </div>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowLeft, Grid, Moon, Plus, Setting, Sunny } from '@element-plus/icons-vue'
import { formatEpisodeContextLabel } from '@/utils/filmCreateContext'

defineProps({
  projectPageTitle: { type: String, default: '' },
  projectLoadState: { type: String, default: 'ready' },
  dramaId: { default: null },
  hasAnyEpisode: { type: Boolean, default: false },
  selectedEpisodeId: { default: null },
  episodeSwitching: { type: Boolean, default: false },
  selectedEpisodeContextLabel: { type: String, default: '' },
  episodes: { type: Array, default: () => [] },
  isDark: { type: Boolean, default: false },
})

const emit = defineEmits([
  'go-list',
  'episode-select',
  'add-episode',
  'go-to-drama',
  'go-canvas-mode',
  'toggle-theme',
  'open-ai-config',
])

const episodeSelectRef = ref(null)

function focusEpisodeSelect() {
  const select = episodeSelectRef.value
  if (!select) return false
  if (typeof select.focus === 'function') select.focus()
  if (typeof select.toggleMenu === 'function') select.toggleMenu()
  return true
}

defineExpose({ focusEpisodeSelect })
</script>

<style scoped>
.header {
  background: rgba(20, 21, 28, 0.78);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 28px;
  position: sticky;
  top: 0;
  z-index: 200;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.15), 0 4px 20px rgba(0, 0, 0, 0.2);
  margin-left: var(--film-nav-width);
}
.sidebar-collapsed .header {
  margin-left: var(--film-nav-width);
}
html.light .header {
  background: #ffffff !important;
  border-bottom-color: rgba(139, 92, 246, 0.1) !important;
  box-shadow: 0 1px 0 rgba(139,92,246,0.06), 0 4px 20px rgba(139, 92, 246, 0.05) !important;
}
.header-inner {
  display: flex;
  align-items: center;
  gap: 16px;
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
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover { filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.5)); }
.logo-main {
  font-size: 1.05rem;
  font-weight: 700;
  background: linear-gradient(135deg, #d0d5e8 0%, #a8b0cc 50%, #8890b0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.01em;
  filter: drop-shadow(0 0 8px rgba(160, 170, 200, 0.15));
}
.logo-sub {
  font-size: 0.65rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: #52525e;
  -webkit-text-fill-color: #52525e;
  text-transform: uppercase;
}
html.light .logo-main {
  background: linear-gradient(135deg, #6d28d9, #4f46e5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.breadcrumb-sep {
  color: #3a3a44;
  font-size: 0.9rem;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}
html.light .breadcrumb-sep { color: #d1d5db; }
.page-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 500;
  color: #7a7a88;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 4px 12px;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.light .page-title {
  color: #6b7280;
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.1);
}
.header-context {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
}
.header-context-label {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.header-add-episode {
  flex-shrink: 0;
}
.header-episode-select {
  width: min(240px, 20vw);
  min-width: 170px;
  flex-shrink: 0;
}
.header-episode-select :deep(.el-select__selected-item) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-back-drama {
  flex-shrink: 0;
}
.header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.workspace-actions > .el-button,
.header-actions > .el-button {
  margin-left: 0;
}
.workspace-actions {
  min-width: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.workspace-actions > * {
  min-height: 32px;
}
@media (min-width: 769px) and (max-width: 1400px) {
  .header-inner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      "brand project"
      "actions actions";
    gap: 8px 16px;
  }
  .header-inner .logo { grid-area: brand; }
  .header-inner .breadcrumb-sep { display: none; }
  .header-inner > .header-context { grid-area: project; }
  .workspace-actions {
    grid-column: 1 / -1;
    grid-row: 2;
    display: grid;
    grid-template-columns: minmax(170px, 1fr) auto auto auto;
    margin-left: 0;
    width: 100%;
  }
  .workspace-actions .header-actions {
    margin-left: 0;
  }
}
@media (min-width: 769px) and (max-width: 960px) {
  .workspace-actions {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      "episode episode episode"
      "back canvas utilities";
  }
  .workspace-actions > .header-context { grid-area: episode; }
  .workspace-actions > .btn-back-drama { grid-area: back; }
  .workspace-actions > .btn-canvas-mode { grid-area: canvas; }
  .workspace-actions > .header-actions {
    grid-area: utilities;
    justify-self: end;
  }
}
.btn-theme {
  --el-button-bg-color: rgba(255, 255, 255, 0.04);
  --el-button-border-color: rgba(255, 255, 255, 0.08);
  --el-button-text-color: #8b8b96;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-button-hover-border-color: rgba(255, 255, 255, 0.18);
  --el-button-hover-text-color: #c8c8d0;
  transition: all 0.2s ease;
}
html.light .btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.04);
  --el-button-border-color: rgba(99, 102, 241, 0.12);
  --el-button-text-color: #6b7280;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.08);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.3);
  --el-button-hover-text-color: #4f46e5;
}
.logo:focus-visible,
.header-add-episode:focus-visible,
.btn-back-drama:focus-visible,
.btn-canvas-mode:focus-visible,
.btn-theme:focus-visible,
.btn-ai-config:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
.logo:focus-visible { outline-offset: 4px; }
</style>
