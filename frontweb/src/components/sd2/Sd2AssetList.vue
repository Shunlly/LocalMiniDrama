<template>
  <div class="sd2-asset-list">
    <div class="panel-title">资产（需组编号）</div>
    <div class="panel-actions row-gap">
      <Sd2AssetFilter v-model="assetGroupIdInput" />
      <el-button type="primary" size="small" :loading="loadingAssets" :disabled="Boolean(refreshAssetsLockReason)" :title="refreshAssetsLockReason" :aria-label="loadingAssets ? '正在刷新资产列表' : (refreshAssetsLockReason || '刷新资产列表')" @click="refreshAssets">刷新资产列表</el-button>
      <el-button type="success" size="small" :disabled="mutationLocked" :title="mutationLocked ? mutationLockReason : undefined" :aria-label="mutationLocked ? mutationLockReason : '新建资产'" @click="openCreateAsset">新建资产</el-button>
    </div>
    <el-table :data="assetRows" size="small" stripe max-height="320">
      <el-table-column prop="Id" label="标识" min-width="120" show-overflow-tooltip />
      <el-table-column prop="Name" label="名称" min-width="90" show-overflow-tooltip />
      <el-table-column prop="AssetType" label="类型" width="88">
        <template #default="{ row }">{{ assetTypeLabel(row.AssetType) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="168" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" :aria-label="`查看资产${row.name || row.id || '详情'}`" @click="getAssetDetail(row)">详情</el-button>
          <el-button link type="primary" size="small" :disabled="mutationLocked" :title="mutationLocked ? mutationLockReason : undefined" :aria-label="mutationLocked ? mutationLockReason : `编辑资产${row.name || row.id || ''}`" @click="openEditAsset(row)">编辑</el-button>
          <el-button link type="danger" size="small" :disabled="mutationLocked" :title="mutationLocked ? mutationLockReason : undefined" :aria-label="mutationLocked ? mutationLockReason : `删除资产${row.name || row.id || ''}`" @click="deleteAsset(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import Sd2AssetFilter from './Sd2AssetFilter.vue'

// 展示组编号筛选与资产列表；筛选输入交给 Sd2AssetFilter，拉取和写操作仍留在认证资产管理页。
const assetGroupIdInput = defineModel('assetGroupIdInput', { type: String, default: '' })

defineProps({
  assetRows: { type: Array, default: () => [] },
  loadingAssets: { type: Boolean, default: false },
  mutationLocked: { type: Boolean, default: false },
  mutationLockReason: { type: String, default: undefined },
  refreshAssetsLockReason: { type: String, default: undefined },
  refreshAssets: { type: Function, required: true },
  openCreateAsset: { type: Function, required: true },
  getAssetDetail: { type: Function, required: true },
  openEditAsset: { type: Function, required: true },
  deleteAsset: { type: Function, required: true },
})

function assetTypeLabel(type) {
  return ({ Image: '图片', Video: '视频', Audio: '音频' }[type] || type || '')
}
</script>

<style scoped>
.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.panel-actions.row-gap {
  flex-wrap: nowrap;
}
</style>
