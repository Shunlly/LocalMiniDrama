<template>
  <div
    v-if="!networkLoading && !networkError && networkSearched && networkItems.length === 0"
    class="network-empty"
    role="status"
    aria-live="polite"
  >
    <el-icon><Files /></el-icon>
    <h2>没有找到匹配的网络素材</h2>
    <p>请更换关键词或素材类型后重试。</p>
    <div class="network-empty-actions">
      <el-button
        v-if="searchNetworkMedia"
        type="primary"
        plain
        aria-label="重新搜索网络素材"
        @click="searchNetworkMedia"
      >重新搜索</el-button>
      <el-button aria-label="清除网络素材搜索" @click="clearNetworkSearch">清除搜索</el-button>
    </div>
  </div>
  <div v-else-if="!networkLoading && !networkError && !networkSearched" class="network-empty" role="status" aria-live="polite">
    <el-icon><Search /></el-icon>
    <h2>搜索可导入的网络素材</h2>
    <p>结果会在这里显示，并附带来源和许可信息。</p>
    <p>下一步：在上方输入关键词后点搜索。</p>
  </div>
</template>

<script setup>
// 仅展示网络素材空态；搜索仍由素材中心页处理。
import { Files, Search } from '@element-plus/icons-vue'

defineProps({
  networkLoading: { type: Boolean, default: false },
  networkError: { type: String, default: '' },
  networkSearched: { type: Boolean, default: false },
  networkItems: { type: Array, default: () => [] },
  searchNetworkMedia: { type: Function, default: null },
  clearNetworkSearch: { type: Function, required: true },
})
</script>

<style scoped>
.network-empty {
  grid-column: 1 / -1;
  display: flex;
  min-height: 260px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-subtle);
  text-align: center;
}

.network-empty .el-icon {
  font-size: 42px;
}

.network-empty h2,
.network-empty p {
  margin: 0;
}

.network-empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}

.network-empty h2 {
  color: var(--text-bright);
  font-size: 17px;
}
</style>
