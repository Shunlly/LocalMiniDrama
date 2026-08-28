<template>
  <div class="film-create-storyboard-dialogs">
    <!-- 分镜提示词编辑弹窗 -->
    <AccessibleDialog
      v-model="showSbPromptDialog"
      :title="`分镜 ${sbPromptTarget?.storyboard_number ?? ''} · 编辑提示词`"
      width="700px"
      @close="sbPromptTarget = null"
    >
      <el-form v-if="sbPromptTarget" label-width="0" class="sb-prompt-dialog-form">
        <!-- 图片区 -->
        <div class="sb-prompt-section-title">🖼 图片提示词</div>
        <el-form-item label="">
          <div style="width:100%">
            <div style="font-size:12px; color:#6b7280; margin-bottom:4px;">原始提示词（分镜生成时写入，仅供参考）</div>
            <el-input
              v-model="sbPromptImageText"
              type="textarea"
              :rows="4"
              placeholder="分镜生成时由 AI 写入的原始描述"
            />
          </div>
        </el-form-item>
        <el-form-item label="">
          <div style="width:100%">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="font-size:12px; color:#6b7280;">通用优化提示词（仅更新本字段，不影响首尾帧/关键帧专用提示词）</span>
              <el-button
                size="small"
                type="warning"
                plain
                :loading="sbPromptPolishing"
                @click="onPolishSbPrompt"
              >{{ sbPromptPolishedText ? '重新生成' : '立即生成' }}</el-button>
            </div>
            <el-input
              v-model="sbPromptPolishedText"
              type="textarea"
              :rows="5"
              placeholder="点击「立即生成」润色通用优化提示词（仅更新本字段，不影响首尾帧专用提示词）"
            />
          </div>
        </el-form-item>
        <!-- 视频区 -->
        <div class="sb-prompt-section-title" style="margin-top:12px;">🎬 视频提示词</div>
        <el-form-item label="">
          <el-input
            v-model="sbPromptVideoText"
            type="textarea"
            :rows="12"
            placeholder="视频生成提示词（可选，留空则由系统自动生成）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSbPromptDialog = false">取消</el-button>
        <el-button type="primary" :loading="sbPromptSaving" @click="onSaveSbPromptDialog">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 首尾帧提示词编辑器（显示最终发给AI的完整提示词，支持编辑保存） -->
    <AccessibleDialog
      v-model="showFramePromptEditor"
      :title="`${editingFramePromptSlot === 'last' ? '尾帧' : '首帧'}图生提示词 · 编辑`"
      width="720px"
      destroy-on-close
    >
      <div class="frame-prompt-editor-body">
        <div class="frame-prompt-editor-hint">
          此提示词将直接发给AI生成首/尾帧图片。支持编辑后保存，保存后点击「生成」即可使用新提示词。
        </div>

        <!-- 空间布局锚点（生成分镜时 AI 输出的最高优先级站位合同） -->
        <div v-if="editingFramePromptSb?.layout_description" class="frame-layout-anchor">
          <div class="frame-layout-anchor-label">本分镜空间布局锚点（首尾帧强制一致合同，最高优先级）</div>
          <div class="frame-layout-anchor-text">{{ editingFramePromptSb.layout_description }}</div>
          <div class="frame-layout-anchor-note">首帧必须严格按此生成初始站位；尾帧必须在完全相同的左右位置、距离、构图下仅演化姿态/表情/结果。</div>
        </div>

        <el-input
          v-model="editingFramePromptText"
          type="textarea"
          :rows="14"
          placeholder="在此编辑最终发给AI生图的完整提示词..."
          class="frame-prompt-editor-textarea"
        />
      </div>
      <template #footer>
        <el-button @click="showFramePromptEditor = false">关闭</el-button>
        <el-button :loading="editingFramePromptRegenerating" @click="regenerateEditingFramePrompt">重新生成</el-button>
        <el-button type="primary" :loading="editingFramePromptSaving" @click="saveEditingFramePrompt">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 分镜视频参数编辑弹窗 -->
    <AccessibleDialog
      v-model="showVideoParamsDialog"
      :title="`分镜 ${videoParamsTarget?.storyboard_number ?? ''} · 视频参数`"
      width="860px"
      destroy-on-close
      @close="onVideoParamsDialogClosed"
    >
      <el-form v-if="videoParamsTarget" label-width="115px" size="small" class="vp-dialog-form">
        <el-form-item label="创作模式">
          <el-radio-group
            :model-value="sbCreationMode[videoParamsTarget.id] === 'universal' ? 'universal' : 'classic'"
            size="small"
            @change="(v) => setSbCreationModeId(videoParamsTarget.id, v)"
          >
            <el-radio-button value="classic">经典分镜</el-radio-button>
            <el-radio-button value="universal">全能模式</el-radio-button>
          </el-radio-group>
          <div class="vp-mode-hint">全能模式：中间为片段描述；生视频时使用 <strong>AI 配置里当前启用的视频</strong>（接口规范 <code>kling_omni</code> 或 <code>volcengine_omni</code>，模型如 <code>kling-video-o1</code>、<code>doubao-seedance-2-0-260128</code> 等）并合并场景/角色/道具等参考图（不含经典分镜主图）。经典字段保留，可随时切回。</div>
        </el-form-item>
        <el-form-item v-if="getSbGridImages(videoParamsTarget.id).length" label="视频参考图">
          <el-select
            v-model="sbVideoReferenceImageId[videoParamsTarget.id]"
            :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}视频参考图`"
            clearable
            placeholder="默认使用主图/首帧"
            style="width:280px"
          >
            <el-option
              v-for="image in getSbGridImages(videoParamsTarget.id)"
              :key="image.id"
              :label="image.frame_type === 'nine_grid' ? `九宫格整图 #${image.id}` : `四宫格整图 #${image.id}`"
              :value="image.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="素材中心参考图">
          <div class="vp-reference-panel">
            <div class="vp-reference-toolbar">
              <el-button size="small" @click="openGlobalMediaPicker(videoParamsTarget, 'reference-primary')">设为视频主参考</el-button>
              <el-button size="small" plain @click="openGlobalMediaPicker(videoParamsTarget, 'reference')">添加自由参考图</el-button>
            </div>
            <div v-if="getSbFreeReferenceItems(videoParamsTarget).length" class="vp-reference-list">
              <div
                v-for="(item, index) in getSbFreeReferenceItems(videoParamsTarget)"
                :key="item.asset_id || item.local_path || item.image_url || index"
                class="vp-reference-item"
              >
                <button
                  type="button"
                  class="vp-reference-thumb"
                  :aria-label="`预览自由参考图 ${item.name || index + 1}`"
                  @click="openImagePreview(assetImageUrl(item))"
                >
                  <img :src="assetImageUrl(item)" :alt="item.name || `自由参考图 ${index + 1}`" />
                </button>
                <div class="vp-reference-body">
                  <div class="vp-reference-title-row">
                    <span class="vp-reference-title">{{ item.name || `自由参考图 ${index + 1}` }}</span>
                    <el-tag v-if="index === 0" size="small" effect="plain" type="success">主参考</el-tag>
                  </div>
                  <div class="vp-reference-meta">{{ item.source_drama_title || '全局上传' }}</div>
                  <div class="vp-reference-actions">
                    <el-button
                      v-if="index !== 0"
                      size="small"
                      link
                      type="primary"
                      @click="onPromoteSbFreeReferenceImage(videoParamsTarget, item)"
                    >
                      设为主参考
                    </el-button>
                    <el-button
                      size="small"
                      link
                      type="danger"
                      @click="onRemoveSbFreeReferenceImage(videoParamsTarget, index)"
                    >
                      移除
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="vp-reference-empty">当前分镜还没有从素材中心挂载自由参考图。</div>
          </div>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标题">
              <el-input v-model="sbTitle[videoParamsTarget.id]" placeholder="镜头标题" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="地点">
              <el-input v-model="sbLocation[videoParamsTarget.id]" placeholder="场景地点" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="时间">
              <el-input v-model="sbTime[videoParamsTarget.id]" placeholder="清晨/午后" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="时长(秒)">
              <el-input-number v-model="sbDuration[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}时长（秒）`" :min="1" :max="60" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="景别">
              <el-select v-model="sbShotType[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}景别`" placeholder="景别" style="width:100%">
                <el-option label="大远景" value="大远景" />
                <el-option label="远景" value="远景" />
                <el-option label="中景" value="中景" />
                <el-option label="近景" value="近景" />
                <el-option label="特写" value="特写" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="运镜">
              <el-select v-model="sbMovement[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}运镜`" placeholder="运镜（推荐动态）" style="width:100%" clearable filterable>
                <el-option-group label="基础运镜">
                  <el-option label="固定（少用）" value="static" />
                  <el-option label="推镜" value="push" />
                  <el-option label="拉镜" value="pull" />
                  <el-option label="横摇（左/右）" value="pan" />
                  <el-option label="纵摇（上/下）" value="tilt" />
                  <el-option label="跟镜/跟踪" value="tracking" />
                  <el-option label="升镜（吊臂上升）" value="crane_up" />
                  <el-option label="降镜（吊臂下降）" value="crane_dn" />
                  <el-option label="环绕/轨道" value="orbit" />
                  <el-option label="手持/晃动" value="handheld" />
                </el-option-group>
                <el-option-group label="进阶运镜">
                  <el-option label="变焦（zoom in/out）" value="zoom" />
                  <el-option label="旋转/滚镜（roll）" value="roll" />
                  <el-option label="甩镜/急摇" value="whip_pan" />
                  <el-option label="螺旋上升/下降" value="spiral" />
                </el-option-group>
                <el-option-group label="电影化组合镜头">
                  <el-option label="希区柯克镜头（推+变焦）" value="hitchcock_zoom" />
                  <el-option label="子弹时间（环绕+升格）" value="bullet_time" />
                  <el-option label="荷兰角+运镜" value="dutch_angle_move" />
                  <el-option label="推轨复合（dolly+track）" value="dolly_track" />
                  <el-option label="升格环绕（slow-mo orbit）" value="slowmo_orbit" />
                </el-option-group>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="氛围">
              <el-input v-model="sbAtmosphere[videoParamsTarget.id]" placeholder="氛围/情绪" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="镜头视角">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <el-select v-model="sbAngleS[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}镜头景别`" placeholder="景别" style="width:76px">
                  <el-option label="特写" value="close_up" />
                  <el-option label="中景" value="medium" />
                  <el-option label="远景" value="wide" />
                </el-select>
                <el-select v-model="sbAngleV[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}镜头俯仰`" placeholder="俯仰" style="width:86px">
                  <el-option label="平视" value="eye_level" />
                  <el-option label="低角仰拍" value="low" />
                  <el-option label="高角俯拍" value="high" />
                  <el-option label="虫眼仰视" value="worm" />
                </el-select>
                <el-select v-model="sbAngleH[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}镜头方向`" placeholder="方向" style="width:80px">
                  <el-option label="正面" value="front" />
                  <el-option label="前左45°" value="front_left" />
                  <el-option label="左侧" value="left" />
                  <el-option label="后左135°" value="back_left" />
                  <el-option label="背面" value="back" />
                  <el-option label="后右135°" value="back_right" />
                  <el-option label="右侧" value="right" />
                  <el-option label="前右45°" value="front_right" />
                </el-select>
                <span v-if="sbAngleS[videoParamsTarget.id] && sbAngleV[videoParamsTarget.id] && sbAngleH[videoParamsTarget.id]"
                      style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 6px;border-radius:4px;white-space:nowrap">
                  {{ angleToPromptFragment(sbAngleH[videoParamsTarget.id], sbAngleV[videoParamsTarget.id], sbAngleS[videoParamsTarget.id]).label }}
                </span>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="灯光">
              <el-select v-model="sbLighting[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}灯光风格`" placeholder="灯光风格" style="width:100%" clearable>
                <el-option label="自然光" value="natural" />
                <el-option label="顺光" value="front" />
                <el-option label="侧光" value="side" />
                <el-option label="逆光" value="backlit" />
                <el-option label="顶光" value="top" />
                <el-option label="底光" value="under" />
                <el-option label="柔光" value="soft" />
                <el-option label="戏剧光" value="dramatic" />
                <el-option label="黄金时段" value="golden_hour" />
                <el-option label="蓝调时刻" value="blue_hour" />
                <el-option label="夜景" value="night" />
                <el-option label="霓虹" value="neon" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="景深">
              <el-select v-model="sbDof[videoParamsTarget.id]" :aria-label="`分镜${videoParamsTarget.storyboard_number || videoParamsTarget.id}景深`" placeholder="景深" style="width:100%" clearable>
                <el-option label="极浅景深" value="extreme_shallow" />
                <el-option label="浅景深" value="shallow" />
                <el-option label="中景深" value="medium" />
                <el-option label="深景深（全焦）" value="deep" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 空间布局锚点：生成分镜时 AI 输出的最高优先级人物站位合同（首尾帧强制一致核心） -->
        <el-form-item label="空间布局锚点（首尾帧人物站位合同）">
          <div style="display:flex; gap:8px; align-items:flex-start; width:100%">
            <el-input
              v-model="sbLayoutDescription[videoParamsTarget.id]"
              type="textarea"
              :rows="3"
              placeholder="例如：女主站画面左三分之一正对镜头，男主站右后侧侧身看向女主，中景，双人构图，平衡稳定"
              style="flex:1"
            />
            <el-button
              size="small"
              :loading="regeneratingLayoutSbIds.has(videoParamsTarget.id)"
              @click="onRegenerateLayoutDescription(videoParamsTarget)"
              style="margin-top:4px; white-space:nowrap"
            >
              AI 重新生成/优化
            </el-button>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35">
            最高优先级空间合同（用于首尾帧站位锁定）。AI 可参考上下分镜一键重新生成/优化，点击右侧按钮触发。
          </div>
        </el-form-item>

        <el-form-item label="动作">
          <el-input v-model="sbAction[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="动作描述" />
        </el-form-item>
        <el-form-item label="对白">
          <el-input v-model="sbDialogue[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="角色对白" />
        </el-form-item>
        <el-form-item label="解说旁白">
          <el-input v-model="sbNarration[videoParamsTarget.id]" type="textarea" :rows="2" class="sb-narration-input" placeholder="画外解说 / 纪录片式旁白（与对白分开）" />
        </el-form-item>
        <el-form-item v-if="canSplitSbByAudio(videoParamsTarget)" label="多角色对白">
          <div class="sb-split-audio-row">
            <p class="sb-split-audio-tip">
              本镜含多句对白或「对白+旁白」，Seedance 同镜易串音。可拆成多条分镜（每条仅一人说话或仅旁白），再分别生视频。
            </p>
            <el-button
              type="warning"
              plain
              :loading="splitByAudioLoading"
              @click="onSplitSbByAudio(videoParamsTarget)"
            >
              按对白拆镜
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="画面结果">
          <el-input v-model="sbResult[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="动作完成后的画面结果" />
        </el-form-item>
        <el-form-item label="视频提示词">
          <div class="vp-video-prompt-hint">保存后将根据上方字段，由系统按最新规则自动生成（含角色音色锚点）。</div>
          <el-input
            v-if="videoParamsTarget?.video_prompt"
            :model-value="videoParamsTarget.video_prompt"
            type="textarea"
            :rows="3"
            readonly
            style="color:#6b7280;margin-top:8px"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showVideoParamsDialog = false">取消</el-button>
        <el-button type="primary" :loading="videoParamsSaving" @click="onSaveVideoParams">保存并更新</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

