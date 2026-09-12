<template>
  <div class="sb-panel sb-video">
    <div v-if="getSbVideo(sb.id)" class="sb-video-area">
      <video
        v-if="assetVideoUrl(getSbVideo(sb.id))"
        :key="sbMainVideoPlayerKey(sb.id)"
        :src="assetVideoUrl(getSbVideo(sb.id))"
        controls
        :aria-label="`分镜 ${sb.storyboard_number} 视频预览`"
        class="sb-video-player"
        preload="metadata"
      />
      <div
        v-else
        class="sb-video-error"
        :title="getSbVideoError(sb.id) || '视频地址无效'"
      >
        {{ getSbVideoError(sb.id) || '视频地址无效，请重新生成' }}
      </div>
      <span v-if="isSbVideoGenerating(sb.id)" class="sb-video-regenerating-overlay">
        <el-icon class="is-loading"><Loading /></el-icon>
        正在重新生成...
      </span>
    </div>
    <div v-else class="sb-video-area sb-video-placeholder">
      <span v-if="isSbVideoGenerating(sb.id)" class="sb-video-generating-text">
        <el-icon class="is-loading"><Loading /></el-icon>
        正在生成视频...
      </span>
      <template v-else>
        <div v-if="getSbVideoError(sb.id)" class="sb-video-error">
          {{ getSbVideoError(sb.id) }}
        </div>
        <ActionGate :reason="sbVideoGenerationDisabledReason(sb)" label="生成分镜视频">
          <el-button
            type="primary"
            size="small"
            class="sb-generate-video-btn"
            :loading="isSbVideoGenerating(sb.id)"
            :disabled="Boolean(sbVideoGenerationDisabledReason(sb))"
            :title="isSbVideoGenerating(sb.id) ? '正在生成分镜视频，请稍候' : (sbVideoGenerationDisabledReason(sb) || undefined)"
            :aria-label="isSbVideoGenerating(sb.id) ? '正在生成分镜视频，请稍候' : (sbVideoGenerationDisabledReason(sb) || `生成分镜${sb.storyboard_number}视频`)" @click="onGenerateSbVideo(sb)"
          >
            生成分镜视频
          </el-button>
        </ActionGate>
      </template>
    </div>
    <!-- 视频历史条：有多条历史时显示，点击可切换 -->
    <div v-if="getVideoStripItems(sb.id).length" class="sb-videos-strip">
      <el-tooltip content="历史视频：点击可切换为当前视频" placement="top" :show-arrow="false">
        <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
      </el-tooltip>
      <button
        type="button"
        v-for="item in getVideoStripItems(sb.id)"
        :key="item.key"
        class="sb-video-thumb"
        :title="`${item.label}（点击切换）`"
        :aria-label="`切换到${item.label}`"
        @click="onSelectSbMainVideo(sb, item.video)"
      >
        <video :src="item.src" preload="metadata" aria-hidden="true" class="sb-video-thumb-player" />
        <span class="sb-video-thumb-label">{{ item.label }}</span>
      </button>
    </div>
    <div v-if="getSbVideo(sb.id)" class="sb-video-actions">
      <ActionGate :reason="sbVideoGenerationDisabledReason(sb)" label="重新生成">
        <el-button size="small" :loading="isSbVideoGenerating(sb.id)" :disabled="Boolean(sbVideoGenerationDisabledReason(sb))" :title="isSbVideoGenerating(sb.id) ? '正在生成分镜视频，请稍候' : (sbVideoGenerationDisabledReason(sb) || undefined)" :aria-label="isSbVideoGenerating(sb.id) ? '正在生成分镜视频，请稍候' : (sbVideoGenerationDisabledReason(sb) || `生成分镜${sb.storyboard_number}视频`)" @click="onGenerateSbVideo(sb)">重新生成</el-button>
      </ActionGate>
      <el-tooltip v-if="getNextStoryboard(sb.id)" content="提取本视频尾帧，设为下一个分镜的首帧" placement="top">
        <el-button size="small" :loading="linkingTailFrameIds.has(sb.id)" :title="linkingTailFrameIds.has(sb.id) ? '正在衔接尾帧，请稍候' : undefined" :aria-label="linkingTailFrameIds.has(sb.id) ? '正在衔接尾帧，请稍候' : `将分镜${sb.storyboard_number}尾帧衔接到下一镜`" @click="onLinkTailFrameToNext(sb)">尾帧衔接</el-button>
      </el-tooltip>
      <ActionGate v-if="sb.dialogue" :reason="ttsGenerationDisabledReason(sb.id, 'dialogue')" label="对白配音">
        <el-button
          size="small"
          :loading="ttsSbIds.has(sb.id)"
          :disabled="Boolean(ttsGenerationDisabledReason(sb.id, 'dialogue'))"
          :title="ttsSbIds.has(sb.id) ? '正在生成对白配音，请稍候' : (ttsGenerationDisabledReason(sb.id, 'dialogue') || undefined)"
          :aria-label="ttsSbIds.has(sb.id) ? '正在生成对白配音，请稍候' : (ttsGenerationDisabledReason(sb.id, 'dialogue') || `生成分镜${sb.storyboard_number}对白配音`)" @click="onTtsSbDialogue(sb)"
        >
          对白配音
        </el-button>
      </ActionGate>
      <el-tooltip v-if="sb.dialogue && sbDialogueAudioRelPath(sb)" content="播放对白配音" placement="top">
        <el-button size="small" :aria-label="`播放分镜${sb.storyboard_number || i + 1}对白配音`" @click="playSbDialogueTts(sb)">
          <el-icon><VideoPlay /></el-icon>
        </el-button>
      </el-tooltip>
    </div>
    <div
      v-if="!sbCanSubmitVideo(sb)"
      class="sb-video-disabled-reason"
      role="status"
      tabindex="0"
    >
      <el-icon><WarningFilled /></el-icon>
      <span>{{ sbVideoGenerationDisabledReason(sb) }}</span>
    </div>
    <div
      v-if="gridRefState.visible"
      class="sb-video-grid-ref"
      :class="{ 'is-selected': gridRefState.hasSelected }"
      role="status"
      :aria-label="gridRefState.ariaLabel"
    >
      <span class="sb-dot"></span>
      <span class="sb-video-grid-ref-status">{{ gridRefState.statusText }}</span>
      <span class="sb-video-grid-ref-hint">{{ gridRefState.hintText }}</span>
      <el-button
        v-if="gridRefState.canOpenParams"
        size="small"
        link
        type="primary"
        :aria-label="gridRefState.actionAriaLabel"
        @click="onOpenGridRefParams"
      >
        {{ gridRefState.actionText }}
      </el-button>
    </div>
    <div class="sb-video-prompt-label">
      <span class="sb-dot"></span>
      <span>视频提示词</span>
    </div>
    <div class="sb-video-params-bar">
      <span class="sb-video-prompt-text sb-video-prompt-text--preview">{{ sb.video_prompt || '暂无视频提示词（在「视频配置」保存后自动生成）' }}</span>
      <el-button size="small" link type="primary" :aria-label="`手工编辑分镜${sb.storyboard_number}视频提示词`" @click="onOpenSbPromptDialog(sb)">手工编辑</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { InfoFilled, Loading, VideoPlay, WarningFilled } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import { describeSbVideoGridReference } from '@/components/filmCreate/filmCreateStoryboardVideoColumnCopy.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  sb: { type: Object, required: true },
  i: { type: Number, required: true },
  linkingTailFrameIds: { type: [Set, Object], default: () => new Set() },
  ttsSbIds: { type: [Set, Object], default: () => new Set() },
  assetVideoUrl: { type: Function, required: true },
  getNextStoryboard: { type: Function, required: true },
  getSbVideo: { type: Function, required: true },
  getSbVideoError: { type: Function, required: true },
  getVideoStripItems: { type: Function, required: true },
  isSbVideoGenerating: { type: Function, required: true },
  onGenerateSbVideo: { type: Function, required: true },
  onLinkTailFrameToNext: { type: Function, required: true },
  onOpenSbPromptDialog: { type: Function, required: true },
  onSelectSbMainVideo: { type: Function, required: true },
  onTtsSbDialogue: { type: Function, required: true },
  playSbDialogueTts: { type: Function, required: true },
  sbCanSubmitVideo: { type: Function, required: true },
  sbDialogueAudioRelPath: { type: Function, required: true },
  sbMainVideoPlayerKey: { type: Function, required: true },
  sbVideoGenerationDisabledReason: { type: Function, required: true },
  ttsGenerationDisabledReason: { type: Function, required: true },
  getSbGridImages: { type: Function, default: undefined },
  getSbVideoReferenceGrid: { type: Function, default: undefined },
  onOpenVideoParams: { type: Function, default: undefined },
  gridMode: { type: String, default: 'single' },
})

const gridRefState = computed(() => describeSbVideoGridReference({
  sb: props.sb,
  storyboardIndex: props.i,
  gridMode: props.gridMode,
  getSbGridImages: props.getSbGridImages,
  getSbVideoReferenceGrid: props.getSbVideoReferenceGrid,
  onOpenVideoParams: props.onOpenVideoParams,
}))

function onOpenGridRefParams() {
  if (typeof props.onOpenVideoParams === 'function') {
    props.onOpenVideoParams(props.sb)
  }
}
</script>

<style scoped src="./FilmCreateStoryboardVideoColumn.css"></style>
