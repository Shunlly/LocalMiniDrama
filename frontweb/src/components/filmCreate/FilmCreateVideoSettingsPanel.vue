<template>
  <section class="section card" aria-labelledby="video-settings-title">
    <h2 id="video-settings-title" class="section-title">视频配置</h2>
    <p class="section-lead">这些选项只在合成整集时生效，不会改已生成的分镜视频。</p>
    <p
      v-if="panelState.settingsLockedReason"
      class="video-settings-lock"
      role="status"
      data-testid="video-settings-lock-reason"
    >
      {{ panelState.settingsLockedReason }}
    </p>
    <el-form class="config-grid" label-position="top" @submit.prevent>
      <el-form-item class="video-settings-item video-settings-item--resolution" label="分辨率">
        <el-select
          :model-value="resolution"
          aria-label="成片分辨率"
          :aria-describedby="resolutionDescribedBy"
          :aria-invalid="Boolean(panelState.resolutionWarning)"
          placeholder="请选择成片分辨率"
          :disabled="panelState.settingsLocked"
          style="width: 160px"
          @update:model-value="emit('update:resolution', $event)"
        >
          <el-option
            v-if="panelState.unrecognizedResolution"
            :label="panelState.resolutionOptionLabel"
            :value="resolution"
            disabled
          />
          <el-option
            v-for="item in VIDEO_SETTINGS_RESOLUTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <p
          v-if="panelState.resolutionWarning"
          id="video-resolution-warning"
          class="video-option-warning"
          role="alert"
        >
          {{ panelState.resolutionWarning }}
        </p>
        <p id="video-resolution-hint" class="video-option-hint">按项目画幅输出对应清晰度。更高更清晰，生成更慢。</p>
      </el-form-item>

      <el-form-item label="字幕">
        <div class="video-option-row">
          <el-switch
            :model-value="subtitle"
            aria-label="成片字幕"
            aria-describedby="video-subtitle-hint"
            inline-prompt
            active-text="开"
            inactive-text="关"
            :disabled="panelState.settingsLocked"
            @update:model-value="emit('update:subtitle', $event)"
          />
        </div>
        <p id="video-subtitle-hint" class="video-option-hint">{{ panelState.subtitleHint }}</p>
      </el-form-item>

      <el-form-item label="对白烧录">
        <div class="video-option-row">
          <el-switch
            :model-value="burnDialogue"
            aria-label="对白烧录"
            aria-describedby="video-burn-dialogue-hint"
            inline-prompt
            active-text="开"
            inactive-text="关"
            :disabled="panelState.settingsLocked"
            @update:model-value="emit('update:burnDialogue', $event)"
          />
        </div>
        <p id="video-burn-dialogue-hint" class="video-option-hint">{{ panelState.burnDialogueHint }}</p>
      </el-form-item>

      <el-form-item label="水印">
        <div class="video-option-row">
          <el-switch
            :model-value="watermark"
            aria-label="成片水印"
            :aria-describedby="watermarkDescribedBy"
            inline-prompt
            active-text="开"
            inactive-text="关"
            :disabled="panelState.settingsLocked"
            @update:model-value="emit('update:watermark', $event)"
          />
          <el-input
            v-if="watermark"
            :model-value="watermarkText"
            aria-label="水印文字"
            :aria-describedby="watermarkDescribedBy"
            :aria-invalid="Boolean(panelState.watermarkWarning)"
            placeholder="右下角水印文字"
            maxlength="200"
            show-word-limit
            clearable
            class="video-watermark-input"
            :disabled="panelState.settingsLocked"
            @update:model-value="emit('update:watermarkText', $event)"
          />
        </div>
        <p
          v-if="panelState.watermarkWarning"
          id="video-watermark-warning"
          class="video-option-warning"
          role="alert"
        >
          {{ panelState.watermarkWarning }}
        </p>
        <p
          v-else
          id="video-watermark-hint"
          class="video-option-hint"
        >
          {{ panelState.watermarkHint }}
        </p>
      </el-form-item>
    </el-form>
    <p class="config-tip">分镜图、分镜视频和旁白语音使用的模型，以「<button type="button" class="ai-config-text-button" @click="emit('open-ai-config')">AI 配置</button>」中设为默认的为准。这里的成片选项只影响合成整集。</p>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const VIDEO_SETTINGS_RESOLUTIONS = [
  { value: '480p', label: '480p（更省流量）' },
  { value: '720p', label: '720p（推荐）' },
  { value: '1080p', label: '1080p（更清晰）' },
]