const props = defineProps({
  editingFramePromptRegenerating: { type: Boolean, default: false },
  editingFramePromptSaving: { type: Boolean, default: false },
  editingFramePromptSb: { type: Object, default: null },
  editingFramePromptSlot: { type: String, default: 'first' },
  regeneratingLayoutSbIds: { type: [Set, Object], default: () => new Set() },
  sbAction: { type: Object, default: () => ({}) },
  sbAngleH: { type: Object, default: () => ({}) },
  sbAngleS: { type: Object, default: () => ({}) },
  sbAngleV: { type: Object, default: () => ({}) },
  sbAtmosphere: { type: Object, default: () => ({}) },
  sbCreationMode: { type: Object, default: () => ({}) },
  sbDialogue: { type: Object, default: () => ({}) },
  sbDof: { type: Object, default: () => ({}) },
  sbDuration: { type: Object, default: () => ({}) },
  sbLayoutDescription: { type: Object, default: () => ({}) },
  sbLighting: { type: Object, default: () => ({}) },
  sbLocation: { type: Object, default: () => ({}) },
  sbMovement: { type: Object, default: () => ({}) },
  sbNarration: { type: Object, default: () => ({}) },
  sbPromptPolishing: { type: Boolean, default: false },
  sbPromptSaving: { type: Boolean, default: false },
  sbResult: { type: Object, default: () => ({}) },
  sbShotType: { type: Object, default: () => ({}) },
  sbTime: { type: Object, default: () => ({}) },
  sbTitle: { type: Object, default: () => ({}) },
  sbVideoReferenceImageId: { type: Object, default: () => ({}) },
  splitByAudioLoading: { type: Boolean, default: false },
  videoParamsSaving: { type: Boolean, default: false },
  videoParamsTarget: { type: Object, default: null },
  angleToPromptFragment: { type: Function, required: true },
  assetImageUrl: { type: Function, required: true },
  canSplitSbByAudio: { type: Function, required: true },
  getSbFreeReferenceItems: { type: Function, required: true },
  getSbGridImages: { type: Function, required: true },
  onPolishSbPrompt: { type: Function, required: true },
  onPromoteSbFreeReferenceImage: { type: Function, required: true },
  onRegenerateLayoutDescription: { type: Function, required: true },
  onRemoveSbFreeReferenceImage: { type: Function, required: true },
  onSaveSbPromptDialog: { type: Function, required: true },
  onSaveVideoParams: { type: Function, required: true },
  onSplitSbByAudio: { type: Function, required: true },
  onVideoParamsDialogClosed: { type: Function, required: true },
  openGlobalMediaPicker: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  regenerateEditingFramePrompt: { type: Function, required: true },
  saveEditingFramePrompt: { type: Function, required: true },
  setSbCreationModeId: { type: Function, required: true },
})

