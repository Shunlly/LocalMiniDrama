<template>
  <header class="header">
    <div class="header-inner">
      <h1 class="logo">
        <span class="logo-main">本地短剧助手</span>
        <span class="logo-sub">LocalMiniDrama</span>
      </h1>
      <p
        v-if="listWriteLocked && listWriteLockReason"
        id="project-list-write-lock-reason"
        class="visually-hidden"
      >{{ listWriteLockReason }}</p>
      <!-- 素材入口：通用媒体为一级入口，语义素材保留在分类菜单中 -->
      <div class="header-library">
        <el-button class="btn-library btn-material-center" title="打开素材中心" aria-label="打开素材中心" @click="goMaterialCenter">
          <el-icon><Files /></el-icon>素材中心
        </el-button>
        <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="bottom">
          <span
            class="tooltip-trigger"
            :tabindex="listWriteLocked ? 0 : undefined"
            :aria-label="listWriteLocked ? `打开分类素材不可用：${listWriteLockReason}` : undefined"
            :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
          >
        <el-dropdown :disabled="listWriteLocked" trigger="click" placement="bottom-start" @command="openSemanticLibrary">
          <el-button class="btn-library btn-semantic-library" :disabled="listWriteLocked" aria-label="打开分类素材" :title="listWriteLocked ? listWriteLockReason : '打开分类素材'" :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined">
            <el-icon><Collection /></el-icon>分类素材
            <el-icon class="dropdown-caret"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="character"><el-icon><User /></el-icon>角色素材库</el-dropdown-item>
              <el-dropdown-item command="scene"><el-icon><PictureFilled /></el-icon>场景素材库</el-dropdown-item>
              <el-dropdown-item command="prop"><el-icon><Box /></el-icon>道具素材库</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
          </span>
        </el-tooltip>
      </div>
      <!-- 右侧操作区 -->
      <div class="header-actions">
        <el-button class="btn-library" title="打开自由创作" aria-label="打开自由创作" @click="goFreeCreate">
          <el-icon><MagicStick /></el-icon>自由创作
        </el-button>
        <el-tooltip content="项目回收站" placement="bottom">
          <el-button class="btn-trash utility-icon-button" title="项目回收站" aria-label="打开项目回收站" @click="openTrash">
            <el-icon><Delete /></el-icon>
            <span class="visually-hidden">打开项目回收站</span>
          </el-button>
        </el-tooltip>
        <el-tooltip :content="isDark ? '切换到浅色模式' : '切换到暗色模式'" placement="bottom">
          <el-button class="btn-theme utility-icon-button" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" :aria-label="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
            <span class="visually-hidden">{{ isDark ? '切换到浅色模式' : '切换到暗色模式' }}</span>
          </el-button>
        </el-tooltip>
        <el-button class="btn-settings" title="打开 AI 配置" aria-label="打开 AI 配置" @click="showAiConfigDialog = true">
          <el-icon><Setting /></el-icon>AI 配置
        </el-button>
        <el-button
          v-if="backupNavItem"
          class="btn-library btn-backup"
          title="打开数据备份"
          aria-label="打开数据备份与维护"
          @click="goBackup"
        >
          <el-icon><Download /></el-icon>数据备份
        </el-button>
        <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="bottom">
          <span
            class="tooltip-trigger"
            :tabindex="listWriteLocked ? 0 : undefined"
            :aria-label="listWriteLocked ? `导入项目包不可用：${listWriteLockReason}` : undefined"
            :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
          >
            <el-button ref="importTriggerButton" class="btn-import" :loading="importing" :disabled="listWriteLocked" aria-label="导入项目包" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined" @click="triggerImport">
              <el-icon><Upload /></el-icon>导入项目包
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="bottom">
          <span
            class="tooltip-trigger"
            :tabindex="listWriteLocked ? 0 : undefined"
            :aria-label="listWriteLocked ? `新建项目不可用：${listWriteLockReason}` : undefined"
            :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
          >
            <el-button type="primary" class="btn-new" :disabled="listWriteLocked" aria-label="新建项目" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined" @click="goNewProject">
              <el-icon><Plus /></el-icon>新建项目
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>
  </header>
</template>

<script setup>
// 项目列表顶栏：品牌、素材入口和工作区操作
import { ref } from 'vue'
import { Delete, Setting, Plus, User, PictureFilled, Box, Sunny, Moon, Download, Upload, MagicStick, Files, Collection, ArrowDown } from '@element-plus/icons-vue'

const showAiConfigDialog = defineModel('showAiConfigDialog', { type: Boolean, default: false })

defineProps({
  isDark: { type: Boolean, default: false },
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
  listError: { type: String, default: '' },
  backupNavItem: { default: null },
  importing: { type: Boolean, default: false },
  goMaterialCenter: { type: Function, required: true },
  openSemanticLibrary: { type: Function, required: true },
  goFreeCreate: { type: Function, required: true },
  openTrash: { type: Function, required: true },
  toggleTheme: { type: Function, required: true },
  goBackup: { type: Function, required: true },
  triggerImport: { type: Function, required: true },
  goNewProject: { type: Function, required: true },
})

