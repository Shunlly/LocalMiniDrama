<template>
  <div class="sd2-asset-last-response">
    <div class="panel-title">最近一次响应（调试）</div>
    <el-input
      v-model="lastRawJson"
      type="textarea"
      :rows="6"
      readonly
      class="mono"
      aria-label="最近一次响应（调试）"
    />
  </div>
</template>

<script setup>
// 只展示最近一次接口响应；请求仍由认证资产管理页发出。
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
}
.mono :deep(textarea) {
  font-family: Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
