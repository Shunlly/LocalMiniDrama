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
            <el-select v-model="gridMode" aria-label="分镜序列图模式" size="small" style="width:110px" :disabled="storyboardUseFirstLastFrame">
              <el-option label="单张" value="single" />
              <el-option label="四宫格" value="quad_grid" />
              <el-option label="九宫格" value="nine_grid" />
            </el-select>
            <span class="sb-config-hint">{{ storyboardUseFirstLastFrame ? '首尾帧模式下使用单张图，序列宫格暂不可用' : '四/九宫格自动按视角拆分' }}</span>
          </label>
        </div>
        <div class="sb-config-row sb-narration-export-row" style="margin-top:10px;flex-wrap:wrap;align-items:center;gap:12px">
          <el-checkbox v-model="storyboardUseFirstLastFrame" @change="onStoryboardUseFirstLastFrameChange">
            首尾帧参考图（生成首帧和尾帧，帮助视频保持镜头衔接）
          </el-checkbox>
          <el-checkbox v-model="storyboardUniversalOmni" @change="emit('save-settings')">
            多段分镜模式（每镜生成可直接用于长提示词的分段描述）
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
              @click="onExportStoryboardSheet"
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
              @click="onExportNarrationSrt"
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
                :disabled="Boolean(storyboardActionDisabledReason)"
                @click="onGenerateStoryboard"
              >
                {{ storyboards.length > 0 ? '重新生成分镜' : 'AI 生成分镜' }}
              </el-button>
            </ActionGate>
            <ActionGate :reason="episodeActionDisabledReason" label="添加一个分镜">
              <el-button type="info" plain size="large" :disabled="Boolean(episodeActionDisabledReason)" @click="onAddSingleStoryboard">
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
                  @click="startBatchImageGeneration"
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
                  @click="startBatchVideoGeneration"
                >
                  批量生成分镜视频
                </el-button>
              </ActionGate>
              <el-button v-if="batchImageRunning" size="large" type="danger" plain @click="batchImageStopping = true">停止图片</el-button>
              <el-button v-if="batchVideoRunning" size="large" type="danger" plain @click="batchVideoStopping = true">停止视频</el-button>
            </div>
            <div v-if="videoCapabilityReason" class="batch-video-capability" role="alert">
              <span>{{ videoCapabilityReason }}</span>
              <el-button link type="primary" @click="openAiConfig('video')">前往 AI 配置</el-button>
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
        <!-- 批量生成进度 -->
        <div v-if="batchImageRunning || batchVideoRunning || batchImageErrors.length || batchVideoErrors.length" class="batch-status">
          <div v-if="batchImageRunning" class="batch-progress">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>批量生成分镜图：{{ batchImageProgress.current }}/{{ batchImageProgress.total }}</span>
            <span v-if="batchImageProgress.failed > 0" class="batch-failed">{{ batchImageProgress.failed }} 条失败</span>
            <span v-if="batchImageStopping" class="batch-stopping">（正在停止...）</span>
          </div>
          <div v-if="batchVideoRunning" class="batch-progress">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>批量生成分镜视频：{{ batchVideoProgress.current }}/{{ batchVideoProgress.total }}</span>
            <span v-if="batchVideoProgress.failed > 0" class="batch-failed">{{ batchVideoProgress.failed }} 条失败</span>
            <span v-if="batchVideoStopping" class="batch-stopping">（正在停止...）</span>
          </div>
          <div v-if="batchImageErrors.length > 0" class="batch-error-log">
            <div class="batch-error-title">分镜图生成失败记录：</div>
            <div v-for="(e, i) in batchImageErrors" :key="i" class="batch-error-line">{{ e }}</div>
          </div>
          <div v-if="batchVideoErrors.length > 0" class="batch-error-log">
            <div class="batch-error-title">分镜视频生成失败记录：</div>
            <div v-for="(e, i) in batchVideoErrors" :key="i" class="batch-error-line">{{ e }}</div>
          </div>
        </div>
        <div v-if="storyboardGenerating || universalOmniPolishRunning" class="storyboard-generating-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span v-if="universalOmniPolishRunning">
            正在润色全能提示词：第 {{ universalOmniPolishProgress.current }} / {{ universalOmniPolishProgress.total }} 镜
            <template v-if="universalOmniPolishProgress.label">（{{ universalOmniPolishProgress.label }}）</template>
            …
          </span>
          <span v-else>正在分析剧本并拆解分镜，请稍候...</span>
        </div>
        <div v-if="sbTruncatedWarning && !sbTruncatedDismissed && storyboards.length > 0" class="sb-truncated-warning">
          <el-icon><WarningFilled /></el-icon>
          <span>检测到分镜可能不完整（AI 输出被截断），请确认分镜数量是否符合预期，必要时可重新生成。</span>
          <el-button size="small" text @click="sbTruncatedDismissed = true">关闭</el-button>
        </div>
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
          <div class="sb-ctrl-bar">
            <span class="sb-ctrl-num">{{ i + 1 }}</span>
            <span class="sb-ctrl-title">{{ sb.title || '未命名分镜' }}</span>
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
            <!-- 左：分镜脚本 -->
            <div class="sb-panel sb-script">
              <div class="sb-script-row sb-script-selects">
                <el-select
                  :model-value="getSbCharacterIds(sb.id)"
                  :aria-label="`分镜${sb.storyboard_number || i + 1}角色`"
                  placeholder="选择角色"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  size="small"
                  class="sb-select"
                  @update:model-value="(v) => setSbCharacterIds(sb.id, v)"
                >
                  <el-option
                    v-for="c in (characters || [])"
                    :key="String(c.id)"
                    :label="c.name || '未命名'"
                    :value="c.id"
                  />
                  <template v-if="!(characters || []).length" #empty>
                    <span class="sb-select-empty">请先在「角色」面板添加角色</span>
                  </template>
                </el-select>
                <el-select
                  v-model="sbSceneId[sb.id]"
                  :aria-label="`分镜${sb.storyboard_number || i + 1}场景`"
                  placeholder="选择场景"
                  clearable
                  size="small"
                  class="sb-select"
                  @change="() => onStoryboardSceneChange(sb.id)"
                >
                  <el-option
                    v-for="s in (scenes || [])"
                    :key="s.id"
                    :label="s.location"
                    :value="s.id"
                  />
                  <template v-if="!(scenes || []).length" #empty>
                    <span class="sb-select-empty">请先在「场景」面板添加场景</span>
                  </template>
                </el-select>
                <el-select
                  :model-value="getSbPropIds(sb.id)"
                  :aria-label="`分镜${sb.storyboard_number || i + 1}道具`"
                  placeholder="选择道具"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  size="small"
                  class="sb-select"
                  @update:model-value="(v) => setSbPropIds(sb.id, v)"
                >
                  <el-option
                    v-for="p in (propItems || [])"
                    :key="String(p.id)"
                    :label="p.name || '未命名'"
                    :value="p.id"
                  />
                  <template v-if="!(propItems || []).length" #empty>
                    <span class="sb-select-empty">请先在「道具」面板添加道具</span>
                  </template>
                </el-select>
              </div>
              <!-- 当前选中：场景 / 角色 / 道具缩略图 -->
              <div v-if="getSbSelectedScene(sb.id) || getSbSelectedCharacters(sb.id).length || getSbSelectedProps(sb.id).length || (characters || []).length" class="sb-selected-thumbs">
                <div v-if="getSbSelectedScene(sb.id)" class="sb-thumb-row">
                  <span class="sb-thumb-label">场景</span>
                  <div class="sb-thumb-list">
                    <button
                      type="button"
                      v-for="s in [getSbSelectedScene(sb.id)]"
                      :key="s.id"
                      class="sb-thumb-item sb-thumb-scene"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(s) }"
                      :title="s.location"
                      :disabled="!hasAssetImage(s)"
                      :aria-label="`预览${s.location || '场景'}图片`"
                      @click="hasAssetImage(s) && openImagePreview(assetImageUrl(s))"
                    >
                      <img v-if="hasAssetImage(s)" :src="assetImageUrl(s)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (s.location || '')[0] }}</span>
                    </button>
                  </div>
                </div>
                <div v-if="(characters || []).length" class="sb-thumb-row">
                  <span class="sb-thumb-label">角色</span>
                  <div class="sb-thumb-list">
                    <button
                      type="button"
                      v-for="c in getSbSelectedCharacters(sb.id)"
                      :key="c.id"
                      class="sb-thumb-item sb-thumb-avatar"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(c) }"
                      :title="c.name"
                      :disabled="!hasAssetImage(c)"
                      :aria-label="`预览${c.name || '角色'}图片`"
                      @click="hasAssetImage(c) && openImagePreview(assetImageUrl(c))"
                    >
                      <img v-if="hasAssetImage(c)" :src="assetImageUrl(c)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (c.name || '')[0] }}</span>
                    </button>
                    <el-dropdown trigger="click" @command="(cmd) => onSbAddCharacterCommand(sb.id, cmd)">
                      <button
                        type="button"
                        class="sb-thumb-item sb-thumb-avatar sb-thumb-add-char"
                        title="添加角色"
                        :aria-label="`为分镜${sb.storyboard_number || i + 1}添加角色`"
                        @click.stop
                      >
                        <el-icon><Plus /></el-icon>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu class="sb-char-add-dropdown">
                          <el-dropdown-item
                            v-for="c in charactersAvailableToAddToSb(sb.id)"
                            :key="c.id"
                            :command="c.id"
                          >
                            {{ c.name || '未命名' }}
                          </el-dropdown-item>
                          <el-dropdown-item v-if="!charactersAvailableToAddToSb(sb.id).length" disabled>
                            已全部添加或无角色
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
                <div v-if="getSbSelectedProps(sb.id).length" class="sb-thumb-row">
                  <span class="sb-thumb-label">道具</span>
                  <div class="sb-thumb-list">
                    <button
                      type="button"
                      v-for="p in getSbSelectedProps(sb.id)"
                      :key="p.id"
                      class="sb-thumb-item sb-thumb-prop"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(p) }"
                      :title="p.name"
                      :disabled="!hasAssetImage(p)"
                      :aria-label="`预览${p.name || '道具'}图片`"
                      @click="hasAssetImage(p) && openImagePreview(assetImageUrl(p))"
                    >
                      <img v-if="hasAssetImage(p)" :src="assetImageUrl(p)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (p.name || '')[0] }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <!-- 首尾帧模式下隐藏“图片提示词”入口，统一收敛到首/尾帧槽位的“查看提示词” -->
              <div v-if="!storyboardUseFirstLastFrame" class="sb-prompt-label">
                <span class="sb-dot"></span>
                <span>图片提示词</span>
              </div>
              <div v-if="!storyboardUseFirstLastFrame" class="sb-prompt-row">
                <span class="sb-prompt-text">{{ sb.image_prompt || '暂无图片提示词' }}</span>
                <el-button size="small" link type="primary" @click="onOpenSbPromptDialog(sb)">编辑</el-button>
              </div>
              <template v-if="storyboardIncludeNarration || (sbNarration[sb.id] || '').trim() || (sb.narration || '').trim()">
                <div class="sb-prompt-label">
                  <span class="sb-dot"></span>
                  <span>解说旁白</span>
                </div>
                <el-input
                  v-model="sbNarration[sb.id]"
                  type="textarea"
                  :rows="2"
                  :aria-label="`分镜${sb.storyboard_number || i + 1}解说旁白`"
                  placeholder="本镜解说文案（画外音 / 纪录片式旁白，可生成配音或导出字幕）"
                  class="sb-narration-input"
                  @blur="() => onSaveSbNarrationField(sb)"
                />
                <div v-if="(sbNarration[sb.id] || sb.narration || '').toString().trim()" class="sb-narration-actions">
                  <ActionGate :reason="ttsGenerationDisabledReason(sb.id, 'narration')" label="解说配音">
                    <el-button
                      size="small"
                      :loading="ttsSbNarrationIds.has(sb.id)"
                      :disabled="Boolean(ttsGenerationDisabledReason(sb.id, 'narration'))"
                      @click="onTtsSbNarration(sb)"
                    >
                      解说配音
                    </el-button>
                  </ActionGate>
                  <el-tooltip v-if="sbNarrationAudioRelPath(sb)" content="播放解说旁白配音" placement="top">
                    <el-button size="small" :aria-label="`播放分镜${sb.storyboard_number || i + 1}解说旁白配音`" @click="playSbNarrationTts(sb)">
                      <el-icon><VideoPlay /></el-icon>
                    </el-button>
                  </el-tooltip>
                </div>
              </template>
            </div>
            <!-- 中：经典模式=分镜参考图；全能模式=片段描述（独立字段，与参考图并存） -->
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
                    >
                      全能提示词
                      <el-icon class="sb-universal-dd-caret"><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="generate">生成全能提示词</el-dropdown-item>
                        <el-dropdown-item command="generate-force">不查图片强制生成</el-dropdown-item>
                        <el-dropdown-item command="polish" :disabled="!sbUniversalSegmentTrimmed(sb)">
                          润色全能提示词
                        </el-dropdown-item>
                        <el-dropdown-item command="polish-force" :disabled="!sbUniversalSegmentTrimmed(sb)">
                          不查图片强制润色
                        </el-dropdown-item>
                        <el-dropdown-item
                          command="to-grok-video-tags"
                          divided
                          :disabled="!sbUniversalSegmentTrimmed(sb)"
                        >
                          改为 grok视频格式
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
                        <el-button type="primary" size="small" :loading="generatingSbFirstImageIds.has(sb.id)" @click="onGenerateSbFrameImage(sb, 'first')">生成</el-button>
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
                        <el-button type="primary" size="small" :loading="generatingSbLastImageIds.has(sb.id)" @click="onGenerateSbFrameImage(sb, 'last')">生成</el-button>
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
                    <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">
                      <el-icon><MagicStick /></el-icon>
                      生成分镜参考图
                    </el-button>
                    <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                  </template>
                  <template v-else-if="sb.error_msg || sb.errorMsg">
                    <div class="sb-image-error" :title="sb.error_msg || sb.errorMsg">{{ sb.error_msg || sb.errorMsg }}</div>
                    <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">
                      <el-icon><Refresh /></el-icon>
                      重试
                    </el-button>
                    <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                  </template>
                  <template v-else>
                    <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">
                      <el-icon><MagicStick /></el-icon>
                      生成分镜参考图
                    </el-button>
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
                  <el-button size="small" :loading="generatingSbFirstImageIds.has(sb.id) || generatingSbLastImageIds.has(sb.id)" @click="onGenerateSbFramePair(sb)">{{ hasSbFirstLastPair(sb) ? '重新生成首尾帧' : '一键生成首尾帧' }}</el-button>
                  <el-tooltip content="高清放大仅作用于首帧" placement="top">
                    <el-button size="small" :loading="upscalingSbIds.has(sb.id)" :disabled="!getSbLocalImage(sb)" @click="onUpscaleSbImage(sb)">
                      <el-icon><ZoomIn /></el-icon>超分(首帧)
                    </el-button>
                  </el-tooltip>
                </template>
                <template v-else>
                <el-button size="small" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">重新生成</el-button>
                <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                <el-tooltip content="高清放大（2x超分辨率）" placement="top">
                  <el-button
                    size="small"
                    :loading="upscalingSbIds.has(sb.id)"
                    :disabled="!getSbLocalImage(sb)"
                    @click="onUpscaleSbImage(sb)"
                  >
                    <el-icon><ZoomIn /></el-icon>超分
                  </el-button>
                </el-tooltip>
                </template>
              </div>
              </template>
            </div>
            <!-- 右：分镜视频（由 /videos?storyboard_id 拉取）；有视频时仍显示提示词与生成按钮便于调整后重新生成 -->
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
                      @click="onGenerateSbVideo(sb)"
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
                  @click="onSelectSbMainVideo(sb, item.video)"
                >
                  <video :src="item.src" preload="metadata" aria-hidden="true" class="sb-video-thumb-player" />
                  <span class="sb-video-thumb-label">{{ item.label }}</span>
                </button>
              </div>
              <div v-if="getSbVideo(sb.id)" class="sb-video-actions">
                <ActionGate :reason="sbVideoGenerationDisabledReason(sb)" label="重新生成">
                  <el-button size="small" :loading="isSbVideoGenerating(sb.id)" :disabled="Boolean(sbVideoGenerationDisabledReason(sb))" @click="onGenerateSbVideo(sb)">重新生成</el-button>
                </ActionGate>
                <el-tooltip v-if="getNextStoryboard(sb.id)" content="提取本视频尾帧，设为下一个分镜的首帧" placement="top">
                  <el-button size="small" :loading="linkingTailFrameIds.has(sb.id)" @click="onLinkTailFrameToNext(sb)">尾帧衔接</el-button>
                </el-tooltip>
                <ActionGate v-if="sb.dialogue" :reason="ttsGenerationDisabledReason(sb.id, 'dialogue')" label="对白配音">
                  <el-button
                    size="small"
                    :loading="ttsSbIds.has(sb.id)"
                    :disabled="Boolean(ttsGenerationDisabledReason(sb.id, 'dialogue'))"
                    @click="onTtsSbDialogue(sb)"
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
              <div class="sb-video-prompt-label">
                <span class="sb-dot"></span>
                <span>视频提示词</span>
              </div>
              <div class="sb-video-params-bar">
                <span class="sb-video-prompt-text sb-video-prompt-text--preview">{{ sb.video_prompt || '暂无视频提示词（在「视频配置」保存后自动生成）' }}</span>
                <el-button size="small" link type="primary" @click="onOpenSbPromptDialog(sb)">手工编辑</el-button>
              </div>
            </div>
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
        <div v-else-if="storyboards.length === 0" class="empty-tip">{{ hasAnyEpisode ? '还没有分镜，可生成分镜或添加一个分镜' : '请先创建或选择剧集，再生成或添加分镜' }}</div>
      </section>
  </div>
