<template>
  <section class="section card script-workbench-unified">
    <el-tabs v-model="scriptWorkbenchMode" class="script-workbench-tabs">
      <el-tab-pane label="创作剧本" name="create">
        <div class="script-pane-inner">
          <div class="script-sub-block">
            <h2 class="section-title">故事生成</h2>
            <p class="section-desc">输入一段故事梗概，AI 帮你扩写成完整剧本，或直接导入小说章节</p>
            <el-input
              v-model="storyInput"
              type="textarea"
              :rows="4"
              placeholder="例如：一个少女在森林里遇见会说话的狐狸，一起寻找失落的宝石..."
              class="story-textarea"
            />
            <div class="row gap" style="margin-top: 10px; flex-wrap: wrap;">
              <el-select v-model="storyStyle" aria-label="故事风格" placeholder="故事风格" clearable style="width: 120px" @change="emit('save-settings')">
                <el-option label="现代" value="modern" />
                <el-option label="古风" value="ancient" />
                <el-option label="奇幻" value="fantasy" />
                <el-option label="日常" value="daily" />
              </el-select>
              <el-select v-model="storyType" aria-label="故事生成剧本类型" placeholder="剧本类型" clearable style="width: 120px" @change="emit('save-settings')">
                <el-option label="剧情" value="drama" />
                <el-option label="喜剧" value="comedy" />
                <el-option label="冒险" value="adventure" />
              </el-select>
              <div style="display:flex;align-items:center;gap:6px;font-size:13px">
                <span>集数</span>
                <el-input-number
                  v-model="storyEpisodeCount"
                  aria-label="故事生成集数"
                  :min="1"
                  :step="1"
                  :precision="0"
                  controls-position="right"
                  style="width: 100px"
                />
              </div>
              <el-button type="primary" :loading="isStoryGenRunning" @click="emit('generate-story')">
                生成剧本
              </el-button>
              <el-button plain @click="emit('open-novel-import')">
                <el-icon><DocumentAdd /></el-icon>
                导入小说
              </el-button>
            </div>
          </div>
          <div class="script-sub-divider" />
          <div id="anchor-script" class="script-sub-block">
            <h2 class="section-title">剧本</h2>
            <div
              v-if="dramaId && !hasAnyEpisode"
              class="empty-tip film-episode-empty"
              role="status"
            >
              <p class="film-episode-empty-title">还没有剧集</p>
              <p>可以点「添加一集」开始手写剧本，或在上方输入故事梗概后生成剧本。</p>
              <div class="film-episode-empty-actions">
                <el-button type="primary" @click="emit('add-episode')">添加一集</el-button>
                <el-button @click="emit('go-to-drama')">返回剧集管理</el-button>
              </div>
            </div>
            <div class="row gap" style="margin-bottom: 10px; flex-wrap: wrap;">
              <el-input v-model="scriptTitle" placeholder="集标题" style="width: 150px" />
              <el-button v-if="dramaId" style="margin-left: auto" aria-label="添加一集" @click="emit('add-episode')">
                <el-icon><Plus /></el-icon>添加一集
              </el-button>
            </div>
            <el-input
              v-model="scriptContent"
              type="textarea"
              :rows="8"
              placeholder="剧本内容将显示在这里，可直接编辑..."
              class="story-textarea"
            />
            <div class="row gap" style="margin-top: 8px; flex-wrap: wrap;">
              <el-button
                :loading="scriptGenerating"
                :disabled="!!dramaId && hasAnyEpisode && !currentEpisodeId"
                @click="emit('generate-script')"
              >
                保存当前集
              </el-button>
              <span
                class="script-save-status"
                :class="`is-${scriptDraftStatus}`"
                role="status"
                aria-live="polite"
              >{{ scriptDraftStatusLabel }}</span>
            </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="选择剧本" name="select">
        <p class="section-desc script-mode-hint">
          从剧本库选择后，仅把「故事梗概」与「各集剧本正文」写入当前工程，不会导入角色、分镜、图片或视频。
        </p>
        <el-button type="primary" @click="emit('open-select-script')">
          <el-icon><Document /></el-icon>
          从已有剧本中选择…
        </el-button>
        <div v-if="dramaId && (episodes.length || storyInput)" class="script-preview-wrap">
          <h3 class="preview-block-title">故事梗概</h3>
          <el-input
            :model-value="storyInput"
            type="textarea"
            :rows="3"
            readonly
            class="story-textarea"
          />
          <template v-if="episodes.length > 1">
            <h3 class="preview-block-title">分集剧本</h3>
            <el-tabs v-model="selectPreviewEpisodeId" class="preview-ep-tabs">
              <el-tab-pane
                v-for="ep in episodes"
                :key="ep.id"
                :label="ep.title || ('第' + (ep.episode_number || 0) + '集')"
                :name="String(ep.id)"
              >
                <el-input
                  :model-value="ep.script_content || ''"
                  type="textarea"
                  :rows="12"
                  readonly
                  class="story-textarea"
                />
              </el-tab-pane>
            </el-tabs>
          </template>
          <template v-else>
            <h3 class="preview-block-title">剧本正文</h3>
            <el-input
              :model-value="scriptContent"
              type="textarea"
              :rows="12"
              readonly
              class="story-textarea"
            />
          </template>
          <div class="preview-actions">
            <el-button type="primary" plain @click="scriptWorkbenchMode = 'create'">切换到创作剧本以编辑</el-button>
          </div>
        </div>
        <p v-else class="script-select-empty">尚未选择剧本，请点击上方按钮</p>
      </el-tab-pane>
    </el-tabs>
  </section>

  <AccessibleDialog
    v-model="showSelectScriptDialog"
    title="从剧本库导入"
    width="640px"
    destroy-on-close
    @open="emit('load-select-script-list')"
  >
    <div v-loading="selectScriptLoading || selectScriptImporting" class="select-script-list">
      <button
        type="button"
        v-for="d in selectableScriptDramas"
        :key="d.id"
        class="select-script-item"
        :class="{ disabled: selectScriptImporting }"
        :disabled="selectScriptImporting"
        @click="!selectScriptImporting && emit('pick-script', d.id)"
      >
        <span class="select-script-title">{{ d.title || '未命名' }}</span>
        <span class="select-script-desc">{{ (d.description || '暂无简介').slice(0, 200) }}{{ (d.description && d.description.length > 200) ? '…' : '' }}</span>
      </button>
      <div v-if="!selectScriptLoading && selectScriptDramas.length === 0" class="select-script-empty">
        <p>剧本库为空，可直接在当前项目创作剧本</p>
        <el-button type="primary" @click="emit('return-to-creation')">开始创作剧本</el-button>
      </div>
      <div v-else-if="!selectScriptLoading && selectableScriptDramas.length === 0" class="select-script-empty">
        <p>没有可导入的其他剧本</p>
        <el-button type="primary" @click="emit('return-to-creation')">返回创作剧本</el-button>
      </div>
    </div>
  </AccessibleDialog>
