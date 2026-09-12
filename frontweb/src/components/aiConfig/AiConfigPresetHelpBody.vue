<template>
  <div class="ph-body">
    <template v-for="(block, index) in blocks" :key="index">
      <pre v-if="block.type === 'pre'">{{ block.text }}</pre>
      <template v-else>
        <template v-for="(part, partIndex) in block.parts || []" :key="partIndex">
          <b v-if="part.bold">{{ part.bold }}</b>
          <code v-else-if="part.code">{{ part.code }}</code>
          <template v-else>{{ part.text }}</template>
        </template>
        <br v-if="index < blocks.length - 1">
      </template>
    </template>
  </div>
</template>

<script setup>
defineProps({
  blocks: { type: Array, default: () => [] },
})
</script>

<style scoped>
.ph-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-primary, #303133);
}
.ph-body pre {
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  margin: 6px 0 2px;
  white-space: pre-wrap;
  word-break: break-all;
}
.ph-body code {
  background: var(--ai-config-code-surface, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
