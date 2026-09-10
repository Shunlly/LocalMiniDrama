<template>
  <div class="film-create-storyboard-root">
      <input
        ref="sbImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        tabindex="-1"
        aria-hidden="true"
        @change="onSbImageFileChange"
      />
      <!-- 分镜生成 -->
      <section id="anchor-storyboard" class="section card">
        <h2 class="section-title">
          <span>分镜生成</span>
          <span class="step-desc">根据剧本、角色、场景自动生成分镜头脚本</span>
        </h2>
        <FilmCreateStoryboardConfigBar
          v-model:storyboard-count="storyboardCount"
          v-model:video-duration="videoDuration"
          v-model:grid-mode="gridMode"
          v-model:storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
          v-model:storyboard-universal-omni="storyboardUniversalOmni"
          v-model:storyboard-include-narration="storyboardIncludeNarration"
          v-model:video-frame-contiguity="videoFrameContiguity"
          v-model:batch-image-stopping="batchImageStopping"
          v-model:batch-video-stopping="batchVideoStopping"
          :storyboards="storyboards"
          :storyboard-generating="storyboardGenerating"
          :universal-omni-polish-running="universalOmniPolishRunning"
          :exporting-storyboard-sheet="exportingStoryboardSheet"
          :batch-image-running="batchImageRunning"
          :batch-video-running="batchVideoRunning"
          :storyboard-action-disabled-reason="storyboardActionDisabledReason"
          :episode-action-disabled-reason="episodeActionDisabledReason"
          :batch-action-disabled-reason="batchActionDisabledReason"
          :batch-video-action-disabled-reason="batchVideoActionDisabledReason"
          :video-capability-reason="videoCapabilityReason"
          :script-estimate-storyboard-hint="scriptEstimateStoryboardHint"
          :script-estimate-storyboard-title="scriptEstimateStoryboardTitle"
          :script-estimate-video-duration-hint="scriptEstimateVideoDurationHint"
          :script-estimate-video-duration-title="scriptEstimateVideoDurationTitle"
          :on-add-single-storyboard="onAddSingleStoryboard"
          :on-export-narration-srt="onExportNarrationSrt"
          :on-export-storyboard-sheet="onExportStoryboardSheet"
          :on-generate-storyboard="onGenerateStoryboard"
          :on-storyboard-use-first-last-frame-change="onStoryboardUseFirstLastFrameChange"
          :open-ai-config="openAiConfig"
          :start-batch-image-generation="startBatchImageGeneration"
          :start-batch-video-generation="startBatchVideoGeneration"
          @save-settings="emit('save-settings')"
        />
        <FilmCreateStoryboardStatusStrip
          v-model:sb-truncated-dismissed="sbTruncatedDismissed"
          :batch-image-running="batchImageRunning"
          :batch-video-running="batchVideoRunning"
          :batch-image-errors="batchImageErrors"
          :batch-video-errors="batchVideoErrors"
          :batch-image-progress="batchImageProgress"
          :batch-video-progress="batchVideoProgress"
          :batch-image-stopping="batchImageStopping"
          :batch-video-stopping="batchVideoStopping"
          :storyboard-generating="storyboardGenerating"
          :universal-omni-polish-running="universalOmniPolishRunning"
          :universal-omni-polish-progress="universalOmniPolishProgress"
          :sb-truncated-warning="sbTruncatedWarning"
          :storyboards="storyboards"
        />
        <template v-if="storyboards.length > 0">
          <template v-for="(sb, i) in storyboards" :key="sb.id">
            <!-- 段落分隔标头：segment_title 存在且是新段落的第一个镜头时显示 -->
            <div
              v-if="sb.segment_title && (i === 0 || sb.segment_index !== storyboards[i - 1].segment_index)"
              class="segment-header"
            >
              <div class="segment-header-inner">
                <span class="segment-index-badge">第 {{ (sb.segment_index ?? 0) + 1 }} 幕</span>
                <span class="segment-title-text">{{ sb.segment_title }}</span>
                <span class="segment-shot-range">
                  镜头 {{ i + 1 }}–{{ (() => {
                    let end = i
                    while (end + 1 < storyboards.length && storyboards[end + 1].segment_index === sb.segment_index) end++
                    return end + 1
                  })() }}
                </span>
              </div>
            </div>
          <!-- 分镜控制栏（卡片外，缩进表示属于当前幕） -->
          <div
            class="sb-ctrl-bar"
            :class="{ 'sb-ctrl-bar--drop-target': dropTargetStoryboardIndex === i }"
            @dragover="onReorderDragOver($event, i)"
            @drop="onReorderDrop($event, i)"
          >
            <button
              type="button"
              class="sb-reorder-handle"
              :draggable="storyboards.length > 1 && !storyboardGenerating && !universalOmniPolishRunning && !storyboardReorderBusy"
              :disabled="storyboards.length < 2 || storyboardGenerating || universalOmniPolishRunning || storyboardReorderBusy"
              :aria-label="reorderHandleReason() ? `拖动排序分镜${i + 1}不可用：${reorderHandleReason()}` : `拖动排序分镜${i + 1}，按上下方向键移动`"
              :title="reorderHandleReason() || '拖动排序；按上下方向键移动'"
              @click.stop
              @dragstart.stop="onReorderDragStart($event, i)"
              @dragend="onReorderDragEnd"
              @keydown.up.prevent.stop="onMoveStoryboardUp(sb, i)"
              @keydown.down.prevent.stop="onMoveStoryboardDown(sb, i)"
            >
              <el-icon aria-hidden="true"><Rank /></el-icon>
            </button>
            <span class="sb-ctrl-num">{{ i + 1 }}</span>
            <span class="sb-ctrl-title">{{ sb.title || '未命名分镜' }}</span>
            <span
              class="sb-ctrl-reorder-wrap"
              :title="storyboardMoveCopies[i].up.title"
            >
              <button
                type="button"
                class="sb-ctrl-btn sb-ctrl-reorder-btn"
                :disabled="storyboardMoveCopies[i].up.disabled"
                :aria-label="storyboardMoveCopies[i].up.ariaLabel"
                :title="storyboardMoveCopies[i].up.title"
                @click="onMoveStoryboardUp(sb, i)"
              >
                <el-icon aria-hidden="true"><ArrowUp /></el-icon>
              </button>
            </span>
            <span
              class="sb-ctrl-reorder-wrap"
              :title="storyboardMoveCopies[i].down.title"
            >
              <button
                type="button"
                class="sb-ctrl-btn sb-ctrl-reorder-btn"
                :disabled="storyboardMoveCopies[i].down.disabled"
                :aria-label="storyboardMoveCopies[i].down.ariaLabel"
                :title="storyboardMoveCopies[i].down.title"
                @click="onMoveStoryboardDown(sb, i)"
              >
                <el-icon aria-hidden="true"><ArrowDown /></el-icon>
              </button>
            </span>
            <el-tag v-if="sb.movement" size="small" effect="plain" type="info" class="sb-movement-tag">{{ getMovementLabel(sb.movement) }}</el-tag>
            <el-button size="small" plain class="sb-ctrl-btn sb-ctrl-config-btn" @click="onOpenVideoParamsDialog(sb)">⚙ 分镜配置</el-button>
            <el-button
              size="small"
              plain
              class="sb-ctrl-btn sb-ctrl-mode-btn"
              :title="isSbUniversalMode(sb.id) ? '切换为经典分镜（中间显示参考图）' : '切换为全能模式（中间为片段描述，经典字段保留）'"
              @click="onToggleSbUniversalMode(sb)"
            >
              {{ isSbUniversalMode(sb.id) ? '经典分镜' : '全能模式' }}
            </el-button>
            <el-button
              size="small"
              plain
              class="sb-ctrl-btn"
              :aria-label="`在分镜${i + 1}前插入新分镜`"
              title="在本镜头前插入新分镜"
              @click="onInsertStoryboardBefore(sb)"
            >
              <el-icon aria-hidden="true"><Plus /></el-icon>
              <span>插入分镜</span>
            </el-button>
            <el-button
              class="sb-ctrl-delete"
              type="danger"
              text
              size="small"
              :title="`删除分镜${i + 1}`"
              :aria-label="`删除分镜${sb.storyboard_number || i + 1}`"
              @click="onDeleteSingleStoryboard(sb.id)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
          <div :id="'sb-' + sb.id" class="storyboard-row">
            <FilmCreateStoryboardScriptColumn
              :sb="sb"
              :i="i"
              :characters="characters"
              :scenes="scenes"
              :prop-items="propItems"
              :sb-scene-id="sbSceneId"
              :sb-narration="sbNarration"
              :storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
              :storyboard-include-narration="storyboardIncludeNarration"
              :tts-sb-narration-ids="ttsSbNarrationIds"
              :asset-image-url="assetImageUrl"
              :characters-available-to-add-to-sb="charactersAvailableToAddToSb"
              :get-sb-character-ids="getSbCharacterIds"
              :get-sb-prop-ids="getSbPropIds"
              :get-sb-selected-characters="getSbSelectedCharacters"
              :get-sb-selected-props="getSbSelectedProps"
              :get-sb-selected-scene="getSbSelectedScene"
              :has-asset-image="hasAssetImage"
              :on-open-sb-prompt-dialog="onOpenSbPromptDialog"
              :on-save-sb-narration-field="onSaveSbNarrationField"
              :on-sb-add-character-command="onSbAddCharacterCommand"
              :on-storyboard-scene-change="onStoryboardSceneChange"
              :on-tts-sb-narration="onTtsSbNarration"
              :open-image-preview="openImagePreview"
              :play-sb-narration-tts="playSbNarrationTts"
              :sb-narration-audio-rel-path="sbNarrationAudioRelPath"
              :set-sb-character-ids="setSbCharacterIds"
              :set-sb-prop-ids="setSbPropIds"
              :tts-generation-disabled-reason="ttsGenerationDisabledReason"
            />
            <FilmCreateStoryboardImageColumn
              :sb="sb"
              :i="i"
              v-model:last-frame-use-first-layout-lock="lastFrameUseFirstLayoutLock"
              v-model:drag-over-sb-id="dragOverSbId"
              :sb-universal-segment-text="sbUniversalSegmentText"
              :storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
              :generating-sb-image-ids="generatingSbImageIds"
              :generating-sb-first-image-ids="generatingSbFirstImageIds"
              :generating-sb-last-image-ids="generatingSbLastImageIds"
              :generating-universal-segment-ids="generatingUniversalSegmentIds"
              :using-prev-tail-as-first-ids="usingPrevTailAsFirstIds"
              :upscaling-sb-ids="upscalingSbIds"
              :uploading-sb-image-id="uploadingSbImageId"
              :uploading-sb-image-slot="uploadingSbImageSlot"
              :asset-image-url="assetImageUrl"
              :can-use-prev-tail-as-first="canUsePrevTailAsFirst"
              :get-sb-first-image="getSbFirstImage"
              :get-sb-image="getSbImage"
              :get-sb-last-image="getSbLastImage"
              :get-sb-local-image="getSbLocalImage"
              :get-sb-universal-omni-ref-slots="getSbUniversalOmniRefSlots"
              :get-strip-items="getStripItems"
              :has-sb-draft-image-placeholder="hasSbDraftImagePlaceholder"
              :has-sb-first-last-pair="hasSbFirstLastPair"
              :has-sb-image="hasSbImage"
              :history-image-label="historyImageLabel"
              :is-sb-universal-mode="isSbUniversalMode"
              :storyboard-media-action-reason="storyboardMediaActionReason"
              :on-generate-sb-frame-image="onGenerateSbFrameImage"
              :on-generate-sb-frame-pair="onGenerateSbFramePair"
              :on-generate-sb-image="onGenerateSbImage"
              :on-last-frame-layout-lock-change="onLastFrameLayoutLockChange"
              :on-remove-sb-history-image="onRemoveSbHistoryImage"
              :on-save-universal-segment-field="onSaveUniversalSegmentField"
              :on-sb-image-drag-leave="onSbImageDragLeave"
              :on-sb-image-drag-over="onSbImageDragOver"
              :on-sb-image-drop="onSbImageDrop"
              :on-select-strip-item="onSelectStripItem"
              :on-strip-item-click="onStripItemClick"
              :on-universal-segment-prompt-menu="onUniversalSegmentPromptMenu"
              :on-upload-sb-image-click="onUploadSbImageClick"
              :on-upscale-sb-image="onUpscaleSbImage"
              :on-use-prev-tail-as-first="onUsePrevTailAsFirst"
              :open-image-preview="openImagePreview"
              :sb-universal-segment-trimmed="sbUniversalSegmentTrimmed"
              :show-sb-frame-prompt-preview="showSbFramePromptPreview"
              :storyboard-image-url="storyboardImageUrl"
              :strip-item-title="stripItemTitle"
              :get-sb-free-reference-items="getSbFreeReferenceItems"
              :open-global-media-picker="openGlobalMediaPicker"
              :on-promote-sb-free-reference-image="onPromoteSbFreeReferenceImage"
              :on-remove-sb-free-reference-image="onRemoveSbFreeReferenceImage"
            />
            <FilmCreateStoryboardVideoColumn
              :sb="sb"
              :i="i"
              :linking-tail-frame-ids="linkingTailFrameIds"
              :tts-sb-ids="ttsSbIds"
              :asset-video-url="assetVideoUrl"
              :get-next-storyboard="getNextStoryboard"
              :get-sb-video="getSbVideo"
              :get-sb-video-error="getSbVideoError"
              :get-video-strip-items="getVideoStripItems"
              :is-sb-video-generating="isSbVideoGenerating"
              :on-generate-sb-video="onGenerateSbVideo"
              :on-link-tail-frame-to-next="onLinkTailFrameToNext"
              :on-open-sb-prompt-dialog="onOpenSbPromptDialog"
              :on-select-sb-main-video="onSelectSbMainVideo"
              :on-tts-sb-dialogue="onTtsSbDialogue"
              :play-sb-dialogue-tts="playSbDialogueTts"
              :sb-can-submit-video="sbCanSubmitVideo"
              :sb-dialogue-audio-rel-path="sbDialogueAudioRelPath"
              :sb-main-video-player-key="sbMainVideoPlayerKey"
              :sb-video-generation-disabled-reason="sbVideoGenerationDisabledReason"
              :tts-generation-disabled-reason="ttsGenerationDisabledReason"
              :get-sb-grid-images="getSbGridImages"
              :get-sb-video-reference-grid="getSbVideoReferenceGrid"
              :on-open-video-params="onOpenVideoParamsDialog"
            />
          </div>
          </template>
        </template>
        <!-- 分镜生成中提示条 -->
        <div v-if="storyboardGenerating || universalOmniPolishRunning" class="sb-generating-tip">
          <span class="sb-gen-dot" /><span class="sb-gen-dot" /><span class="sb-gen-dot" />
          <span v-if="universalOmniPolishRunning" class="sb-gen-text">
            全能片段润色中 {{ universalOmniPolishProgress.current }}/{{ universalOmniPolishProgress.total }}
            <template v-if="universalOmniPolishProgress.label"> · {{ universalOmniPolishProgress.label }}</template>
          </span>
          <span v-else class="sb-gen-text">分镜持续生成中，请稍候…</span>
        </div>
        <div v-else-if="storyboards.length === 0" class="empty-tip">
          <template v-if="hasAnyEpisode">
            <p>还没有分镜，可生成分镜或添加一个分镜</p>
            <div class="empty-tip-actions">
              <ActionGate :reason="storyboardActionDisabledReason" label="生成分镜">
                <el-button
                  type="primary"
                  :loading="storyboardGenerating || universalOmniPolishRunning"
                  :disabled="Boolean(storyboardActionDisabledReason)"
                  :title="storyboardGenerating || universalOmniPolishRunning ? '正在生成分镜，请稍候' : (storyboardActionDisabledReason || undefined)"
                  @click="onGenerateStoryboard"
                >生成分镜</el-button>
              </ActionGate>
              <ActionGate :reason="episodeActionDisabledReason" label="添加一个分镜">
                <el-button
                  :disabled="Boolean(episodeActionDisabledReason)"
                  :title="episodeActionDisabledReason || undefined"
                  @click="onAddSingleStoryboard"
                >添加一个分镜</el-button>
              </ActionGate>
            </div>
          </template>
          <template v-else>
            <p>请先创建或选择剧集，再生成或添加分镜</p>
            <div class="empty-tip-actions">
              <el-button type="primary" @click="onAddEpisode">去创建剧集</el-button>
            </div>
          </template>
        </div>
      </section>
  </div>