const sbPromptTarget = defineModel('sbPromptTarget', { type: Object, default: null })
const showSbPromptDialog = defineModel('showSbPromptDialog', { type: Boolean, default: false })
const showFramePromptEditor = defineModel('showFramePromptEditor', { type: Boolean, default: false })
const showVideoParamsDialog = defineModel('showVideoParamsDialog', { type: Boolean, default: false })
const editingFramePromptText = defineModel('editingFramePromptText', { type: String, default: '' })
const sbPromptImageText = defineModel('sbPromptImageText', { type: String, default: '' })
const sbPromptPolishedText = defineModel('sbPromptPolishedText', { type: String, default: '' })
const sbPromptVideoText = defineModel('sbPromptVideoText', { type: String, default: '' })

const {
angleToPromptFragment,
assetImageUrl,
canSplitSbByAudio,
getSbFreeReferenceItems,
getSbGridImages,
onPolishSbPrompt,
onPromoteSbFreeReferenceImage,
onRegenerateLayoutDescription,
onRemoveSbFreeReferenceImage,
onSaveSbPromptDialog,
onSaveVideoParams,
onSplitSbByAudio,
onVideoParamsDialogClosed,
openGlobalMediaPicker,
openImagePreview,
regenerateEditingFramePrompt,
saveEditingFramePrompt,
setSbCreationModeId
} = props

