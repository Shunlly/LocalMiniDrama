<template>
  <div
    v-if="!loading && hasSuccessfulListLoad && !listError && total > projectPageSize"
    class="project-pagination"
    aria-label="项目列表分页"
  >
    <el-pagination
      v-model:current-page="projectPage"
      v-model:page-size="projectPageSize"
      :total="total"
      :page-sizes="[12, 24, 48]"
      layout="total, sizes, prev, pager, next"
      @current-change="loadProjectPage"
      @size-change="handleProjectPageSizeChange"
    />
  </div>
</template>

<script setup>
// 项目列表服务端分页
const projectPage = defineModel('currentPage', { type: Number, default: 1 })
const projectPageSize = defineModel('pageSize', { type: Number, default: 24 })

defineProps({
  loading: { type: Boolean, default: false },
  hasSuccessfulListLoad: { type: Boolean, default: false },
  listError: { type: String, default: '' },
  total: { type: Number, default: 0 },
  loadProjectPage: { type: Function, required: true },
  handleProjectPageSizeChange: { type: Function, required: true },
})
</script>

<style scoped>
.project-pagination {
  display: flex;
  justify-content: center;
  min-height: 56px;
  margin-top: 18px;
  padding: 10px 0 2px;
}
</style>
