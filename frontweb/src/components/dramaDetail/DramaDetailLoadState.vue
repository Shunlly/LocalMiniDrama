<template>
      <section
        v-if="state === 'loading'"
        class="project-load-state"
        role="status"
        aria-live="polite"
      >
        <el-icon class="project-load-state-icon is-loading"><Loading /></el-icon>
        <h2>正在加载项目</h2>
        <p>正在读取剧集、分集和制作资源。</p>
      </section>

      <section
        v-else-if="state === 'error'"
        ref="errorSectionRef"
        class="project-load-state project-load-state--error"
        role="alert"
        aria-labelledby="drama-load-error-title"
        tabindex="-1"
      >
        <el-icon class="project-load-state-icon"><WarningFilled /></el-icon>
        <h2 id="drama-load-error-title">{{ notFound ? '项目不存在' : '暂时无法加载项目' }}</h2>
        <p>{{ errorText }}</p>
        <p v-if="notFound" class="project-load-state-assurance">项目可能已移入回收站或被删除，请返回项目列表确认。</p>
        <p v-else class="project-load-state-assurance">项目数据没有被删除，当前页面已停止所有项目编辑操作。</p>
        <div class="project-load-state-actions">
          <el-button v-if="!notFound" type="primary" :loading="pending" aria-label="重试加载" :title="pending ? '正在重新加载项目，请稍候' : undefined" @click="emit('retry')">
            <el-icon><Refresh /></el-icon>重试加载
          </el-button>
          <el-button aria-label="返回项目列表" @click="emit('go-list')">
            <el-icon><ArrowLeft /></el-icon>返回项目列表
          </el-button>
        </div>
      </section>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowLeft, Loading, Refresh, WarningFilled } from '@element-plus/icons-vue'

// 加载/失败面只负责展示，重试与返回列表仍由页面处理

defineProps({
  state: { type: String, default: 'loading' },
  errorText: { type: String, default: '' },
  notFound: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
})

const emit = defineEmits(['retry', 'go-list'])
const errorSectionRef = ref(null)

defineExpose({
  focus: () => errorSectionRef.value?.focus?.(),
})
</script>

<style scoped>
.project-load-state {
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  border: 1px solid rgba(113, 113, 122, 0.45);
  border-radius: 8px;
  background: rgba(24, 24, 27, 0.88);
  text-align: center;
}
.project-load-state:focus { outline: none; }
.project-load-state:focus-visible { outline: 2px solid #818cf8; outline-offset: 3px; }
.project-load-state--error { border-color: rgba(248, 113, 113, 0.45); }
.project-load-state-icon { font-size: 34px; color: #a1a1aa; }
.project-load-state--error .project-load-state-icon { color: #f87171; }
.project-load-state h2 { margin: 4px 0 0; font-size: 1.25rem; color: #f4f4f5; }
.project-load-state p { max-width: 620px; margin: 0; color: #a1a1aa; line-height: 1.65; }
.project-load-state .project-load-state-assurance { color: #d4d4d8; }
.project-load-state-actions { display: flex; gap: 10px; margin-top: 12px; }
html.light .project-load-state { background: #fff; border-color: #d4d4d8; }
html.light .project-load-state--error { border-color: #fca5a5; }
html.light .project-load-state h2 { color: #18181b; }
html.light .project-load-state p { color: #52525b; }
</style>
