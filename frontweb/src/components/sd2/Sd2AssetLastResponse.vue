<template>
  <details class="sd2-asset-last-response">
    <summary class="panel-title">最近一次响应（调试）</summary>
    <p class="panel-hint">仅用于排查接口返回，默认收起，避免把厂商原文直接摊在页面上。</p>
    <el-input
      v-model="lastRawJson"
      type="textarea"
      :rows="6"
      readonly
      class="mono"
      placeholder="暂无调试响应"
      aria-label="最近一次响应（调试）"
    />
  </details>
</template>

<script setup>
// 只展示最近一次接口响应；请求仍由认证资产库父页发出。
const lastRawJson = defineModel({ type: String, default: '' })
</script>

<style scoped>
.sd2-asset-last-response {
  margin-top: 16px;
}
.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  cursor: pointer;
}
.panel-hint {
  margin: 0 0 8px;
  color: #606266;
  font-size: 12px;
  line-height: 1.5;
}
.mono :deep(textarea) {
  font-family: Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
