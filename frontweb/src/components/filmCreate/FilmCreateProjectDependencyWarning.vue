<template>
  <section
    v-if="warningText"
    class="project-dependency-warning"
    :role="mediaError ? 'alert' : 'status'"
    aria-live="polite"
  >
    <el-icon><WarningFilled /></el-icon>
    <div class="project-dependency-warning-copy">
      <p>{{ warningText }}</p>
      <p v-if="actionHint" class="project-dependency-warning-hint">{{ actionHint }}</p>
    </div>
    <div class="project-dependency-warning-actions">
      <el-button
        size="small"
        type="primary"
        :loading="loading"
        :title="loading ? '正在重试加载素材，请稍候' : undefined"
        :aria-label="retryAriaLabel"
        @click="onRetry"
      >
        <el-icon><Refresh /></el-icon>重试加载素材
      </el-button>
      <a
        v-if="mediaError"
        class="project-dependency-warning-link"
        href="#anchor-storyboard-images"
      >查看分镜</a>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import { describeActionAriaLabel, toFilmCreateOptionalUserFacingText } from '@/components/filmCreate/filmCreateActionCopy.js'

const props = defineProps({
  mediaError: { type: String, default: '' },
  dependencyWarning: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['retry'])

const warningText = computed(() => [
  toFilmCreateOptionalUserFacingText(props.mediaError, '分镜素材读取失败，请稍后重试'),
  toFilmCreateOptionalUserFacingText(props.dependencyWarning, '项目依赖暂时无法同步，请稍后重试'),
].filter(Boolean).join('；'))
const retryAriaLabel = computed(() => describeActionAriaLabel('重试加载素材', {
  loading: props.loading,
  loadingLabel: '正在重试加载素材',
}))
const actionHint = computed(() => {
  if (props.mediaError && props.dependencyWarning) {
    return '项目仍可继续编辑。可重试加载素材，或先查看已加载的分镜。'
  }
  if (props.mediaError) return '已加载的分镜可以继续编辑；失败项可重试加载。'
  if (props.dependencyWarning) return '项目已打开。可重试同步任务状态，不影响当前编辑。'
  return ''
})

function onRetry(event) {
  emit('retry')
  event?.currentTarget?.focus?.()
}
</script>

<style scoped>
.project-dependency-warning {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding: 10px 12px;
  border: 1px solid rgba(245, 158, 11, 0.38);
  border-radius: 6px;
  background: rgba(120, 53, 15, 0.15);
  color: #fcd34d;
}
.project-dependency-warning-copy {
  flex: 1;
  min-width: 0;
}
.project-dependency-warning-copy p {
  margin: 0;
  line-height: 1.5;
}
.project-dependency-warning-hint {
  margin-top: 4px;
  color: inherit;
  opacity: 0.88;
  font-size: 12px;
}
.project-dependency-warning-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.project-dependency-warning-link {
  color: inherit;
  font-size: 13px;
  line-height: 1.4;
  text-decoration: underline;
  white-space: nowrap;
}
.project-dependency-warning-link:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
html.light .project-dependency-warning { background: #fffbeb; color: #92400e; border-color: #fcd34d; }
</style>
