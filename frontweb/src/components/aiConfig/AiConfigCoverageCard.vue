<template>
  <article
    :ref="(element) => setCoverageCardRef(item.type, element)"
    class="coverage-item"
    :class="[
      `coverage-${item.state}`,
      {
        'is-selected': selected,
        'coverage-item-compact': compact,
      },
    ]"
    tabindex="-1"
    :aria-label="`${item.label}，${coverageStateLabel(item)}，${coverageTestLabel(item.test)}`"
  >
    <button
      type="button"
      class="coverage-select"
      :aria-pressed="selected"
      @click="$emit('select', item)"
    >
      <span :class="['coverage-icon', `coverage-icon-${item.type}`]">
        <el-icon>
          <ChatDotRound v-if="item.type === 'text'" />
          <Picture v-else-if="item.type === 'image'" />
          <Film v-else-if="item.type === 'storyboard_image'" />
          <VideoCamera v-else-if="item.type === 'video'" />
          <Microphone v-else-if="item.type === 'tts'" />
          <Document v-else-if="item.type === 'ocr'" />
          <Headset v-else />
        </el-icon>
      </span>
      <span class="coverage-item-main">
        <span class="coverage-item-heading">
          <strong>{{ item.label }}</strong>
          <el-tag :type="coverageStateTagType(item)" size="small" effect="plain">
            {{ coverageStateLabel(item) }}
          </el-tag>
        </span>
        <span class="coverage-description">{{ item.description }}</span>
        <span class="coverage-config-count">{{ coverageInventoryLabel(item) }}</span>
        <span class="coverage-config-detail">{{ coverageConfigDetail(item) }}</span>
        <span :class="['coverage-test-status', `test-${item.test.status}`]">
          <span class="coverage-status-dot" />
          {{ coverageTestLabel(item.test) }}
        </span>
      </span>
    </button>
    <span class="coverage-actions">
      <el-button
        v-for="action in coverageActions(item)"
        :key="`${item.type}-${action.key}`"
        :link="action.action !== 'test'"
        :plain="action.action === 'test'"
        size="small"
        :type="action.action === 'test' ? 'primary' : (action.emphasis === 'primary' ? 'primary' : 'info')"
        :class="['coverage-action-link', { 'coverage-action-test': action.action === 'test' }]"
        :aria-label="action.label"
        :aria-busy="isCoverageActionTesting(item, action)"
        :loading="isCoverageActionTesting(item, action)"
        :disabled="isCoverageActionDisabled(item, action)"
        @click.stop="$emit('action', item, action)"
      >
        {{ action.label }}
      </el-button>
    </span>
  </article>
</template>

<script setup>
import { ChatDotRound, Document, Film, Headset, Microphone, Picture, VideoCamera } from '@element-plus/icons-vue'
import {
  coverageConfigDetail,
  coverageInventoryLabel,
  coverageStateLabel,
  coverageStateTagType,
  coverageTestLabel,
} from '@/composables/useAiConfigCoverage.js'

defineProps({
  item: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  coverageActions: { type: Function, required: true },
  isCoverageActionTesting: { type: Function, required: true },
  isCoverageActionDisabled: { type: Function, required: true },
  setCoverageCardRef: { type: Function, required: true },
})

defineEmits(['select', 'action'])
</script>

<style scoped>
.coverage-item {
  min-width: 0;
  min-height: 132px;
  display: grid;
  grid-template-rows: 1fr auto;
  align-items: start;
  gap: 8px 10px;
  padding: 10px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-blank, #fff);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.coverage-item:hover {
  border-color: var(--el-color-primary-light-5, #a0cfff);
  box-shadow: 0 2px 8px rgba(31, 41, 55, 0.08);
}
.coverage-select:focus-visible {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 2px;
}
.coverage-item:focus-visible {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 2px;
}
.coverage-item.is-selected {
  border-color: var(--el-color-primary, #409eff);
  background: var(--el-color-primary-light-9, #ecf5ff);
}
.coverage-select {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  min-width: 0;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.coverage-icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 16px;
}
.coverage-icon-text { color: var(--ai-config-info-text, #2563eb); background: var(--ai-config-info-surface, #eff6ff); }
.coverage-icon-image { color: var(--ai-config-success-text, #047857); background: var(--ai-config-success-surface, #ecfdf5); }
.coverage-icon-storyboard_image { color: #7c3aed; background: #f5f3ff; }
.coverage-icon-video { color: var(--ai-config-warning-text, #c2410c); background: var(--ai-config-warning-surface, #fff7ed); }
.coverage-icon-tts { color: #0f766e; background: #f0fdfa; }
.coverage-icon-ocr { color: #0369a1; background: #e0f2fe; }
.coverage-icon-transcription { color: #7c2d12; background: #fff7ed; }
.coverage-item-compact {
  min-height: 108px;
}
.coverage-item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.coverage-item-heading {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}
.coverage-item-heading strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 13px;
  line-height: 20px;
}
.coverage-description,
.coverage-config-count,
.coverage-config-detail,
.coverage-test-status {
  display: block;
  font-size: 12px;
  line-height: 1.45;
}
.coverage-description {
  color: var(--el-text-color-regular, #606266);
}
.coverage-config-count {
  color: var(--el-text-color-secondary, #909399);
}
.coverage-config-detail {
  min-width: 0;
  color: var(--el-text-color-primary, #303133);
  overflow-wrap: anywhere;
}
.coverage-test-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--el-text-color-secondary, #909399);
}
.coverage-status-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #9ca3af;
}
.coverage-test-status.test-passed { color: var(--ai-config-success-text, #047857); }
.coverage-test-status.test-passed .coverage-status-dot { background: #10b981; }
.coverage-test-status.test-failed { color: var(--ai-config-danger-text, #b91c1c); }
.coverage-test-status.test-failed .coverage-status-dot { background: #ef4444; }
.coverage-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 2px;
}
.coverage-action-link {
  min-height: 32px;
  padding: 4px 8px;
}
.coverage-action-test {
  min-height: 32px;
  padding: 4px 10px;
  font-weight: 600;
}
</style>
