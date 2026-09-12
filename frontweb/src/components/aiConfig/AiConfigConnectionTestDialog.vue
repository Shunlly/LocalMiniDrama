<template>
  <AccessibleDialog v-model="testVisible" title="测试连接" width="420px" class="ai-config-overlay" :show-close="false" @closed="restoreTestedCoverageCardFocus">
    <p class="test-result-announcement" role="status" aria-live="polite">{{ testResultAnnouncement }}</p>
    <p v-if="testResult === null">正在测试…</p>
    <template v-else-if="testResult">
      <el-alert
        v-if="testServiceType === 'image' || testServiceType === 'storyboard_image' || testServiceType === 'video'"
        type="success"
        title="连接成功"
        description="连通性探针通过。提示：测试不等同于真实生成验收，模型名填错、账号未开通该功能、配额不足或服务商临时不可用时，实际生成仍可能报错。"
        show-icon
        :closable="false"
      />
      <el-alert
        v-else-if="testServiceType === 'ocr'"
        type="success"
        title="连接成功"
        description="图片识别接口已正常响应。测试只验证连通性，不代表 PDF/图片识别已真实跑通。"
        show-icon
        :closable="false"
      />
      <el-alert
        v-else-if="testServiceType === 'transcription'"
        type="success"
        title="连接成功"
        description="语音转写接口已正常响应。测试只验证连通性，不代表音频/视频转写已真实跑通。"
        show-icon
        :closable="false"
      />
      <el-alert
        v-else
        type="success"
        title="连接成功"
        description="文本生成接口已正常响应。"
        show-icon
        :closable="false"
      />
      <p v-if="testSuggestDiscoverModels" class="field-tip">也可以读取模型目录，不会自动覆盖已填写的模型列表。</p>
    </template>
    <el-alert
      v-else
      type="error"
      :title="testError || '连接失败'"
      :description="testErrorDetail || undefined"
      show-icon
      :closable="false"
    />
    <template #footer>
      <el-button
        v-if="testResult === false"
        type="primary"
        :loading="testingConfigId !== null"
        :aria-label="testingConfigId !== null ? '正在重试连接' : '重试连接测试'" @click="retryConnectionTest"
      >重试</el-button>
      <el-button aria-label="关闭" @click="testVisible = false">关闭</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  testResult: { default: null },
  testServiceType: { type: String, default: '' },
  testError: { type: String, default: '' },
  testErrorDetail: { type: String, default: '' },
  testResultAnnouncement: { type: String, default: '' },
  testSuggestDiscoverModels: { type: Boolean, default: false },
  testingConfigId: { default: null },
  restoreTestedCoverageCardFocus: { type: Function, required: true },
  retryConnectionTest: { type: Function, required: true },
})

const testVisible = defineModel('testVisible', { type: Boolean, default: false })
</script>

<style scoped>
.test-result-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
</style>
