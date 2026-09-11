<template>
<div class="empty-tip">
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
      <el-button type="primary" @click="onAddEpisode">去创建剧集</el-button>
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
.empty-tip { color: #5a5a66; font-size: 0.9rem; padding: 16px 0; }

html.light .empty-tip { color: #9ca3af; }
.empty-tip p { margin: 0; }
.empty-tip-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
</style>
