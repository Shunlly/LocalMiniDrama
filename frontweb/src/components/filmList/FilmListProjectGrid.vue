<template>
  <div class="project-grid">
    <article
      v-for="d in filteredDramas"
      :key="d.id"
      class="project-card"
    >
      <RouterLink
        class="project-card-link"
        :to="projectCardDestination(d, sourceImportIntent, projectListReturnTo)"
        :aria-label="`打开项目「${d.title || '未命名项目'}」`"
      >
        <div class="project-card-body">
          <div class="project-card-layout">
            <div class="project-card-cover" :class="{ 'project-card-cover--empty': !projectCoverUrl(d) }">
              <img
                v-if="projectCoverUrl(d)"
                :src="projectCoverUrl(d)"
                :alt="projectCoverAlt(d)"
                loading="lazy"
                @error="markProjectCoverError(d)"
              />
              <div v-else class="project-card-cover-placeholder" aria-hidden="true">
                <el-icon><PictureFilled /></el-icon>
                <span>{{ totalStoryboards(d) > 0 ? '待生成画面' : '尚无画面' }}</span>
              </div>
            </div>
            <div class="project-card-content">
              <div class="project-card-topline">
                <span class="badge badge-status" :class="'badge-status--' + (d.status || 'draft')">{{ formatStatus(d.status) }}</span>
                <span class="project-updated">更新于 {{ formatDate(d.updated_at || d.created_at) }}</span>
              </div>
              <div class="project-card-header">
                <h3 class="project-title" :title="d.title || '未命名项目'">{{ d.title || '未命名项目' }}</h3>
              </div>
              <p class="project-desc">{{ d.description || '暂无描述' }}</p>
              <div class="project-card-stats" aria-label="项目概览">
                <span class="project-stat">
                  <strong>{{ d.episodes?.length || 0 }}</strong>
                  <span>集</span>
                </span>
                <span class="project-stat">
                  <strong>{{ totalStoryboards(d) }}</strong>
                  <span>分镜</span>
                </span>
                <span v-if="d.metadata?.aspect_ratio" class="project-stat project-stat--compact">{{ d.metadata.aspect_ratio }}</span>
              </div>
              <div class="project-badges">
                <span v-if="d.style" class="badge badge-style">{{ formatStyle(d.style) }}</span>
                <span v-if="d.genre" class="badge badge-genre">{{ formatGenre(d.genre) }}</span>
              </div>
              <div class="project-card-footer">
                <p class="project-meta">创建于 {{ formatDate(d.created_at) || '未知时间' }}</p>
                <span class="project-card-continue">{{ sourceImportIntent ? '导入网页 URL' : ((d.episodes && d.episodes.length) ? '继续制作' : '去创建剧集') }} <el-icon aria-hidden="true"><ArrowRight /></el-icon></span>
              </div>
            </div>
          </div>
        </div>
      </RouterLink>
      <RouterLink
        class="project-card-assets"
        :to="{ name: 'drama-detail', params: { id: d.id }, query: { returnTo: projectListReturnTo }, hash: '#source-intake-workflow' }"
        :aria-label="`打开项目「${d.title || '未命名项目'}」的故事素材流程`"
        @click.stop
      >
        <el-icon><Files /></el-icon>故事素材
      </RouterLink>
      <el-dropdown
        class="project-card-menu"
        trigger="click"
        placement="bottom-end"
        popper-class="project-actions-dropdown"
        @click.stop
        @command="handleProjectAction($event, d)"
      >
        <el-button
          class="project-menu-button"
          text
          circle
          :loading="exportingId === d.id"
          title="项目操作"
          :aria-label="`打开项目「${d.title || '未命名项目'}」操作菜单`"
        >
          <el-icon><MoreFilled /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="export" :disabled="exportingId === d.id" :title="exportingId === d.id ? '正在导出该项目，请稍候' : undefined">
              <el-icon><Download /></el-icon>导出项目
            </el-dropdown-item>
            <el-dropdown-item command="edit" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined"><el-icon><Edit /></el-icon>编辑项目</el-dropdown-item>
            <el-dropdown-item command="trash" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" divided>
              <el-icon><Delete /></el-icon>移入回收站
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </article>
  </div>
