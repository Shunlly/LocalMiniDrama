<template>
  <section class="config-form-section config-policy-section">
    <div class="config-section-header">
      <div>
        <h4>调用策略</h4>
        <p>同类服务有多个配置时，默认项优先于普通配置，优先级用于后续排序。</p>
      </div>
      <span class="config-section-index">{{ form.service_type === 'jimeng2_character_auth' ? '03' : '04' }}</span>
    </div>
    <template v-if="['text', 'image', 'storyboard_image', 'video', 'tts'].includes(form.service_type)">
      <el-form-item v-if="form.service_type === 'text'" label="输入单价">
        <div class="pricing-field-row">
          <el-input-number v-model="form.pricing_input_per_million_tokens" :min="0" :precision="4" :step="0.1" controls-position="right" />
          <span>USD / 百万 tokens</span>
        </div>
      </el-form-item>
      <el-form-item v-if="form.service_type === 'text'" label="输出单价">
        <div class="pricing-field-row">
          <el-input-number v-model="form.pricing_output_per_million_tokens" :min="0" :precision="4" :step="0.1" controls-position="right" />
          <span>USD / 百万 tokens</span>
        </div>
      </el-form-item>
      <el-form-item v-else-if="form.service_type === 'image' || form.service_type === 'storyboard_image'" label="图片单价">
        <div class="pricing-field-row">
          <el-input-number v-model="form.pricing_per_image" :min="0" :precision="6" :step="0.01" controls-position="right" />
          <span>USD / 张</span>
        </div>
      </el-form-item>
      <el-form-item v-else-if="form.service_type === 'video'" label="视频单价">
        <div class="pricing-field-row">
          <el-input-number v-model="form.pricing_per_second" :min="0" :precision="6" :step="0.01" controls-position="right" />
          <span>USD / 秒</span>
        </div>
      </el-form-item>
      <el-form-item v-else-if="form.service_type === 'tts'" label="语音单价">
        <div class="pricing-field-row">
          <el-input-number v-model="form.pricing_per_1000_characters" :min="0" :precision="6" :step="0.01" controls-position="right" />
          <span>USD / 千字符</span>
        </div>
      </el-form-item>
      <p class="pricing-help">选填。用于 Production 工作流成本估算；留空会明确显示为“未配置价格”，不会误报为零成本。</p>
    </template>
    <el-form-item>
      <template #label>
        <span class="form-label-tip">优先级
          <el-tooltip content="同一服务类型有多个配置时，数字越大越优先被调用。默认 0，一般设为 10 即可。" placement="top" popper-class="cfg-tip-popper">
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-input-number v-model="form.priority" :min="0" :max="999" />
    </el-form-item>
    <el-form-item>
      <template #label>
        <span class="form-label-tip">设为默认
          <el-tooltip placement="top" popper-class="cfg-tip-popper">
            <template #content>
              <div class="cfg-tip-content">
                每种服务类型只有一个「默认」配置。<br>
                生成时系统会优先使用默认配置，建议每类至少设一个默认。
              </div>
            </template>
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-switch v-model="form.is_default" :disabled="configWriteLocked" />
    </el-form-item>
  </section>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'

defineProps({
  form: { type: Object, required: true },
  configWriteLocked: { type: Boolean, default: false },
})
</script>

<style scoped>
.config-form-section {
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-blank, #fff);
}
.config-policy-section {
  margin-bottom: 0;
}
.config-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.config-section-header h4 {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: 15px;
  line-height: 22px;
}
.config-section-header p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular, #606266);
  font-size: 12px;
  line-height: 1.5;
}
.config-section-index {
  flex: 0 0 auto;
  min-width: 34px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-size: 12px;
  font-weight: 600;
}
.form-label-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.tip-icon {
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.tip-icon:hover {
  color: var(--el-color-primary, #409eff);
}
.pricing-field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pricing-field-row span {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  white-space: nowrap;
}
.pricing-help {
  margin: -4px 0 14px 100px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
}
@media (max-width: 760px) {
  .config-section-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .pricing-help {
    margin-left: 0;
  }
  .pricing-field-row {
    flex-wrap: wrap;
  }
}
@media (max-width: 520px) {
  .config-form-section {
    padding: 12px;
  }
}
</style>
