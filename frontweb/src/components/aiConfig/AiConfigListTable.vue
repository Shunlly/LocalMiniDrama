<template>
  <el-table
    v-loading="loading"
    :data="rows"
    stripe
    style="width: 100%"
    aria-label="AI 服务配置列表"
    :aria-busy="loading || vendorLockLoading || configListPendingEmpty"
    @selection-change="onSelectionChange"
  >
    <el-table-column v-if="!vendorLock.enabled" type="selection" width="46" :selectable="isConfigRowSelectable" />
    <el-table-column prop="name" label="名称" min-width="220" show-overflow-tooltip />
    <el-table-column prop="provider" label="提供商" min-width="180" show-overflow-tooltip />
    <el-table-column prop="base_url" label="接口地址（Base URL）" min-width="170" show-overflow-tooltip />
    <el-table-column prop="default_model" label="默认模型" min-width="130" show-overflow-tooltip>
      <template #default="{ row }">
        {{ row.default_model || (Array.isArray(row.model) && row.model[0]) || '—' }}
      </template>
    </el-table-column>
    <el-table-column prop="service_type" label="类型" width="148">
      <template #default="{ row }">
        <span :class="['type-badge', 'type-' + row.service_type]">
          <el-icon class="type-icon">
            <ChatDotRound v-if="row.service_type === 'text'" />
            <Picture v-else-if="row.service_type === 'image'" />
            <Film v-else-if="row.service_type === 'storyboard_image'" />
            <VideoCamera v-else-if="row.service_type === 'video'" />
            <Microphone v-else-if="row.service_type === 'tts'" />
            <Document v-else-if="row.service_type === 'ocr'" />
            <Headset v-else-if="row.service_type === 'transcription'" />
            <Key v-else-if="row.service_type === 'jimeng2_character_auth'" />
            <Folder v-else-if="row.service_type === 'model_ark_asset'" />
          </el-icon>
          {{ serviceTypeLabel(row.service_type) }}
        </span>
      </template>
    </el-table-column>
    <el-table-column prop="is_default" label="默认" width="60">
      <template #default="{ row }">
        <el-tag v-if="row.is_default" type="success" size="small">✓</el-tag>
        <span v-else class="no-default">—</span>
      </template>
    </el-table-column>
    <el-table-column label="操作" width="180" fixed="right">
      <template #default="{ row }">
        <el-button link type="primary" size="small" :aria-label="configActionLabel('测试', row)" @click="openTest(row)">测试</el-button>
        <el-button link type="primary" size="small" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" :aria-label="configActionLabel(vendorLock.enabled ? '修改密钥' : '编辑', row)" @click="onRowEdit(row)">{{ vendorLock.enabled ? '修改密钥' : '编辑' }}</el-button>
        <el-button v-if="!vendorLock.enabled" link type="danger" size="small" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" :aria-label="configActionLabel('删除', row)" @click="onDelete(row)">删除</el-button>
      </template>
    </el-table-column>
    <template #empty>
      <div
        class="config-empty-state"
        :role="configListFailedEmpty ? 'alert' : 'status'"
        :aria-live="configListFailedEmpty ? 'assertive' : 'polite'"
        :aria-busy="configListPendingEmpty || loading"
      >
        <el-icon class="config-empty-icon"><MagicStick /></el-icon>
        <strong>{{ configEmptyTitle }}</strong>
        <span>{{ displayedEmptyDescription }}</span>
        <div class="config-empty-actions">
          <el-button
            v-if="configListFailedEmpty"
            type="primary"
            size="small"
            aria-label="重新读取配置列表"
            :loading="loading || vendorLockLoading"
            @click="retryConfigDependencies"
          >
            重新读取配置列表
          </el-button>
          <el-button
            v-else-if="!vendorLock.enabled && !configListPendingEmpty"
            type="primary"
            size="small"
            :disabled="configWriteLocked"
            :title="configWriteLocked ? configWriteLockReason : undefined"
            :aria-label="emptyAddAriaLabel"
            @click="openAddForService(activeServiceFilter || 'text')"
          >
            <el-icon><Plus /></el-icon>
            {{ activeServiceFilter ? `添加${serviceTypeLabel(activeServiceFilter)}配置` : '添加第一个配置' }}
          </el-button>
          <el-button
            v-if="activeServiceFilter && !configListFailedEmpty && !configListPendingEmpty"
            size="small"
            aria-label="清除当前服务筛选，查看全部配置"
            @click="clearServiceFilter"
          >查看全部</el-button>
        </div>
      </div>
    </template>
  </el-table>