</template>

<script setup>
import { ArrowDown, ArrowUp, Delete, Plus, Rank } from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import { storyboardsAPI } from '@/api/storyboards'
import { storyboardMoveButtonCopy, storyboardMoveDisabledReason, useFilmCreateStoryboardReorder } from '@/composables/filmCreate/useFilmCreateStoryboardReorder'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import FilmCreateStoryboardConfigBar from '@/components/filmCreate/FilmCreateStoryboardConfigBar.vue'
import FilmCreateStoryboardImageColumn from '@/components/filmCreate/FilmCreateStoryboardImageColumn.vue'
import FilmCreateStoryboardScriptColumn from '@/components/filmCreate/FilmCreateStoryboardScriptColumn.vue'
import FilmCreateStoryboardStatusStrip from '@/components/filmCreate/FilmCreateStoryboardStatusStrip.vue'
import FilmCreateStoryboardVideoColumn from '@/components/filmCreate/FilmCreateStoryboardVideoColumn.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  storyboards: { type: Array, default: () => [] },
  storyboardsAPI: { type: Object, default: null },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propItems: { type: Array, default: () => [] },
  sbSceneId: { type: Object, default: () => ({}) },
  sbNarration: { type: Object, default: () => ({}) },
  sbUniversalSegmentText: { type: Object, default: () => ({}) },
  batchImageErrors: { type: Array, default: () => [] },
  batchVideoErrors: { type: Array, default: () => [] },
  batchImageProgress: { type: Object, default: () => ({}) },
  batchVideoProgress: { type: Object, default: () => ({}) },
  generatingSbImageIds: { type: [Set, Object], default: () => new Set() },
  generatingSbFirstImageIds: { type: [Set, Object], default: () => new Set() },
  generatingSbLastImageIds: { type: [Set, Object], default: () => new Set() },
  generatingUniversalSegmentIds: { type: [Set, Object], default: () => new Set() },
  linkingTailFrameIds: { type: [Set, Object], default: () => new Set() },
  usingPrevTailAsFirstIds: { type: [Set, Object], default: () => new Set() },
  ttsSbIds: { type: [Set, Object], default: () => new Set() },
  ttsSbNarrationIds: { type: [Set, Object], default: () => new Set() },
  upscalingSbIds: { type: [Set, Object], default: () => new Set() },
  universalOmniPolishProgress: { type: Object, default: () => ({ current: 0, total: 0, label: '' }) },
  hasAnyEpisode: { type: Boolean, default: false },
  currentEpisodeId: { type: [Number, String, null], default: null },
  storyboardGenerating: { type: Boolean, default: false },
  universalOmniPolishRunning: { type: Boolean, default: false },
  exportingStoryboardSheet: { type: Boolean, default: false },
  batchImageRunning: { type: Boolean, default: false },
  batchVideoRunning: { type: Boolean, default: false },
  sbTruncatedWarning: { type: Boolean, default: false },
  uploadingSbImageId: { type: [Number, String, null], default: null },
  uploadingSbImageSlot: { type: Function, required: true },
  storyboardActionDisabledReason: { type: String, default: '' },
  episodeActionDisabledReason: { type: String, default: '' },
  batchActionDisabledReason: { type: String, default: '' },
  storyboardMediaActionReason: { type: String, default: '' },
  batchVideoActionDisabledReason: { type: String, default: '' },
  videoCapabilityReason: { type: String, default: '' },
  scriptEstimateStoryboardHint: { type: String, default: '' },
  scriptEstimateStoryboardTitle: { type: String, default: '' },
  scriptEstimateVideoDurationHint: { type: String, default: '' },
  scriptEstimateVideoDurationTitle: { type: String, default: '' },
  assetImageUrl: { type: Function, required: true },
  assetVideoUrl: { type: Function, required: true },
  canUsePrevTailAsFirst: { type: Function, required: true },
  charactersAvailableToAddToSb: { type: Function, required: true },
  getMovementLabel: { type: Function, required: true },
  getNextStoryboard: { type: Function, required: true },
  getSbCharacterIds: { type: Function, required: true },
  getSbFirstImage: { type: Function, required: true },
  getSbImage: { type: Function, required: true },
  getSbLastImage: { type: Function, required: true },
  getSbLocalImage: { type: Function, required: true },
  getSbPropIds: { type: Function, required: true },
  getSbSelectedCharacters: { type: Function, required: true },
  getSbSelectedProps: { type: Function, required: true },
  getSbSelectedScene: { type: Function, required: true },
  getSbUniversalOmniRefSlots: { type: Function, required: true },
  getSbVideo: { type: Function, required: true },
  getSbVideoError: { type: Function, required: true },
  getStripItems: { type: Function, required: true },
  getVideoStripItems: { type: Function, required: true },
  hasAssetImage: { type: Function, required: true },
  hasSbDraftImagePlaceholder: { type: Function, required: true },
  hasSbFirstLastPair: { type: Function, required: true },
  hasSbImage: { type: Function, required: true },
  historyImageLabel: { type: Function, required: true },
  isSbUniversalMode: { type: Function, required: true },
  isSbVideoGenerating: { type: Function, required: true },
  onAddEpisode: { type: Function, default: () => {} },
  onAddSingleStoryboard: { type: Function, required: true },
  onDeleteSingleStoryboard: { type: Function, required: true },
  onExportNarrationSrt: { type: Function, required: true },
  onExportStoryboardSheet: { type: Function, required: true },
  onGenerateSbFrameImage: { type: Function, required: true },
  onGenerateSbFramePair: { type: Function, required: true },
  onGenerateSbImage: { type: Function, required: true },
  onGenerateSbVideo: { type: Function, required: true },
  onGenerateStoryboard: { type: Function, required: true },
  onInsertStoryboardBefore: { type: Function, required: true },
  onLastFrameLayoutLockChange: { type: Function, required: true },
  onLinkTailFrameToNext: { type: Function, required: true },
  onOpenSbPromptDialog: { type: Function, required: true },
  onOpenVideoParamsDialog: { type: Function, required: true },
  onRemoveSbHistoryImage: { type: Function, required: true },
  onSaveSbNarrationField: { type: Function, required: true },
  onSaveUniversalSegmentField: { type: Function, required: true },
  onSbAddCharacterCommand: { type: Function, required: true },
  onSbImageDragLeave: { type: Function, required: true },
  onSbImageDragOver: { type: Function, required: true },
  onSbImageDrop: { type: Function, required: true },
  onSelectSbMainVideo: { type: Function, required: true },
  onSelectStripItem: { type: Function, required: true },
  onStoryboardSceneChange: { type: Function, required: true },
  onStoryboardUseFirstLastFrameChange: { type: Function, required: true },
  onStripItemClick: { type: Function, required: true },
  onToggleSbUniversalMode: { type: Function, required: true },
  onTtsSbDialogue: { type: Function, required: true },
  onTtsSbNarration: { type: Function, required: true },
  onUniversalSegmentPromptMenu: { type: Function, required: true },
  prepareSbImageUpload: { type: Function, required: true },
  onUpscaleSbImage: { type: Function, required: true },
  onUsePrevTailAsFirst: { type: Function, required: true },
  openAiConfig: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  playSbDialogueTts: { type: Function, required: true },
  playSbNarrationTts: { type: Function, required: true },
  sbCanSubmitVideo: { type: Function, required: true },
  sbDialogueAudioRelPath: { type: Function, required: true },
  sbMainVideoPlayerKey: { type: Function, required: true },
  sbNarrationAudioRelPath: { type: Function, required: true },
  sbUniversalSegmentTrimmed: { type: Function, required: true },
  sbVideoGenerationDisabledReason: { type: Function, required: true },
  setSbCharacterIds: { type: Function, required: true },
  setSbPropIds: { type: Function, required: true },
  showSbFramePromptPreview: { type: Function, required: true },
  startBatchImageGeneration: { type: Function, required: true },
  startBatchVideoGeneration: { type: Function, required: true },
  storyboardImageUrl: { type: Function, required: true },
  stripItemTitle: { type: Function, required: true },
  ttsGenerationDisabledReason: { type: Function, required: true },
  getSbFreeReferenceItems: { type: Function, default: (sb) => [] },
  openGlobalMediaPicker: { type: Function, default: () => {} },
  onPromoteSbFreeReferenceImage: { type: Function, default: () => {} },
  onRemoveSbFreeReferenceImage: { type: Function, default: () => {} },
  getSbGridImages: { type: Function, default: undefined },
  getSbVideoReferenceGrid: { type: Function, default: undefined },
})

