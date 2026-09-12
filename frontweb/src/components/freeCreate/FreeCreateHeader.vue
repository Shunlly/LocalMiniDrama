<template>
<div class="page-header">
      <div class="header-left">
        <el-button text class="back-link" aria-label="返回项目首页" @click="goBack">
          <el-icon aria-hidden="true"><ArrowLeft /></el-icon>
          返回项目首页
        </el-button>
        <h1 class="page-title">自由创作</h1>
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
  min-width: 0;
  overflow-x: clip;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-bright);
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.page-desc {
  color: var(--text-muted);
  font-size: 14px;
  margin: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.back-link {
  padding-left: 0;
}

.back-link:focus-visible {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: 2px;
}

@media (max-width: 520px) {
  .header-left {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