const importTriggerButton = ref(null)

defineExpose({ importTriggerButton })
</script>

<style scoped>
.header {
  background: rgba(12, 12, 18, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(99, 102, 241, 0.18);
  padding: 12px 24px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 0 rgba(99, 102, 241, 0.08), 0 4px 24px rgba(0, 0, 0, 0.3);
}
.header-inner {
  max-width: min(1400px, 96vw);
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.logo {
  margin: 0;
  cursor: default;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
}
.logo-main {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0;
  color: #c7d2fe;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
  filter: none;
}
.header-library {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 20px;
}
.btn-material-center {
  font-weight: 600;
  --el-button-bg-color: rgba(99, 102, 241, 0.2);
  --el-button-border-color: rgba(129, 140, 248, 0.55);
  --el-button-text-color: #c7d2fe;
}
.btn-semantic-library .dropdown-caret {
  margin-left: 2px;
  font-size: 12px;
}
.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.utility-icon-button {
  width: 34px;
  min-width: 34px;
  padding: 0;
}
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.header-library :deep(.el-button:focus-visible),
.header-actions :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
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

.btn-trash {
  --el-button-bg-color: rgba(148, 163, 184, 0.08);
  --el-button-border-color: rgba(148, 163, 184, 0.28);
  --el-button-text-color: #cbd5e1;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.16);
  --el-button-hover-border-color: rgba(148, 163, 184, 0.46);
  --el-button-hover-text-color: #f1f5f9;
}
html.light .btn-trash {
  --el-button-bg-color: #ffffff;
  --el-button-border-color: #cbd1d9;
  --el-button-text-color: #4b5563;
  --el-button-hover-bg-color: #f3f4f6;
  --el-button-hover-border-color: #8b95a3;
  --el-button-hover-text-color: #1f2937;
}

/* 资源库按钮 —— 靛紫调 */
.btn-library {
  --el-button-bg-color: rgba(99, 102, 241, 0.12);
  --el-button-border-color: rgba(99, 102, 241, 0.35);
  --el-button-text-color: #a5b4fc;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.22);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.55);
  --el-button-hover-text-color: #c7d2fe;
  --el-button-active-bg-color: rgba(99, 102, 241, 0.3);
  --el-button-active-border-color: rgba(99, 102, 241, 0.7);
}
html.light .btn-library {
  --el-button-bg-color: rgba(79, 70, 229, 0.08);
  --el-button-border-color: rgba(79, 70, 229, 0.3);
  --el-button-text-color: #3730a3;
  --el-button-hover-bg-color: rgba(79, 70, 229, 0.14);
  --el-button-hover-border-color: rgba(79, 70, 229, 0.5);
  --el-button-hover-text-color: #312e81;
  --el-button-active-bg-color: rgba(79, 70, 229, 0.2);
  --el-button-active-border-color: rgba(79, 70, 229, 0.65);
}

/* 主题切换按钮 */
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

/* AI 配置按钮 —— 琥珀调 */
.btn-settings {
  --el-button-bg-color: rgba(234, 179, 8, 0.1);
  --el-button-border-color: rgba(234, 179, 8, 0.32);
  --el-button-text-color: #fcd34d;
  --el-button-hover-bg-color: rgba(234, 179, 8, 0.2);
  --el-button-hover-border-color: rgba(234, 179, 8, 0.5);
  --el-button-hover-text-color: #fde68a;
  --el-button-active-bg-color: rgba(234, 179, 8, 0.28);
  --el-button-active-border-color: rgba(234, 179, 8, 0.65);
}
html.light .btn-settings {
  --el-button-bg-color: rgba(180, 83, 9, 0.07);
  --el-button-border-color: rgba(180, 83, 9, 0.28);
  --el-button-text-color: #92400e;
  --el-button-hover-bg-color: rgba(180, 83, 9, 0.12);
  --el-button-hover-border-color: rgba(180, 83, 9, 0.45);
  --el-button-hover-text-color: #78350f;
  --el-button-active-bg-color: rgba(180, 83, 9, 0.18);
  --el-button-active-border-color: rgba(180, 83, 9, 0.6);
}

/* 导入按钮 —— 亮色模式下提升可读性 */
html.light .btn-import {
  --el-button-text-color: #374151;
  --el-button-border-color: #d1d5db;
  --el-button-hover-text-color: #1f2937;
  --el-button-hover-border-color: #9ca3af;
}
html.light .header {
  background: rgba(255, 255, 255, 0.92);
  border-bottom-color: #e4e7ec;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04), 0 4px 16px rgba(15, 23, 42, 0.04);
}
html.light .logo-main {
  color: #4f46e5;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
</style>
