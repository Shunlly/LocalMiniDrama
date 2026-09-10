<template>
<div class="sb-panel sb-image" :class="{ 'sb-image--universal': isSbUniversalMode(sb.id) }">
  <template v-if="isSbUniversalMode(sb.id)">
    <div class="sb-prompt-label sb-universal-label-row">
      <div class="sb-universal-label-left">
        <span class="sb-dot"></span>
        <span>片段描述</span>
        <el-tooltip placement="top" :show-after="280" :show-arrow="false" popper-class="sb-universal-tooltip-popper">
          <template #content>
            <div class="sb-universal-tooltip">
              全能生视频链路（<strong>AI 配置 · 视频</strong> 中选接口规范：<code>kling_omni</code> 可灵 Omni，或 <code>volcengine_omni</code> 火山即梦 Seedance 2.0 多图参考；模型如 <code>kling-video-o1</code>、<code>doubao-seedance-2-0-260128</code> 等以控制台为准）：此处为提交主提示词；只要本框有内容，生视频时<strong>只</strong>发送这段，不会拼接下方「视频提示词」里的动作/对话/旁白。参考图顺序一般为：场景 → 角色（多张）→ 道具（<strong>不含</strong>经典分镜中间主图）；请用 <strong>@图片1</strong>、<strong>@图片2</strong>…（<strong>@图片N 后建议加半角空格</strong>）对应参考图，勿用 @姓名 指图；有场景图时 <strong>@图片1</strong> 只表环境，人物从 <strong>@图片2</strong> 起。若场景参考是<strong>四宫格/多视角拼图</strong>，仅借空间与氛围，须在文案中写明<strong>单镜头完整画幅、禁止分屏宫格</strong>，避免成片模仿拼图布局。全能提示词下拉中「生成」会按<strong>本条分镜总时长</strong>与本集剧本、镜序、邻镜信息，自动决定子分镜数 M（第2行「由以下M个分镜…」），第4行起为「分镜1：T1秒:」…多行，且各段秒数之和等于本镜时长；第3行仍为环境/参考图约束；「生成」与「润色」均为<strong>流式输出</strong>到本框；「润色」在此基础上增强。若本框留空，则退回仅用「视频提示词」。
            </div>
          </template>
          <el-icon class="sb-universal-hint-icon" tabindex="0" role="img" aria-label="片段说明">
            <QuestionFilled />
          </el-icon>
        </el-tooltip>
      </div>
      <el-dropdown
        trigger="click"
        class="sb-universal-prompt-dd"
        @command="(cmd) => onUniversalSegmentPromptMenu(sb, cmd)"
      >
        <el-button
          type="primary"
          link
          size="small"
          class="sb-universal-gen-btn"
          :loading="generatingUniversalSegmentIds.has(sb.id)"
          :title="generatingUniversalSegmentIds.has(sb.id) ? '正在生成全能提示词，请稍候' : undefined"
        >
          全能提示词
          <el-icon class="sb-universal-dd-caret"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="generate">生成全能提示词</el-dropdown-item>
            <el-dropdown-item command="generate-force">不查图片强制生成</el-dropdown-item>
            <el-dropdown-item
              command="polish"
              :disabled="!sbUniversalSegmentTrimmed(sb)"
              :title="universalSegmentActionDisabledReason"
            >
              润色全能提示词
            </el-dropdown-item>
            <el-dropdown-item
              command="polish-force"
              :disabled="!sbUniversalSegmentTrimmed(sb)"
              :title="universalSegmentActionDisabledReason"
            >
              不查图片强制润色
            </el-dropdown-item>
            <el-dropdown-item
              command="to-grok-video-tags"
              divided
              :disabled="!sbUniversalSegmentTrimmed(sb)"
              :title="universalSegmentActionDisabledReason"
            >
              改为 Grok 视频格式
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <UniversalSegmentOmniAtEditor
      v-if="!generatingUniversalSegmentIds.has(sb.id)"
      v-model="sbUniversalSegmentText[sb.id]"
      :slots="getSbUniversalOmniRefSlots(sb)"
      :aria-label="`分镜${sb.storyboard_number || i + 1}全能片段描述`"
      class="sb-universal-textarea"
      @blur="() => onSaveUniversalSegmentField(sb)"
    />
    <el-input
      v-else
      v-model="sbUniversalSegmentText[sb.id]"
      type="textarea"
      :rows="10"
      :autosize="{ minRows: 10, maxRows: 22 }"
      :aria-label="`分镜${sb.storyboard_number || i + 1}全能片段描述`"
      placeholder="例如：@图片1 为夜景街道，@图片2 从餐厅冲出停在光斑里，低头操作手机…"
      class="sb-universal-textarea"
      @blur="() => onSaveUniversalSegmentField(sb)"
    />
  </template>
  <template v-else>
  <div
    class="sb-image-area"
    :class="{
      'sb-image-area--dragover': dragOverSbId === sb.id,
      'sb-image-area--has-quad': !storyboardUseFirstLastFrame && getStripItems(sb.id).length > 0,
      'sb-image-area--first-last': storyboardUseFirstLastFrame,
    }"
    @dragover="onSbImageDragOver($event, sb.id)"
    @dragleave="onSbImageDragLeave($event, sb.id)"
    @drop="onSbImageDrop($event, sb)"
  >
    <!-- 首尾帧双槽 -->
    <template v-if="storyboardUseFirstLastFrame">
      <div class="sb-fl-dual">
        <div class="sb-fl-slot">
          <div class="sb-fl-slot-label">首帧</div>
          <div class="sb-fl-slot-body">
            <template v-if="getSbFirstImage(sb.id)">
              <button type="button" class="sb-generated-preview" :aria-label="`预览分镜${sb.storyboard_number || i + 1}首帧`" @click="openImagePreview(assetImageUrl(getSbFirstImage(sb.id)))">
                <img :src="assetImageUrl(getSbFirstImage(sb.id))" class="sb-generated-img" alt="分镜首帧" />
              </button>
            </template>
            <template v-else-if="storyboardImageUrl(sb)">
              <button type="button" class="sb-generated-preview" :aria-label="`预览分镜${sb.storyboard_number || i + 1}首帧`" @click="openImagePreview(storyboardImageUrl(sb))">
                <img :src="storyboardImageUrl(sb)" class="sb-generated-img" alt="分镜首帧" />
              </button>
            </template>
            <template v-else>
              <span class="sb-fl-empty">动作前静止</span>
            </template>
          </div>
          <div v-if="getSbFirstImage(sb.id)?.prompt" class="sb-fl-slot-prompt" :title="getSbFirstImage(sb.id).prompt">
            {{ getSbFirstImage(sb.id).prompt }}
          </div>
          <div class="sb-fl-slot-actions">
            <ActionGate :reason="imageGenerateDisabledReason" label="生成首帧">
              <el-button type="primary" size="small" :loading="generatingSbFirstImageIds.has(sb.id)" :disabled="Boolean(imageGenerateDisabledReason)" :title="generatingSbFirstImageIds.has(sb.id) ? '正在生成首帧，请稍候' : (imageGenerateDisabledReason || undefined)" @click="onGenerateSbFrameImage(sb, 'first')">生成</el-button>
            </ActionGate>
            <el-tooltip v-if="canUsePrevTailAsFirst(sb)" content="直接使用上一分镜的尾帧图片（高清原图）替换本首帧，画面更清晰" placement="top">
              <el-button size="small" :loading="usingPrevTailAsFirstIds.has(sb.id)" @click="onUsePrevTailAsFirst(sb)">上镜尾帧</el-button>
            </el-tooltip>
            <el-button size="small" :loading="uploadingSbImageSlot(sb.id) === 'first'" @click="onUploadSbImageClick(sb, 'first')">上传</el-button>
            <el-button type="primary" link size="small" @click="showSbFramePromptPreview(sb, 'first')">查看提示词</el-button>
          </div>
        </div>
        <div class="sb-fl-arrow" aria-hidden="true">→</div>
        <div class="sb-fl-slot">
          <div class="sb-fl-slot-label">尾帧</div>
          <div class="sb-fl-slot-body">
            <template v-if="getSbLastImage(sb.id)">
              <button type="button" class="sb-generated-preview" :aria-label="`预览分镜${sb.storyboard_number || i + 1}尾帧`" :title="getSbLastImage(sb.id).prompt || ''" @click="openImagePreview(assetImageUrl(getSbLastImage(sb.id)))">
                <img :src="assetImageUrl(getSbLastImage(sb.id))" class="sb-generated-img" alt="分镜尾帧" />
              </button>
            </template>
            <template v-else>
              <span class="sb-fl-empty">动作后结果</span>
            </template>
          </div>
          <div v-if="getSbLastImage(sb.id)?.prompt" class="sb-fl-slot-prompt" :title="getSbLastImage(sb.id).prompt">
            {{ getSbLastImage(sb.id).prompt }}
          </div>
          <div class="sb-fl-slot-actions">
            <ActionGate :reason="imageGenerateDisabledReason" label="生成尾帧">
              <el-button type="primary" size="small" :loading="generatingSbLastImageIds.has(sb.id)" :disabled="Boolean(imageGenerateDisabledReason)" :title="generatingSbLastImageIds.has(sb.id) ? '正在生成尾帧，请稍候' : (imageGenerateDisabledReason || undefined)" @click="onGenerateSbFrameImage(sb, 'last')">生成</el-button>
            </ActionGate>
            <el-checkbox
              v-model="lastFrameUseFirstLayoutLock"
              class="sb-fl-first-lock-opt"
              title="勾选时尾帧生成会附带首帧图作构图与左右站位参考；取消后仅使用场景/角色/道具参考，便于调整出场人物"
              @change="onLastFrameLayoutLockChange"
            >
              首帧站位
            </el-checkbox>
            <el-button size="small" :loading="uploadingSbImageSlot(sb.id) === 'last'" @click="onUploadSbImageClick(sb, 'last')">上传</el-button>
            <el-button type="primary" link size="small" @click="showSbFramePromptPreview(sb, 'last')">查看提示词</el-button>
          </div>
        </div>
      </div>
      <div v-if="getStripItems(sb.id).length" class="sb-imgs-strip">
        <el-tooltip content="历史图：点击设为首帧或尾帧，左上角放大预览，右上角删除" placement="top" :show-arrow="false">
          <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
        </el-tooltip>
        <div
          v-for="(item, historyIndex) in getStripItems(sb.id)"
          :key="item.key"
          class="sb-img-thumb"
          :title="stripItemTitle(sb.id, item, historyImageLabel(sb, i, item, historyIndex))"
        >
          <button type="button" class="sb-img-thumb-primary" :aria-label="stripItemTitle(sb.id, item, historyImageLabel(sb, i, item, historyIndex))" @click="onStripItemClick(sb, item)">
            <img :src="item.src" alt="" />
            <span v-if="item.frameBadge" class="sb-img-thumb-label">{{ item.frameBadge }}</span>
            <span v-else-if="item.label" class="sb-img-thumb-label">{{ item.label }}</span>
          </button>
          <button type="button" class="thumb-preview-btn" title="放大预览" :aria-label="`预览${historyImageLabel(sb, i, item, historyIndex)}`" @click.stop="openImagePreview(item.src)">
            <el-icon :size="10"><ZoomIn /></el-icon>
          </button>
          <button v-if="item.img?.id" type="button" class="extra-thumb-remove" title="删除历史图" :aria-label="`删除${historyImageLabel(sb, i, item, historyIndex)}`" @click.stop="onRemoveSbHistoryImage(sb.id, item.img.id)">×</button>
        </div>
      </div>
    </template>
    <!-- 单主图（未勾选首尾帧） -->
    <template v-else>
    <div class="sb-main-image-wrap">
      <template v-if="getSbImage(sb.id)">
        <button type="button" class="sb-generated-preview" :aria-label="`预览分镜${sb.storyboard_number || i + 1}主图`" :title="getSbImage(sb.id).prompt || ''" @click="openImagePreview(assetImageUrl(getSbImage(sb.id)))">
          <img :src="assetImageUrl(getSbImage(sb.id))" class="sb-generated-img" alt="分镜主图" />
        </button>
        <div v-if="getSbImage(sb.id).prompt" class="sb-main-img-prompt">{{ getSbImage(sb.id).prompt }}</div>
      </template>
      <template v-else-if="storyboardImageUrl(sb)">
        <button type="button" class="sb-generated-preview" :aria-label="`预览分镜${sb.storyboard_number || i + 1}主图`" @click="openImagePreview(storyboardImageUrl(sb))">
          <img :src="storyboardImageUrl(sb)" class="sb-generated-img" alt="分镜主图" />
        </button>
      </template>
      <template v-else-if="hasSbDraftImagePlaceholder(sb)">
        <div class="sb-draft-placeholder" role="status">
          <strong>草稿占位</strong>
          <span>尚未生成可预览的分镜图，可切换到正式模式或手动上传。</span>
        </div>
        <ActionGate :reason="imageGenerateDisabledReason" label="生成分镜参考图">
          <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" :disabled="Boolean(imageGenerateDisabledReason)" :title="generatingSbImageIds.has(sb.id) ? '正在生成分镜图，请稍候' : (imageGenerateDisabledReason || undefined)" @click="onGenerateSbImage(sb)">
            <el-icon><MagicStick /></el-icon>
            生成分镜参考图
          </el-button>
        </ActionGate>
        <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
      </template>
      <template v-else-if="sb.error_msg || sb.errorMsg">
        <div class="sb-image-error" :title="imageErrorText">{{ imageErrorText }}</div>
        <ActionGate :reason="imageGenerateDisabledReason" label="重试">
          <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" :disabled="Boolean(imageGenerateDisabledReason)" :title="generatingSbImageIds.has(sb.id) ? '正在生成分镜图，请稍候' : (imageGenerateDisabledReason || undefined)" @click="onGenerateSbImage(sb)">
            <el-icon><Refresh /></el-icon>
            重试
          </el-button>
        </ActionGate>
        <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
      </template>
      <template v-else>
        <ActionGate :reason="imageGenerateDisabledReason" label="生成分镜参考图">
          <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" :disabled="Boolean(imageGenerateDisabledReason)" :title="generatingSbImageIds.has(sb.id) ? '正在生成分镜图，请稍候' : (imageGenerateDisabledReason || undefined)" @click="onGenerateSbImage(sb)">
            <el-icon><MagicStick /></el-icon>
            生成分镜参考图
          </el-button>
        </ActionGate>
        <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
      </template>
    </div>
    <div v-if="getStripItems(sb.id).length" class="sb-imgs-strip">
      <el-tooltip content="历史图：点击设为主图，左上角放大预览，右上角删除" placement="top" :show-arrow="false">
        <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
      </el-tooltip>
      <div
        v-for="(item, historyIndex) in getStripItems(sb.id)"
        :key="item.key"
        class="sb-img-thumb"
        :title="[item.label, item.prompt].filter(Boolean).join('\n\n') || '点击设为主图'"
      >
        <button type="button" class="sb-img-thumb-primary" :aria-label="`${historyImageLabel(sb, i, item, historyIndex)}，设为主图`" @click="onSelectStripItem(sb, item)">
          <img :src="item.src" alt="" />
          <span v-if="item.label" class="sb-img-thumb-label">{{ item.label }}</span>
        </button>
        <button type="button" class="thumb-preview-btn" title="放大预览" :aria-label="`预览${historyImageLabel(sb, i, item, historyIndex)}`" @click.stop="openImagePreview(item.src)">
          <el-icon :size="10"><ZoomIn /></el-icon>
        </button>
        <button v-if="item.img?.id" type="button" class="extra-thumb-remove" title="删除历史图" :aria-label="`删除${historyImageLabel(sb, i, item, historyIndex)}`" @click.stop="onRemoveSbHistoryImage(sb.id, item.img.id)">×</button>
      </div>
    </div>
    </template>
    <div v-if="dragOverSbId === sb.id" class="sb-image-area-drop-hint">松开上传到首帧</div>
  </div>
  <div v-if="hasSbImage(sb) || storyboardUseFirstLastFrame" class="sb-image-actions">
    <template v-if="storyboardUseFirstLastFrame">
      <ActionGate :reason="imageGenerateDisabledReason" :label="hasSbFirstLastPair(sb) ? '重新生成首尾帧' : '一键生成首尾帧'">
        <el-button size="small" :loading="generatingSbFirstImageIds.has(sb.id) || generatingSbLastImageIds.has(sb.id)" :disabled="Boolean(imageGenerateDisabledReason)" :title="(generatingSbFirstImageIds.has(sb.id) || generatingSbLastImageIds.has(sb.id)) ? '正在生成首尾帧，请稍候' : (imageGenerateDisabledReason || undefined)" @click="onGenerateSbFramePair(sb)">{{ hasSbFirstLastPair(sb) ? '重新生成首尾帧' : '一键生成首尾帧' }}</el-button>
      </ActionGate>
      <ActionGate :reason="upscaleDisabledReason" label="超分(首帧)">
        <el-tooltip content="高清放大仅作用于首帧" placement="top">
          <el-button size="small" :loading="upscalingSbIds.has(sb.id)" :disabled="Boolean(upscaleDisabledReason)" :title="upscalingSbIds.has(sb.id) ? '正在超分，请稍候' : (upscaleDisabledReason || undefined)" @click="onUpscaleSbImage(sb)">
            <el-icon><ZoomIn /></el-icon>超分(首帧)
          </el-button>
        </el-tooltip>
      </ActionGate>
    </template>
    <template v-else>
    <ActionGate :reason="imageGenerateDisabledReason" label="重新生成">
      <el-button size="small" :loading="generatingSbImageIds.has(sb.id)" :disabled="Boolean(imageGenerateDisabledReason)" :title="generatingSbImageIds.has(sb.id) ? '正在生成分镜图，请稍候' : (imageGenerateDisabledReason || undefined)" @click="onGenerateSbImage(sb)">重新生成</el-button>
    </ActionGate>
    <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
    <ActionGate :reason="upscaleDisabledReason" label="超分">
      <el-tooltip content="高清放大（2 倍超分辨率）" placement="top">
        <el-button
          size="small"
          :loading="upscalingSbIds.has(sb.id)"
          :disabled="Boolean(upscaleDisabledReason)"
          :title="upscalingSbIds.has(sb.id) ? '正在超分，请稍候' : (upscaleDisabledReason || undefined)"
          @click="onUpscaleSbImage(sb)"
        >
          <el-icon><ZoomIn /></el-icon>超分
        </el-button>
      </el-tooltip>
    </ActionGate>
    </template>
  </div>
  </template>
  <div class="sb-free-ref">
    <div class="sb-free-ref-head">
      <span class="sb-dot"></span>
      <span>自由参考图</span>
      <el-button
        size="small"
        plain
        :aria-label="`为分镜${sb.storyboard_number || i + 1}添加自由参考图`"
        @click="openGlobalMediaPicker(sb, 'reference')"
      >添加自由参考图</el-button>
    </div>
    <div v-if="sbFreeReferenceItems.length" class="sb-free-ref-list">
      <div
        v-for="(item, index) in sbFreeReferenceItems"
        :key="item.asset_id || item.local_path || item.image_url || index"
        class="sb-free-ref-item"
      >
        <button
          type="button"
          class="sb-free-ref-thumb"
          :aria-label="`预览自由参考图 ${item.name || index + 1}`"
          @click="openImagePreview(assetImageUrl(item))"
        >
          <img :src="assetImageUrl(item)" :alt="item.name || `自由参考图 ${index + 1}`" />
        </button>
        <div class="sb-free-ref-body">
          <div class="sb-free-ref-title-row">
            <span class="sb-free-ref-title">{{ item.name || `自由参考图 ${index + 1}` }}</span>
            <el-tag v-if="index === 0" size="small" effect="plain" type="success">主参考</el-tag>
          </div>
          <div class="sb-free-ref-actions">
            <el-button
              size="small"
              link
              type="primary"
              :aria-label="`预览${item.name || `自由参考图 ${index + 1}`}`"
              @click="openImagePreview(assetImageUrl(item))"
            >预览</el-button>
            <el-button
              v-if="index !== 0"
              size="small"
              link
              type="primary"
              :aria-label="`将${item.name || `自由参考图 ${index + 1}`}设为主参考`"
              @click="onPromoteSbFreeReferenceImage(sb, item)"
            >设为主参考</el-button>
            <el-button
              size="small"
              link
              type="danger"
              :aria-label="`移除${item.name || `自由参考图 ${index + 1}`}`"
              @click="onRemoveSbFreeReferenceImage(sb, index)"
            >移除</el-button>
          </div>
        </div>
      </div>
    </div>
    <p v-else class="sb-free-ref-empty" role="status">当前分镜还没有从素材中心挂载自由参考图。</p>
  </div>