function describeVideoSettingsPanel(input = {}) {
  const resolution = String(input.resolution || '').trim()
  const subtitle = Boolean(input.subtitle)
  const burnDialogue = Boolean(input.burnDialogue)
  const watermark = Boolean(input.watermark)
  const watermarkText = String(input.watermarkText || '').trim()
  const disabled = Boolean(input.disabled)
  const disabledReason = String(input.disabledReason || '').trim()
  const supported = resolution === '480p' || resolution === '720p' || resolution === '1080p'
  const settingsLockedReason = disabledReason || (disabled ? '当前不能修改视频配置。' : '')
  let watermarkWarning = ''
  let watermarkHint = '关闭时，成片右下角不会叠加文字水印。'
  if (watermark && !watermarkText) {
    watermarkWarning = '已开启水印，但还没填写文字。合成时不会叠加水印。'
    watermarkHint = ''
  } else if (watermark) {
    watermarkHint = '水印会出现在成片右下角，最多 200 字。'
  }
  return {
    settingsLockedReason,
    settingsLocked: Boolean(settingsLockedReason),
    unrecognizedResolution: Boolean(resolution) && !supported,
    resolutionWarning: !resolution
      ? '还没有选择成片分辨率。'
      : (supported ? '' : '当前分辨率不受支持，合成前请改成 480p、720p 或 1080p。'),
    subtitleHint: subtitle
      ? '开启后，合成整集时会检测解说旁白：有文案则生成字幕文件、按分镜时长合成旁白语音（过长加速 / 过短补静音），再烧录到成片并混音。没有旁白文案的分镜会跳过。'
      : '关闭时，合成成片不会烧录解说旁白字幕，也不会生成旁白语音。',
    burnDialogueHint: burnDialogue
      ? '开启后，会把各镜已生成的对白配音按分镜时长对齐并混入整集成片；没有对白音频的分镜保持静音。可与「字幕」同时开启，旁白和对白会叠混。'
      : '关闭时，各镜对白配音不会混入整集成片。此项是混音，不是把对白字烧到画面上。',
    watermarkWarning,
    watermarkHint,
    resolutionOptionLabel: !resolution
      ? '请选择成片分辨率'
      : (supported ? resolution : `${resolution}（不受支持）`),
  }
}

const props = defineProps({
  resolution: { type: String, default: '720p' },
  subtitle: { type: Boolean, default: false },
  burnDialogue: { type: Boolean, default: false },
  watermark: { type: Boolean, default: false },
  watermarkText: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  disabledReason: { type: String, default: '' },
})

const emit = defineEmits([
  'update:resolution',
  'update:subtitle',
  'update:burnDialogue',
  'update:watermark',
  'update:watermarkText',
  'open-ai-config',
])

const panelState = computed(() => describeVideoSettingsPanel(props))
const resolutionDescribedBy = computed(() => (
  panelState.value.resolutionWarning
    ? 'video-resolution-warning video-resolution-hint'
    : 'video-resolution-hint'
))
const watermarkDescribedBy = computed(() => (
  panelState.value.watermarkWarning ? 'video-watermark-warning' : 'video-watermark-hint'
))
</script>

<style scoped>
.section {
  margin-bottom: 24px;
}
.card {
  background: #1e1f28;
  border-radius: 14px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
}
.card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
}
html.light .card {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  border-color: rgba(139, 92, 246, 0.08);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 4px 20px rgba(99, 102, 241, 0.05);
}
html.light .card:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 36px rgba(99, 102, 241, 0.08);
}
.section-title {
  font-size: 1.05rem;
  margin: 0 0 4px;
  color: #f4f4f5;
  font-weight: 600;
  letter-spacing: -0.01em;
}
html.light .section-title { color: #1e1b4b; }
.section-lead {
  margin: 0 0 12px;
  color: #a1a1aa;
  font-size: 13px;
  line-height: 1.55;
}
html.light .section-lead { color: #52525b; }
.video-settings-lock,
.video-option-warning {
  margin: 0 0 12px;
  color: #fbbf24;
  font-size: 12px;
  line-height: 1.5;
}
.video-option-warning {
  margin: 6px 0 0;
}
html.light .video-settings-lock,
html.light .video-option-warning {
  color: #b45309;
}
.config-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px 24px;
  margin-bottom: 16px;
}
.video-settings-item--resolution {
  max-width: 360px;
}
.video-option-hint {
  display: block;
  margin: 6px 0 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}
.video-option-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
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
.ai-config-text-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
}
.ai-config-text-button:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
.ai-config-text-button:disabled,
.video-settings-lock + .config-grid :deep(.el-switch.is-disabled),
.video-settings-lock + .config-grid :deep(.el-select.is-disabled) {
  cursor: not-allowed;
}
</style>