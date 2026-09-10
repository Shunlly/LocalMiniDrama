<template>
  <el-form-item label="原始素材">
    <el-input
      v-model="text"
      type="textarea"
      :rows="8"
      aria-label="原始素材"
      placeholder="粘贴小说、梗概、剧本、分镜表、漫画文字说明或转写文本"
    />
  </el-form-item>
</template>

<script setup>
const text = defineModel('text', { type: String, default: '' })
</script>