const storyboardCount = defineModel('storyboardCount', { type: Number, default: null })
const videoDuration = defineModel('videoDuration', { type: Number, default: null })
const gridMode = defineModel('gridMode', { type: String, default: 'single' })
const storyboardUseFirstLastFrame = defineModel('storyboardUseFirstLastFrame', { type: Boolean, default: false })
const storyboardUniversalOmni = defineModel('storyboardUniversalOmni', { type: Boolean, default: false })
const storyboardIncludeNarration = defineModel('storyboardIncludeNarration', { type: Boolean, default: false })
const lastFrameUseFirstLayoutLock = defineModel('lastFrameUseFirstLayoutLock', { type: Boolean, default: false })
const videoFrameContiguity = defineModel('videoFrameContiguity', { type: Boolean, default: false })
const sbTruncatedDismissed = defineModel('sbTruncatedDismissed', { type: Boolean, default: false })
const batchImageStopping = defineModel('batchImageStopping', { type: Boolean, default: false })
const batchVideoStopping = defineModel('batchVideoStopping', { type: Boolean, default: false })
const dragOverSbId = defineModel('dragOverSbId', { default: null })

const emit = defineEmits(['save-settings', 'upload-sb-image'])
const sbImageFileInput = ref(null)
const pendingSbUpload = ref(null)
const {
  storyboardReorderBusy,
  dropTargetStoryboardIndex,
  onMoveStoryboardUp,
  onMoveStoryboardDown,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDragEnd,
  onReorderDrop,
} = useFilmCreateStoryboardReorder({
  getList: () => props.storyboards || [],
  getStoryboardsAPI: () => props.storyboardsAPI || storyboardsAPI,
  isBlocked: () => props.storyboardGenerating || props.universalOmniPolishRunning,
})

