<template>
  <section class="section card">
    <h2 class="section-title">视频配置</h2>
    <div class="config-grid">
      <el-form-item label="分辨率">
        <el-select :model-value="resolution" aria-label="成片分辨率" style="width: 160px" @update:model-value="emit('update:resolution', $event)">
          <el-option label="480p" value="480p" />
          <el-option label="720p" value="720p" />
          <el-option label="1080p" value="1080p" />
        </el-select>
      </el-form-item>
      <el-form-item label="字幕">
        <div class="video-option-row">
          <el-switch :model-value="subtitle" @update:model-value="emit('update:subtitle', $event)" />
          <span v-if="subtitle" class="video-option-hint">开启后，合成整集时会检测解说旁白：若有文案则自动生成 SRT、按分镜时长合成旁白语音（过长加速 / 过短补静音）、与成片对齐后烧录字幕并混音。</span>
        </div>
      </el-form-item>
      <el-form-item label="对白烧录">
        <div class="video-option-row">
          <el-switch :model-value="burnDialogue" @update:model-value="emit('update:burnDialogue', $event)" />
          <span v-if="burnDialogue" class="video-option-hint">开启后，将把各镜生成的对白配音按分镜时长对齐并混入整集成片（无对白音频的分镜为静音）。可与「字幕」旁白同时开启，两条音轨会叠混。</span>
        </div>
      </el-form-item>
      <el-form-item label="水印">
        <div class="video-option-row">
          <el-switch :model-value="watermark" @update:model-value="emit('update:watermark', $event)" />
          <el-input
            v-if="watermark"
            :model-value="watermarkText"
            placeholder="右下角水印文字"
            maxlength="200"
            show-word-limit
            clearable
            class="video-watermark-input"
            @update:model-value="emit('update:watermarkText', $event)"
          />
        </div>
      </el-form-item>
    </div>
    <p class="config-tip">文本/图片/视频使用的模型以「<el-link type="primary" underline="never" @click="emit('open-ai-config')">AI 配置</el-link>」中设为默认的为准。</p>
  </section>
</template>

<script setup>
defineProps({
  resolution: { type: String, default: '720p' },
  subtitle: { type: Boolean, default: false },
  burnDialogue: { type: Boolean, default: false },
  watermark: { type: Boolean, default: false },
  watermarkText: { type: String, default: '' },
})

const emit = defineEmits([
  'update:resolution',
  'update:subtitle',
  'update:burnDialogue',
  'update:watermark',
  'update:watermarkText',
  'open-ai-config',
])
</script>

<style scoped>
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px 24px;
  margin-bottom: 16px;
}
.video-option-hint {
  flex: 1;
  min-width: 200px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}
.video-option-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 12px;
}
.video-watermark-input {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.config-tip {
  margin: 12px 0 0;
  font-size: 0.9rem;
  color: #a1a1aa;
}
.config-tip .el-link { font-size: inherit; }
</style>
