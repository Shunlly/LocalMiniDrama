<template>
  <section
    v-if="hasSuccessfulListLoad && !listError && (dramas.length > 0 || hasProjectFilters)"
    class="workspace-overview"
    aria-labelledby="project-list-title"
  >
      <div class="workspace-copy">
        <h2 id="project-list-title" class="workspace-title">项目列表</h2>
        <p class="workspace-count">
        {{ projectListCountLabel }}
        </p>
      </div>
    <div class="workspace-controls" role="search" aria-label="项目列表筛选">
      <el-input
        v-model="projectSearch"
        class="workspace-search"
        clearable
        placeholder="搜索项目标题、描述、风格或类型"
        aria-label="搜索项目"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select
        v-model="projectStatusFilter"
        class="workspace-status"
        aria-label="按项目状态筛选"
      >
        <el-option label="全部状态" value="all" />
        <el-option label="草稿" value="draft" />
        <el-option label="生成中" value="generating" />
        <el-option label="已发布" value="published" />
      </el-select>
      <el-select
        v-model="projectSort"
        class="workspace-sort"
        aria-label="项目排序"
      >
        <el-option label="更新时间优先" value="updated-desc" />
        <el-option label="创建时间优先" value="created-desc" />
        <el-option label="标题升序" value="title-asc" />
      </el-select>
      <el-button
        v-if="hasProjectFilters"
        class="workspace-clear-filters"
        aria-label="清除筛选"
        @click="clearProjectFilters"
      >
        清除筛选
      </el-button>
    </div>
  </section>

    <!-- 空项目时提供完整起步路径；已有项目时使用顶部主操作，避免重复入口。 -->
    <section v-if="!loading && hasSuccessfulListLoad && !listError && dramas.length === 0 && !hasProjectFilters" class="action-card action-card--empty" role="status" aria-live="polite">
      <div class="action-card-inner">
        <h2 class="action-card-title">还没有短剧项目</h2>
        <p class="action-card-desc">新建空白项目，或继续已有项目包。</p>
        <div class="action-card-buttons">
          <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="top">
            <span
              class="tooltip-trigger"
              :tabindex="listWriteLocked ? 0 : undefined"
              :aria-label="listWriteLocked ? `新建项目不可用：${listWriteLockReason}` : undefined"
              :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
            >
              <el-button type="primary" size="large" class="action-btn action-btn-new" :disabled="listWriteLocked" aria-label="新建项目" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined" @click="goNewProject">
                <el-icon><Plus /></el-icon>新建项目
              </el-button>
            </span>
          </el-tooltip>
          <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="top">
            <span
              class="tooltip-trigger"
              :tabindex="listWriteLocked ? 0 : undefined"
              :aria-label="listWriteLocked ? `导入项目包不可用：${listWriteLockReason}` : undefined"
              :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
            >
              <el-button size="large" class="action-btn action-btn-import" :loading="importing" :disabled="listWriteLocked" aria-label="导入项目包" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined" @click="triggerImport">
                <el-icon><Upload /></el-icon>导入项目包
              </el-button>
            </span>
          </el-tooltip>
        </div>
        <div class="action-card-secondary">
          <el-button class="action-btn-material" aria-label="打开素材中心" @click="goMaterialCenter">
            <el-icon><Files /></el-icon>前往素材中心
          </el-button>
          <el-button class="action-btn-trash" aria-label="打开项目回收站" @click="openTrash">
            <el-icon><Delete /></el-icon>查看回收站
          </el-button>
        </div>
        <div v-if="exampleList.length > 0" class="action-card-example">
          <div class="example-hint">
            <el-icon class="example-hint-icon"><QuestionFilled /></el-icon>
            <span class="example-hint-text">新手？试试导入示例项目快速体验</span>
          </div>
          <div class="example-list">
            <el-tooltip
              v-for="ex in exampleList"
              :key="ex.filename"
              :content="listWriteLockReason"
              :disabled="!listWriteLocked"
              placement="top"
            >
              <span
                class="tooltip-trigger"
                :tabindex="listWriteLocked ? 0 : undefined"
                :aria-label="listWriteLocked ? `导入示例项目${ex.name}不可用：${listWriteLockReason}` : undefined"
                :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
              >
            <el-button
              size="small"
              class="example-btn"
              :loading="importingExample === ex.filename"
              :disabled="listWriteLocked"
              :title="listWriteLocked ? listWriteLockReason : undefined"
              :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
              :aria-label="importingExample === ex.filename ? `正在导入${ex.name}` : (listWriteLocked ? `导入示例项目${ex.name}不可用：${listWriteLockReason}` : `导入示例项目${ex.name}`)" @click="onImportExample(ex)"
            >
              <el-icon><FolderOpened /></el-icon>{{ ex.name }}
            </el-button>
              </span>
            </el-tooltip>
          </div>
        </div>
      </div>
    </section>
    <section
      v-if="!loading && hasSuccessfulListLoad && !listError && hasProjectFilters && filteredDramas.length === 0"
      class="action-card action-card--empty action-card--search-empty"
      role="status"
      aria-live="polite"
    >
      <div class="action-card-inner">
        <h2 class="action-card-title">没有匹配的项目</h2>
        <p class="action-card-desc">换一个关键词或状态，或清除筛选后查看全部项目。</p>
        <div class="action-card-buttons">
          <el-button class="action-btn action-btn-clear-filters" aria-label="清除筛选并查看全部项目" @click="clearProjectFilters">
            清除筛选
          </el-button>
          <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="top">
            <span
              class="tooltip-trigger"
              :tabindex="listWriteLocked ? 0 : undefined"
              :aria-label="listWriteLocked ? `新建项目不可用：${listWriteLockReason}` : undefined"
              :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined"
            >
              <el-button type="primary" class="action-btn action-btn-new" :disabled="listWriteLocked" aria-label="新建项目" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'project-list-write-lock-reason' : undefined" @click="goNewProject">
                <el-icon><Plus /></el-icon>新建项目
              </el-button>
            </span>
          </el-tooltip>
        </div>
      </div>
    </section>
  </template>

