<template>
  <div class="batch-import-panel">
    <template v-if="previewEpisodes.length">
      <div class="batch-import-preview-header">
        <span>共识别 {{ previewChapters.length }} 章，预计导入 {{ previewEpisodes.length }} 集</span>
      </div>
      <el-table :data="previewEpisodes" border stripe height="420" class="batch-import-preview-table">
        <el-table-column prop="episode_number" label="集数" width="80" align="center" />
        <el-table-column prop="title" label="集标题" min-width="220" show-overflow-tooltip />
        <el-table-column label="包含章节" min-width="260" show-overflow-tooltip>
          <template #default="scope">
            {{ scope.row.chapter_titles.join('、') || '未识别章节标题' }}
          </template>
        </el-table-column>
        <el-table-column label="内容预览" min-width="320" show-overflow-tooltip>
          <template #default="scope">
            <div class="batch-import-preview-cell batch-import-preview-cell--single-line">
              {{ scope.row.script_content || '暂无内容' }}
            </div>
          </template>
        </el-table-column>
      </el-table>
    </template>
    <div v-else class="batch-import-empty" role="status">
      <strong>还没有可导入的集数预览</strong>
      <p>请先在「导入设置」中选择 TXT 文件，再点击「确认导入配置」。</p>
      <el-button type="primary" plain @click="emit('back')">返回导入设置</el-button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  previewChapters: { type: Array, default: () => [] },
  previewEpisodes: { type: Array, default: () => [] },
})

const emit = defineEmits(['back'])
</script>

<style scoped>
.batch-import-panel { display: flex; flex-direction: column; gap: 16px; min-height: 420px; }
.batch-import-empty { min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; color: #71717a; border: 1px dashed #3f3f46; border-radius: 12px; text-align: center; }
.batch-import-empty strong { color: #e4e4e7; font-size: 0.95rem; }
.batch-import-empty p { margin: 0; line-height: 1.6; }
.batch-import-preview-header { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-bottom: 12px; color: #c084fc; font-size: 0.85rem; flex-wrap: wrap; }
.batch-import-preview-table :deep(.el-table) { --el-table-bg-color: transparent; --el-table-tr-bg-color: transparent; --el-table-border-color: #3f3f46; --el-table-header-bg-color: rgba(39, 39, 42, 0.9); --el-table-row-hover-bg-color: rgba(139, 92, 246, 0.08); color: #e4e4e7; }
.batch-import-preview-table :deep(.el-table__inner-wrapper::before) { display: none; }
.batch-import-preview-table :deep(th.el-table__cell) { color: #fafafa; }
.batch-import-preview-table :deep(td.el-table__cell) { vertical-align: top; }
.batch-import-preview-cell { line-height: 1.6; white-space: pre-wrap; color: #d4d4d8; }
.batch-import-preview-cell--single-line { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
</style>
