<template>
  <main class="not-found-page">
    <section class="not-found-content" aria-labelledby="not-found-title">
      <p class="product-name">
        <span class="logo-main">本地短剧助手</span>
        <span class="logo-sub">LocalMiniDrama</span>
      </p>
      <p class="status-code" aria-hidden="true">404</p>
      <h1 id="not-found-title" ref="titleRef" tabindex="-1" aria-describedby="not-found-reason not-found-next-step">{{ copy.title }}</h1>
      <p id="not-found-reason" class="description">{{ copy.reason }}</p>
      <p id="not-found-next-step" class="next-step">{{ copy.nextStep }}</p>
      <div class="actions">
        <el-button v-if="canGoBack" :icon="ArrowLeft" aria-label="返回上一页" @click="goBack">返回上一页</el-button>
        <el-button type="primary" :icon="HomeFilled" aria-label="返回项目列表" @click="goHome">返回项目列表</el-button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowLeft, HomeFilled } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { resolveNotFoundCopy, resolveNotFoundDisplayPath, resolveNotFoundNavigation } from '@/utils/notFoundNavigation.js'

const route = useRoute()
const router = useRouter()
const titleRef = ref(null)

const navigation = computed(() => resolveNotFoundNavigation(router.options.history.state, route.fullPath))
const canGoBack = computed(() => navigation.value.type === 'back')
const fromPath = computed(() => resolveNotFoundDisplayPath(route))
const copy = computed(() => resolveNotFoundCopy(fromPath.value, { canGoBack: canGoBack.value }))

function goHome() {
  router.replace({ name: 'list' })
}

function goBack() {
  if (canGoBack.value) router.back()
  else goHome()
}

function focusTitle() {
  titleRef.value?.focus({ preventScroll: true })
}

onMounted(focusTitle)

watch(() => route.fullPath, (fullPath, previousFullPath) => {
  if (!previousFullPath || fullPath === previousFullPath) return
  nextTick(focusTitle)
})
</script>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background: var(--bg-page);
  color: var(--text-primary);
}

.not-found-content {
  width: min(100%, 460px);
  text-align: center;
}

.product-name {
  margin: 0 0 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  line-height: 1.2;
}
.logo-main {
  color: var(--accent-text);
  font-size: 15px;
  font-weight: 700;
}
.logo-sub {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
}

.status-code {
  margin: 0;
  color: var(--text-muted);
  font-size: 56px;
  line-height: 1;
  font-weight: 700;
}

h1 {
  margin: 16px 0 8px;
  font-size: 28px;
  line-height: 1.3;
}

h1:focus {
  outline: none;
}

h1:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 4px;
}

.description {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.7;
}

.next-step {
  margin: 12px 0 0;
  color: var(--text-primary);
  line-height: 1.7;
  font-weight: 600;
}

.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

@media (max-width: 480px) {
  .not-found-page {
    padding: 24px 18px;
  }

  .actions {
    flex-direction: column-reverse;
  }

  .actions :deep(.el-button) {
    width: 100%;
    margin: 0;
  }
}
</style>
