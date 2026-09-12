<template>
  <el-input
    v-model="assetGroupIdInput"
    placeholder="组编号，或左侧点选一行"
    clearable
    style="flex: 1; min-width: 140px"
  />
</template>

<script setup>
// 资产列表的组编号筛选；点选资产组后由认证资产管理页写入该值。
const assetGroupIdInput = defineModel({ type: String, default: '' })
</script>
