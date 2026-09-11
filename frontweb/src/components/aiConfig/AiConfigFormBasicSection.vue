<template>
  <section class="config-form-section">
    <div class="config-section-header">
      <div>
        <h4>基础信息</h4>
        <p>先确定服务用途和便于识别的配置名称。</p>
      </div>
      <span class="config-section-index">01</span>
    </div>
    <el-form-item prop="service_type">
      <template #label>
        <span class="form-label-tip">服务类型
          <el-tooltip placement="top" :show-arrow="true" popper-class="cfg-tip-popper">
            <template #content>
              <div class="cfg-tip-content">
                <b>文本/对话</b>：用于 AI 生成故事剧本<br>
                <b>文本生成图片</b>：角色、场景、道具的图片生成（不支持参考图）<br>
                <b>分镜图片生成</b>：生成分镜图片，支持传入角色参考图<br>
                <b>视频生成</b>：根据分镜图生成视频片段<br>
                <b>语音合成 TTS</b>：为分镜对白自动合成语音（点分镜配音按钮时使用）<br>
                <b>图片识别 OCR</b>：用于 PDF、扫描件和图片抽文字。本机也可安装 Tesseract。预设只用于填表，不代表已跑通该厂商<br>
                <b>语音转写</b>：用于音频、视频对白转成文字。预设只用于填表，不代表已跑通该厂商<br>
                <b>即梦2角色认证</b>：将角色主图登记到即梦业务素材库（认证资产），仅填网关 URL 与 Token
              </div>
            </template>
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-select
        v-model="form.service_type"
        data-ai-config-field="service_type"
        aria-label="服务类型"
        placeholder="选择类型"
        no-data-text="暂无可选服务类型"
        style="width: 100%"
        :disabled="Boolean(editingId)"
        :aria-invalid="isConfigFieldInvalid('service_type')"
        :aria-describedby="configFieldDescriptionId('service_type')"
        @change="onServiceTypeChange"
      >
        <el-option label="文本/对话" value="text" />
        <el-option label="文本生成图片" value="image" />
        <el-option label="分镜图片生成" value="storyboard_image" />
        <el-option label="视频生成" value="video" />
        <el-option label="语音合成 TTS" value="tts" />
        <el-option label="图片识别 OCR" value="ocr" />
        <el-option label="语音转写" value="transcription" />
        <el-option label="即梦2角色认证" value="jimeng2_character_auth" />
      </el-select>
      <span :id="configFieldDescriptionId('service_type')" class="config-field-a11y-description">
        {{ configFieldDescription('service_type') }}
      </span>
    </el-form-item>
    <el-form-item prop="name">
      <template #label>
        <span class="form-label-tip">名称
          <el-tooltip content="配置的显示名，用于在列表中区分不同配置，选择厂商后可自动生成。" placement="top" popper-class="cfg-tip-popper">
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-input
        v-model="form.name"
        data-ai-config-field="name"
        placeholder="如：OpenAI 图文，可自动生成"
        :aria-invalid="isConfigFieldInvalid('name')"
        :aria-describedby="configFieldDescriptionId('name')"
      />
      <span :id="configFieldDescriptionId('name')" class="config-field-a11y-description">
        {{ configFieldDescription('name') }}
      </span>
    </el-form-item>
  </section>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'

defineProps({
  form: { type: Object, required: true },
  editingId: { default: null },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
  onServiceTypeChange: { type: Function, required: true },
})
</script>

<style scoped>
.config-field-a11y-description {
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
.config-form-section {
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-blank, #fff);
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
@media (max-width: 760px) {
  .config-section-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 520px) {
  .config-form-section {
    padding: 12px;
  }
}
</style>