</template>

<script setup>
import { Document, DocumentAdd, Plus } from '@element-plus/icons-vue'

defineOptions({ inheritAttrs: false })

defineProps({
  isStoryGenRunning: { type: Boolean, default: false },
  dramaId: { type: [Number, String], default: null },
  hasAnyEpisode: { type: Boolean, default: false },
  scriptGenerating: { type: Boolean, default: false },
  currentEpisodeId: { type: [Number, String], default: null },
  episodes: { type: Array, default: () => [] },
  scriptDraftStatus: { type: String, default: 'saved' },
  scriptDraftStatusLabel: { type: String, default: '已保存' },
  selectScriptLoading: { type: Boolean, default: false },
  selectScriptImporting: { type: Boolean, default: false },
  selectableScriptDramas: { type: Array, default: () => [] },
  selectScriptDramas: { type: Array, default: () => [] },
})

const scriptWorkbenchMode = defineModel('scriptWorkbenchMode', { type: String, default: 'create' })
const storyInput = defineModel('storyInput', { type: String, default: '' })
const storyStyle = defineModel('storyStyle', { type: String, default: '' })
const storyType = defineModel('storyType', { type: String, default: '' })
const storyEpisodeCount = defineModel('storyEpisodeCount', { type: Number, default: 1 })
const scriptTitle = defineModel('scriptTitle', { type: String, default: '' })
const scriptContent = defineModel('scriptContent', { type: String, default: '' })
const showSelectScriptDialog = defineModel('showSelectScriptDialog', { type: Boolean, default: false })
const selectPreviewEpisodeId = defineModel('selectPreviewEpisodeId', { type: String, default: '' })

