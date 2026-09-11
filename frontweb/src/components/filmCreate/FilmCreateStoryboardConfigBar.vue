<template>
  <div class="sb-config-bar">
    <div class="sb-config-row">
      <label class="sb-config-item">
        <span class="sb-config-label">分镜数量</span>
        <el-input-number v-model="storyboardCount" aria-label="分镜数量（生成设置）" :min="1" :max="200" :step="5" placeholder="自动" class="sb-config-input" />
        <span class="sb-config-hint sb-config-hint--estimate" :title="scriptEstimateStoryboardTitle">留空则按剧本体量估算{{ scriptEstimateStoryboardHint }}</span>
      </label>
      <span class="sb-config-divider">｜</span>
      <label class="sb-config-item">
        <span class="sb-config-label">视频总时长(秒)</span>
        <el-input-number v-model="videoDuration" aria-label="分镜视频总时长（秒）" :min="10" :max="600" :step="5" placeholder="自动" class="sb-config-input" />
        <span class="sb-config-hint sb-config-hint--estimate" :title="scriptEstimateVideoDurationTitle">留空则按剧本体量估算{{ scriptEstimateVideoDurationHint }}</span>
      </label>
      <span class="sb-config-divider">｜</span>
      <label class="sb-config-item">
        <span class="sb-config-label">序列图模式</span>
        <el-select
          v-model="gridMode"
          :aria-label="configControlState.gridModeAriaLabel"
          :title="configControlState.gridModeDisabledReason || configControlState.gridModeHint"
          aria-describedby="sb-grid-mode-hint"
          size="small"
          style="width:110px"
          :disabled="Boolean(configControlState.gridModeDisabledReason)"
        >
          <el-option label="单张" value="single" />
          <el-option label="四宫格" value="quad_grid" />
          <el-option label="九宫格" value="nine_grid" />
        </el-select>
        <span id="sb-grid-mode-hint" class="sb-config-hint">{{ configControlState.gridModeHint }}</span>
      </label>
    </div>
    <div class="sb-config-row sb-narration-export-row" style="margin-top:10px;flex-wrap:wrap;align-items:center;gap:12px">
      <el-checkbox
        v-model="storyboardUseFirstLastFrame"
        :aria-label="configControlState.firstLastFrameAriaLabel"
        @change="onStoryboardUseFirstLastFrameChange"
      >
        首尾帧参考图（生成首帧和尾帧，帮助视频保持镜头衔接）
      </el-checkbox>
      <el-checkbox
        v-model="storyboardUniversalOmni"
        :aria-label="configControlState.universalOmniAriaLabel"
        @change="emit('save-settings')"
      >
        全能模式（每镜生成可直接用于长提示词的分段描述）
      </el-checkbox>
      <el-checkbox v-model="storyboardIncludeNarration" @change="emit('save-settings')">
        同时生成解说旁白（与对白分轨，便于配音和字幕）
      </el-checkbox>
      <ActionGate v-if="storyboards.length" :reason="episodeActionDisabledReason" label="导出分镜表">
        <el-button
          class="sb-export-srt-btn"
          size="small"
          plain
          type="primary"
          :disabled="Boolean(episodeActionDisabledReason)"
          :loading="exportingStoryboardSheet"
          :title="exportingStoryboardSheet ? '正在导出分镜表，请稍候' : (episodeActionDisabledReason || undefined)"
          :aria-label="exportingStoryboardSheet ? '正在导出分镜表，请稍候' : (episodeActionDisabledReason || '导出分镜表')" @click="onExportStoryboardSheet"
        >
          导出分镜表
        </el-button>
      </ActionGate>
      <ActionGate v-if="storyboards.length" :reason="episodeActionDisabledReason" label="导出解说 SRT">
        <el-button
          class="sb-export-srt-btn"
          size="small"
          plain
          type="primary"
          :disabled="Boolean(episodeActionDisabledReason)"
          :title="episodeActionDisabledReason || undefined"
          :aria-label="episodeActionDisabledReason || '导出解说 SRT'" @click="onExportNarrationSrt"
        >
          导出解说 SRT
        </el-button>
      </ActionGate>
    </div>
    <div id="anchor-storyboard-images" class="asset-actions sb-batch-actions">
      <div class="flex">
        <ActionGate
          :reason="storyboardActionDisabledReason"
          :label="storyboards.length > 0 ? '重新生成分镜' : 'AI 生成分镜'"
        >
          <el-button
            type="primary"
            size="large"
            :loading="storyboardGenerating || universalOmniPolishRunning"
            :aria-label="storyboardGenerating || universalOmniPolishRunning ? '正在生成分镜，请稍候' : (storyboardActionDisabledReason || (storyboards.length > 0 ? '重新生成分镜' : 'AI 生成分镜'))"
            :disabled="Boolean(storyboardActionDisabledReason)"
            :title="storyboardGenerating || universalOmniPolishRunning ? '正在生成分镜，请稍候' : (storyboardActionDisabledReason || undefined)"
            @click="onGenerateStoryboard"
          >
            {{ storyboards.length > 0 ? '重新生成分镜' : 'AI 生成分镜' }}
          </el-button>
        </ActionGate>
        <ActionGate :reason="episodeActionDisabledReason" label="添加一个分镜">
          <el-button type="info" plain size="large" :disabled="Boolean(episodeActionDisabledReason)" :title="episodeActionDisabledReason || undefined" :aria-label="episodeActionDisabledReason || '添加一个分镜'" @click="onAddSingleStoryboard">
            添加一个分镜
          </el-button>
        </ActionGate>
      </div>
      <template v-if="storyboards.length > 0">
        <div class="sb-batch-right">
          <ActionGate :reason="batchActionDisabledReason" label="批量生成分镜图">
            <el-button
              type="success"
              plain
              size="large"
              :loading="batchImageRunning"
              :disabled="Boolean(batchActionDisabledReason)"
              :title="batchImageRunning ? '正在批量生成分镜图，请稍候' : (batchActionDisabledReason || undefined)"
              :aria-label="batchImageRunning ? '正在批量生成分镜图，请稍候' : (batchActionDisabledReason || '批量生成分镜图')" @click="startBatchImageGeneration"
            >
              批量生成分镜图
            </el-button>
          </ActionGate>
          <ActionGate :reason="batchVideoActionDisabledReason" label="批量生成分镜视频">
            <el-button
              type="warning"
              plain
              size="large"
              :loading="batchVideoRunning"
              :disabled="Boolean(batchVideoActionDisabledReason)"
              :title="batchVideoRunning ? '正在批量生成分镜视频，请稍候' : (batchVideoActionDisabledReason || undefined)"
              :aria-label="batchVideoRunning ? '正在批量生成分镜视频，请稍候' : (batchVideoActionDisabledReason || '批量生成分镜视频')" @click="startBatchVideoGeneration"
            >
              批量生成分镜视频
            </el-button>
          </ActionGate>
          <el-button v-if="batchImageRunning" size="large" type="danger" plain aria-label="停止批量生成图片" @click="batchImageStopping = true">停止图片</el-button>
          <el-button v-if="batchVideoRunning" size="large" type="danger" plain aria-label="停止批量生成视频" @click="batchVideoStopping = true">停止视频</el-button>
        </div>
        <div v-if="videoCapabilityReason" class="batch-video-capability" role="alert">
          <span>{{ videoCapabilityReason }}</span>
          <el-button link type="primary" aria-label="前往 AI 配置" @click="openAiConfig('video')">前往 AI 配置</el-button>
        </div>
        <!-- 连贯帧模式 UI 暂时隐藏（保留变量与批量生成逻辑，后续可快速恢复） -->
        <div v-if="false" class="batch-video-options" style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:13px;">
          <el-checkbox v-model="videoFrameContiguity" size="small">
            连贯帧模式（自动衔接相邻视频帧）
          </el-checkbox>
          <el-tooltip placement="top" :show-after="100">
            <template #content>
              <div style="max-width:320px;line-height:1.7">
                <div style="font-weight:600;margin-bottom:4px">连贯帧模式说明</div>
                <div>启用后批量视频顺序生成，每条视频的<b>末帧</b>自动截取并作为下一条视频的<b>首帧参考图</b>，减少镜头切换的跳跃感。</div>
                <div style="margin-top:8px;font-weight:600">⚠️ 需要模型支持图生视频（i2v）</div>
                <div style="margin-top:4px">
                  ✅ 支持：kling-video、kling-omni-video、wan2.2-kf2v-flash、wan2.6-i2v-flash<br/>
                  ❌ 不支持（末帧将被忽略）：wan2.6-t2v、wan2.6-r2v-flash、wanx2.1-vace-plus 等纯文生视频模型
                </div>
                <div style="margin-top:8px;color:#faad14">如当前视频模型不支持 i2v，启用此选项不会报错，但末帧衔接不会生效。</div>
              </div>
            </template>
            <el-icon style="color:#9ca3af;cursor:help"><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'

