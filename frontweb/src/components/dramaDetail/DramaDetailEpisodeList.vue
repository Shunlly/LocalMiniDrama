<template>
      <!-- 分集列表 -->
      <section id="episode-list" class="section card" tabindex="-1">
        <div class="section-header">
          <div class="section-title">分集列表</div>
          <span class="section-count">共 {{ episodes.length }} 集</span>
          <EpisodeBatchImportDialog
            ref="episodeBatchImportDialogRef"
            :start-episode-number="nextEpisodeNumber"
            :import-handler="onBatchImportEpisodes"
            style="margin-left: auto"
            @import="onBatchImportEpisodes"
          />
          <el-button size="small" type="primary" :loading="addingEpisode" aria-label="新增一集" @click="onAddEpisode">
            <el-icon><Plus /></el-icon>新增一集
          </el-button>
        </div>
        <div v-if="episodes.length === 0" class="empty-state" role="status" aria-live="polite">
          <div class="empty-state-title">{{ episodeEmptyState.title }}</div>
          <div class="empty-state-copy">{{ episodeEmptyState.description }}</div>
          <div class="empty-state-actions">
            <el-tooltip :content="episodeEmptyState.primaryDisabledReason" :disabled="!episodeEmptyState.primaryDisabledReason" placement="top">
              <span
                class="tooltip-trigger"
                :tabindex="episodeEmptyState.primaryDisabledReason ? 0 : undefined"
                :aria-label="episodeEmptyState.primaryDisabledReason ? `${episodeEmptyState.primaryAction.label}不可用：${episodeEmptyState.primaryDisabledReason}` : undefined"
              >
                <el-button
                  type="primary"
                  :disabled="Boolean(episodeEmptyState.primaryDisabledReason)"
                  :title="episodeEmptyState.primaryDisabledReason || undefined"
                  :aria-describedby="episodeEmptyState.primaryDisabledReason || episodeEmptyState.note ? 'episode-empty-reason' : undefined"
                  :aria-label="episodeEmptyState.primaryDisabledReason ? `${episodeEmptyState.primaryAction.label}不可用：${episodeEmptyState.primaryDisabledReason}` : episodeEmptyState.primaryAction.label" @click="handleReadinessAction(episodeEmptyState.primaryAction)"
                >
                  {{ episodeEmptyState.primaryAction.label }}
                </el-button>
              </span>
            </el-tooltip>
            <el-button v-if="episodeEmptyState.unblockAction" :aria-label="episodeEmptyState.unblockAction.label" @click="handleReadinessAction(episodeEmptyState.unblockAction)">
              {{ episodeEmptyState.unblockAction.label }}
            </el-button>
            <el-button aria-label="批量导入剧本" @click="openEpisodeBatchImport">批量导入剧本</el-button>
            <el-button
              v-if="episodeEmptyState.primaryAction?.id !== 'create_blank_episode' && episodeEmptyState.primaryAction?.target !== 'add-episode'"
              :loading="addingEpisode"
              aria-label="新增空白集"
              @click="onAddEpisode"
            >
              <el-icon><Plus /></el-icon>新增空白集
            </el-button>
          </div>
          <div v-if="episodeEmptyState.primaryDisabledReason || episodeEmptyState.note" id="episode-empty-reason" class="empty-state-note">{{ episodeEmptyState.primaryDisabledReason || episodeEmptyState.note }}</div>
        </div>
        <div v-else class="episode-grid">
          <article
            v-for="ep in episodes"
            :key="ep.id"
            class="episode-card"
          >
            <el-button
              class="episode-card-delete"
              size="small"
              type="danger"
              plain
              circle
              :icon="Delete"
              :loading="deletingEpisodeId === ep.id"
              :aria-label="`删除第 ${ep.episode_number ?? ep.number ?? '?'} 集`"
              :title="`删除第 ${ep.episode_number ?? ep.number ?? '?'} 集`"
              @click.stop="onDeleteEpisode(ep)"
            />
            <RouterLink
              class="episode-card-main"
              :to="{ path: `/film/${dramaId}`, query: withProjectListReturnTo({ episode: String(ep.id) }) }"
              :aria-label="`进入第 ${ep.episode_number ?? ep.number ?? '未知'} 集「${ep.title || '未命名'}」制作`"
            >
              <span class="episode-num">第 {{ ep.episode_number ?? ep.number ?? '?' }} 集</span>
              <div class="episode-title">{{ ep.title || '未命名' }}</div>
              <div class="episode-preview">{{ (ep.script_content || '').slice(0, 20) || '暂无剧本' }}</div>
              <div class="episode-stats">
                <span class="ep-stat">
                  <span class="ep-stat-num">{{ ep.storyboards?.length ?? 0 }}</span> 分镜
                </span>
                <span v-if="ep.status" class="ep-stat ep-stat--status" :class="'ep-status--' + ep.status">{{ epStatusLabel(ep.status) }}</span>
              </div>
              <span class="episode-enter">
                <el-icon class="episode-enter-icon"><VideoPlay /></el-icon>
                进入制作
              </span>
            </RouterLink>
          </article>
        </div>
      </section>
</template>

<script setup>
import { ref } from 'vue'
import { Delete, Plus, VideoPlay } from '@element-plus/icons-vue'
import EpisodeBatchImportDialog from '@/components/EpisodeBatchImportDialog.vue'

// 分集列表只负责展示，新增、删除和批量导入仍由页面处理

