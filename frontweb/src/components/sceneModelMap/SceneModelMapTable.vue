<template>
  <el-table
    v-loading="loading"
    :data="list"
    stripe
    style="width: 100%"
  >
    <el-table-column prop="key" label="场景键" min-width="220">
      <template #default="{ row }">
        <div class="scene-key-cell">
          <span class="scene-key-label">{{ getSceneKeyLabel(row.key) || row.key }}</span>
        </div>
      </template>
    </el-table-column>
    <el-table-column prop="service_type" label="服务类型" width="120">
      <template #default="{ row }">
        <el-tag :type="serviceTypeTagType(row.service_type)" size="small">
          {{ serviceTypeLabel(row.service_type) }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="config_name" label="AI 配置" min-width="220">
      <template #default="{ row }">
        <div class="config-availability">
          <el-tag v-if="!row.config_id" type="info" size="small">使用默认配置</el-tag>
          <template v-else>
            <span>{{ row.config_name || ('配置 #' + row.config_id) }}</span>
            <el-tag v-if="row.config_missing" type="danger" size="small">绑定配置不可用</el-tag>
            <el-tag v-else-if="row.config_inactive" type="warning" size="small">绑定配置已停用</el-tag>
            <el-tag v-else-if="row.config_type_mismatch" type="warning" size="small">服务类型不匹配</el-tag>
          </template>
        </div>
      </template>
    </el-table-column>
    <el-table-column prop="model_override" label="模型覆盖" min-width="180">
      <template #default="{ row }">
        <span v-if="row.model_override" class="model-override">{{ row.model_override }}</span>
        <span v-else class="text-muted">使用配置默认模型</span>
      </template>
    </el-table-column>
    <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
    <el-table-column label="操作" width="150" fixed="right">
      <template #default="{ row }">
        <el-button
          link
          type="primary"
          size="small"
          :disabled="writeLocked" :title="writeLocked ? writeLockReason : undefined"
          :aria-label="`编辑场景「${getSceneKeyLabel(row.key) || row.key}」的模型映射`"
          @click="$emit('edit', row)"
        >编辑</el-button>
        <el-button
          link
          type="danger"
          size="small"
          :disabled="writeLocked" :title="writeLocked ? writeLockReason : undefined"
          :aria-label="`删除场景「${getSceneKeyLabel(row.key) || row.key}」的模型映射`"
          @click="$emit('delete', row)"
        >删除</el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup>
import { getSceneKeyLabel, serviceTypeLabel, serviceTypeTagType } from './sceneModelMapCatalog.js'

defineProps({
  list: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  writeLocked: { type: Boolean, default: false },
  writeLockReason: { type: String, default: '' },
})

defineEmits(['edit', 'delete'])
</script>

<style scoped>
.scene-key-label {
  font-size: 14px;
  color: #303133;
}
.model-override {
  background: #e6f7ff;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #096dd9;
}
.text-muted {
  color: #999;
  font-size: 13px;
}
.scene-key-cell,
.config-availability {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
