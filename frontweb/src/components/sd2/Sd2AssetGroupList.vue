<template>
  <div class="sd2-asset-group-list">
    <div class="panel-title">资产组</div>
    <div class="panel-actions">
      <el-button type="primary" size="small" :loading="loadingGroups" :disabled="Boolean(refreshGroupsLockReason)" :title="refreshGroupsLockReason" @click="refreshGroups">刷新列表</el-button>
      <el-button type="success" size="small" :disabled="mutationLocked" :title="mutationLocked ? mutationLockReason : undefined" @click="openCreateGroup">新建组</el-button>
    </div>
    <el-table
      :data="groupRows"
      size="small"
      stripe
      highlight-current-row
      max-height="320"
      @current-change="onGroupRowChange"
    >
      <el-table-column prop="Id" label="标识" min-width="120" show-overflow-tooltip />
      <el-table-column prop="Name" label="名称" min-width="100" show-overflow-tooltip />
      <el-table-column label="操作" width="168" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="getGroupDetail(row)">详情</el-button>
          <el-button link type="primary" size="small" :disabled="mutationLocked" :title="mutationLocked ? mutationLockReason : undefined" @click="openEditGroup(row)">编辑</el-button>
          <el-button link type="danger" size="small" :disabled="mutationLocked" :title="mutationLocked ? mutationLockReason : undefined" @click="deleteGroup(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
// 仅展示资产组列表；刷新、点选和写操作仍留在认证资产管理页。
defineProps({
  groupRows: { type: Array, default: () => [] },
  loadingGroups: { type: Boolean, default: false },
  mutationLocked: { type: Boolean, default: false },
  mutationLockReason: { type: String, default: undefined },
  refreshGroupsLockReason: { type: String, default: undefined },
  refreshGroups: { type: Function, required: true },
  openCreateGroup: { type: Function, required: true },
  getGroupDetail: { type: Function, required: true },
  openEditGroup: { type: Function, required: true },
  deleteGroup: { type: Function, required: true },
  onGroupRowChange: { type: Function, required: true },
})
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
</style>