</template>

<script setup>
// 项目卡片网格：封面、继续制作入口和卡片操作菜单
import { Edit, Delete, PictureFilled, Download, Files, MoreFilled, ArrowRight } from '@element-plus/icons-vue'

defineProps({
  filteredDramas: { type: Array, default: () => [] },
  sourceImportIntent: { type: Boolean, default: false },
  projectListReturnTo: { type: String, default: '/' },
  exportingId: { default: null },
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
  projectCardDestination: { type: Function, required: true },
  projectCoverUrl: { type: Function, required: true },
  projectCoverAlt: { type: Function, required: true },
  markProjectCoverError: { type: Function, required: true },
  formatStatus: { type: Function, required: true },
  formatDate: { type: Function, required: true },
  formatStyle: { type: Function, required: true },
  formatGenre: { type: Function, required: true },
  totalStoryboards: { type: Function, required: true },
  handleProjectAction: { type: Function, required: true },
})
</script>

<style scoped>
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 18px;
}
.project-card {
  position: relative;
  background: rgba(24, 24, 30, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 8px;
  padding: 0;
  transition: border-color 0.25s, background 0.25s, transform 0.25s, box-shadow 0.25s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  overflow: hidden;
}
.project-card-link {
  display: block;
  height: 100%;
  padding: 14px 16px;
  border-radius: inherit;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
.project-card-link:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: -4px;
  box-shadow: inset 0 0 0 1px rgba(165, 180, 252, 0.35), 0 0 0 4px rgba(99, 102, 241, 0.22);
}
.project-card:focus-within {
  border-color: rgba(129, 140, 248, 0.75);
}
.project-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: transparent;
  pointer-events: none;
}
.project-card:hover {
  border-color: rgba(99, 102, 241, 0.55);
  background: rgba(28, 28, 36, 0.9);
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(99, 102, 241, 0.12), 0 0 0 1px rgba(99, 102, 241, 0.08), 0 2px 8px rgba(0, 0, 0, 0.4);
}

