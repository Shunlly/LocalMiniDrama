<template>
  <section class="canvas-start-state" aria-labelledby="canvas-start-heading" aria-describedby="canvas-start-description">
    <form class="start-panel" @submit.prevent="confirmEpisode">
      <el-icon class="start-icon"><SetUp /></el-icon>
      <h2 id="canvas-start-heading">{{ heading }}</h2>
      <p id="canvas-start-description">{{ description }}</p>

      <el-select
        v-if="mode === 'select-episode' && episodes.length > 1"
        :model-value="draftEpisodeId"
        placeholder="选择要进入的剧集"
        class="episode-picker"
        aria-label="选择要进入的剧集"
        @update:model-value="selectDraftEpisode"
      >
        <el-option
          v-for="episode in episodes"
          :key="episode.id"
          :label="episode.title || `第 ${episode.episode_number || ''} 集`"
          :value="episode.id"
        />
      </el-select>
      <div v-else-if="mode === 'select-episode' && effectiveEpisodeLabel" class="episode-pill">
        {{ effectiveEpisodeLabel }}
      </div>
      <p v-else-if="mode === 'select-episode'" class="episode-empty" role="status">
        暂无可选剧集
      </p>

      <div class="start-actions">
        <el-button
          v-if="actions.primaryAction === 'create-episode'"
          type="primary"
          native-type="button"
          aria-label="新建第一集"
          @click="emit('create-episode')"
        >
          <el-icon><Plus /></el-icon>
          新建第一集
        </el-button>
        <el-button
          v-else-if="actions.primaryAction === 'confirm-episode'"
          type="primary"
          :disabled="effectiveEpisodeId === null"
          native-type="submit"
        >
          <el-icon><Right /></el-icon>
          进入这一集
        </el-button>
        <el-button
          v-if="actions.secondaryAction === 'go-list'"
          link
          type="primary"
          native-type="button"
          @click="emit('go-list')"
        >
          <el-icon><List /></el-icon>
          列表模式
        </el-button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { List, Plus, Right, SetUp } from '@element-plus/icons-vue'

import {
  createCanvasEpisodeDraft,
  getCanvasEmptyStateActions,
  reconcileCanvasEpisodeDraft,
  resolveCanvasEpisodeId,
} from '@/utils/canvasUiState'

const props = defineProps({
  mode: { type: String, default: 'unavailable' },
  episodes: { type: Array, default: () => [] },
  selectedEpisodeId: { type: [String, Number], default: null },
})

const emit = defineEmits([
  'create-episode',
  'confirm-episode',
  'go-list',
])

const draftEpisodeId = ref(createCanvasEpisodeDraft(props.episodes, props.selectedEpisodeId))
const actions = computed(() => getCanvasEmptyStateActions(props.mode, props.episodes.length))

const effectiveEpisodeId = computed(() => resolveCanvasEpisodeId(props.episodes, draftEpisodeId.value))

const effectiveEpisodeLabel = computed(() => {
  const episode = props.episodes.find((item) => String(item.id) === String(effectiveEpisodeId.value))
  if (!episode) return ''
  return episode.title || `第 ${episode.episode_number || ''} 集`
})

const heading = computed(() => {
  if (props.mode === 'create-episode') return '从第一集开始搭建画布'
  if (props.mode === 'select-episode' && props.episodes.length === 0) return '先新建一集，再进入画布'
  if (props.mode === 'select-episode') return '先选择一集，再进入画布'
  return '画布暂时无法显示'
})

const description = computed(() => {
  if (props.mode === 'create-episode') return '先建立剧集，再继续编写剧本、创建分镜和整理素材。'
  if (props.mode === 'select-episode' && props.episodes.length === 0) return '当前项目还没有可进入的剧集。'
  if (props.mode === 'select-episode') return '确定当前要查看的剧集后，再从顶部工具开始创建内容，或切回列表模式继续编辑。'
  return '返回列表模式检查项目内容，或重新进入画布。'
})

function selectDraftEpisode(value) {
  draftEpisodeId.value = resolveCanvasEpisodeId(props.episodes, value)
}

function confirmEpisode() {
  const episodeId = effectiveEpisodeId.value
  if (episodeId === null) return
  emit('confirm-episode', episodeId)
}

watch(() => props.selectedEpisodeId, (value) => {
  draftEpisodeId.value = createCanvasEpisodeDraft(props.episodes, value)
})

watch(() => props.episodes, (episodes) => {
  draftEpisodeId.value = reconcileCanvasEpisodeDraft(
    episodes,
    draftEpisodeId.value,
    props.selectedEpisodeId
  )
}, { deep: true })

watch(() => props.mode, (mode) => {
  draftEpisodeId.value = mode === 'select-episode'
    ? createCanvasEpisodeDraft(props.episodes, props.selectedEpisodeId)
    : null
})
</script>

<style scoped>
.canvas-start-state {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  padding: 32px;
  background: rgba(15, 15, 18, 0.9);
}

.start-panel {
  width: min(560px, 100%);
  padding: 30px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 8px;
  background: var(--bg-card, #18181b);
  text-align: center;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
}

.start-icon {
  width: 44px;
  height: 44px;
  margin-bottom: 12px;
  border-radius: 8px;
  background: rgba(129, 140, 248, 0.14);
  color: #a5b4fc;
  font-size: 24px;
}

h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.35;
  color: var(--text-bright, #fafafa);
}

p {
  margin: 8px 0 18px;
  color: var(--text-muted, #a1a1aa);
  font-size: 13px;
  line-height: 1.6;
}

.episode-picker {
  width: min(320px, 100%);
  margin-bottom: 16px;
}

.episode-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 180px;
  max-width: 100%;
  margin-bottom: 16px;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 999px;
  background: rgba(129, 140, 248, 0.12);
  color: var(--text-bright, #fafafa);
  font-size: 13px;
  font-weight: 600;
}

.episode-empty {
  margin: 0 0 16px;
  color: var(--text-muted, #a1a1aa);
}

.start-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

</style>
