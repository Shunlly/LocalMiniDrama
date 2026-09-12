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
          <h1 class="page-title">{{ pageTitle }}</h1>
        </div>
        <el-button class="btn-back-list" aria-label="返回项目列表" @click="emit('go-list')">
          <el-icon aria-hidden="true"><ArrowLeft /></el-icon>返回项目列表
        </el-button>
        <div class="header-actions">
          <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" :aria-label="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="emit('toggle-theme')">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
            {{ isDark ? '浅色' : '暗色' }}
          </el-button>
          <p
            v-if="isDramaReady && !currentEpisodeId"
            id="drama-header-episode-reason"
            class="visually-hidden"
          >请先新增一集</p>
          <el-tooltip
            v-if="isDramaReady"
            content="请先新增一集，再进入制作"
            :disabled="Boolean(currentEpisodeId)"
            placement="bottom"
          >
            <span
              class="tooltip-trigger"
              :tabindex="currentEpisodeId ? undefined : 0"
              :aria-label="currentEpisodeId ? undefined : '进入制作不可用：请先新增一集'"
              :aria-describedby="currentEpisodeId ? undefined : 'drama-header-episode-reason'"
            >
              <el-button
                type="primary"
                :disabled="!currentEpisodeId"
                :aria-label="currentEpisodeId ? '进入制作' : '进入制作不可用：请先新增一集'"
                :aria-describedby="currentEpisodeId ? undefined : 'drama-header-episode-reason'"
                @click="emit('go-create')"
              >
                <el-icon><VideoPlay /></el-icon>进入制作
              </el-button>
            </span>
          </el-tooltip>
          <el-tooltip
            v-if="isDramaReady"
            content="请先新增一集，再进入画布"
            :disabled="Boolean(currentEpisodeId)"
            placement="bottom"
          >
            <span
              class="tooltip-trigger"
              :tabindex="currentEpisodeId ? undefined : 0"
              :aria-label="currentEpisodeId ? undefined : '画布模式不可用：请先新增一集'"
              :aria-describedby="currentEpisodeId ? undefined : 'drama-header-episode-reason'"
            >
              <el-button
                type="primary"
                plain
                :disabled="!currentEpisodeId"
                :aria-label="currentEpisodeId ? '画布模式' : '画布模式不可用：请先新增一集'"
                :aria-describedby="currentEpisodeId ? undefined : 'drama-header-episode-reason'"
                @click="emit('go-canvas-mode')"
              >
                <el-icon><Grid /></el-icon>画布模式
              </el-button>
            </span>
          </el-tooltip>
        </div>
      </div>
    </header>
</template>

<script setup>
import { ArrowLeft, Grid, Moon, Sunny, VideoPlay } from '@element-plus/icons-vue'

// 页头只负责展示，返回项目列表与进入制作等方法仍由页面处理

defineProps({
  pageTitle: { type: String, default: '剧集管理' },
  isDark: { type: Boolean, default: false },
  isDramaReady: { type: Boolean, default: false },
  currentEpisodeId: { default: null },
})

const emit = defineEmits(['go-list', 'toggle-theme', 'go-create', 'go-canvas-mode'])
</script>

<style scoped>
.header {
  background: #121216;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(139, 92, 246, 0.18);
  padding: 12px 24px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.4);
}
html.light .drama-detail .header {
  background: #ffffff !important;
  border-bottom-color: rgba(139, 92, 246, 0.2) !important;
  box-shadow: 0 2px 16px rgba(139, 92, 246, 0.08) !important;
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
  font-size: 1.1rem;
  font-weight: 700;
  background: linear-gradient(135deg, #c4b5fd 0%, #818cf8 50%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
}
html.light .drama-detail .logo-main {
  background: linear-gradient(135deg, #7c3aed, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .drama-detail .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.header-inner { max-width: min(1200px, 96vw); margin: 0 auto; display: flex; align-items: center; gap: 16px; }
.breadcrumb-sep {
  color: #3f3f46;
  font-size: 1rem;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}
html.light .breadcrumb-sep { color: #d1d5db; }
.header-context {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
}
.header-context-label {
  flex-shrink: 0;
  color: #71717a;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
html.light .header-context-label { color: #6b7280; }
.page-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 500;
  color: #a1a1aa;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 3px 10px;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.light .page-title {
  color: #6b7280;
  background: rgba(99, 102, 241, 0.06);
  border-color: rgba(99, 102, 241, 0.15);
}
.btn-back-list {
  flex-shrink: 0;
}
.header-actions { margin-left: auto; display: flex; gap: 8px; flex-shrink: 0; }
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.logo:focus-visible { outline: 2px solid #818cf8; outline-offset: 4px; }
.btn-theme {
  --el-button-bg-color: rgba(148, 163, 184, 0.1);
  --el-button-border-color: rgba(148, 163, 184, 0.3);
  --el-button-text-color: #94a3b8;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.2);
  --el-button-hover-border-color: rgba(148, 163, 184, 0.5);
  --el-button-hover-text-color: #cbd5e1;
  transition: all 0.2s;
}
html.light .btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.08);
  --el-button-border-color: rgba(99, 102, 241, 0.3);
  --el-button-text-color: #6366f1;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.15);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.5);
  --el-button-hover-text-color: #4f46e5;
}
@media (max-width: 760px) {
  .header {
    padding: 10px 12px;
  }
  .header-inner {
    max-width: 100%;
    gap: 8px;
    flex-wrap: wrap;
  }
  .breadcrumb-sep,
  .header-context {
    display: none;
  }
  .btn-back-list {
    margin-left: auto;
  }
  .header-actions {
    width: 100%;
    margin-left: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .header-actions :deep(.el-button) {
    min-width: 0;
    margin-left: 0;
  }
}
</style>
