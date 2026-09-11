<template>
<div class="page-header">
      <div class="header-left">
        <el-button text aria-label="返回项目首页" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          项目首页
        </el-button>
        <h2 class="page-title">自由创作</h2>
      </div>
      <p class="page-desc">不绑定剧集，直接输入文字生成图片或视频</p>
    </div>
</template>

<script setup>
import { ArrowLeft } from '@element-plus/icons-vue'

const emit = defineEmits(['go-back'])

function goBack() {
  emit('go-back')
}
</script>

<style scoped>
.page-header {
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-bright);
  margin: 0;
}

.page-desc {
  color: var(--text-muted);
  font-size: 14px;
  margin: 0;
}
</style>
