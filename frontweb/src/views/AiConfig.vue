<template>
  <div class="ai-config">
    <header class="header">
      <div class="header-inner">
        <button type="button" class="logo" :aria-label="backButtonLabel" @click="goBack">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">LocalMiniDrama</span>
        </button>
        <h1 class="page-title">AI 配置</h1>
        <el-button class="btn-back" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          {{ backButtonText }}
        </el-button>
      </div>
    </header>

    <main class="main">
      <AIConfigContent :initial-service-type="initialServiceType" />
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import AIConfigContent from '@/components/AIConfigContent.vue'

const router = useRouter()
const route = useRoute()
const filterableServiceTypes = new Set(['text', 'image', 'storyboard_image', 'video', 'tts'])
const initialServiceType = computed(() => {
  const raw = Array.isArray(route.query.service_type)
    ? route.query.service_type[0]
    : route.query.service_type
  const normalized = String(raw || '').trim()
  return filterableServiceTypes.has(normalized) ? normalized : ''
})
const returnTo = computed(() => {
  const normalize = route.meta.normalizeReturnTo
  return typeof normalize === 'function' ? normalize(route.query.returnTo) : ''
})
const returnsToFreeCreate = computed(() => returnTo.value.startsWith('/free-create'))
const backButtonText = computed(() => {
  if (returnsToFreeCreate.value) return '返回自由创作'
  return returnTo.value ? '返回项目' : '返回首页'
})
const backButtonLabel = computed(() => {
  if (returnsToFreeCreate.value) return '返回自由创作'
  return returnTo.value ? '返回原项目' : '返回项目列表'
})

function goBack() {
  router.replace(returnTo.value || { name: 'list' })
}
</script>

<style scoped>
.ai-config {
  min-height: 100vh;
  background: #0f0f12;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.12) 0%, transparent 60%);
}
html.light .ai-config {
  background: #f5f3ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(139, 92, 246, 0.12) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
}
.header {
  background: rgba(18, 18, 22, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(139, 92, 246, 0.18);
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.4);
  position: sticky;
  top: 0;
  z-index: 100;
}
html.light .header {
  background: rgba(255, 255, 255, 0.85);
  border-bottom-color: rgba(139, 92, 246, 0.2);
  box-shadow: 0 2px 16px rgba(139, 92, 246, 0.08);
}
.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover {
  filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.5));
}
.logo:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 4px;
  border-radius: 4px;
}
.logo-main {
  font-size: 1.1rem;
  font-weight: 700;
  background: linear-gradient(135deg, #c4b5fd 0%, #818cf8 50%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
}
html.light .logo-main {
  background: linear-gradient(135deg, #7c3aed, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.page-title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  color: #a1a1aa;
}
html.light .page-title { color: #6b7280; }
.main {
  max-width: 1200px;
  margin: 24px auto;
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 16px;
  padding: 20px 24px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
html.light .main {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.08);
}
</style>