</div>
</template>

<script setup>
import { computed } from 'vue'
import { ArrowDown, InfoFilled, MagicStick, QuestionFilled, Refresh, ZoomIn } from '@element-plus/icons-vue'
import UniversalSegmentOmniAtEditor from '@/components/UniversalSegmentOmniAtEditor.vue'
import { toUserFacingError } from '@/utils/userFacingError'
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  sb: { type: Object, required: true },
  i: { type: Number, required: true },
  sbUniversalSegmentText: { type: Object, default: () => ({}) },
  storyboardUseFirstLastFrame: { type: Boolean, default: false },
  generatingSbImageIds: { type: [Set, Object], default: () => new Set() },
  generatingSbFirstImageIds: { type: [Set, Object], default: () => new Set() },
  generatingSbLastImageIds: { type: [Set, Object], default: () => new Set() },
  generatingUniversalSegmentIds: { type: [Set, Object], default: () => new Set() },
  usingPrevTailAsFirstIds: { type: [Set, Object], default: () => new Set() },
  upscalingSbIds: { type: [Set, Object], default: () => new Set() },
  uploadingSbImageId: { type: [Number, String, null], default: null },
  uploadingSbImageSlot: { type: Function, required: true },
  assetImageUrl: { type: Function, required: true },
  canUsePrevTailAsFirst: { type: Function, required: true },
  getSbFirstImage: { type: Function, required: true },
  getSbImage: { type: Function, required: true },
  getSbLastImage: { type: Function, required: true },
  getSbLocalImage: { type: Function, required: true },
  getSbUniversalOmniRefSlots: { type: Function, required: true },
  getStripItems: { type: Function, required: true },
  hasSbDraftImagePlaceholder: { type: Function, required: true },
  hasSbFirstLastPair: { type: Function, required: true },
  hasSbImage: { type: Function, required: true },
  historyImageLabel: { type: Function, required: true },
  isSbUniversalMode: { type: Function, required: true },
  onGenerateSbFrameImage: { type: Function, required: true },
  onGenerateSbFramePair: { type: Function, required: true },
  onGenerateSbImage: { type: Function, required: true },
  onLastFrameLayoutLockChange: { type: Function, required: true },
  onRemoveSbHistoryImage: { type: Function, required: true },
  onSaveUniversalSegmentField: { type: Function, required: true },
  onSbImageDragLeave: { type: Function, required: true },
  onSbImageDragOver: { type: Function, required: true },
  onSbImageDrop: { type: Function, required: true },
  onSelectStripItem: { type: Function, required: true },
  onStripItemClick: { type: Function, required: true },
  onUniversalSegmentPromptMenu: { type: Function, required: true },
  onUploadSbImageClick: { type: Function, required: true },
  onUpscaleSbImage: { type: Function, required: true },
  onUsePrevTailAsFirst: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  sbUniversalSegmentTrimmed: { type: Function, required: true },
  showSbFramePromptPreview: { type: Function, required: true },
  storyboardImageUrl: { type: Function, required: true },
  stripItemTitle: { type: Function, required: true },
  getSbFreeReferenceItems: { type: Function, default: (sb) => (Array.isArray(sb?.reference_images ?? sb?.reference_image_urls) ? (sb.reference_images ?? sb.reference_image_urls) : []) },
  openGlobalMediaPicker: { type: Function, default: () => {} },
  onPromoteSbFreeReferenceImage: { type: Function, default: () => {} },
  onRemoveSbFreeReferenceImage: { type: Function, default: () => {} },
  storyboardMediaActionReason: { type: String, default: '' },
})

