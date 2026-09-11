<template>
  <main v-if="state === 'loading'" class="main project-state-main" aria-busy="true">
    <section class="project-load-state" role="status" aria-live="polite">
      <el-icon class="project-load-state-icon is-loading"><Loading /></el-icon>
      <h1>正在加载制作项目</h1>
      <p>正在读取剧本、制作资源和分镜媒体。</p>
    </section>
  </main>

  <main v-else-if="state === 'error'" class="main project-state-main">
    <section
      ref="errorSectionRef"
      class="project-load-state project-load-state--error"
      role="alert"
      aria-labelledby="film-project-load-error-title"
      tabindex="-1"
    >
      <el-icon class="project-load-state-icon"><WarningFilled /></el-icon>
      <h1 id="film-project-load-error-title">{{ notFound ? '制作项目不存在' : '暂时无法打开制作项目' }}</h1>
      <p>{{ errorText }}</p>
      <p v-if="notFound" class="project-load-state-assurance">项目可能已移入回收站或被删除，请返回项目列表确认。</p>
      <p v-else class="project-load-state-assurance">项目数据没有被删除，当前页面已停止所有项目编辑和生成操作。</p>
      <div class="project-load-state-actions">
        <el-button v-if="!notFound" type="primary" :loading="pending" aria-label="重试加载" :title="filmCreateActionTitle('', pending, '正在重新加载项目，请稍候')" @click="emit('retry')">
          <el-icon><Refresh /></el-icon>重试加载
        </el-button>
        <el-button aria-label="返回项目列表" @click="emit('go-list')">
          <el-icon><ArrowLeft /></el-icon>返回项目列表
        </el-button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowLeft, Loading, Refresh, WarningFilled } from '@element-plus/icons-vue'
import { filmCreateActionTitle } from './filmCreateActionTitle.js'

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
.project-state-main {
  min-height: calc(100vh - 72px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.project-load-state {
  width: min(760px, 100%);
  min-height: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 32px;
  padding: 40px;
  border: 1px solid rgba(113, 113, 122, 0.45);
  border-radius: 8px;
  background: rgba(30, 31, 40, 0.94);
  text-align: center;
}
.project-load-state:focus { outline: none; }
.project-load-state:focus-visible { outline: 2px solid #818cf8; outline-offset: 3px; }
.project-load-state--error { border-color: rgba(248, 113, 113, 0.48); }
.project-load-state-icon { font-size: 36px; color: #a1a1aa; }
.project-load-state--error .project-load-state-icon { color: #f87171; }
.project-load-state h1 { margin: 4px 0 0; font-size: 1.3rem; color: #f4f4f5; }
.project-load-state p { max-width: 620px; margin: 0; color: #a1a1aa; line-height: 1.65; }
.project-load-state .project-load-state-assurance { color: #d4d4d8; }
.project-load-state-actions { display: flex; gap: 10px; margin-top: 12px; }
html.light .project-load-state { background: #fff; border-color: #d4d4d8; }
html.light .project-load-state--error { border-color: #fca5a5; }
html.light .project-load-state h1 { color: #18181b; }
html.light .project-load-state p { color: #52525b; }
</style>
