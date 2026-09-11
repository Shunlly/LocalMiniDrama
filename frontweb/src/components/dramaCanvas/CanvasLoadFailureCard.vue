<template>
  <main
    ref="rootRef"
    class="canvas-load-failure"
    tabindex="-1"
    role="alert"
    aria-live="assertive"
  >
    <div class="canvas-load-failure-card">
      <p class="canvas-load-eyebrow">项目加载失败</p>
      <h1 class="canvas-load-title">当前画布暂时无法打开</h1>
      <p class="canvas-load-message">{{ error }}</p>
      <p class="canvas-load-detail">
        {{ notFound ? '项目可能已移入回收站或已删除。' : '请确认本地服务可用后，在当前页面直接重试。' }}
      </p>
      <div class="canvas-load-actions">
        <el-button type="primary" :loading="loading" :aria-label="loading ? '正在重试加载' : '重试加载'" @click="retryCanvasProjectLoad">重试加载</el-button>
        <el-button aria-label="返回项目列表" @click="goProjectList">返回项目列表</el-button>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  notFound: { type: Boolean, default: false },
  retryCanvasProjectLoad: { type: Function, required: true },
  goProjectList: { type: Function, required: true },
})

const rootRef = ref(null)

// 加载 composable 仍对 canvasLoadFailureRef.focus() 调用，组件实例需转发到可聚焦根节点
defineExpose({
  focus: () => rootRef.value?.focus?.(),
})
</script>

<style scoped>
.canvas-load-failure {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}

.canvas-load-failure-card {
  width: min(520px, 100%);
  padding: 24px;
  border-radius: 8px;
  border: 1px solid var(--canvas-danger-text, #f87171);
  background: var(--canvas-card-surface, #18181b);
  box-shadow: var(--canvas-raised-shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
}

.canvas-load-eyebrow {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--canvas-danger-text, #f87171);
}

.canvas-load-title {
  margin: 0 0 10px;
  font-size: 22px;
  line-height: 1.2;
  color: var(--text-bright, #fafafa);
}

.canvas-load-message,
.canvas-load-detail {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--canvas-text-secondary, #d4d4d8);
}

.canvas-load-detail {
  margin-top: 8px;
  color: var(--canvas-text-muted, #a1a1aa);
}

.canvas-load-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}
</style>
