<template>
  <main class="not-found-page">
    <section class="not-found-content" aria-labelledby="not-found-title">
      <p class="product-name">LocalMiniDrama</p>
      <p class="status-code" aria-hidden="true">404</p>
      <h1 id="not-found-title" ref="titleRef" tabindex="-1">页面不存在</h1>
      <p class="description">
        <template v-if="fromPath">无法打开地址 {{ fromPath }}。地址可能已失效，或项目编号不正确。</template>
        <template v-else>地址可能已失效，或项目编号不正确。</template>
      </p>
      <div class="actions">
        <el-button v-if="canGoBack" :icon="ArrowLeft" @click="goBack">返回上一页</el-button>
        <el-button type="primary" :icon="HomeFilled" @click="goHome">项目列表</el-button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, HomeFilled } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { resolveNotFoundFromPath, resolveNotFoundNavigation } from '@/utils/notFoundNavigation.js'

const route = useRoute()
const router = useRouter()
const titleRef = ref(null)

const navigation = computed(() => resolveNotFoundNavigation(router.options.history.state, route.fullPath))
const canGoBack = computed(() => navigation.value.type === 'back')
const fromPath = computed(() => resolveNotFoundFromPath(route.query.from))

function goBack() {
  if (canGoBack.value) router.back()
  else router.replace('/')
}

function goHome() {
  router.replace('/')
}

onMounted(() => {
  titleRef.value?.focus({ preventScroll: true })
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
  color: var(--accent-text);
  font-size: 15px;
  font-weight: 700;
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