<script setup>
// 项目列表筛选工具条与空态
import { Delete, Plus, Upload, QuestionFilled, FolderOpened, Files, Search } from '@element-plus/icons-vue'

const projectSearch = defineModel('projectSearch', { type: String, default: '' })
const projectStatusFilter = defineModel('projectStatusFilter', { type: String, default: 'all' })
const projectSort = defineModel('projectSort', { type: String, default: 'updated-desc' })

defineProps({
  loading: { type: Boolean, default: false },
  hasSuccessfulListLoad: { type: Boolean, default: false },
  listError: { type: String, default: '' },
  dramas: { type: Array, default: () => [] },
  filteredDramas: { type: Array, default: () => [] },
  hasProjectFilters: { type: Boolean, default: false },
  projectListCountLabel: { type: String, default: '' },
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
  importing: { type: Boolean, default: false },
  exampleList: { type: Array, default: () => [] },
  importingExample: { default: null },
  goNewProject: { type: Function, required: true },
  triggerImport: { type: Function, required: true },
  goMaterialCenter: { type: Function, required: true },
  openTrash: { type: Function, required: true },
  onImportExample: { type: Function, required: true },
  clearProjectFilters: { type: Function, required: true },
})
</script>

<style scoped>
.workspace-overview {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
  padding: 4px 0 2px;
}
.workspace-copy {
  min-width: 0;
}
.workspace-title {
  margin: 0;
  color: #f4f4f5;
  font-size: 1.2rem;
  font-weight: 650;
  line-height: 1.25;
}
.workspace-count {
  margin: 5px 0 0;
  color: #8b8b97;
  font-size: 0.82rem;
  line-height: 1.4;
}
.workspace-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: min(520px, 100%);
}
.workspace-search {
  width: 320px;
}
.workspace-status {
  width: 124px;
}
.workspace-sort {
  width: 150px;
}
html.dark .workspace-search :deep(.el-input__wrapper),
html.dark .workspace-sort :deep(.el-select__wrapper) {
  background: #18181b;
  box-shadow: 0 0 0 1px #3f3f46;
}
html.dark .workspace-search :deep(.el-input__inner),
html.dark .workspace-sort :deep(.el-select__selected-item),
html.dark .workspace-sort :deep(.el-select__placeholder) {
  color: #e4e4e7;
}
html.dark .workspace-search :deep(.el-input__inner::placeholder) {
  color: #71717a;
}
.action-card {
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}
.action-card:hover {
  transform: none;
  box-shadow: none;
}
.action-card::before {
  display: none;
}
.action-card-inner {
  width: min(680px, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}
.action-card--empty {
  grid-column: 1 / -1;
  min-height: 260px;
  padding: 44px 12px;
}
.action-card--search-empty {
  min-height: 210px;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(148, 163, 184, 0.34);
  background: rgba(24, 24, 30, 0.42);
}
.action-card--search-empty .action-card-inner {
  align-items: center;
  text-align: center;
}
.action-card--search-empty .action-card-buttons {
  justify-content: center;
}
.action-card-title {
  font-size: 1.35rem;
  font-weight: 650;
  color: #f4f4f5;
  margin: 0;
}
.action-card-desc {
  margin: -4px 0 4px;
  color: #a1a1aa;
  font-size: 0.875rem;
}
.action-card-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
  justify-content: flex-start;
}
.action-btn {
  min-width: 150px;
}
.action-btn-new {
  --el-button-bg-color: var(--el-color-primary);
}
.action-btn-import {
  --el-button-bg-color: rgba(99, 102, 241, 0.12);
  --el-button-border-color: rgba(99, 102, 241, 0.35);
  --el-button-text-color: #a5b4fc;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.22);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.55);
  --el-button-hover-text-color: #c7d2fe;
}
.action-card-secondary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.action-btn-material {
  --el-button-bg-color: rgba(255, 255, 255, 0.02);
  --el-button-border-color: rgba(99, 102, 241, 0.28);
  --el-button-text-color: #c7d2fe;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.14);
  --el-button-hover-border-color: rgba(129, 140, 248, 0.5);
  --el-button-hover-text-color: #e0e7ff;
}
.action-btn-trash {
  --el-button-bg-color: transparent;
  --el-button-border-color: rgba(148, 163, 184, 0.28);
  --el-button-text-color: #a1a1aa;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.1);
  --el-button-hover-border-color: rgba(148, 163, 184, 0.5);
  --el-button-hover-text-color: #e4e4e7;
}
.action-card-note {
  margin: 0;
  color: #8b8b97;
  font-size: 0.82rem;
  text-align: center;
}
.action-card-example {
  width: 100%;
  padding-top: 8px;
  border-top: 1px solid rgba(99, 102, 241, 0.15);
}
.example-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  margin-bottom: 8px;
}
.example-hint-icon {
  color: #a5b4fc;
  font-size: 15px;
}
.example-hint-text {
  font-size: 0.8rem;
  color: #71717a;
}
.example-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.example-btn {
  --el-button-bg-color: rgba(34, 197, 94, 0.1);
  --el-button-border-color: rgba(34, 197, 94, 0.3);
  --el-button-text-color: #4ade80;
  --el-button-hover-bg-color: rgba(34, 197, 94, 0.2);
  --el-button-hover-border-color: rgba(34, 197, 94, 0.5);
  --el-button-hover-text-color: #22c55e;
}
.workspace-clear-filters {
  flex: 0 0 auto;
}
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.action-card-buttons :deep(.el-button:focus-visible),
.example-list :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
html.light .action-card {
  background: transparent;
}
html.light .action-card:hover {
  background: transparent;
}
html.light .action-card-title { color: #20242c; }
html.light .workspace-title { color: #20242c; }
html.light .workspace-count { color: #6b7280; }
html.light .action-card--search-empty {
  background: #ffffff;
  border-color: #d6dbe3;
}
html.light .action-card-desc { color: #6b7280; }
html.light .action-btn-import {
  --el-button-bg-color: #ffffff;
  --el-button-border-color: #b8c0cc;
  --el-button-text-color: #374151;
  --el-button-hover-bg-color: #f3f4f6;
  --el-button-hover-border-color: #7c8796;
  --el-button-hover-text-color: #111827;
}
html.light .action-btn-material {
  --el-button-bg-color: rgba(79, 70, 229, 0.04);
  --el-button-border-color: rgba(79, 70, 229, 0.22);
  --el-button-text-color: #4338ca;
  --el-button-hover-bg-color: rgba(79, 70, 229, 0.1);
  --el-button-hover-border-color: rgba(79, 70, 229, 0.38);
  --el-button-hover-text-color: #3730a3;
}
html.light .action-btn-trash {
  --el-button-bg-color: transparent;
  --el-button-border-color: #cbd1d9;
  --el-button-text-color: #4b5563;
  --el-button-hover-bg-color: #f3f4f6;
  --el-button-hover-border-color: #8b95a3;
  --el-button-hover-text-color: #1f2937;
}
html.light .action-card-note { color: #6b7280; }
html.light .example-hint-text { color: #6b7280; }
@media (max-width: 860px) {
  .workspace-overview {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
  .workspace-controls {
    justify-content: stretch;
    min-width: 0;
  }
  .workspace-search {
    flex: 1 1 auto;
    width: auto;
  }
  .workspace-status,
  .workspace-sort,
  .workspace-clear-filters {
    flex: 0 1 150px;
  }
}
@media (max-width: 620px) {
  .workspace-controls {
    align-items: stretch;
    flex-direction: column;
  }
  .workspace-search,
  .workspace-status,
  .workspace-sort,
  .workspace-clear-filters {
    width: 100%;
  }
}
</style>