const emit = defineEmits([
  'save-settings',
  'generate-story',
  'open-novel-import',
  'add-episode',
  'go-to-drama',
  'generate-script',
  'open-select-script',
  'load-select-script-list',
  'pick-script',
  'return-to-creation',
])
</script>

<style scoped>
.section {
  margin-bottom: 24px;
}
.card {
  background: #1e1f28;
  border-radius: 14px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
}
.card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
}
html.light .card {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  border-color: rgba(139, 92, 246, 0.08);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 4px 20px rgba(99, 102, 241, 0.05);
}
html.light .card:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 36px rgba(99, 102, 241, 0.08);
}
.section-title {
  font-size: 1.05rem;
  margin: 0 0 4px;
  color: #f4f4f5;
  font-weight: 600;
  letter-spacing: -0.01em;
}
html.light .section-title { color: #1e1b4b; }
.section-desc {
  color: #52525b;
  font-size: 0.82rem;
  margin: 0 0 14px;
  line-height: 1.5;
}
html.light .section-desc { color: #6b7280; }
.story-textarea {
  margin-bottom: 12px;
}
.row { display: flex; flex-wrap: wrap; align-items: center; }
.gap { gap: 12px; }
.empty-tip {
  color: #5a5a66;
  font-size: 0.9rem;
  padding: 16px 0;
}
html.light .empty-tip {
  color: #9ca3af;
}
.script-workbench-unified {
  margin-bottom: 0;
}
.script-workbench-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.script-workbench-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}
.script-workbench-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 600;
}
.script-pane-inner {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.script-sub-block {
  padding-top: 4px;
}
.script-sub-divider {
  margin: 20px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
html.light .script-sub-divider {
  border-top-color: rgba(0, 0, 0, 0.08);
}
.script-mode-hint {
  margin-top: 0;
  margin-bottom: 12px;
}
.script-preview-wrap {
  margin-top: 20px;
}
.preview-block-title {
  margin: 16px 0 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: #a1a1aa;
}
html.light .preview-block-title {
  color: #64748b;
}
.preview-block-title:first-of-type {
  margin-top: 0;
}
.preview-actions {
  margin-top: 16px;
}
.script-select-empty {
  margin-top: 16px;
  color: #71717a;
  font-size: 14px;
}
.select-script-list {
  min-height: 120px;
  max-height: 420px;
  overflow-y: auto;
}
.select-script-item {
  width: 100%;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.select-script-item:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.select-script-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(99, 102, 241, 0.35);
}
.select-script-item.disabled,
.select-script-item.disabled:hover {
  cursor: not-allowed;
  opacity: 0.55;
  border-color: rgba(255, 255, 255, 0.06);
  background: transparent;
}
html.light .select-script-item {
  border-color: rgba(99, 102, 241, 0.15);
}
html.light .select-script-item:hover {
  background: rgba(99, 102, 241, 0.06);
}
.select-script-title {
  display: block;
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 6px;
}
html.light .select-script-title {
  color: #1e1b4b;
}
.select-script-desc {
  display: block;
  font-size: 13px;
  color: #9ca0b2;
  line-height: 1.45;
}
.select-script-empty {
  text-align: center;
  color: #71717a;
  padding: 24px;
}
.select-script-empty p {
  margin: 0 0 12px;
}
.preview-ep-tabs {
  margin-top: 4px;
}
.film-episode-empty {
  margin: 0 0 12px;
}
.film-episode-empty-title {
  margin: 0 0 6px;
  font-weight: 600;
  color: var(--text-primary);
}
.film-episode-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.script-save-status {
  align-self: center;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.script-save-status.is-dirty,
.script-save-status.is-error {
  color: var(--status-warning);
}
.script-save-status.is-saving {
  color: var(--accent-text);
}
</style>