function describeStoryboardConfigControls(input = {}) {
  const useFirstLast = Boolean(input.storyboardUseFirstLastFrame)
  const gridModeDisabledReason = useFirstLast ? '首尾帧模式下使用单张图，序列宫格暂不可用' : ''
  return {
    gridModeDisabledReason,
    gridModeHint: gridModeDisabledReason || '四/九宫格自动按视角拆分',
    gridModeAriaLabel: gridModeDisabledReason
      ? `分镜序列图模式不可用：${gridModeDisabledReason}`
      : '分镜序列图模式',
    firstLastFrameAriaLabel: '首尾帧参考图（生成首帧和尾帧，帮助视频保持镜头衔接）',
    universalOmniAriaLabel: '全能模式（每镜生成可直接用于长提示词的分段描述）',
  }
}

defineProps({
  storyboards: { type: Array, default: () => [] },
  storyboardGenerating: { type: Boolean, default: false },
  universalOmniPolishRunning: { type: Boolean, default: false },
  exportingStoryboardSheet: { type: Boolean, default: false },
  batchImageRunning: { type: Boolean, default: false },
  batchVideoRunning: { type: Boolean, default: false },
  storyboardActionDisabledReason: { type: String, default: '' },
  episodeActionDisabledReason: { type: String, default: '' },
  batchActionDisabledReason: { type: String, default: '' },
  batchVideoActionDisabledReason: { type: String, default: '' },
  videoCapabilityReason: { type: String, default: '' },
  scriptEstimateStoryboardHint: { type: String, default: '' },
  scriptEstimateStoryboardTitle: { type: String, default: '' },
  scriptEstimateVideoDurationHint: { type: String, default: '' },
  scriptEstimateVideoDurationTitle: { type: String, default: '' },
  onAddSingleStoryboard: { type: Function, required: true },
  onExportNarrationSrt: { type: Function, required: true },
  onExportStoryboardSheet: { type: Function, required: true },
  onGenerateStoryboard: { type: Function, required: true },
  onStoryboardUseFirstLastFrameChange: { type: Function, required: true },
  openAiConfig: { type: Function, required: true },
  startBatchImageGeneration: { type: Function, required: true },
  startBatchVideoGeneration: { type: Function, required: true },
})

