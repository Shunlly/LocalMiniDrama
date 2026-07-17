<template>
  <div class="canvas-drama-header" role="group" :aria-label="accessibleLabel">
    <div class="title">{{ data.drama?.title || '未命名项目' }}</div>
    <div class="meta">
      <span v-if="styleLabel">风格 {{ styleLabel }}</span>
      <span>{{ (data.drama?.episodes || []).length }} 集</span>
      <span>{{ assetCount }} 素材</span>
      <span>{{ storyboardCount }} 分镜</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { findStyleOption } from '@/constants/styleOptions.js'

const props = defineProps({
  data: { type: Object, required: true },
})

const assetCount = computed(() => {
  const d = props.data.drama || {}
  return (d.characters?.length || 0) + (d.scenes?.length || 0) + (d.props?.length || 0)
})

const storyboardCount = computed(() =>
  (props.data.drama?.episodes || []).reduce((n, ep) => n + (ep.storyboards?.length || 0), 0)
)

const styleLabel = computed(() => {
  const value = String(props.data.drama?.style || '').trim()
  return findStyleOption(value)?.label || value
})

const accessibleLabel = computed(() => (
  `项目 ${props.data.drama?.title || '未命名'}，${(props.data.drama?.episodes || []).length} 集，${assetCount.value} 个素材，${storyboardCount.value} 个分镜`
))
</script>

<style scoped>
.canvas-drama-header {
  min-width: 280px;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid var(--canvas-indigo-border, rgba(129, 140, 248, 0.45));
  background: var(--canvas-project-surface, linear-gradient(135deg, rgba(49, 46, 129, 0.55), rgba(24, 24, 27, 0.92)));
  box-shadow: var(--canvas-project-shadow, 0 8px 32px rgba(0, 0, 0, 0.35));
}
.title {
  font-size: 16px;
  font-weight: 700;
  color: var(--canvas-project-title, #f4f4f5);
  margin-bottom: 6px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--canvas-text-muted, #a1a1aa);
}
</style>
