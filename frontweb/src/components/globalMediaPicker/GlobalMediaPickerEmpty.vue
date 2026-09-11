<template>
  <div class="picker-empty" role="status">
    <p>{{ hasActiveFilters ? '当前筛选下没有素材。' : '素材中心还是空的。' }}</p>
    <div class="picker-empty__actions">
      <el-button v-if="hasActiveFilters" size="small" @click="emit('clear-filters')">清除筛选</el-button>
      <el-button size="small" type="primary" @click="emit('open-library')">前往素材中心上传</el-button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  hasActiveFilters: { type: Boolean, default: false },
})

const emit = defineEmits(['clear-filters', 'open-library'])
</script>

<style scoped>
.picker-empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-muted);
  flex-direction: column;
  gap: 10px;
}

.picker-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
</style>
