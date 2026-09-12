<template>
  <div v-loading="loading" class="library-list">
    <slot name="error" />
    <div v-for="item in items" :key="item.id" class="library-item">
      <slot name="item" :item="item" />
    </div>
    <slot name="empty" />
  </div>
</template>

<script setup>
// 本剧资源库列表只负责加载容器、条目槽和空态槽，封面与文案仍由父级传入
defineProps({
  loading: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
})
</script>

<style scoped>
.library-list { min-height: 120px; min-width: 0; display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-x: hidden; overflow-y: auto; }
.library-item { display: flex; gap: 12px; min-width: 0; padding: 10px; background: #1c1c1e; border: 1px solid #27272a; border-radius: 8px; }
</style>
