<template>
  <span v-if="reason" class="canvas-action-gate-wrap">
    <el-tooltip :content="reason" placement="bottom" :show-after="180">
      <span
        class="canvas-action-gate"
        role="group"
        tabindex="0"
        aria-disabled="true"
        :aria-label="`${label}不可用`"
        v-bind="{ 'aria-describedby': descriptionId }"
      >
        <slot />
        <span :id="descriptionId" class="visually-hidden">{{ reason }}</span>
      </span>
    </el-tooltip>
    <el-button
      v-if="canOpenAiConfig"
      link
      type="primary"
      size="small"
      class="config-link"
      :aria-label="`前往${serviceLabel} AI 配置`"
      @click.stop="openAiConfig"
    >
      前往 AI 配置
    </el-button>
  </span>
  <slot v-else />
</template>

<script setup>
import { computed, inject } from 'vue'

const props = defineProps({
  reason: { type: String, default: '' },
  label: { type: String, default: '此操作' },
  descriptionId: { type: String, required: true },
  configServiceType: { type: String, default: '' },
})

const openAiConfigHandler = inject('localMiniDrama.canvas.openAiConfig', null)
const canOpenAiConfig = computed(() => (
  Boolean(props.configServiceType) && typeof openAiConfigHandler === 'function'
))
const serviceLabel = computed(() => (
  props.configServiceType === 'video' ? '视频' : props.configServiceType === 'tts' ? '语音合成' : ''
))

function openAiConfig() {
  openAiConfigHandler?.(props.configServiceType)
}
</script>

<style scoped>
.canvas-action-gate-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  flex-wrap: wrap;
}

.canvas-action-gate {
  display: inline-flex;
  max-width: 100%;
  cursor: not-allowed;
}

.config-link {
  margin: 0;
  padding-inline: 2px;
}

.canvas-action-gate:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}

.visually-hidden {
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
</style>
