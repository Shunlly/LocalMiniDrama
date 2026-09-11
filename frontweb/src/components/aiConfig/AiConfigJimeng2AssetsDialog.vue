<template>
  <AccessibleDialog
    v-model="jimeng2AssetsDialogVisible"
    title="素材库列表"
    width="720px"
    class="jimeng2-assets-dialog ai-config-overlay"
    destroy-on-close
    @closed="onJimeng2AssetsDialogClosed"
  >
    <p class="field-tip" style="margin-top: 0">
      文档：
      <a href="https://83zi.com/sd2realperson.html" target="_blank" rel="noopener noreferrer">SilvaMux 素材管理 API</a>
      ；仅启用中的素材可用于 Seedance 2.0 视频引用。
    </p>
    <el-table v-loading="jimeng2AssetsLoading" :data="jimeng2AssetsRows" stripe max-height="420" empty-text="暂无数据或未加载">
      <el-table-column prop="id" label="素材 ID" min-width="120" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" width="100" show-overflow-tooltip />
      <el-table-column prop="asset_type" label="类型" width="88">
        <template #default="{ row }">{{ jimeng2AssetTypeLabel(row.asset_type) }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="96">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" size="small">
            {{ jimeng2AssetStatusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="asset_url" label="素材地址" min-width="160" show-overflow-tooltip />
      <el-table-column prop="url" label="原始地址" min-width="120" show-overflow-tooltip />
      <el-table-column prop="created_at" label="创建时间" width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ formatJimeng2AssetCreatedAt(row.created_at) || '未知时间' }}</template>
      </el-table-column>
    </el-table>
    <div v-if="jimeng2AssetsHasMore" style="margin-top: 12px; text-align: center">
      <el-button :loading="jimeng2AssetsLoading" :aria-label="jimeng2AssetsLoading ? '正在加载更多' : '加载更多素材'" @click="loadMoreJimeng2MaterialAssets">加载更多</el-button>
    </div>
    <template #footer>
      <el-button aria-label="关闭素材列表" @click="jimeng2AssetsDialogVisible = false">关闭</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import {
  jimeng2AssetTypeLabel,
  jimeng2AssetStatusLabel,
} from '@/utils/aiConfigLabels.js'

defineOptions({ inheritAttrs: false })

defineProps({
  jimeng2AssetsLoading: { type: Boolean, default: false },
  jimeng2AssetsRows: { type: Array, default: () => [] },
  jimeng2AssetsHasMore: { type: Boolean, default: false },
  formatJimeng2AssetCreatedAt: { type: Function, required: true },
  loadMoreJimeng2MaterialAssets: { type: Function, required: true },
  onJimeng2AssetsDialogClosed: { type: Function, required: true },
})

const jimeng2AssetsDialogVisible = defineModel('jimeng2AssetsDialogVisible', { type: Boolean, default: false })
</script>

<style scoped>
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
</style>