const storyboardCount = defineModel('storyboardCount', { type: Number, default: null })
const videoDuration = defineModel('videoDuration', { type: Number, default: null })
const gridMode = defineModel('gridMode', { type: String, default: 'single' })
const storyboardUseFirstLastFrame = defineModel('storyboardUseFirstLastFrame', { type: Boolean, default: false })
const storyboardUniversalOmni = defineModel('storyboardUniversalOmni', { type: Boolean, default: false })
const storyboardIncludeNarration = defineModel('storyboardIncludeNarration', { type: Boolean, default: false })
const videoFrameContiguity = defineModel('videoFrameContiguity', { type: Boolean, default: false })
const batchImageStopping = defineModel('batchImageStopping', { type: Boolean, default: false })
const batchVideoStopping = defineModel('batchVideoStopping', { type: Boolean, default: false })

const emit = defineEmits(['save-settings'])
const configControlState = computed(() => describeStoryboardConfigControls({
  storyboardUseFirstLastFrame: storyboardUseFirstLastFrame.value,
}))
</script>

<style scoped>
.flex { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
[id^="anchor-"] { scroll-margin-top: 84px; }
.sb-batch-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.sb-batch-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.batch-video-capability {
  flex: 1 0 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.45;
}
.sb-config-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sb-config-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sb-config-label {
  font-size: 0.85rem;
  color: #a1a1aa;
  white-space: nowrap;
}
.sb-config-input {
  width: 110px;
}
.sb-config-hint {
  font-size: 0.78rem;
  color: #52525b;
  white-space: nowrap;
}
.sb-config-hint--estimate {
  white-space: normal;
  max-width: 220px;
  line-height: 1.35;
}
.sb-config-divider {
  color: #3a3a44;
  font-size: 0.85rem;
  margin: 0 4px;
}
.sb-narration-export-row :deep(.el-checkbox__label) {
  color: #e4e4e7;
  font-size: 0.875rem;
  line-height: 1.45;
}
html.light .sb-narration-export-row :deep(.el-checkbox__label) {
  color: #374151;
}
.sb-export-srt-btn.el-button--primary.is-plain {
  --el-button-bg-color: rgba(124, 58, 237, 0.75);
  --el-button-border-color: #a78bfa;
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
  --el-button-hover-bg-color: #8b5cf6;
  --el-button-hover-border-color: #c4b5fd;
}
html.light .sb-export-srt-btn.el-button--primary.is-plain {
  --el-button-bg-color: #7c3aed;
  --el-button-border-color: #6d28d9;
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
  --el-button-hover-bg-color: #6d28d9;
  --el-button-hover-border-color: #5b21b6;
}
</style>
