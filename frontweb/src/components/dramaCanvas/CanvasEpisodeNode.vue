<template>
  <div
    class="canvas-episode-node"
    role="button"
    tabindex="0"
    :aria-label="accessibleLabel"
    :title="accessibleLabel"
    @keydown.enter.stop.prevent="activateEpisode"
    @keydown.space.stop.prevent="activateEpisode"
  >
    <Handle type="target" :position="Position.Left" />
    <span class="badge">第 {{ data.episode?.episode_number ?? '?' }} 集</span>
    <span class="title">{{ data.episode?.title || '未命名集' }}</span>
    <span class="count">{{ (data.episode?.storyboards || []).length }} 镜</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'

const props = defineProps({
  data: { type: Object, required: true },
})

const ctx = useCanvasContext()

const accessibleLabel = computed(() => {
  const episode = props.data.episode || {}
  const count = (episode.storyboards || []).length
  const next = count > 0 ? '展开第一个分镜' : '新建分镜'
  return `第 ${episode.episode_number ?? '?'} 集，${episode.title || '未命名集'}，${count} 个分镜，按 Enter 或空格${next}`
})

async function activateEpisode() {
  const episode = props.data.episode || {}
  const first = (episode.storyboards || [])[0]
  if (first?.id) {
    await ctx?.setFocusedNode?.(`sb:${first.id}`)
    return
  }
  ctx?.openCreateDialog?.('storyboard')
}
</script>

<style scoped>
.canvas-episode-node {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--canvas-violet-border, rgba(167, 139, 250, 0.5));
  background: var(--canvas-episode-surface, rgba(76, 29, 149, 0.35));
  color: var(--canvas-episode-text, #e9d5ff);
  font-size: 13px;
  white-space: nowrap;
}
.badge {
  font-weight: 700;
}
.title {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.count {
  font-size: 11px;
  opacity: 0.75;
}
.canvas-episode-node:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 3px;
}
</style>
