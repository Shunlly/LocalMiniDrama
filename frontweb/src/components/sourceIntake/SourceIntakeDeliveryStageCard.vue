<template>
  <div class="status-block timeline-block">
    <div class="stage-heading stage-heading--compact">
      <div>
        <strong>剧集 / 时间线</strong>
        <span>确认剧集数量、轨道和可用媒体。</span>
      </div>
      <el-tag v-if="timelineSummary.itemCount" size="small" :type="timelineSummary.hasPlaceholderItems ? 'warning' : timelineSummary.hasRequiredTracks ? 'success' : 'warning'">
        {{ timelineSummary.hasOnlyPlaceholderItems ? '占位' : timelineSummary.hasPlaceholderItems ? '含占位' : timelineSummary.itemCount + ' 条' }}
      </el-tag>
    </div>
    <div v-if="timelineSummary.episodeCount" class="timeline-summary">
      <span>{{ timelineSummary.episodeCount }} 集</span>
      <span>{{ timelineSummary.trackCount }} 轨</span>
      <span>{{ formatDuration(timelineSummary.durationSec) }}</span>
      <span>{{ timelineSummary.trackTypes.map(timelineTrackTypeLabel).join(' / ') }}</span>
      <span v-if="timelineSummary.placeholderItemCount">{{ timelineSummary.placeholderItemCount }} 条占位</span>
    </div>
    <div v-else-if="dramaEpisodeCount" class="timeline-summary">
      <span>{{ dramaEpisodeCount }} 集已生成</span>
      <span>时间线尚未生成</span>
    </div>
    <div v-else class="stage-empty">完成素材处理后，这里会显示剧集与时间线摘要。</div>
    <div class="stage-action-row delivery-actions">
      <el-button type="primary" plain @click="$emit('select-step', 'intake')">继续导入故事素材</el-button>
    </div>
  </div>
</template>

<script setup>
import { timelineTrackTypeLabel } from '@/utils/timelineSummary'

defineProps({
  timelineSummary: { type: Object, required: true },
  dramaEpisodeCount: { type: Number, default: 0 },
  formatDuration: { type: Function, required: true },
})

defineEmits(['select-step'])
</script>

<style scoped>
.status-block {
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 14px;
  background: rgba(18, 18, 22, 0.58);
}
.stage-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stage-heading--compact {
  margin-bottom: 12px;
}
.stage-heading > div {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.stage-heading strong {
  color: #f4f4f5;
  font-size: 14px;
  font-weight: 600;
}
.stage-heading div span {
  color: var(--source-text-muted, #a1a1aa);
  font-size: 11px;
  line-height: 1.4;
}
.timeline-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 8px 0 10px;
  color: var(--source-text-secondary, #d4d4d8);
  font-size: 12px;
}
.stage-empty {
  padding: 10px 0;
  color: var(--source-text-muted, #a1a1aa);
  font-size: 12px;
  line-height: 1.5;
}
.stage-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  margin-bottom: 10px;
}
.delivery-actions {
  margin-top: 12px;
  margin-bottom: 0;
}
html.light .status-block {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .stage-heading strong {
  color: #18181b;
}
</style>