</script>

<style scoped>
.vp-mode-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.45;
  margin-top: 8px;
  max-width: 520px;
}

.vp-dialog-form .el-form-item {
  margin-bottom: 12px;
}

.vp-dialog-form :deep(.el-form-item__content) {
  min-width: 0;
}

.vp-reference-panel {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vp-reference-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.vp-reference-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  width: 100%;
  max-height: 176px;
  overflow-y: auto;
}

.vp-reference-item {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.vp-reference-thumb {
  width: 64px;
  height: 64px;
  min-width: 64px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-dark);
  cursor: pointer;
}

.vp-reference-thumb:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.vp-reference-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.vp-reference-body {
  min-width: 0;
}

.vp-reference-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.vp-reference-title {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vp-reference-meta {
  margin-top: 3px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vp-reference-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}

.vp-reference-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.vp-reference-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.sb-prompt-section-title { font-size: 0.9rem; font-weight: 600; color: #e4e4e7; margin-bottom: 8px; }

.sb-prompt-section-title--row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }

.vp-video-prompt-hint { font-size: 12px; color: #909399; line-height: 1.5; }

.sb-prompt-dialog-form .el-form-item { margin-bottom: 10px; }

.sb-frame-prompt-clean .el-message-box__content {
  padding: 16px 20px 8px;
}

.frame-prompt-editor-body {
  padding: 4px 0;
}

.frame-prompt-editor-hint {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
  line-height: 1.5;
}

html.light .frame-prompt-editor-hint {
  color: #475569;
}

.frame-prompt-editor-textarea :deep(.el-textarea__inner) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
}

.frame-layout-anchor {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}

html.light .frame-layout-anchor {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.frame-layout-anchor-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 4px;
}

.frame-layout-anchor-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: #1e293b;
  background: #fff;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}

.frame-layout-anchor-note {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
