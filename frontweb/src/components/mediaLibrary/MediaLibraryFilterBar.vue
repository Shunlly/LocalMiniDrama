<template>
    <div class="filter-bar">
      <el-radio-group v-model="mediaType" class="type-filter" aria-label="素材类型筛选" @change="applyFilters">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="image">图片</el-radio-button>
        <el-radio-button value="video">视频</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="keyword"
        placeholder="搜索素材..."
        aria-label="搜索素材"
        class="search-input"
        clearable
        @input="debouncedLoad"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>
</template>

<script setup>

// 仅展示本地筛选栏；筛选状态仍留在素材中心页，加载函数由页面注入。
import { Search } from '@element-plus/icons-vue'

const mediaType = defineModel('mediaType', { type: String, required: true })
const keyword = defineModel('keyword', { type: String, required: true })

defineProps({
  applyFilters: { type: Function, required: true },
  debouncedLoad: { type: Function, required: true },
})
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.search-input {
  width: 240px;
}
</style>