</template>

<script setup>
import { ArrowDown, Delete, InfoFilled, Loading, MagicStick, Plus, QuestionFilled, Refresh, VideoPlay, WarningFilled, ZoomIn } from '@element-plus/icons-vue'
import { ref } from 'vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import UniversalSegmentOmniAtEditor from '@/components/UniversalSegmentOmniAtEditor.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  storyboards: { type: Array, default: () => [] },
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
ttsGenerationDisabledReason
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

<style scoped>
.section { margin-bottom: 24px; }
.card { background: #1e1f28; border-radius: 14px; padding: 22px; border: 1px solid rgba(255, 255, 255, 0.06); }
html.light .card { background: rgba(255, 255, 255, 0.75); border-color: rgba(139, 92, 246, 0.08); }
.section-title { font-size: 1.05rem; margin: 0 0 4px; color: #f4f4f5; font-weight: 600; }
html.light .section-title { color: #1e1b4b; }
.step-desc { margin-left: 8px; font-size: 0.82rem; font-weight: 400; color: #71717a; }
.empty-tip { color: #5a5a66; font-size: 0.9rem; padding: 16px 0; }
html.light .empty-tip { color: #9ca3af; }
.flex { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
[id^="anchor-"], [id^="sb-"] { scroll-margin-top: 84px; }
@media (min-width: 769px) {
  .film-create {
    --film-create-sticky-offset: 84px;
  }

  .main :is([id^="anchor-"], [id^="sb-"]) {
    scroll-margin-top: var(--film-create-sticky-offset);
  }
}

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

.batch-stopping {
  color: var(--el-color-warning);
  font-size: 12px;
}

.sb-image-error {
  width: 100%;
  flex: 1;
  background: #450a0a;
  color: #f87171;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
  font-size: 0.85rem;
  overflow: hidden;
  margin-bottom: 8px;
}

.sb-img-thumb:hover .extra-thumb-remove,
.sb-img-thumb:hover .thumb-preview-btn { opacity: 1; }

@keyframes sb-fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.segment-header {
  margin: 24px 0 14px;
  position: relative;
}

.segment-header:first-child { margin-top: 0; }

.segment-header-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  background: linear-gradient(90deg, rgba(139,92,246,0.12) 0%, transparent 80%);
  border-left: 3px solid rgba(139,92,246,0.6);
  border-radius: 0 10px 10px 0;
}

.segment-index-badge {
  font-size: 11px;
  font-weight: 600;
  color: #a78bfa;
  background: rgba(139,92,246,0.15);
  padding: 2px 8px;
  border-radius: 20px;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.segment-title-text {
  font-size: 14px;
  font-weight: 600;
  color: #d4d4d8;
  flex: 1;
  letter-spacing: -0.01em;
}

.segment-shot-range {
  font-size: 11px;
  color: #52525b;
  white-space: nowrap;
}

html.light .segment-header-inner {
  background: linear-gradient(90deg, rgba(139,92,246,0.07) 0%, transparent 80%);
  border-left-color: rgba(124,58,237,0.5);
}

html.light .segment-title-text { color: #1e1b4b; }

html.light .segment-index-badge { color: #7c3aed; background: rgba(124,58,237,0.08); }

html.light .segment-shot-range { color: #9ca3af; }

.nav-segment-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px 2px;
  font-size: 10px;
  font-weight: 700;
  color: #a78bfa;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.nav-segment-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8b5cf6;
  flex-shrink: 0;
}

.storyboard-row {
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin-bottom: 16px;
  background: #1e1f28;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
  position: relative;
  transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
  animation: sb-fade-in 0.35s ease both;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.storyboard-row:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
}

html.light .storyboard-row {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(139, 92, 246, 0.06);
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 2px 12px rgba(99, 102, 241, 0.04);
}

html.light .storyboard-row:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 24px rgba(99, 102, 241, 0.08);
  transform: translateY(-1px);
}

.storyboard-row:last-child { margin-bottom: 0; }

.sb-ctrl-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 32px;
  margin-bottom: 4px;
  height: 26px;
}

.sb-ctrl-num {
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 5px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.sb-ctrl-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

html.light .sb-ctrl-title {
  color: #000;
}

.sb-movement-tag.el-tag {
  height: 18px;
  line-height: 18px;
  padding: 0 6px;
  font-size: 11px;
  margin-left: 6px;
  flex-shrink: 0;
}

.sb-ctrl-btn.el-button {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}

.sb-ctrl-config-btn.el-button {
  border-color: rgba(139,92,246,0.45);
  color: #a78bfa;
  background: rgba(139,92,246,0.08);
}

.sb-ctrl-config-btn.el-button:hover {
  border-color: #8b5cf6;
  color: #fff;
  background: rgba(139,92,246,0.6);
}

html.light .sb-ctrl-config-btn.el-button {
  border-color: rgba(124,58,237,0.35);
  color: #7c3aed;
  background: rgba(124,58,237,0.06);
}

html.light .sb-ctrl-config-btn.el-button:hover {
  border-color: #7c3aed;
  color: #fff;
  background: #7c3aed;
}

.sb-ctrl-delete {
  margin-left: auto;
  opacity: 0.4;
  transition: opacity 0.2s;
  height: 22px;
  padding: 0 4px;
}

.sb-ctrl-bar:hover .sb-ctrl-delete {
  opacity: 1;
}

.sb-panel {
  flex: 1;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid rgba(255,255,255,0.05);
  display: flex;
  flex-direction: column;
}

html.light .sb-panel {
  border-right-color: rgba(139,92,246,0.08);
}

.sb-panel:last-child { border-right: none; }

.sb-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 10px;
}

.sb-panel-title .el-icon { font-size: 1rem; color: #a1a1aa; }

.sb-panel-title-name {
  margin-left: 4px;
  color: #a1a1aa;
  font-weight: 500;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-script { padding-top: 10px; }

.sb-script-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.sb-select { flex: 1; min-width: 0; }

.sb-select-empty { font-size: 0.8rem; color: #71717a; padding: 8px; }

.sb-selected-thumbs {
  margin: 10px 0;
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sb-thumb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sb-thumb-row:last-child { margin-bottom: 0; }

.sb-thumb-label {
  font-size: 0.8rem;
  color: #71717a;
  flex-shrink: 0;
  width: 36px;
}

.sb-thumb-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.sb-thumb-item {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #22232d;
  color: inherit;
  font: inherit;
}

.sb-thumb-item.sb-thumb-clickable {
  cursor: pointer;
}

.sb-thumb-item:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }

.sb-thumb-item:disabled { cursor: default; }

.sb-thumb-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

.sb-thumb-add-char {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1.5px dashed #52525b;
  background: transparent;
  color: #a1a1aa;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.sb-thumb-add-char:hover {
  color: #e4e4e7;
  border-color: #71717a;
  background: rgba(63, 63, 70, 0.5);
}

html.light .sb-thumb-add-char {
  border-color: #d4d4d8;
  color: #71717a;
}

html.light .sb-thumb-add-char:hover {
  color: #18181b;
  border-color: #a1a1aa;
  background: #f4f4f5;
}

.sb-thumb-prop,
.sb-thumb-scene {
  width: 36px;
  height: 36px;
}

.sb-script-row.sb-script-selects {
  gap: 6px;
}

.sb-script-row.sb-script-selects .sb-select {
  min-width: 0;
}

.sb-script-row.sb-script-selects .el-select { flex: 1; min-width: 0; }

.sb-thumb-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sb-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #7a7a88;
  background: #2a2b36;
}

.sb-script-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #71717a;
  margin-bottom: 6px;
}

.sb-script-label .el-icon { font-size: 0.9rem; }

.sb-upload-icon { margin-left: auto; cursor: pointer; color: #a1a1aa; }

.sb-meta {
  font-size: 0.75rem;
  color: #71717a;
  display: flex;
  gap: 12px;
}

.sb-image-area {
  flex: 1;
  min-height: 200px;
  max-height: 320px;
  background: linear-gradient(145deg, #1a1b24 0%, #1e1f28 60%, #1c1d26 100%);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  position: relative;
  transition: border-color 0.2s, background 0.2s;
}

.sb-image-area:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

html.light .sb-image-area {
  background: linear-gradient(145deg, #f5f3ff 0%, #ede9fe 100%);
  border-color: rgba(124,58,237,0.2);
}

html.light .sb-image-area:hover {
  border-color: rgba(124,58,237,0.45);
}

.sb-image-area--dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  background: rgba(64, 158, 255, 0.1);
}

.sb-image-area-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.9rem;
  border-radius: 8px;
  pointer-events: none;
}

.sb-generated-img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
}

.sb-generated-preview {
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-in;
}

.sb-generated-preview:focus-visible { outline: 2px solid #818cf8; outline-offset: -2px; }

.sb-image-file-input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }

.sb-gen-btn { margin-top: 4px; }

.sb-image-area img.sb-generated-img { cursor: pointer; }

.sb-panel.sb-image.sb-image--universal {
  min-height: 300px;
  justify-content: flex-start;
}

.sb-universal-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.sb-universal-label-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.sb-universal-hint-icon {
  cursor: help;
  color: #9ca3af;
  font-size: 16px;
  flex-shrink: 0;
}

.sb-universal-hint-icon:hover {
  color: #a78bfa;
}

.sb-universal-gen-btn {
  flex-shrink: 0;
}

.sb-universal-prompt-dd {
  flex-shrink: 0;
}

.sb-universal-dd-caret {
  margin-left: 2px;
  font-size: 12px;
  vertical-align: middle;
}

:global(.sb-universal-tooltip-popper.el-popper) {
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.sb-universal-tooltip {
  max-width: 360px;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: 8px;
  color: #f1f5f9;
  background: #0f172a;
  border: 1px solid rgba(248, 250, 252, 0.22);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.sb-universal-tooltip strong {
  font-weight: 600;
  color: #ffffff;
}

html.light .sb-universal-tooltip {
  color: #0f172a;
  background: #ffffff;
  border-color: #cbd5e1;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}

html.light .sb-universal-tooltip strong {
  color: #020617;
}

.sb-universal-textarea {
  flex: 1;
  min-height: 0;
}

.sb-universal-textarea :deep(.el-textarea__inner) {
  min-height: 220px !important;
  font-size: 13px;
  line-height: 1.55;
}

.sb-ctrl-mode-btn.el-button {
  border-color: rgba(34, 197, 94, 0.35);
  color: #86efac;
  background: rgba(34, 197, 94, 0.08);
}

.sb-ctrl-mode-btn.el-button:hover {
  border-color: #22c55e;
  color: #fff;
  background: rgba(34, 197, 94, 0.45);
}

html.light .sb-ctrl-mode-btn.el-button {
  border-color: rgba(22, 163, 74, 0.35);
  color: #15803d;
  background: rgba(22, 163, 74, 0.06);
}

html.light .sb-ctrl-mode-btn.el-button:hover {
  border-color: #16a34a;
  color: #fff;
  background: #16a34a;
}

.sb-image-area--first-last {
  min-height: 220px;
  max-height: none;
  padding: 8px;
  align-items: stretch;
  justify-content: flex-start;
}

.sb-fl-dual {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  flex: 1;
  min-height: 180px;
}

.sb-fl-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sb-fl-slot-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  text-align: center;
}

.sb-fl-slot-body {
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
}

.sb-fl-slot-body .sb-generated-img {
  max-height: 160px;
}

.sb-fl-empty {
  font-size: 0.75rem;
  color: #71717a;
}

.sb-fl-arrow {
  flex-shrink: 0;
  align-self: center;
  font-size: 1.25rem;
  color: #a78bfa;
  opacity: 0.85;
}

.sb-fl-slot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  align-items: center;
}

.sb-fl-first-lock-opt {
  margin: 0 2px;
  height: auto;
}

.sb-fl-first-lock-opt :deep(.el-checkbox__label) {
  font-size: 12px;
  padding-left: 4px;
}

.sb-fl-slot-prompt {
  font-size: 0.68rem;
  line-height: 1.35;
  color: #9ca3af;
  max-height: 2.7em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  padding: 0 4px;
  word-break: break-all;
}

.sb-image-area--has-quad {
  flex-direction: column;
  align-items: stretch;
  overflow-y: auto;
  max-height: 340px;
}

.sb-imgs-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 8px 4px;
  overflow-x: auto;
  border-top: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.sb-strip-hint-icon {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  cursor: default;
  transition: color 0.15s;
}

.sb-strip-hint-icon:hover {
  color: var(--el-color-primary);
}

.sb-img-thumb {
  position: relative;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s;
  flex-shrink: 0;
  width: 52px;
  height: 52px;
}

.sb-img-thumb:hover { border-color: var(--el-color-primary); }

.sb-img-thumb:focus-within { border-color: var(--el-color-primary); }

.sb-img-thumb-primary {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.sb-img-thumb-primary:focus-visible { outline: 2px solid #818cf8; outline-offset: -2px; }

.sb-img-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sb-img-thumb-label {
  position: absolute;
  bottom: 1px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  color: #fff;
  background: rgba(0,0,0,0.45);
  pointer-events: none;
}

.sb-main-image-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
}

.sb-draft-placeholder {
  width: 100%;
  min-height: 88px;
  margin-bottom: 8px;
  padding: 12px;
  display: grid;
  place-content: center;
  gap: 4px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-regular);
  text-align: center;
}

.sb-draft-placeholder strong {
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
}

.sb-draft-placeholder span {
  max-width: 320px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.sb-main-img-prompt {
  width: 100%;
  font-size: 10px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 4px 6px;
  line-height: 1.4;
  max-height: 48px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-all;
  cursor: default;
}

.sb-quad-preview { max-height: 160px; }

.sb-image-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-shrink: 0;
  padding-top: 6px;
}

.sb-video-area {
  flex: 1;
  min-height: 200px;
  background: linear-gradient(145deg, #1a1b24 0%, #1e1f28 60%, #1c1d26 100%);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s;
}

html.light .sb-video-area {
  background: linear-gradient(145deg, #f5f3ff 0%, #ede9fe 100%);
  border-color: rgba(124,58,237,0.2);
}

.sb-video-placeholder {
  color: #71717a;
  font-size: 0.9rem;
  flex-direction: column;
  gap: 10px;
  text-align: center;
  padding: 16px;
}

html.light .sb-video-placeholder {
  color: #7c3aed;
}

.sb-video-generating-text {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #409eff;
  font-size: 0.85rem;
}

.sb-video-error {
  color: #f56c6c;
  font-size: 0.75rem;
  line-height: 1.4;
  word-break: break-word;
  max-height: 80px;
  overflow-y: auto;
  padding: 4px 8px;
  background: rgba(245, 108, 108, 0.08);
  border-radius: 4px;
  text-align: left;
  width: 100%;
}

.sb-video-player {
  width: 100%;
  max-height: 240px;
  border-radius: 8px;
}

.sb-video-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-shrink: 0;
  padding-top: 6px;
}

.sb-video-disabled-reason {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0;
  color: var(--el-color-warning);
  font-size: 0.8rem;
  line-height: 1.4;
}

.sb-video-disabled-reason:focus-visible {
  outline: 2px solid var(--el-color-warning);
  outline-offset: 2px;
}

.sb-video-regenerating-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 0.82rem;
  color: #a78bfa;
}

.sb-videos-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.sb-video-thumb {
  position: relative;
  width: 72px;
  height: 48px;
  border-radius: 5px;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  background: transparent;
  border: 1.5px solid transparent;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.sb-video-thumb:hover {
  border-color: #a855f7;
}

.sb-video-thumb:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}

.sb-video-thumb-player {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.sb-video-thumb-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.55);
  color: #e4e4e7;
  font-size: 0.65rem;
  text-align: center;
  padding: 1px 0;
  pointer-events: none;
}

.sb-video-prompt-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sb-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a855f7;
  flex-shrink: 0;
}

.sb-video-prompt-label > span:not(.sb-dot) { font-size: 0.85rem; color: #e4e4e7; }

.sb-video-params-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0;
}

.sb-video-params-bar .sb-video-prompt-text {
  flex: 1;
  min-width: 0;
}

.sb-video-prompt-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}

.sb-video-prompt-row .sb-video-prompt-text {
  flex: 1;
  min-width: 0;
}

.sb-video-prompt-text {
  font-size: 0.85rem;
  color: #a1a1aa;
  line-height: 1.5;
  padding: 8px 0;
}

.sb-video-prompt-text--preview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.sb-video-prompt-edit {
  margin-bottom: 8px;
}

.sb-video-prompt-edit .el-textarea { margin-bottom: 8px; }

.sb-video-prompt-edit-actions { display: flex; gap: 8px; }

.sb-generate-video-btn { margin-top: 8px; }

.sb-prompt-label { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; }

.sb-prompt-label .sb-dot { flex-shrink: 0; }

.sb-prompt-label > span:not(.sb-dot) { font-size: 0.85rem; color: #e4e4e7; }

.sb-prompt-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }

.sb-prompt-row .sb-prompt-text { flex: 1; min-width: 0; font-size: 0.85rem; color: #a1a1aa; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.sb-image-prompt-edit .el-textarea { margin-bottom: 6px; }

.sb-prompt-edit-actions { display: flex; gap: 8px; }

.sb-video-fields-collapse { margin: 8px 0; }

.sb-video-fields-collapse .el-collapse-item__header { font-size: 0.9rem; }

.sb-prompt-section-title { font-size: 0.9rem; font-weight: 600; color: #e4e4e7; margin-bottom: 8px; }

.sb-prompt-section-title--row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }

.sb-split-audio-tip { font-size: 12px; color: #64748b; line-height: 1.45; margin: 0 0 8px; }

.sb-split-audio-row { display: flex; flex-direction: column; align-items: flex-start; }

.sb-prompt-dialog-form .el-form-item { margin-bottom: 10px; }

.sb-collapse-title { color: #a1a1aa; }

.sb-video-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; padding: 8px 0; }

.sb-field { display: flex; flex-direction: column; gap: 4px; }

.sb-field-full { grid-column: 1 / -1; }

.sb-field-label { font-size: 0.8rem; color: #a1a1aa; }

.sb-field-select { width: 100%; }

.sb-video-fields-actions { grid-column: 1 / -1; margin-top: 8px; }

.sb-truncated-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: rgba(234, 179, 8, 0.12);
  border: 1px solid rgba(234, 179, 8, 0.4);
  border-radius: 8px;
  color: #fbbf24;
  font-size: 0.875rem;
  line-height: 1.5;
}

.sb-truncated-warning .el-icon {
  flex-shrink: 0;
  font-size: 1rem;
  color: #fbbf24;
}

.sb-truncated-warning span {
  flex: 1;
}

.sb-generating-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 18px;
  margin-top: 10px;
  background: rgba(139, 92, 246, 0.08);
  border: 1px dashed rgba(139, 92, 246, 0.35);
  border-radius: 10px;
  color: #a78bfa;
  font-size: 0.9rem;
}

.sb-gen-text {
  flex: 1;
  letter-spacing: 0.03em;
}

.sb-gen-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  animation: sb-dot-bounce 1.2s infinite ease-in-out both;
}

.sb-gen-dot:nth-child(1) { animation-delay: 0s; }

.sb-gen-dot:nth-child(2) { animation-delay: 0.2s; }

.sb-gen-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes sb-dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40%            { transform: scale(1);   opacity: 1;   }
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

.sb-narration-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.sb-narration-input :deep(.el-textarea__inner) {
  color: #e4e4e7 !important;
  background-color: rgba(24, 24, 27, 0.85) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: none;
}

.sb-narration-input :deep(.el-textarea__inner::placeholder) {
  color: #71717a !important;
}

html.light .sb-narration-input :deep(.el-textarea__inner) {
  color: #1e1b4b !important;
  background-color: #ffffff !important;
  border-color: rgba(139, 92, 246, 0.22) !important;
}

html.light .sb-narration-input :deep(.el-textarea__inner::placeholder) {
  color: #9ca3af !important;
}

.sb-frame-prompt-clean .el-message-box__content {
  padding: 16px 20px 8px;
}

.sb-prompt-clean-body {
  max-width: 680px;
  min-width: 480px;
}

.sb-prompt-pre {
  margin: 0 0 12px 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
  color: #e2e8f0;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  padding: 14px 16px;
  max-height: 420px;
  overflow-y: auto;
}

html.light .sb-prompt-pre {
  color: #1e2937;
  background: #f8fafc;
  border-color: #cbd5e1;
}

.sb-prompt-meta-line {
  font-size: 11px;
  color: #64748b;
  padding: 0 4px 8px;
  line-height: 1.4;
}

html.light .sb-prompt-meta-line {
  color: #64748b;
}
</style>