.project-card-body {
  min-width: 0;
}
.project-card-layout {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 16px;
  min-height: 182px;
}
.project-card-cover {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 182px;
  overflow: hidden;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  background: #202028;
  color: #71717a;
}
.project-card-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.project-card-cover-placeholder {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 12px 8px;
  color: #8b8b97;
  font-size: 0.7rem;
  line-height: 1.35;
  text-align: center;
}
.project-card-cover-placeholder .el-icon {
  color: #a5b4fc;
  font-size: 22px;
}
.project-card-cover--empty {
  border-style: dashed;
  background: rgba(99, 102, 241, 0.06);
}
.project-card-content {
  display: flex;
  min-width: 0;
  min-height: 100%;
  flex-direction: column;
}
.project-card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding-right: 36px;
}
.project-updated {
  overflow: hidden;
  color: #8b8b97;
  font-size: 0.74rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-card-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  margin-bottom: 8px;
  padding-right: 36px;
}
.project-title {
  min-width: 0;
  font-size: 1.05rem;
  line-height: 1.4;
  margin: 2px 0 0;
  color: #fafafa;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.project-desc {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0 0 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.project-card-stats {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 12px;
}
.project-stat {
  display: inline-flex;
  min-width: 64px;
  min-height: 42px;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  color: #a1a1aa;
  font-size: 0.72rem;
  line-height: 1.1;
}
.project-stat strong {
  color: #f4f4f5;
  font-size: 1rem;
  font-weight: 680;
  line-height: 1;
}
.project-stat--compact {
  min-width: 58px;
  align-items: center;
  color: #fbbf24;
  font-family: monospace;
  font-size: 0.86rem;
}
.project-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 10px;
}
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 99px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}
.badge-status--draft {
  background: rgba(113, 113, 122, 0.15);
  color: #a1a1aa;
  border: 1px solid rgba(113, 113, 122, 0.3);
}
.badge-status--published {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.badge-status--generating {
  background: rgba(234, 179, 8, 0.12);
  color: #fcd34d;
  border: 1px solid rgba(234, 179, 8, 0.3);
}
.badge-status--archived {
  background: rgba(99, 102, 241, 0.1);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.25);
}
.badge-episodes {
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.28);
}
.badge-storyboards {
  background: rgba(20, 184, 166, 0.12);
  color: #2dd4bf;
  border: 1px solid rgba(20, 184, 166, 0.28);
}
.badge-ratio {
  background: rgba(251, 146, 60, 0.1);
  color: #fb923c;
  border: 1px solid rgba(251, 146, 60, 0.25);
  font-family: monospace;
}
.badge-style {
  background: rgba(168, 85, 247, 0.1);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.25);
}
.badge-genre {
  background: rgba(249, 115, 22, 0.1);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.25);
}
.project-meta {
  font-size: 0.75rem;
  color: #71717a;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}
.project-card-continue {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  color: #a5b4fc;
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
}
.project-card-assets {
  position: absolute;
  left: 28px;
  bottom: 24px;
  z-index: 3;
  display: inline-flex;
  width: 88px;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(199, 210, 254, 0.45);
  border-radius: 6px;
  background: rgba(9, 9, 14, 0.82);
  color: #e0e7ff;
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  backdrop-filter: blur(8px);
}
.project-card-assets:hover,
.project-card-assets:focus-visible {
  border-color: #a5b4fc;
  background: rgba(49, 46, 129, 0.92);
  color: #ffffff;
}
.project-card-assets:focus-visible {
  outline: 2px solid #c7d2fe;
  outline-offset: 2px;
}
.project-card-link:hover .project-card-continue,
.project-card-link:focus-visible .project-card-continue {
  color: #c7d2fe;
}
.project-menu-button {
  --el-button-size: 30px;
  color: #a1a1aa;
  margin-top: -2px;
  align-self: start;
}
.project-card-menu {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
}
.project-menu-button:hover,
.project-menu-button:focus-visible {
  color: #e4e4e7;
  background: rgba(99, 102, 241, 0.16);
}

html.light .project-card {
  background: #ffffff;
  border-color: #e1e5eb;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
  backdrop-filter: none;
}
html.light .project-card::before {
  background: transparent;
}
html.light .project-card:hover {
  border-color: #aeb6c2;
  background: #ffffff;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
}
html.light .project-card-cover {
  border-color: #e1e5eb;
  background: #f3f4f6;
  color: #6b7280;
}
html.light .project-card-cover--empty {
  background: #f8f7ff;
  border-color: #cfd3e1;
}
html.light .project-card-cover-placeholder .el-icon {
  color: #6366f1;
}
html.light .project-card-continue {
  color: #4f46e5;
}
html.light .project-card-assets {
  border-color: rgba(79, 70, 229, 0.4);
  background: rgba(255, 255, 255, 0.9);
  color: #4338ca;
}
html.light .project-card-assets:hover,
html.light .project-card-assets:focus-visible {
  border-color: #4f46e5;
  background: #eef2ff;
  color: #312e81;
}
html.light .project-card-link:hover .project-card-continue,
html.light .project-card-link:focus-visible .project-card-continue {
  color: #3730a3;
}

html.light .project-updated { color: #6b7280; }
html.light .project-title { color: #20242c; }
html.light .project-desc { color: #4b5563; }
html.light .project-meta { color: #6b7280; }
html.light .project-stat {
  background: #f8fafc;
  border-color: #e1e5eb;
  color: #6b7280;
}
html.light .project-stat strong { color: #20242c; }
html.light .project-stat--compact { color: #92400e; }
html.light .project-menu-button { color: #6b7280; }
html.light .project-menu-button:hover,
html.light .project-menu-button:focus-visible {
  color: #3730a3;
  background: rgba(79, 70, 229, 0.1);
}
html.light .badge-status--draft {
  background: rgba(107, 114, 128, 0.1);
  color: #4b5563;
  border-color: rgba(107, 114, 128, 0.25);
}

@media (max-width: 620px) {
  .project-card-topline {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
  .project-card-layout {
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 12px;
    min-height: 168px;
  }
  .project-card-cover {
    min-height: 168px;
  }
}
</style>
