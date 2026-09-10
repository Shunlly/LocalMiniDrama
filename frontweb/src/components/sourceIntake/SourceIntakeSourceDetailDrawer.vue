<template>
  <el-drawer v-model="visible" title="素材详情" size="46%">
    <div v-if="loading" class="empty-line">加载中…</div>
    <template v-else-if="sourceDetail">
      <div class="detail-meta">
        <div><strong>{{ sourceDetail.source.title }}</strong></div>
        <div>{{ sourceTypeLabel(sourceDetail.source.source_type) }} / {{ formatTime(sourceDetail.source.created_at) || '未知时间' }}</div>
        <div>素材片段 {{ sourceDetail.items?.length || 0 }} / 故事事件 {{ sourceDetail.events?.length || 0 }} / 事件关系 {{ sourceDetail.event_edges?.length || 0 }}</div>
      </div>

      <div class="detail-section">
        <div class="detail-title">素材片段</div>
        <div v-if="sourceDetail.items?.length">
          <div v-for="item in sourceDetail.items" :key="item.id" class="detail-row">
            <strong>#{{ item.item_no }} {{ item.title }}</strong>
            <p>{{ item.summary }}</p>
          </div>
        </div>
        <div v-else class="empty-line">暂无素材片段</div>
      </div>

      <div class="detail-section">
        <div class="detail-title">故事事件</div>
        <div v-if="sourceDetail.events?.length">
          <div v-for="event in sourceDetail.events" :key="event.id" class="detail-row">
            <strong>#{{ event.event_no }} {{ event.title }}</strong>
            <p>{{ event.detail }}</p>
          </div>
        </div>
        <div v-else class="empty-line">暂无故事事件</div>
      </div>

      <div class="detail-section">
        <div class="detail-title">事件关系</div>
        <div v-if="sourceDetail.event_edges?.length">
          <div v-for="edge in sourceDetail.event_edges" :key="edge.id" class="detail-row compact-row">
            {{ sourceRelationLabel(edge.relation_type) }}：{{ sourceEventLabel(edge.from_event_id) }} → {{ sourceEventLabel(edge.to_event_id) }}
          </div>
        </div>
        <div v-else class="empty-line">暂无事件关系</div>
      </div>
    </template>
    <div v-else class="empty-line">未找到素材详情，请稍后重试。</div>
  </el-drawer>
</template>

<script setup>
import { sourceRelationLabel, sourceTypeLabel } from '@/utils/sourceIntakeAdapter'

const visible = defineModel('visible', { type: Boolean, default: false })

const props = defineProps({
  loading: { type: Boolean, default: false },
  sourceDetail: { type: Object, default: null },
  formatTime: { type: Function, required: true },
})

function sourceEventLabel(eventId) {
  const event = props.sourceDetail?.events?.find((item) => String(item.id) === String(eventId))
  return `事件 ${event?.event_no ?? eventId ?? '?'}`
}
</script>

<style scoped>
.empty-line {
  font-size: 12px;
  color: var(--source-text-muted, #a1a1aa);
  line-height: 1.45;
}
.detail-title {
  margin-top: 8px;
  color: #e4e4e7;
  font-weight: 600;
}
.detail-meta {
  display: grid;
  gap: 4px;
  color: var(--source-text-muted, #a1a1aa);
  font-size: 13px;
  margin-bottom: 16px;
}
.detail-section {
  margin-top: 14px;
}
.detail-row {
  border-bottom: 1px solid #27272a;
  padding: 8px 0;
  color: var(--source-text-secondary, #d4d4d8);
  font-size: 12px;
}
.detail-row p {
  margin: 4px 0 0;
  line-height: 1.5;
}
.compact-row {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
html.light .detail-title {
  color: #18181b;
}
html.light .detail-row {
  border-bottom-color: #e5e7eb;
}
</style>