</template>

<script setup>
import { computed } from 'vue'
import { Plus, MagicStick, ChatDotRound, Picture, Film, VideoCamera, Key, Microphone, Folder, Document, Headset } from '@element-plus/icons-vue'
import { describeConfigEmptyDescription } from '@/utils/aiConfigEmptyCopy.js'
import { serviceTypeLabel, configActionLabel, describeDisabledControlLabel } from '@/utils/aiConfigLabels.js'

const props = defineProps({
  loading: { type: Boolean, default: false },
  vendorLockLoading: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  vendorLock: { type: Object, required: true },
  configWriteLocked: { type: Boolean, default: false },
  configWriteLockReason: { type: String, default: '' },
  configEmptyTitle: { type: String, default: '' },
  configEmptyDescription: { type: String, default: '' },
  configListFailedEmpty: { type: Boolean, default: false },
  configListPendingEmpty: { type: Boolean, default: false },
  activeServiceFilter: { type: String, default: '' },
  isConfigRowSelectable: { type: Function, required: true },
  onSelectionChange: { type: Function, required: true },
  openTest: { type: Function, required: true },
  onRowEdit: { type: Function, required: true },
  onDelete: { type: Function, required: true },
  retryConfigDependencies: { type: Function, required: true },
  openAddForService: { type: Function, required: true },
  clearServiceFilter: { type: Function, required: true },
})

const displayedEmptyDescription = computed(() => {
  if (props.vendorLock?.enabled && !props.configListFailedEmpty && !props.configListPendingEmpty) {
    return describeConfigEmptyDescription({
      vendorLockEnabled: true,
      serviceFilter: props.activeServiceFilter,
    })
  }
  return props.configEmptyDescription
})

const emptyAddAriaLabel = computed(() => describeDisabledControlLabel(
  props.activeServiceFilter ? `添加${serviceTypeLabel(props.activeServiceFilter)}配置` : '添加第一个配置',
  { disabled: props.configWriteLocked, reason: props.configWriteLockReason },
))
</script>

<style scoped>
.config-empty-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-regular, #606266);
}
.config-empty-state strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 14px;
}
.config-empty-state > span {
  max-width: 440px;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  overflow-wrap: anywhere;
}
.config-empty-icon {
  color: var(--el-color-primary, #409eff);
  font-size: 28px;
}
.config-empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.config-empty-actions :deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 2px;
}
/* 类型徽章 */
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
}
.type-icon {
  font-size: 13px;
  flex-shrink: 0;
}
/* 文本/对话 — 蓝色 */
.type-text {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.25);
}
/* 文本生成图片 — 绿色 */
.type-image {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.25);
}
/* 分镜图片生成 — 紫色 */
.type-storyboard_image {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
  border-color: rgba(139, 92, 246, 0.25);
}
/* 视频 — 橙色 */
.type-video {
  background: rgba(249, 115, 22, 0.12);
  color: #f97316;
  border-color: rgba(249, 115, 22, 0.25);
}
.type-ocr {
  background: rgba(14, 165, 233, 0.12);
  color: #0284c7;
  border-color: rgba(14, 165, 233, 0.25);
}
.type-transcription {
  background: rgba(234, 88, 12, 0.12);
  color: #c2410c;
  border-color: rgba(234, 88, 12, 0.25);
}
.type-jimeng2_character_auth {
  background: rgba(20, 184, 166, 0.14);
  color: #0d9488;
  border-color: rgba(20, 184, 166, 0.28);
}
.type-model_ark_asset {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.25);
}
.no-default {
  color: var(--el-text-color-secondary, #9ca3af);
  font-size: 13px;
}
@media (max-width: 760px) {
  .config-empty-actions {
    flex-wrap: wrap;
  }
}
@media (max-width: 520px) {
  .config-empty-actions {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }
  .config-empty-actions :deep(.el-button) {
    margin-left: 0;
    width: 100%;
  }
}
</style>