function moveReasonState() {
  return {
    length: (props.storyboards || []).length,
    generating: props.storyboardGenerating,
    polishing: props.universalOmniPolishRunning,
    busy: storyboardReorderBusy.value,
  }
}
function moveStoryboardUpReason(index) {
  return storyboardMoveDisabledReason({ ...moveReasonState(), index, offset: -1 })
}
function moveStoryboardDownReason(index) {
  return storyboardMoveDisabledReason({ ...moveReasonState(), index, offset: 1 })
}
function reorderHandleReason() {
  return storyboardMoveDisabledReason({ ...moveReasonState(), index: 1, offset: 0 })
}
const storyboardMoveCopies = computed(() =>
  (props.storyboards || []).map((_, index) => ({
    up: storyboardMoveButtonCopy({ actionLabel: '上移', index, reason: moveStoryboardUpReason(index) }),
    down: storyboardMoveButtonCopy({ actionLabel: '下移', index, reason: moveStoryboardDownReason(index) }),
  })),
)

const {
assetImageUrl,
assetVideoUrl,
canUsePrevTailAsFirst,
charactersAvailableToAddToSb,
getMovementLabel,
getNextStoryboard,
getSbCharacterIds,
getSbFirstImage,
getSbImage,
getSbLastImage,
getSbLocalImage,
getSbPropIds,
getSbSelectedCharacters,
getSbSelectedProps,
getSbSelectedScene,
getSbUniversalOmniRefSlots,
getSbVideo,
getSbVideoError,
getStripItems,
getVideoStripItems,
hasAssetImage,
hasSbDraftImagePlaceholder,
hasSbFirstLastPair,
hasSbImage,
historyImageLabel,
isSbUniversalMode,
isSbVideoGenerating,
onAddEpisode,
onAddSingleStoryboard,
onDeleteSingleStoryboard,
onExportNarrationSrt,
onExportStoryboardSheet,
onGenerateSbFrameImage,
onGenerateSbFramePair,
onGenerateSbImage,
onGenerateSbVideo,
onGenerateStoryboard,
onInsertStoryboardBefore,
onLastFrameLayoutLockChange,
onLinkTailFrameToNext,
onOpenSbPromptDialog,
onOpenVideoParamsDialog,
onRemoveSbHistoryImage,
onSaveSbNarrationField,
onSaveUniversalSegmentField,
onSbAddCharacterCommand,
onSbImageDragLeave,
onSbImageDragOver,
onSbImageDrop,
onSelectSbMainVideo,
onSelectStripItem,
onStoryboardSceneChange,
onStoryboardUseFirstLastFrameChange,
onStripItemClick,
onToggleSbUniversalMode,
onTtsSbDialogue,
onTtsSbNarration,
onUniversalSegmentPromptMenu,
prepareSbImageUpload,
onUpscaleSbImage,
onUsePrevTailAsFirst,
openAiConfig,
openImagePreview,
playSbDialogueTts,
playSbNarrationTts,
sbCanSubmitVideo,
sbDialogueAudioRelPath,
sbMainVideoPlayerKey,
sbNarrationAudioRelPath,
sbUniversalSegmentTrimmed,
sbVideoGenerationDisabledReason,
setSbCharacterIds,
setSbPropIds,
showSbFramePromptPreview,
startBatchImageGeneration,
startBatchVideoGeneration,
storyboardImageUrl,
stripItemTitle,
ttsGenerationDisabledReason,
getSbFreeReferenceItems,
openGlobalMediaPicker,
onPromoteSbFreeReferenceImage,
onRemoveSbFreeReferenceImage,
getSbGridImages,
getSbVideoReferenceGrid
} = props

function onUploadSbImageClick(sb, slot = 'first') {
  if (!sb?.id) return
  pendingSbUpload.value = { sbId: sb.id, slot }
  prepareSbImageUpload(sb, slot)
  if (sbImageFileInput.value) {
    sbImageFileInput.value.value = ''
    sbImageFileInput.value.click()
  }
}

function onSbImageFileChange(ev) {
  const file = ev.target?.files?.[0]
  const pending = pendingSbUpload.value
  ev.target.value = ''
  pendingSbUpload.value = null
  if (!file || !pending?.sbId) return
  emit('upload-sb-image', pending.sbId, file, pending.slot)
}
</script>

<style scoped src="./FilmCreateStoryboardPanel.css"></style>
<style scoped>
.sb-ctrl-bar--drop-target {
  outline: 1px dashed rgba(139, 92, 246, 0.7);
  border-radius: 6px;
}
.sb-reorder-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #a1a1aa;
  cursor: grab;
  flex-shrink: 0;
}
.sb-reorder-handle:active:not(:disabled) {
  cursor: grabbing;
}
.sb-reorder-handle:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.sb-reorder-handle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

</style>
