<template>
  <div class="film-create-storyboard-status">
    <!-- 批量生成进度 -->
    <div v-if="batchImageRunning || batchVideoRunning || batchImageErrors.length || batchVideoErrors.length" class="batch-status">
      <div v-if="batchImageRunning" class="batch-progress">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>批量生成分镜图：{{ batchImageProgress.current }}/{{ batchImageProgress.total }}</span>
        <span v-if="batchImageProgress.failed > 0" class="batch-failed">{{ batchImageProgress.failed }} 条失败</span>
        <span v-if="batchImageStopping" class="batch-stopping">（正在停止...）</span>
      </div>
      <div v-if="batchVideoRunning" class="batch-progress">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>批量生成分镜视频：{{ batchVideoProgress.current }}/{{ batchVideoProgress.total }}</span>
        <span v-if="batchVideoProgress.failed > 0" class="batch-failed">{{ batchVideoProgress.failed }} 条失败</span>
        <span v-if="batchVideoStopping" class="batch-stopping">（正在停止...）</span>
      </div>
      <div v-if="batchImageErrors.length > 0" class="batch-error-log">
        <div class="batch-error-title">分镜图生成失败记录：</div>
        <div v-for="(e, i) in batchImageErrors" :key="i" class="batch-error-line">{{ e }}</div>
      </div>
      <div v-if="batchVideoErrors.length > 0" class="batch-error-log">
        <div class="batch-error-title">分镜视频生成失败记录：</div>
        <div v-for="(e, i) in batchVideoErrors" :key="i" class="batch-error-line">{{ e }}</div>
      </div>
    </div>
    <div v-if="storyboardGenerating || universalOmniPolishRunning" class="storyboard-generating-tip">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span v-if="universalOmniPolishRunning">
        正在润色全能提示词：第 {{ universalOmniPolishProgress.current }} / {{ universalOmniPolishProgress.total }} 镜
        <template v-if="universalOmniPolishProgress.label">（{{ universalOmniPolishProgress.label }}）</template>
        …
      </span>
      <span v-else>正在分析剧本并拆解分镜，请稍候...</span>
    </div>
    <div v-if="sbTruncatedWarning && !sbTruncatedDismissed && storyboards.length > 0" class="sb-truncated-warning">
      <el-icon><WarningFilled /></el-icon>
      <span>检测到分镜可能不完整（AI 输出被截断），请确认分镜数量是否符合预期，必要时可重新生成。</span>
      <el-button size="small" text aria-label="关闭分镜截断提示" @click="sbTruncatedDismissed = true">关闭</el-button>
    </div>
  </div>
</template>

<script setup>
import { Loading, WarningFilled } from '@element-plus/icons-vue'

defineProps({
  batchImageRunning: { type: Boolean, default: false },
  batchVideoRunning: { type: Boolean, default: false },
  batchImageErrors: { type: Array, default: () => [] },
  batchVideoErrors: { type: Array, default: () => [] },
  batchImageProgress: { type: Object, default: () => ({}) },
  batchVideoProgress: { type: Object, default: () => ({}) },
  batchImageStopping: { type: Boolean, default: false },
  batchVideoStopping: { type: Boolean, default: false },
  storyboardGenerating: { type: Boolean, default: false },
  universalOmniPolishRunning: { type: Boolean, default: false },
  universalOmniPolishProgress: { type: Object, default: () => ({ current: 0, total: 0, label: '' }) },
  sbTruncatedWarning: { type: Boolean, default: false },
  storyboards: { type: Array, default: () => [] },
})

const sbTruncatedDismissed = defineModel('sbTruncatedDismissed', { type: Boolean, default: false })
</script>

<style scoped src="./FilmCreateStoryboardStatusStrip.css"></style>
