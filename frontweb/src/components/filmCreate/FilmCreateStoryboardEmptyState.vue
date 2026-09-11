<template>
<div class="empty-tip" role="status">
  <template v-if="hasAnyEpisode">
    <p>还没有分镜，可生成分镜或添加一个分镜</p>
    <div class="empty-tip-actions">
      <ActionGate :reason="storyboardActionDisabledReason" label="生成分镜">
        <el-button
          type="primary"
          :loading="storyboardGenerating || universalOmniPolishRunning"
          :disabled="Boolean(storyboardActionDisabledReason)"
          :title="storyboardGenerating || universalOmniPolishRunning ? '正在生成分镜，请稍候' : (storyboardActionDisabledReason || undefined)"
          @click="onGenerateStoryboard"
        >生成分镜</el-button>
      </ActionGate>
      <ActionGate :reason="episodeActionDisabledReason" label="添加一个分镜">
        <el-button
          :disabled="Boolean(episodeActionDisabledReason)"
          :title="episodeActionDisabledReason || undefined"
          @click="onAddSingleStoryboard"
        >添加一个分镜</el-button>
      </ActionGate>
    </div>
  </template>
  <template v-else>
    <p>请先创建或选择剧集，再生成或添加分镜</p>
    <div class="empty-tip-actions">
      <el-button type="primary" aria-label="去创建剧集后再生成分镜" @click="onAddEpisode">去创建剧集</el-button>
    </div>
  </template>
</div>
</template>

<script setup>
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  hasAnyEpisode: { type: Boolean, default: false },
  storyboardGenerating: { type: Boolean, default: false },
  universalOmniPolishRunning: { type: Boolean, default: false },
  storyboardActionDisabledReason: { type: String, default: '' },
  episodeActionDisabledReason: { type: String, default: '' },
  onGenerateStoryboard: { type: Function, required: true },
  onAddSingleStoryboard: { type: Function, required: true },
  onAddEpisode: { type: Function, default: () => {} },
})
</script>

<style scoped>
.empty-tip {
  color: var(--film-empty-copy, #a1a1aa);
  font-size: 0.9rem;
  line-height: 1.55;
  padding: 16px 0;
}

html.light .empty-tip { color: var(--film-empty-copy, #64748b); }
.empty-tip p { margin: 0; }
.empty-tip-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
}
.empty-tip-actions :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
.empty-tip-actions :deep(.action-gate-wrap) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 100%;
}
</style>
