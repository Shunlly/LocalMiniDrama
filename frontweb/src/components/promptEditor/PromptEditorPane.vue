<template>
  <div class="prompt-card">
    <div class="prompt-card-header">
      <div class="prompt-card-meta">
        <span class="prompt-label">{{ prompt.label }}</span>
        <el-tag
          v-if="prompt.is_customized"
          type="warning"
          size="small"
          class="custom-tag"
        >已自定义</el-tag>
        <el-tag v-else type="info" size="small" class="custom-tag">使用默认</el-tag>
      </div>
      <p class="prompt-desc">{{ prompt.description }}</p>
    </div>

    <div class="prompt-edit-section">
      <div class="section-label">
        <el-icon class="section-icon"><Edit /></el-icon>
        <span>指令内容（可编辑）</span>
      </div>
      <el-input
        :model-value="body"
        type="textarea"
        :rows="16"
        :placeholder="prompt.default_body"
        class="prompt-textarea"
        @update:model-value="$emit('update:body', $event)"
      />
    </div>

    <div v-if="prompt.locked_suffix" class="prompt-locked-section">
      <div class="section-label section-label--locked">
        <el-icon class="section-icon"><Lock /></el-icon>
        <span>JSON 格式要求（锁定，不可修改）</span>
      </div>
      <div class="locked-content">{{ prompt.locked_suffix }}</div>
    </div>

    <div class="prompt-actions">
      <el-button
        type="primary"
        size="small"
        :loading="saving"
        :disabled="Boolean(saveDisabledReason)"
        :title="saveDisabledReason || undefined"
        :aria-label="saveDisabledReason ? `保存不可用：${saveDisabledReason}` : undefined"
        @click="$emit('save')"
      >
        保存
      </el-button>
      <el-button
        size="small"
        :loading="resetting"
        :disabled="Boolean(resetDisabledReason)"
        :title="resetDisabledReason || undefined"
        :aria-label="resetDisabledReason ? `恢复默认不可用：${resetDisabledReason}` : undefined"
        @click="$emit('reset')"
      >
        恢复默认
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { Edit, Lock } from '@element-plus/icons-vue'

defineProps({
  prompt: { type: Object, required: true },
  body: { type: String, default: '' },
  saving: { type: Boolean, default: false },
  resetting: { type: Boolean, default: false },
  saveDisabledReason: { type: String, default: '' },
  resetDisabledReason: { type: String, default: '' },
})

defineEmits(['update:body', 'save', 'reset'])
</script>

<style scoped>
.prompt-card {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e4e4e7);
  border-radius: 12px;
  padding: 20px;
}

.prompt-card-header {
  margin-bottom: 16px;
}

.prompt-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.prompt-label {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-bright, #18181b);
}

.custom-tag {
  font-size: 11px;
}

.prompt-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #71717a);
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted, #71717a);
}

.section-label--locked {
  color: #2563eb;
}

.section-icon {
  font-size: 13px;
}

.prompt-edit-section {
  margin-bottom: 16px;
}

.prompt-textarea :deep(textarea) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12.5px;
  line-height: 1.6;
}

.prompt-locked-section {
  margin-bottom: 16px;
}

.locked-content {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  color: #1e40af;
  white-space: pre-wrap;
  line-height: 1.6;
  user-select: none;
}

.prompt-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, #e4e4e7);
}
</style>