const lastFrameUseFirstLayoutLock = defineModel('lastFrameUseFirstLayoutLock', { type: Boolean, default: false })
const dragOverSbId = defineModel('dragOverSbId', { default: null })

function describeImageGenerateDisabledReason(reason) {
  return String(reason || '').trim()
}

function describeUpscaleDisabledReason(hasLocalImage) {
  return hasLocalImage ? '' : '当前分镜没有可超分的本地图片'
}

function describeUniversalSegmentActionDisabledReason(hasSegment) {
  return hasSegment ? '' : '请先生成全能提示词'
}

function describeStoryboardImageError(sb) {
  return toUserFacingError(sb?.error_msg || sb?.errorMsg, '生成失败')
}

const imageGenerateDisabledReason = computed(() => describeImageGenerateDisabledReason(props.storyboardMediaActionReason))
const upscaleDisabledReason = computed(() => describeUpscaleDisabledReason(Boolean(props.getSbLocalImage(props.sb))))
const imageErrorText = computed(() => describeStoryboardImageError(props.sb))
const universalSegmentActionDisabledReason = computed(() => (
  describeUniversalSegmentActionDisabledReason(Boolean(props.sbUniversalSegmentTrimmed(props.sb)))
))

const sbFreeReferenceItems = computed(() => {
  const items = props.getSbFreeReferenceItems(props.sb)
  return Array.isArray(items) ? items : []
})
</script>

<style scoped src="./FilmCreateStoryboardImageColumn.css"></style>