defineProps({
  episodes: { type: Array, default: () => [] },
  episodeEmptyState: { type: Object, required: true },
  nextEpisodeNumber: { type: Number, default: 1 },
  addingEpisode: { type: Boolean, default: false },
  deletingEpisodeId: { default: null },
  dramaId: { type: [Number, String], required: true },
  withProjectListReturnTo: { type: Function, required: true },
  epStatusLabel: { type: Function, required: true },
  onAddEpisode: { type: Function, required: true },
  onDeleteEpisode: { type: Function, required: true },
  onBatchImportEpisodes: { type: Function, required: true },
  openEpisodeBatchImport: { type: Function, required: true },
  handleReadinessAction: { type: Function, required: true },
})

const episodeBatchImportDialogRef = ref(null)

defineExpose({
  openDialog: (...args) => episodeBatchImportDialogRef.value?.openDialog?.(...args),
  hasUnsavedWork: (...args) => episodeBatchImportDialogRef.value?.hasUnsavedWork?.(...args),
  isImporting: (...args) => episodeBatchImportDialogRef.value?.isImporting?.(...args),
  requestClose: (...args) => episodeBatchImportDialogRef.value?.requestClose?.(...args),
})
</script>

<style scoped>
#episode-list {
  scroll-margin-top: 120px;
}
/* 分区卡片外观与页内其他卡片保持一致 */
.section.card {
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  transition: box-shadow 0.3s, border-color 0.3s;
}
.section.card:hover {
  border-color: rgba(139, 92, 246, 0.25);
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.08);
}
html.light .section.card {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .section.card:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 6px 28px rgba(139, 92, 246, 0.1);
}
.section-title { font-size: 1rem; font-weight: 600; color: #fafafa; margin-bottom: 16px; }
html.light .section-title { color: #18181b; }
.section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.section-header .section-title { margin-bottom: 0; }

.section-count { color: #71717a; font-size: 0.85rem; }
.empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 34px 24px;
  border: 1px dashed var(--border-muted);
  background: var(--bg-inner);
  text-align: center;
}
.empty-state-title { color: var(--text-primary); font-size: 15px; font-weight: 600; }
.empty-state-copy { max-width: 620px; color: var(--text-subtle); font-size: 12px; line-height: 1.6; }
.empty-state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 8px; }
.empty-state-note { color: var(--status-warning); font-size: 11px; line-height: 1.5; }
.tooltip-trigger { display: inline-flex; }
.tooltip-trigger:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }

/* 分集卡片 */
.episode-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.episode-card {
  background: rgba(28, 28, 30, 0.8);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 12px;
  padding: 16px;
  transition: border-color 0.25s, transform 0.2s, box-shadow 0.25s, background 0.2s;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.episode-card-delete {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
}
.episode-card-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding-right: 36px;
  color: inherit;
  text-decoration: none;
}
.episode-card-main:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.episode-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.06), transparent 60%);
  opacity: 0;
  transition: opacity 0.25s;
  pointer-events: none;
}
.episode-card:hover {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(35, 35, 38, 0.9);
  transform: translateY(-3px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(139, 92, 246, 0.15);
}
.episode-card:hover::before { opacity: 1; }
.episode-card:hover .episode-enter {
  color: var(--el-color-primary);
  opacity: 1;
}
.episode-card:hover .episode-enter-icon {
  transform: translateX(3px);
}
.episode-enter {
  width: 100%;
  margin-top: 10px;
  padding-top: 8px;
  padding-right: 0;
  padding-bottom: 0;
  padding-left: 0;
  border: 0;
  border-top: 1px solid var(--border-color);
  background: transparent;
  font-size: 0.78rem;
  color: var(--el-color-primary);
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 1;
  transition: color 0.2s, opacity 0.2s;
}
.episode-enter:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 4px;
}
.episode-enter-icon {
  font-size: 0.85rem;
  transition: transform 0.2s;
}
.episode-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.episode-num { font-size: 0.8rem; color: #71717a; }
.episode-title { font-weight: 500; color: #fafafa; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.episode-preview { font-size: 0.78rem; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px; }
.episode-stats { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ep-stat { font-size: 0.72rem; color: #71717a; }
.ep-stat-num { color: #38bdf8; font-weight: 600; }
.ep-stat--status { padding: 1px 7px; border-radius: 99px; font-size: 0.7rem; }
.ep-status--draft { background: rgba(113,113,122,0.15); color: #a1a1aa; }
.ep-status--processing { background: rgba(234,179,8,0.12); color: #fcd34d; }
.ep-status--completed { background: rgba(34,197,94,0.12); color: #4ade80; }
.ep-status--failed { background: rgba(239,68,68,0.12); color: #f87171; }

html.light .episode-card { background: rgba(255, 255, 255, 0.85); border-color: rgba(139, 92, 246, 0.12); }
html.light .episode-card:hover { background: rgba(245, 243, 255, 0.95); border-color: rgba(139, 92, 246, 0.4); box-shadow: 0 8px 24px rgba(139, 92, 246, 0.12); }
html.light .episode-card::before { background: linear-gradient(135deg, rgba(139, 92, 246, 0.05), transparent 60%); }
html.light .episode-enter { border-top-color: #e4e4e7; color: var(--el-color-primary); }
html.light .episode-card:hover .episode-enter { color: var(--el-color-primary); }
html.light .episode-title { color: #18181b; }

#episode-list {
  scroll-margin-top: 120px;
}

@media (max-width: 760px) {
  .section.card {
    padding: 16px;
  }
  .section-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}

</style>
