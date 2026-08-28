<template>
  <div class="film-create" :class="{ 'sidebar-collapsed': navCollapsed, 'project-state-active': projectLoadState !== 'ready' }">
    <!-- 顶部 -->
    <header class="header">
      <div class="header-inner">
        <button type="button" class="logo" aria-label="返回项目列表" @click="goList">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">LocalMiniDrama</span>
        </button>
        <span class="breadcrumb-sep">›</span>
        <div class="header-context">
          <span class="header-context-label">项目</span>
          <h1 class="page-title" :title="projectPageTitle">{{ projectPageTitle }}</h1>
        </div>
        <div class="workspace-actions">
        <div v-if="projectLoadState === 'ready' && dramaId" class="header-context">
          <span class="header-context-label">当前集</span>
          <el-select
            v-if="hasAnyEpisode"
            class="header-episode-select"
            :model-value="selectedEpisodeId"
            aria-label="当前集"
            :aria-busy="episodeSwitching"
            :title="selectedEpisodeContextLabel"
            :loading="episodeSwitching"
            :disabled="episodeSwitching"
            placeholder="选择集数"
            @change="onEpisodeSelect"
          >
            <el-option
              v-for="(ep, index) in (store.drama?.episodes || [])"
              :key="ep.id"
              :label="formatEpisodeContextLabel(ep, index)"
              :value="ep.id"
            />
          </el-select>
          <el-button
            v-else
            type="primary"
            plain
            class="header-add-episode"
            aria-label="添加一集"
            @click="onAddEpisode"
          >
            <el-icon><Plus /></el-icon>添加一集
          </el-button>
        </div>
        <el-button v-if="projectLoadState === 'ready' && dramaId" class="btn-back-drama" @click="router.push('/drama/' + dramaId)">
          <el-icon><ArrowLeft /></el-icon>
          返回剧集
        </el-button>
        <el-button v-if="projectLoadState === 'ready' && dramaId" type="primary" plain class="btn-canvas-mode" @click="goCanvasMode">
          <el-icon><Grid /></el-icon>
          画布模式
        </el-button>
        <div class="header-actions">
          <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
            {{ isDark ? '浅色' : '暗色' }}
          </el-button><el-button class="btn-ai-config" :disabled="projectLoadState !== 'ready'" @click="openAiConfig()">
            <el-icon><Setting /></el-icon>
            AI配置
          </el-button>
        </div>
        </div>
      </div>
    </header>

    <!-- 左侧固定侧边栏 -->
    <nav v-if="projectLoadState === 'ready'" id="film-create-quick-nav" class="quick-nav" :class="{ collapsed: navCollapsed }" aria-label="快捷导航">
      <div class="nav-sidebar-header">
        <span v-if="!navCollapsed" class="nav-sidebar-title">导航</span>
        <button
          type="button"
          class="nav-toggle"
          :title="navCollapsed ? '展开导航' : '收起导航'"
          :aria-label="navCollapsed ? '展开导航' : '收起导航'"
          :aria-expanded="!navCollapsed"
          aria-controls="film-create-quick-nav"
          @click="toggleNav()"
        >
          <el-icon><Expand v-if="navCollapsed" /><Fold v-else /></el-icon>
        </button>
      </div>

      <!-- 步骤列表 -->
      <div class="nav-steps">
        <button
          v-for="(step, idx) in navSteps"
          :key="step.key"
          type="button"
          class="nav-step"
          :class="['status-' + step.status, { 'is-current': activeNavAnchor === step.anchor }]"
          :aria-current="activeNavAnchor === step.anchor ? 'step' : undefined"
          :title="`跳转到${step.label}`"
          @click="scrollToAnchor(step.anchor, step.anchor)"
        >
          <!-- 左侧连接线 -->
          <span class="step-connector-wrap">
            <span v-if="idx > 0" class="step-line step-line-top" :class="{ filled: navSteps[idx - 1].status === 'done' }" />
            <span
              class="step-dot"
              :class="['dot-' + step.status]"
            >
              <el-icon v-if="step.status === 'done'" class="dot-icon"><Check /></el-icon>
              <el-icon v-else-if="step.status === 'generating'" class="dot-icon spin"><Loading /></el-icon>
              <span v-else class="dot-num">{{ idx + 1 }}</span>
            </span>
            <span v-if="idx < navSteps.length - 1" class="step-line step-line-bottom" :class="{ filled: step.status === 'done' }" />
          </span>

          <!-- 右侧文字 + 状态徽章 -->
          <span class="step-body">
            <span class="step-label">{{ step.label }}</span>
            <span v-if="step.count > 0 && step.status !== 'done'" class="step-count">{{ step.count }}</span>
            <span v-if="step.status === 'partial'" class="step-badge partial-badge" title="部分完成">
              <el-icon><WarningFilled /></el-icon>
            </span>
            <span v-else-if="step.status === 'generating'" class="step-badge gen-badge" title="生成中">
              <el-icon class="spin"><Loading /></el-icon>
            </span>
          </span>
        </button>
      </div>

      <!-- 分镜子列表 -->
      <div v-if="!navCollapsed && storyboards.length > 0" class="nav-group">
        <button
          type="button"
          class="nav-sub-toggle"
          :aria-label="storyboardMenuExpanded ? '收起分镜列表' : '展开分镜列表'"
          :aria-expanded="storyboardMenuExpanded"
          aria-controls="storyboard-nav-list"
          @click="storyboardMenuExpanded = !storyboardMenuExpanded"
        >
          <el-icon><Minus v-if="storyboardMenuExpanded" /><Plus v-else /></el-icon>
          <span>分镜列表</span>
        </button>
        <div id="storyboard-nav-list" v-show="storyboardMenuExpanded" class="nav-sub-list">
          <template v-for="(sb, i) in storyboards" :key="sb.id">
            <!-- 段落标题行 -->
            <div
              v-if="sb.segment_title && (i === 0 || sb.segment_index !== storyboards[i - 1].segment_index)"
              class="nav-segment-label"
            >
              <span class="nav-segment-dot" />
              {{ sb.segment_title }}
            </div>
            <button
              type="button"
              class="nav-sub-item"
              :title="sb.title || '分镜 ' + (i + 1)"
              @click="scrollToAnchor('sb-' + sb.id, 'anchor-storyboard-images')"
            >
              {{ i + 1 }}. {{ sb.title || '分镜' }}
            </button>
          </template>
        </div>
      </div>

      <!-- 当前任务面板 -->
      <div v-if="allActiveTaskItems.length > 0" class="atp-panel">
        <!-- 折叠态：只显示旋转点和数量 -->
        <div v-if="navCollapsed" class="atp-collapsed-badge" :title="allActiveTaskLabels.join('\n')">
          <span class="atp-spin-dot" />
          <span class="atp-collapsed-count">{{ allActiveTaskItems.length }}</span>
        </div>
        <!-- 展开态：标题 + 任务列表 -->
        <template v-else>
          <div class="atp-header">
            <span class="atp-spin-dot" />
            <span class="atp-title">进行中</span>
            <span class="atp-count-badge">{{ allActiveTaskItems.length }}</span>
          </div>
          <div class="atp-list">
            <div
              v-for="item in allActiveTaskItems.slice(0, 8)"
              :key="item.id"
              class="atp-item"
            >
              <span class="atp-item-dot" />
              <el-tooltip :content="item.label" placement="right" :show-after="300" :enterable="false">
                <span class="atp-item-label">{{ item.label }}</span>
              </el-tooltip>
              <button
                type="button"
                class="atp-item-close"
                title="取消任务"
                :aria-label="`取消任务${item.label || ''}`"
                :disabled="item.kind === 'pipeline' && pipelineStopping"
                @click.stop="cancelActiveTask(item)"
              >
                <el-icon v-if="item.kind === 'pipeline' && pipelineStopping" :size="12" class="is-loading"><Loading /></el-icon>
                <el-icon v-else :size="12"><Close /></el-icon>
              </button>
            </div>
            <el-tooltip
              v-if="allActiveTaskItems.length > 8"
              :content="allActiveTaskItems.slice(8).map((t) => t.label).join('\n')"
              placement="right"
              :show-after="200"
            >
              <div class="atp-more">
                还有 {{ allActiveTaskItems.length - 8 }} 个任务...
              </div>
            </el-tooltip>
          </div>
        </template>
      </div>
    </nav>

    <main v-if="projectLoadState === 'loading'" class="main project-state-main" aria-busy="true">
      <section class="project-load-state" role="status" aria-live="polite">
        <el-icon class="project-load-state-icon is-loading"><Loading /></el-icon>
        <h1>正在加载制作项目</h1>
        <p>正在读取剧本、制作资源和分镜媒体。</p>
      </section>
    </main>

    <main v-else-if="projectLoadState === 'error'" class="main project-state-main">
      <section
        ref="projectLoadFailureRef"
        class="project-load-state project-load-state--error"
        role="alert"
        aria-labelledby="film-project-load-error-title"
        tabindex="-1"
      >
        <el-icon class="project-load-state-icon"><WarningFilled /></el-icon>
        <h1 id="film-project-load-error-title">{{ projectLoadNotFound ? '制作项目不存在' : '暂时无法打开制作项目' }}</h1>
        <p>{{ projectLoadError }}</p>
        <p v-if="projectLoadNotFound" class="project-load-state-assurance">项目可能已移入回收站或被删除，请返回项目列表确认。</p>
        <p v-else class="project-load-state-assurance">项目数据没有被删除，当前页面已停止所有项目编辑和生成操作。</p>
        <div class="project-load-state-actions">
          <el-button v-if="!projectLoadNotFound" type="primary" :loading="projectLoadPending" @click="retryFilmProjectLoad">
            <el-icon><Refresh /></el-icon>重试加载
          </el-button>
          <el-button @click="goList">
            <el-icon><ArrowLeft /></el-icon>返回项目列表
          </el-button>
        </div>
      </section>
    </main>

    <main v-else class="main">
      <section
        v-if="projectDependencyWarning || storyboardMediaLoadError"
        class="project-dependency-warning"
        :role="storyboardMediaLoadError ? 'alert' : 'status'"
        aria-live="polite"
      >
        <el-icon><WarningFilled /></el-icon>
        <span>{{ [storyboardMediaLoadError, projectDependencyWarning].filter(Boolean).join('；') }}</span>
        <el-button size="small" :loading="projectDependencyLoading" @click="retryProjectDependencies">
          <el-icon><Refresh /></el-icon>重试加载素材
        </el-button>
      </section>

      <FilmCreatePipelinePanel
        ref="pipelinePanelRef"
        v-model:aspect-ratio="projectAspectRatio"
        v-model:clip-duration="videoClipDuration"
        v-model:script-language="scriptLanguage"
        v-model:generation-style="generationStyle"
        :generation-style-options="generationStyleOptions"
        :production-disabled-reason="productionPipelineActionDisabledReason"
        :draft-disabled-reason="pipelineActionDisabledReason"
        :production-readiness-reason="productionReadinessReason"
        :production-readiness-state="productionReadinessState"
        :production-readiness-service-type="productionReadinessServiceType"
        :starting="pipelineStarting"
        :stopping="pipelineStopping"
        :stop-required="pipelineAbortRequested && pipelineRunning && !pipelineStopping"
        :running="pipelineRunning"
        :paused="pipelinePaused"
        :error-log="pipelineErrorLog"
        :current-step="pipelineCurrentStep"
        :step-index="pipelineStepIndex"
        :step-total="pipelineStepTotal"
        :countdown="pipelineCountdown"
        :countdown-message="pipelineCountdownMsg"
        :active-tasks="pipelineActiveTasks"
        :has-episode="hasAnyEpisode"
        @save-settings="saveProjectSettings"
        @start-one-click="startOneClickPipeline"
        @start-text-framework="startTextFrameworkPipeline"
        @open-ai-config="openAiConfigFromPipeline"
        @retry-readiness="refreshProductionReadiness"
        @pause="pipelinePaused = true"
        @resume="onPipelineResume"
        @cancel="cancelPipelineRun"
        @skip-countdown="skipPipelineCountdown"
        @add-episode="onAddEpisode"
      />

      <!-- 剧本工作台：单卡片 + 选项卡（创作 / 选择） -->
      <FilmCreateScriptWorkbench
        class="section card script-workbench-unified"
        v-model:script-workbench-mode="scriptWorkbenchMode"
        v-model:story-input="storyInput"
        v-model:story-style="storyStyle"
        v-model:story-type="storyType"
        v-model:story-episode-count="storyEpisodeCount"
        v-model:script-title="scriptTitle"
        v-model:script-content="scriptContent"
        v-model:show-select-script-dialog="showSelectScriptDialog"
        v-model:select-preview-episode-id="selectPreviewEpisodeId"
        :is-story-gen-running="isStoryGenRunning"
        :drama-id="dramaId"
        :has-any-episode="hasAnyEpisode"
        :script-generating="scriptGenerating"
        :current-episode-id="currentEpisodeId"
        :episodes="store.drama?.episodes || []"
        :script-draft-status="scriptDraftStatus"
        :script-draft-status-label="scriptDraftStatusLabel"
        :select-script-loading="selectScriptLoading"
        :select-script-importing="selectScriptImporting"
        :selectable-script-dramas="selectableScriptDramas"
        :select-script-dramas="selectScriptDramas"
        @save-settings="saveProjectSettings(false)"
        @generate-story="onGenerateStory"
        @open-novel-import="showNovelImport = true"
        @add-episode="onAddEpisode"
        @go-to-drama="router.push('/drama/' + dramaId)"
        @generate-script="onGenerateScript"
        @open-select-script="openSelectScriptDialog"
        @load-select-script-list="loadSelectScriptList"
        @pick-script="onPickScriptFromDialog"
        @return-to-creation="returnToScriptCreation"
      />

      <!-- 资源管理：角色 / 道具 / 场景 -->
      <FilmCreateResourcePanel
        class="section card resource-panel"
        v-model:resource-panel-collapsed="resourcePanelCollapsed"
        v-model:characters-block-collapsed="charactersBlockCollapsed"
        v-model:props-block-collapsed="propsBlockCollapsed"
        v-model:scenes-block-collapsed="scenesBlockCollapsed"
        v-model:prop-use-quad-grid="propUseQuadGrid"
        v-model:scene-use-quad-grid="sceneUseQuadGrid"
        :characters="characters"
        :prop-items="props"
        :scenes="scenes"
        :character-generation-disabled-reason="characterGenerationDisabledReason"
        :project-action-disabled-reason="projectActionDisabledReason"
        :props-extraction-disabled-reason="propsExtractionDisabledReason"
        :scenes-extraction-disabled-reason="scenesExtractionDisabledReason"
        :storyboard-media-action-reason="storyboardMediaActionReason"
        :characters-generating="charactersGenerating"
        :props-extracting="propsExtracting"
        :scenes-extracting="scenesExtracting"
        :generating-char-ids="generatingCharIds"
        :generating-prop-ids="generatingPropIds"
        :generating-scene-ids="generatingSceneIds"
        :uploading-resource-id="uploadingResourceId"
        :adding-char-to-library-id="addingCharToLibraryId"
        :adding-char-to-material-id="addingCharToMaterialId"
        :adding-prop-to-library-id="addingPropToLibraryId"
        :adding-prop-to-material-id="addingPropToMaterialId"
        :adding-scene-to-library-id="addingSceneToLibraryId"
        :adding-scene-to-material-id="addingSceneToMaterialId"
        :regen-sb-images-for-asset="regenSbImagesForAsset"
        :regen-sb-images-progress="regenSbImagesProgress"
        :sd2-certifying-id="sd2CertifyingId"
        :sd2-voice-uploading-id="sd2VoiceUploadingId"
        :has-asset-image="hasAssetImage"
        :asset-image-url="assetImageUrl"
        :char-role-label="charRoleLabel"
        :local-path-to-url="localPathToUrl"
        :parse-extra-images="parseExtraImages"
        :get-char-affected-storyboards="getCharAffectedStoryboards"
        :get-prop-affected-storyboards="getPropAffectedStoryboards"
        :get-scene-affected-storyboards="getSceneAffectedStoryboards"
        :sd2-action-label="sd2ActionLabel"
        :sd2-voice-action-label="sd2VoiceActionLabel"
        @generate-characters="onGenerateCharacters"
        @add-character="openAddCharacter"
        @open-char-library="showCharLibrary = true"
        @extract-props="onExtractProps"
        @add-prop="showAddProp = true"
        @open-prop-library="showPropLibrary = true"
        @extract-scenes="onExtractScenes"
        @add-scene="openAddScene"
        @open-scene-library="showSceneLibrary = true"
        @generate-character-image="onGenerateCharacterImage"
        @generate-prop-image="onGeneratePropImage"
        @generate-scene-image="onGenerateSceneImage"
        @edit-character="editCharacter"
        @edit-prop="editProp"
        @edit-scene="editScene"
        @delete-character="onDeleteCharacter"
        @delete-prop="onDeleteProp"
        @delete-scene="onDeleteScene"
        @add-character-to-library="onAddCharacterToLibrary"
        @add-character-to-material="onAddCharacterToMaterialLibrary"
        @add-prop-to-library="onAddPropToLibrary"
        @add-prop-to-material="onAddPropToMaterialLibrary"
        @add-scene-to-library="onAddSceneToLibrary"
        @add-scene-to-material="onAddSceneToMaterialLibrary"
        @regen-affected-sb-images="onRegenAffectedSbImages"
        @upload-resource-image="doUploadResourceImage"
        @set-primary-image="onSetPrimaryImage"
        @remove-extra-image="onRemoveExtraImage"
        @preview-image="openImagePreview"
        @scroll-to-storyboard="scrollToStoryboard"
        @sd2-primary-action="onSd2PrimaryAction"
        @sd2-voice-primary-action="onSd2VoicePrimaryAction"
        @sd2-voice-replace="onSd2VoiceReplace"
        @play-sd2-voice="playSd2Voice"
      />
      <!-- 分镜生成 -->
      <FilmCreateStoryboardPanel
        class="section card"
        id="anchor-storyboard"
        v-model:storyboard-count="storyboardCount"
        v-model:video-duration="videoDuration"
        v-model:grid-mode="gridMode"
        v-model:storyboard-use-first-last-frame="storyboardUseFirstLastFrame"
        v-model:storyboard-universal-omni="storyboardUniversalOmni"
        v-model:storyboard-include-narration="storyboardIncludeNarration"
        v-model:last-frame-use-first-layout-lock="lastFrameUseFirstLayoutLock"
        v-model:video-frame-contiguity="videoFrameContiguity"
        v-model:sb-truncated-dismissed="sbTruncatedDismissed"
        v-model:batch-image-stopping="batchImageStopping"
        v-model:batch-video-stopping="batchVideoStopping"
        v-model:drag-over-sb-id="dragOverSbId"
        :storyboards="storyboards"
        :characters="characters"
        :scenes="scenes"
        :sb-scene-id="sbSceneId"
        :sb-narration="sbNarration"
        :sb-universal-segment-text="sbUniversalSegmentText"
        :batch-image-errors="batchImageErrors"
        :batch-video-errors="batchVideoErrors"
        :batch-image-progress="batchImageProgress"
        :batch-video-progress="batchVideoProgress"
        :generating-sb-image-ids="generatingSbImageIds"
        :generating-sb-first-image-ids="generatingSbFirstImageIds"
        :generating-sb-last-image-ids="generatingSbLastImageIds"
        :generating-universal-segment-ids="generatingUniversalSegmentIds"
        :linking-tail-frame-ids="linkingTailFrameIds"
        :using-prev-tail-as-first-ids="usingPrevTailAsFirstIds"
        :tts-sb-ids="ttsSbIds"
        :tts-sb-narration-ids="ttsSbNarrationIds"
        :upscaling-sb-ids="upscalingSbIds"
        :universal-omni-polish-progress="universalOmniPolishProgress"
        :has-any-episode="hasAnyEpisode"
        :current-episode-id="currentEpisodeId"
        :storyboard-generating="storyboardGenerating"
        :universal-omni-polish-running="universalOmniPolishRunning"
        :exporting-storyboard-sheet="exportingStoryboardSheet"
        :batch-image-running="batchImageRunning"
        :batch-video-running="batchVideoRunning"
        :sb-truncated-warning="sbTruncatedWarning"
        :uploading-sb-image-id="uploadingSbImageId"
        :uploading-sb-image-slot="uploadingSbImageSlot"
        :storyboard-action-disabled-reason="storyboardActionDisabledReason"
        :episode-action-disabled-reason="episodeActionDisabledReason"
        :batch-action-disabled-reason="batchActionDisabledReason"
        :batch-video-action-disabled-reason="batchVideoActionDisabledReason"
        :video-capability-reason="videoCapabilityReason"
        :script-estimate-storyboard-hint="scriptEstimateStoryboardHint"
        :script-estimate-storyboard-title="scriptEstimateStoryboardTitle"
        :script-estimate-video-duration-hint="scriptEstimateVideoDurationHint"
        :script-estimate-video-duration-title="scriptEstimateVideoDurationTitle"
        :prop-items="props"
        :asset-image-url="assetImageUrl"
        :asset-video-url="assetVideoUrl"
        :can-use-prev-tail-as-first="canUsePrevTailAsFirst"
        :characters-available-to-add-to-sb="charactersAvailableToAddToSb"
        :get-movement-label="getMovementLabel"
        :get-next-storyboard="getNextStoryboard"
        :get-sb-character-ids="getSbCharacterIds"
        :get-sb-first-image="getSbFirstImage"
        :get-sb-image="getSbImage"
        :get-sb-last-image="getSbLastImage"
        :get-sb-local-image="getSbLocalImage"
        :get-sb-prop-ids="getSbPropIds"
        :get-sb-selected-characters="getSbSelectedCharacters"
        :get-sb-selected-props="getSbSelectedProps"
        :get-sb-selected-scene="getSbSelectedScene"
        :get-sb-universal-omni-ref-slots="getSbUniversalOmniRefSlots"
        :get-sb-video="getSbVideo"
        :get-sb-video-error="getSbVideoError"
        :get-strip-items="getStripItems"
        :get-video-strip-items="getVideoStripItems"
        :has-asset-image="hasAssetImage"
        :has-sb-draft-image-placeholder="hasSbDraftImagePlaceholder"
        :has-sb-first-last-pair="hasSbFirstLastPair"
        :has-sb-image="hasSbImage"
        :history-image-label="historyImageLabel"
        :is-sb-universal-mode="isSbUniversalMode"
        :is-sb-video-generating="isSbVideoGenerating"
        :on-add-single-storyboard="onAddSingleStoryboard"
        :on-delete-single-storyboard="onDeleteSingleStoryboard"
        :on-export-narration-srt="onExportNarrationSrt"
        :on-export-storyboard-sheet="onExportStoryboardSheet"
        :on-generate-sb-frame-image="onGenerateSbFrameImage"
        :on-generate-sb-frame-pair="onGenerateSbFramePair"
        :on-generate-sb-image="onGenerateSbImage"
        :on-generate-sb-video="onGenerateSbVideo"
        :on-generate-storyboard="onGenerateStoryboard"
        :on-insert-storyboard-before="onInsertStoryboardBefore"
        :on-last-frame-layout-lock-change="onLastFrameLayoutLockChange"
        :on-link-tail-frame-to-next="onLinkTailFrameToNext"
        :on-open-sb-prompt-dialog="onOpenSbPromptDialog"
        :on-open-video-params-dialog="onOpenVideoParamsDialog"
        :on-remove-sb-history-image="onRemoveSbHistoryImage"
        :on-save-sb-narration-field="onSaveSbNarrationField"
        :on-save-universal-segment-field="onSaveUniversalSegmentField"
        :on-sb-add-character-command="onSbAddCharacterCommand"
        :on-sb-image-drag-leave="onSbImageDragLeave"
        :on-sb-image-drag-over="onSbImageDragOver"
        :on-sb-image-drop="onSbImageDrop"
        :on-select-sb-main-video="onSelectSbMainVideo"
        :on-select-strip-item="onSelectStripItem"
        :on-storyboard-scene-change="onStoryboardSceneChange"
        :on-storyboard-use-first-last-frame-change="onStoryboardUseFirstLastFrameChange"
        :on-strip-item-click="onStripItemClick"
        :on-toggle-sb-universal-mode="onToggleSbUniversalMode"
        :on-tts-sb-dialogue="onTtsSbDialogue"
        :on-tts-sb-narration="onTtsSbNarration"
        :on-universal-segment-prompt-menu="onUniversalSegmentPromptMenu"
        :prepare-sb-image-upload="onUploadSbImageClick"
        :on-upscale-sb-image="onUpscaleSbImage"
        :on-use-prev-tail-as-first="onUsePrevTailAsFirst"
        :open-ai-config="openAiConfig"
        :open-image-preview="openImagePreview"
        :play-sb-dialogue-tts="playSbDialogueTts"
        :play-sb-narration-tts="playSbNarrationTts"
        :sb-can-submit-video="sbCanSubmitVideo"
        :sb-dialogue-audio-rel-path="sbDialogueAudioRelPath"
        :sb-main-video-player-key="sbMainVideoPlayerKey"
        :sb-narration-audio-rel-path="sbNarrationAudioRelPath"
        :sb-universal-segment-trimmed="sbUniversalSegmentTrimmed"
        :sb-video-generation-disabled-reason="sbVideoGenerationDisabledReason"
        :set-sb-character-ids="setSbCharacterIds"
        :set-sb-prop-ids="setSbPropIds"
        :show-sb-frame-prompt-preview="showSbFramePromptPreview"
        :start-batch-image-generation="startBatchImageGeneration"
        :start-batch-video-generation="startBatchVideoGeneration"
        :storyboard-image-url="storyboardImageUrl"
        :strip-item-title="stripItemTitle"
        :tts-generation-disabled-reason="ttsGenerationDisabledReason"
        @save-settings="saveProjectSettings(false)"
        @upload-sb-image="doUploadSbImage"
      />
      <!-- 7. 视频配置 + AI 模型配置 -->
      <FilmCreateVideoSettingsPanel
        v-model:resolution="videoResolution"
        v-model:subtitle="videoSubtitle"
        v-model:burn-dialogue="videoBurnDialogue"
        v-model:watermark="videoWatermark"
        v-model:watermark-text="videoWatermarkText"
        @open-ai-config="openAiConfig"
      />

      <!-- 8. 交付与导出 -->
      <FilmCreateDeliveryPanel
        :playable-storyboard-video-count="playableStoryboardVideoCount"
        :storyboard-count="storyboards.length"
        :delivery-composite-status-label="deliveryCompositeStatusLabel"
        :delivery-file-count="deliveryFileCount"
        :compose-action-disabled-reason="composeActionDisabledReason"
        :video-status="videoStatus"
        :video-progress="videoProgress"
        :current-episode-video-url="currentEpisodeVideoUrl"
        :video-download-status="videoDownloadStatus"
        :video-download-error="videoDownloadError"
        :current-episode-id="currentEpisodeId"
        :delivery-subtitle-available="deliverySubtitleAvailable"
        :drama-id="dramaId"
        :delivery-export-status="deliveryExportStatus"
        :video-error-msg="videoErrorMsg"
        :delivery-export-feedback="deliveryExportFeedback"
        :delivery-export-has-error="deliveryExportHasError"
        @generate-video="onGenerateVideo"
        @download-video="downloadCurrentEpisodeVideo"
        @download-subtitle="downloadCurrentEpisodeSubtitle"
        @export-project="exportCurrentProjectPackage"
      />
    </main>

    <template v-if="projectLoadState === 'ready'">
    <FilmCreateResourceDialogs
        v-model:show-add-prop="showAddProp"
        v-model:show-char-library="showCharLibrary"
        v-model:show-char-sd2-cert="showCharSd2Cert"
        v-model:show-edit-char-library="showEditCharLibrary"
        v-model:show-edit-character="showEditCharacter"
        v-model:show-edit-prop="showEditProp"
        v-model:show-edit-prop-library="showEditPropLibrary"
        v-model:show-edit-scene="showEditScene"
        v-model:show-edit-scene-library="showEditSceneLibrary"
        v-model:show-prop-library="showPropLibrary"
        v-model:show-scene-library="showSceneLibrary"
        v-model:char-library-keyword="charLibraryKeyword"
        v-model:char-library-page="charLibraryPage"
        v-model:char-library-page-size="charLibraryPageSize"
        v-model:char-library-tab="charLibraryTab"
        v-model:drama-all-char-keyword="dramaAllCharKeyword"
        v-model:drama-all-char-page="dramaAllCharPage"
        v-model:drama-all-char-page-size="dramaAllCharPageSize"
        v-model:drama-all-prop-keyword="dramaAllPropKeyword"
        v-model:drama-all-prop-page="dramaAllPropPage"
        v-model:drama-all-prop-page-size="dramaAllPropPageSize"
        v-model:drama-all-scene-keyword="dramaAllSceneKeyword"
        v-model:drama-all-scene-page="dramaAllScenePage"
        v-model:drama-all-scene-page-size="dramaAllScenePageSize"
        v-model:prop-library-keyword="propLibraryKeyword"
        v-model:prop-library-page="propLibraryPage"
        v-model:prop-library-page-size="propLibraryPageSize"
        v-model:prop-library-tab="propLibraryTab"
        v-model:scene-library-keyword="sceneLibraryKeyword"
        v-model:scene-library-page="sceneLibraryPage"
        v-model:scene-library-page-size="sceneLibraryPageSize"
        v-model:scene-library-tab="sceneLibraryTab"
        v-model:add-char-ref-image="addCharRefImage"
        v-model:add-prop-add-ref-image="addPropAddRefImage"
        v-model:add-prop-form="addPropForm"
        v-model:add-prop-ref-image="addPropRefImage"
        :add-prop-saving="addPropSaving"
        v-model:add-scene-ref-image="addSceneRefImage"
        :char-library-list="charLibraryList"
        :char-library-loading="charLibraryLoading"
        :char-library-total="charLibraryTotal"
        :char-sd2-cert-payload="charSd2CertPayload"
        :current-episode-id="currentEpisodeId"
        :drama-all-char-list="dramaAllCharList"
        :drama-all-char-loading="dramaAllCharLoading"
        :drama-all-char-total="dramaAllCharTotal"
        :drama-all-prop-list="dramaAllPropList"
        :drama-all-prop-loading="dramaAllPropLoading"
        :drama-all-prop-total="dramaAllPropTotal"
        :drama-all-scene-list="dramaAllSceneList"
        :drama-all-scene-loading="dramaAllSceneLoading"
        :drama-all-scene-total="dramaAllSceneTotal"
        v-model:edit-char-library-form="editCharLibraryForm"
        :edit-char-library-saving="editCharLibrarySaving"
        :edit-character-form="editCharacterForm"
        :edit-character-prompt-generating="editCharacterPromptGenerating"
        :edit-character-saving="editCharacterSaving"
        :edit-prop-form="editPropForm"
        v-model:edit-prop-library-form="editPropLibraryForm"
        :edit-prop-library-saving="editPropLibrarySaving"
        :edit-prop-prompt-generating="editPropPromptGenerating"
        :edit-prop-saving="editPropSaving"
        :edit-scene-form="editSceneForm"
        v-model:edit-scene-library-form="editSceneLibraryForm"
        :edit-scene-library-saving="editSceneLibrarySaving"
        :edit-scene-prompt-generating="editScenePromptGenerating"
        :edit-scene-saving="editSceneSaving"
        :extracting-anchors="extractingAnchors"
        :extracting-char-appearance="extractingCharAppearance"
        :extracting-prop-add-desc="extractingPropAddDesc"
        :extracting-prop-desc="extractingPropDesc"
        :extracting-scene-desc="extractingSceneDesc"
        :prop-library-list="propLibraryList"
        :prop-library-loading="propLibraryLoading"
        :prop-library-total="propLibraryTotal"
        :scene-library-list="sceneLibraryList"
        :scene-library-loading="sceneLibraryLoading"
        :scene-library-total="sceneLibraryTotal"
        :asset-image-url="assetImageUrl"
        :char-role-label="charRoleLabel"
        :clear-char-ref-image="clearCharRefImage"
        :clear-prop-ref-image="clearPropRefImage"
        :clear-scene-ref-image="clearSceneRefImage"
        :debounced-load-char-library="debouncedLoadCharLibrary"
        :debounced-load-drama-all-char-list="debouncedLoadDramaAllCharList"
        :debounced-load-drama-all-prop-list="debouncedLoadDramaAllPropList"
        :debounced-load-drama-all-scene-list="debouncedLoadDramaAllSceneList"
        :debounced-load-prop-library="debouncedLoadPropLibrary"
        :debounced-load-scene-library="debouncedLoadSceneLibrary"
        :do-extract-char-from-image="doExtractCharFromImage"
        :do-extract-from-ref="doExtractFromRef"
        :do-extract-from-ref2="doExtractFromRef2"
        :do-extract-prop-from-image="doExtractPropFromImage"
        :do-extract-scene-from-image="doExtractSceneFromImage"
        :do-generate-character-prompt="doGenerateCharacterPrompt"
        :do-generate-prop-prompt="doGeneratePropPrompt"
        :do-generate-scene-prompt="doGenerateScenePrompt"
        :do-generate-scene-single-prompt="doGenerateSceneSinglePrompt"
        :extract-identity-anchors="extractIdentityAnchors"
        :is-char-add-to-episode-loading="isCharAddToEpisodeLoading"
        :is-prop-add-to-episode-loading="isPropAddToEpisodeLoading"
        :is-scene-add-to-episode-loading="isSceneAddToEpisodeLoading"
        :load-char-library-list="loadCharLibraryList"
        :load-drama-all-char-list="loadDramaAllCharList"
        :load-drama-all-prop-list="loadDramaAllPropList"
        :load-drama-all-scene-list="loadDramaAllSceneList"
        :load-prop-library-list="loadPropLibraryList"
        :load-scene-library-list="loadSceneLibraryList"
        :on-add-char-from-library="onAddCharFromLibrary"
        :on-add-drama-char-to-episode="onAddDramaCharToEpisode"
        :on-add-drama-prop-to-episode="onAddDramaPropToEpisode"
        :on-add-drama-scene-to-episode="onAddDramaSceneToEpisode"
        :on-add-prop-from-library="onAddPropFromLibrary"
        :on-add-scene-from-library="onAddSceneFromLibrary"
        :on-char-library-dialog-open="onCharLibraryDialogOpen"
        :on-char-library-tab-change="onCharLibraryTabChange"
        :on-close-char-dialog="onCloseCharDialog"
        :on-close-prop-dialog="onClosePropDialog"
        :on-close-scene-dialog="onCloseSceneDialog"
        :on-delete-char-library="onDeleteCharLibrary"
        :on-delete-prop-library="onDeletePropLibrary"
        :on-delete-scene-library="onDeleteSceneLibrary"
        :on-prop-library-dialog-open="onPropLibraryDialogOpen"
        :on-prop-library-tab-change="onPropLibraryTabChange"
        :on-ref-image-drop="onRefImageDrop"
        :on-ref-image-drop2="onRefImageDrop2"
        :on-ref-image-file-change="onRefImageFileChange"
        :on-ref-image-file-change2="onRefImageFileChange2"
        :on-scene-library-dialog-open="onSceneLibraryDialogOpen"
        :on-scene-library-tab-change="onSceneLibraryTabChange"
        :open-edit-char-library="openEditCharLibrary"
        :open-edit-prop-library="openEditPropLibrary"
        :open-edit-scene-library="openEditSceneLibrary"
        :open-image-preview="openImagePreview"
        :return-to-character-panel="returnToCharacterPanel"
        :submit-add-prop="submitAddProp"
        :submit-edit-char-library="submitEditCharLibrary"
        :submit-edit-character="submitEditCharacter"
        :submit-edit-prop="submitEditProp"
        :submit-edit-prop-library="submitEditPropLibrary"
        :submit-edit-scene="submitEditScene"
        :submit-edit-scene-library="submitEditSceneLibrary"
    />
    <FilmCreateStoryboardDialogs
        v-model:show-sb-prompt-dialog="showSbPromptDialog"
        v-model:show-frame-prompt-editor="showFramePromptEditor"
        v-model:show-video-params-dialog="showVideoParamsDialog"
        v-model:editing-frame-prompt-text="editingFramePromptText"
        v-model:sb-prompt-image-text="sbPromptImageText"
        v-model:sb-prompt-polished-text="sbPromptPolishedText"
        v-model:sb-prompt-video-text="sbPromptVideoText"
        :editing-frame-prompt-regenerating="editingFramePromptRegenerating"
        :editing-frame-prompt-saving="editingFramePromptSaving"
        :editing-frame-prompt-sb="editingFramePromptSb"
        :editing-frame-prompt-slot="editingFramePromptSlot"
        :regenerating-layout-sb-ids="regeneratingLayoutSbIds"
        :sb-action="sbAction"
        :sb-angle-h="sbAngleH"
        :sb-angle-s="sbAngleS"
        :sb-angle-v="sbAngleV"
        :sb-atmosphere="sbAtmosphere"
        :sb-creation-mode="sbCreationMode"
        :sb-dialogue="sbDialogue"
        :sb-dof="sbDof"
        :sb-duration="sbDuration"
        :sb-layout-description="sbLayoutDescription"
        :sb-lighting="sbLighting"
        :sb-location="sbLocation"
        :sb-movement="sbMovement"
        :sb-narration="sbNarration"
        :sb-prompt-polishing="sbPromptPolishing"
        :sb-prompt-saving="sbPromptSaving"
        v-model:sb-prompt-target="sbPromptTarget"
        :sb-result="sbResult"
        :sb-shot-type="sbShotType"
        :sb-time="sbTime"
        :sb-title="sbTitle"
        :sb-video-reference-image-id="sbVideoReferenceImageId"
        :split-by-audio-loading="splitByAudioLoading"
        :video-params-saving="videoParamsSaving"
        :video-params-target="videoParamsTarget"
        :angle-to-prompt-fragment="angleToPromptFragment"
        :asset-image-url="assetImageUrl"
        :can-split-sb-by-audio="canSplitSbByAudio"
        :get-sb-free-reference-items="getSbFreeReferenceItems"
        :get-sb-grid-images="getSbGridImages"
        :on-polish-sb-prompt="onPolishSbPrompt"
        :on-promote-sb-free-reference-image="onPromoteSbFreeReferenceImage"
        :on-regenerate-layout-description="onRegenerateLayoutDescription"
        :on-remove-sb-free-reference-image="onRemoveSbFreeReferenceImage"
        :on-save-sb-prompt-dialog="onSaveSbPromptDialog"
        :on-save-video-params="onSaveVideoParams"
        :on-split-sb-by-audio="onSplitSbByAudio"
        :on-video-params-dialog-closed="onVideoParamsDialogClosed"
        :open-global-media-picker="openGlobalMediaPicker"
        :open-image-preview="openImagePreview"
        :regenerate-editing-frame-prompt="regenerateEditingFramePrompt"
        :save-editing-frame-prompt="saveEditingFramePrompt"
        :set-sb-creation-mode-id="setSbCreationModeId"
    />
    <FilmCreateNovelImportDialog
      v-model:visible="showNovelImport"
      v-model:mode="novelImportMode"
      v-model:text="novelText"
      v-model:max-chapters="novelMaxChapters"
      v-model:ai-summarize="novelAiSummarize"
      :file-name="novelFileName"
      :importing="novelImporting"
      @reset="novelImportReset"
      @file-change="onNovelFileChange"
      @import="onImportNovel"
    />

    <FilmCreateAiConfigDialog
      ref="aiConfigContentRef"
      v-model="showAiConfigDialog"
      :initial-service-type="aiConfigInitialServiceType"
      :before-close="confirmAiConfigWorkspaceClose"
      @back="requestAiConfigWorkspaceClose"
      @configuration-changed="onAiConfigurationChanged"
    />

    <ImagePreviewDialog
      :model-value="Boolean(previewImageUrl)"
      :src="previewImageUrl || ''"
      title="制作资源图片预览"
      @update:model-value="(visible) => { if (!visible) closeImagePreview() }"
    />
    <GlobalMediaPickerDialog
      v-model="showGlobalMediaPicker"
      :title="globalMediaPickerTitle"
      :accept="globalMediaPickerAccept"
      :context="globalMediaPickerContext"
      @select="onGlobalMediaAssetSelected"
      @open-library="openMediaLibraryFromPicker"
    />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive, nextTick } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage as RawElMessage, ElMessageBox } from 'element-plus'
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Setting, Plus, Minus, Sunny, Moon, MagicStick, Upload, Delete, Check, Loading, WarningFilled, User, Box, Picture, Film, VideoCamera, Document, InfoFilled, Refresh, ZoomIn, QuestionFilled, DocumentAdd, Expand, Fold, VideoPlay, Grid, Close, Download } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import { useFilmStore } from '@/stores/film'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { syncGeneratingSetsFromStore, buildEpisodeContext, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { dramaAPI as rawDramaAPI } from '@/api/drama'
import { timelinesAPI as rawTimelinesAPI } from '@/api/timelines'
import { generationAPI as rawGenerationAPI } from '@/api/generation'
import { characterAPI as rawCharacterAPI } from '@/api/characters'
import { propAPI as rawPropAPI } from '@/api/props'
import { sceneAPI as rawSceneAPI } from '@/api/scenes'
import { taskAPI as rawTaskAPI } from '@/api/task'
import { imagesAPI as rawImagesAPI } from '@/api/images'
import { videosAPI as rawVideosAPI } from '@/api/videos'
import { storyboardsAPI as rawStoryboardsAPI } from '@/api/storyboards'
import { uploadAPI as rawUploadAPI } from '@/api/upload'
import { characterLibraryAPI as rawCharacterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI as rawSceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI as rawPropLibraryAPI } from '@/api/propLibrary'
import { formatEpisodeContextLabel } from '@/utils/filmCreateContext'
import {
  buildEpisodeDraftPayload,
  createEpisodeSwitchController,
  createScriptDraftController,
} from '@/utils/scriptDraft'
import { createLatestRequestGuard } from '@/utils/latestRequest.js'
import { logOperation } from '@/utils/operationLog'
import { isPlaceholderMediaUrl, probeImageSource, storyboardImageUrl } from '@/utils/mediaUrl'
import {
  getSbImagesList,
  hasRealMediaValue,
} from '@/utils/storyboardMedia'
import {
  videoConfigSupportsOmni,
} from '@/utils/storyboardVideoRequest'
import { exportStoryboardSheet } from '@/utils/exportStoryboardSheet'
import FilmCreateAiConfigDialog from '@/components/filmCreate/FilmCreateAiConfigDialog.vue'
import GlobalMediaPickerDialog from '@/components/GlobalMediaPickerDialog.vue'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import UniversalSegmentOmniAtEditor from '@/components/UniversalSegmentOmniAtEditor.vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import FilmCreateDeliveryPanel from '@/components/filmCreate/FilmCreateDeliveryPanel.vue'
import FilmCreateVideoSettingsPanel from '@/components/filmCreate/FilmCreateVideoSettingsPanel.vue'
import { requestCoreJson } from '@/utils/coreJsonRequest'
import {
  buildDeliveryFilename as buildDeliveryFilenameFromParts,
  buildEpisodeVideoFilename,
  fetchVerifiedVideoBlob,
  friendlyVideoDownloadError,
  normalizeVideoDownloadFilenamePart,
  triggerBlobDownload,
  validateDeliveryBlob,
} from '@/utils/filmCreateDelivery'
import {
  buildScriptStoryboardEstimate,
  clipSecondsForStoryboardEstimate as resolveClipSeconds,
  estimateVideoDurationSecFromCharLen,
  shotCountEstimateFromDurationSec as resolveShotCountEstimate,
} from '@/utils/filmCreateEstimates'
import FilmCreatePipelinePanel from '@/components/filmCreate/FilmCreatePipelinePanel.vue'
import FilmCreateScriptWorkbench from '@/components/filmCreate/FilmCreateScriptWorkbench.vue'
import FilmCreateResourcePanel from '@/components/filmCreate/FilmCreateResourcePanel.vue'
import FilmCreateStoryboardPanel from '@/components/filmCreate/FilmCreateStoryboardPanel.vue'
import FilmCreateResourceDialogs from '@/components/filmCreate/FilmCreateResourceDialogs.vue'
import FilmCreateStoryboardDialogs from '@/components/filmCreate/FilmCreateStoryboardDialogs.vue'
import FilmCreateNovelImportDialog from '@/components/filmCreate/FilmCreateNovelImportDialog.vue'
import {
  batchGenerationDisabledReason,
  composeVideoDisabledReason,
  episodeResourceDisabledReason,
  getVideoGenerationCapability,
  pipelineDisabledReason,
  projectResourceDisabledReason,
  storyboardDisabledReason,
  userFacingVideoGenerationError,
} from '@/utils/filmCreateActionState'
import { normalizeProductionReadiness } from '@/utils/sourceWorkflowLaunch'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import {
  generationStyleOptions,
  getStylePromptEn,
  getStylePromptZh,
  stylePromptMetadataForSave,
  backfillDramaStylePromptMetadataIfNeeded,
} from '@/constants/styleOptions'
import { useNavigation } from '@/composables/filmCreate/useNavigation'
import { useCharacters } from '@/composables/filmCreate/useCharacters'
import { useProps as usePropsComposable } from '@/composables/filmCreate/useProps'
import { useScenes } from '@/composables/filmCreate/useScenes'
import { useFilmCreateStoryboardMedia } from '@/composables/filmCreate/useFilmCreateStoryboardMedia'
import { useFilmCreatePipelineRun } from '@/composables/filmCreate/useFilmCreatePipelineRun'
import { useFilmCreatePipelineStages } from '@/composables/filmCreate/useFilmCreatePipelineStages'
import { useFilmCreateBatchGeneration } from '@/composables/filmCreate/useFilmCreateBatchGeneration'
import { useFilmCreateStoryboardImageGeneration } from '@/composables/filmCreate/useFilmCreateStoryboardImageGeneration'
import { useFilmCreateStoryboardVideoGeneration } from '@/composables/filmCreate/useFilmCreateStoryboardVideoGeneration'
import { useFilmCreateStoryboardTts } from '@/composables/filmCreate/useFilmCreateStoryboardTts'
import { useFilmCreateLinkedStoryboardRegen } from '@/composables/filmCreate/useFilmCreateLinkedStoryboardRegen'
import { useFilmCreateUniversalSegment } from '@/composables/filmCreate/useFilmCreateUniversalSegment'
import { useFilmCreateStoryboardUpload } from '@/composables/filmCreate/useFilmCreateStoryboardUpload'
import { useFilmCreateResourceUpload } from '@/composables/filmCreate/useFilmCreateResourceUpload'
import { useFilmCreateStoryboardCrud } from '@/composables/filmCreate/useFilmCreateStoryboardCrud'
import { useFilmCreateStoryboardPrompts } from '@/composables/filmCreate/useFilmCreateStoryboardPrompts'
import { useFilmCreateTailFrameLink } from '@/composables/filmCreate/useFilmCreateTailFrameLink'
import { useFilmCreateScriptPersistence } from '@/composables/filmCreate/useFilmCreateScriptPersistence'
import { useFilmCreateStoryboardReferences } from '@/composables/filmCreate/useFilmCreateStoryboardReferences'
import { useFilmCreateScriptWorkspace } from '@/composables/filmCreate/useFilmCreateScriptWorkspace'
import { useFilmCreateNavigationGuards } from '@/composables/filmCreate/useFilmCreateNavigationGuards'
import { createProjectInstanceLifecycle } from '@/utils/projectInstanceLifecycle.js'

const projectLifecycle = createProjectInstanceLifecycle()
const ElMessage = projectLifecycle.guardNotifier(RawElMessage)
const dramaAPI = projectLifecycle.guardApi(rawDramaAPI)
const timelinesAPI = projectLifecycle.guardApi(rawTimelinesAPI)
const generationAPI = projectLifecycle.guardApi(rawGenerationAPI)
const characterAPI = projectLifecycle.guardApi(rawCharacterAPI)
const propAPI = projectLifecycle.guardApi(rawPropAPI)
const sceneAPI = projectLifecycle.guardApi(rawSceneAPI)
const taskAPI = projectLifecycle.guardApi(rawTaskAPI)
const imagesAPI = projectLifecycle.guardApi(rawImagesAPI)
const videosAPI = projectLifecycle.guardApi(rawVideosAPI)
const storyboardsAPI = projectLifecycle.guardApi(rawStoryboardsAPI)
const uploadAPI = projectLifecycle.guardApi(rawUploadAPI)
const characterLibraryAPI = projectLifecycle.guardApi(rawCharacterLibraryAPI)
const sceneLibraryAPI = projectLifecycle.guardApi(rawSceneLibraryAPI)
const propLibraryAPI = projectLifecycle.guardApi(rawPropLibraryAPI)

const route = useRoute()
const router = useRouter()
const projectListReturnTo = computed(() => normalizeProjectListReturnTo(route.query.returnTo))
const store = useFilmStore()
const genStore = useGenerationTaskStore()
const { isDark, toggle: toggleTheme } = useTheme()
const { videoResolution: storeVideoResolution } = storeToRefs(store)
const initialRouteProjectId = route.params.id && route.params.id !== 'new' ? Number(route.params.id) : null
const projectLoadState = ref(initialRouteProjectId ? 'loading' : 'ready')
const projectLoadError = ref('')
const projectLoadNotFound = ref(false)
const projectLoadPending = ref(false)
const projectLoadFailureRef = ref(null)
const projectDependencyWarning = ref('')
const projectDependencyLoading = ref(false)
let projectLoadRequestId = 0
let projectDependencyRequestId = 0
const projectPageTitle = computed(() => {
  if (projectLoadState.value === 'loading') return '正在加载项目'
  if (projectLoadState.value === 'error') return '项目加载失败'
  return store.dramaId ? (store.drama?.title || '项目') : '新建故事'
})

// ── Composable: Navigation ─────────────────────────────
const { navCollapsed, storyboardMenuExpanded, activeNavAnchor, toggleNav, scrollToTop, scrollToAnchor } = useNavigation({
  getAnchorIds: () => navSteps.value.map((step) => step.anchor),
})

function goList() {
  router.push(projectListReturnTo.value || { name: 'list' })
}

function goCanvasMode() {
  if (!dramaId.value) return
  const query = selectedEpisodeId.value ? { episode: String(selectedEpisodeId.value) } : {}
  if (projectListReturnTo.value) query.returnTo = projectListReturnTo.value
  router.push({ path: `/film/${dramaId.value}/canvas`, query })
}

function openMediaLibraryFromPicker() {
  showGlobalMediaPicker.value = false
  router.push({ name: 'media-library', query: { returnTo: route.fullPath } })
}


const showAiConfigDialog = ref(false)
const aiConfigContentRef = ref(null)
const pipelinePanelRef = ref(null)
const aiConfigInitialServiceType = ref('')
const aiConfigChanged = ref(false)
const aiConfigOpenedFromPipelineAction = ref(false)
const videoCapabilityConfigs = ref([])
const videoCapabilityLoading = ref(true)
const videoCapabilityFailed = ref(false)
const authoritativeProductionReadiness = ref(null)
const productionReadinessLoading = ref(true)
const productionReadinessFailed = ref(false)
const videoGenerationCapability = computed(() => getVideoGenerationCapability(
  videoCapabilityConfigs.value,
  { loading: videoCapabilityLoading.value, failed: videoCapabilityFailed.value },
))
const videoCapabilityReason = computed(() => videoGenerationCapability.value.reason)
const productionCapabilityGaps = computed(() => (
  authoritativeProductionReadiness.value?.missing_capabilities || []
))
const productionReadinessState = computed(() => {
  if (productionReadinessLoading.value) return 'checking'
  if (productionReadinessFailed.value) return 'error'
  return productionCapabilityGaps.value.length ? 'missing' : 'ready'
})
const productionReadinessReason = computed(() => {
  if (productionReadinessLoading.value) return '正在检查完整成片所需的 AI 服务与本地合成能力。'
  if (productionReadinessFailed.value) return '无法确认完整成片制作能力，请刷新后重试。'
  if (!productionCapabilityGaps.value.length) return ''
  return productionCapabilityGaps.value
    .map((gap) => `${gap.label}：${gap.detail}`)
    .join('；')
})
const productionReadinessServiceType = computed(() => (
  productionCapabilityGaps.value.find((gap) => gap.service_type)?.service_type || ''
))
const ttsCapabilityReason = computed(() => {
  if (productionReadinessLoading.value) return '正在检查语音合成配置，请稍候。'
  if (productionReadinessFailed.value) return '无法确认语音合成配置，请刷新后重试或前往 AI 配置检查。'
  const gap = productionCapabilityGaps.value.find((item) => item?.service_type === 'tts')
  return gap ? `${gap.label}：${gap.detail}` : ''
})

function openAiConfig(serviceType = '') {
  aiConfigOpenedFromPipelineAction.value = false
  aiConfigInitialServiceType.value = ['text', 'image', 'storyboard_image', 'video', 'tts'].includes(serviceType)
    ? serviceType
    : ''
  showAiConfigDialog.value = true
}

function openAiConfigFromPipeline(serviceType = '', context = {}) {
  aiConfigOpenedFromPipelineAction.value = context.source === 'compact-action'
  aiConfigInitialServiceType.value = ['text', 'image', 'storyboard_image', 'video', 'tts'].includes(serviceType)
    ? serviceType
    : ''
  showAiConfigDialog.value = true
}

function onAiConfigurationChanged() {
  aiConfigChanged.value = true
}

async function confirmAiConfigWorkspaceClose(done) {
  const canClose = (await aiConfigContentRef.value?.requestClose?.()) !== false
  if (canClose) done()
}

async function requestAiConfigWorkspaceClose() {
  const canClose = (await aiConfigContentRef.value?.requestClose?.()) !== false
  if (canClose) showAiConfigDialog.value = false
}

watch(showAiConfigDialog, async (open) => {
  if (open) {
    aiConfigChanged.value = false
    return
  }
  const changed = aiConfigChanged.value
  const restorePipelineSummaryFocus = aiConfigOpenedFromPipelineAction.value
  aiConfigChanged.value = false
  aiConfigOpenedFromPipelineAction.value = false
  invalidateActiveVideoAiConfigCache()
  if (changed) ElMessage.info('配置已更新，正在重新检查')
  const refreshPromise = Promise.allSettled([
    refreshVideoGenerationCapability(),
    refreshProductionReadiness(),
  ])
  await refreshPromise
  if (restorePipelineSummaryFocus) {
    await nextTick()
    pipelinePanelRef.value?.focusSummary()
  }
})
const storyInput = ref('')
const storyStyle = ref('')
const storyType = ref('')
const storyEpisodeCount = ref(1)
const storyGenerating = ref(false)
/** 剧本工作台：create 创作 | select 选择预览 */
const scriptWorkbenchMode = ref('create')
const showSelectScriptDialog = ref(false)
const selectScriptLoading = ref(false)
const selectScriptImporting = ref(false)
const selectScriptDramas = ref([])
/** 选择剧本弹窗列表：排除当前打开的项目，避免误点「导入」到自身 */
const selectableScriptDramas = computed(() => {
  const cur = store.dramaId
  const list = selectScriptDramas.value || []
  if (cur == null) return list
  return list.filter((d) => Number(d.id) !== Number(cur))
})
const selectPreviewEpisodeId = ref('')
// P1-2: 小说导入
const showNovelImport = ref(false)
const novelImportMode = ref('text')
const novelText = ref('')
const novelFileName = ref('')
const novelFileContent = ref('')
const novelMaxChapters = ref(10)
const novelAiSummarize = ref(false)
const novelImporting = ref(false)
const scriptTitle = ref('')
const selectedEpisodeId = ref(null)
const episodeSwitching = ref(false)
const selectedEpisodeContextLabel = computed(() => {
  const episodes = store.drama?.episodes || []
  const index = episodes.findIndex((episode) => (
    Number(episode?.id) === Number(selectedEpisodeId.value)
  ))
  if (index < 0) return '未选择剧集'
  return formatEpisodeContextLabel(episodes[index], index)
})
/** 保存剧本后用于恢复选中集（后端重插后 id 会变，用 episode_number 匹配） */
const savedCurrentEpisodeNumber = ref(1)
const scriptLanguage = ref('zh')
const scriptStoryboardStyle = ref('')
const scriptGenerating = ref(false)
const scriptDraftStatus = ref('saved')
const scriptDraftStatusLabel = computed(() => ({
  dirty: '未保存',
  saving: '自动保存中',
  saved: '已保存',
  error: '自动保存失败',
}[scriptDraftStatus.value] || '已保存'))
const isStoryGenRunning = computed(() => {
  if (storyGenerating.value || scriptGenerating.value) return true
  return genStore.getAllRunningTasks().some(
    (t) => Number(t.dramaId) === Number(dramaId.value) && t.resourceType === GEN_RESOURCE.GENERATE_STORY
  )
})
const generationStyle = ref('')
const projectAspectRatio = ref('16:9')
const videoClipDuration = ref(5)

/** 根据 value 查找样式选项对象 */
function _findStyleOption(val) {
  for (const group of generationStyleOptions) {
    const found = group.options.find(o => o.value === val)
    if (found) return found
  }
  return null
}

/** 传给图像/视频 AI 用的英文 prompt（效果最好）；
 *  找不到 promptEn 时降级到 prompt，再降级到原始值 */
function getSelectedStylePrompt() {
  const val = (generationStyle.value || '').toString().trim()
  if (!val) return undefined
  const opt = _findStyleOption(val)
  if (opt) return opt.promptEn || opt.prompt || val
  return val
}

/** 中文风格描述（用于界面展示或中文场景提示词拼接） */
function getSelectedStylePromptZh() {
  const val = (generationStyle.value || '').toString().trim()
  if (!val) return undefined
  const opt = _findStyleOption(val)
  if (opt) return opt.prompt || opt.promptEn || val
  return val
}

function projectStylePromptMetadata() {
  return stylePromptMetadataForSave(generationStyle.value)
}

const scriptContent = computed({
  get: () => store.scriptContent,
  set: (v) => store.setScriptContent(v)
})
const videoResolution = storeVideoResolution
const videoMusic = ref('')
const videoSfx = ref('')
const videoQuality = ref('high')
const videoSubtitle = ref(false)
/** 合成整集时把各镜对白 TTS（audio_local_path）按分镜时长对齐并混入成片 */
const videoBurnDialogue = ref(false)
const videoWatermark = ref(false)
/** 水印开启时烧录到成片右下角 */
const videoWatermarkText = ref('')

const dramaId = computed(() => store.dramaId)
const characters = computed(() => store.characters)
const scenes = computed(() => store.scenes)
const props = computed(() => store.props)
const storyboards = computed(() => store.storyboards)
const currentEpisode = computed(() => store.currentEpisode)
const currentEpisodeId = computed(() => store.currentEpisode?.id ?? null)
const hasAnyEpisode = computed(() => (store.drama?.episodes || []).length > 0)
const showGlobalMediaPicker = ref(false)
const globalMediaPickerMode = ref('reference')
const globalMediaPickerTarget = ref(null)
const globalMediaPickerAccept = computed(() => 'image')
const globalMediaPickerTitle = computed(() => (
  globalMediaPickerMode.value === 'reference-primary'
    ? '从素材中心选择视频主参考图'
    : '从素材中心添加自由参考图'
))
const globalMediaPickerContext = computed(() => {
  const sb = globalMediaPickerTarget.value
  const epNum = currentEpisode.value?.episode_number
  return {
    projectTitle: store.drama?.title || '未命名项目',
    episodeLabel: epNum != null ? `第${epNum}集` : '',
    storyboardLabel: sb?.storyboard_number != null ? `分镜 #${sb.storyboard_number}` : '',
    usageLabel: globalMediaPickerMode.value === 'reference-primary'
      ? '将放到自由参考图首位，作为无主图时的视频主参考'
      : '将追加到当前分镜的自由参考图',
  }
})
const scriptDraftController = createScriptDraftController({
  saveSnapshot: persistScriptDraftSnapshot,
  onStateChange: (state) => {
    scriptDraftStatus.value = state
  },
})

function captureScriptDraft() {
  const episode = store.currentEpisode
  if (!store.dramaId || !episode?.id) return null
  return {
    dramaId: Number(store.dramaId),
    episodeId: Number(episode.id),
    episodeNumber: Number(episode.episode_number) || 1,
    title: scriptTitle.value || '',
    content: scriptContent.value || '',
  }
}

function markScriptDraftSaved() {
  scriptDraftController.markSaved(captureScriptDraft())
}

async function persistScriptDraftSnapshot(snapshot) {
  if (!snapshot || Number(store.dramaId) !== Number(snapshot.dramaId)) {
    throw new Error('项目已切换，草稿未自动保存')
  }
  const episodes = store.drama?.episodes || []
  const payload = buildEpisodeDraftPayload(episodes, snapshot)
  await dramaAPI.saveEpisodes(snapshot.dramaId, payload)

  const target = episodes.find((episode) => (
    Number(episode.id) === Number(snapshot.episodeId)
      || Number(episode.episode_number) === Number(snapshot.episodeNumber)
  ))
  if (target) {
    target.title = snapshot.title
    target.script_content = snapshot.content
  }
  if (Number(store.currentEpisode?.id) === Number(snapshot.episodeId)) {
    store.currentEpisode.title = snapshot.title
    store.currentEpisode.script_content = snapshot.content
  }
}

async function flushScriptDraft() {
  await scriptDraftController.flush()
}

const episodeSwitchController = createEpisodeSwitchController({
  flushDraft: flushScriptDraft,
  resolveEpisode: (episodeId) => (store.drama?.episodes || []).find((episode) => (
    Number(episode.id) === Number(episodeId)
  )) || null,
  commitEpisode: applySelectedEpisode,
  refreshEpisode: refreshProjectDependencies,
  onBusyChange: (busy) => {
    episodeSwitching.value = busy
  },
})

watch(
  [scriptTitle, () => scriptContent.value, currentEpisodeId],
  () => scriptDraftController.queue(captureScriptDraft()),
  { flush: 'post' },
)
const videoProgress = computed(() => store.videoProgress)
const videoStatus = computed(() => store.videoStatus)

function trackFilmCreateAction(action, payload = {}) {
  const { extra, cancelled, ...rest } = payload
  let phase = 'info'
  if (/_failed$/.test(action)) phase = 'error'
  else if (/stop_complete$|cancel/.test(action)) phase = 'cancel'
  else if (/_complete$|_partial$/.test(action)) phase = 'success'
  else if (/_start$|_click$/.test(action)) phase = 'start'
  logOperation({
    operation: 'film_create',
    phase,
    action,
    cancelled: cancelled === true,
    ...(rest || {}),
    ...(extra && typeof extra === 'object' ? extra : {}),
  })
}
/** 当前集合成视频的播放地址（用于按钮下方预览） */
const currentEpisodeVideoUrl = computed(() => {
  const url = currentEpisode.value?.video_url
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (isPlaceholderMediaUrl(s)) return ''
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  if (s.startsWith('/static/')) return s
  return '/static/' + s.replace(/^\//, '')
})
const deliveryCompositeStatusLabel = computed(() => {
  if (videoStatus.value === 'generating') return `${videoProgress.value}%`
  if (currentEpisodeVideoUrl.value) return '已就绪'
  if (videoStatus.value === 'error') return '合成失败'
  return '待合成'
})
const deliverySubtitleAvailable = computed(() => storyboards.value.some((storyboard) => (
  [storyboard?.dialogue, storyboard?.narration, storyboard?.action]
    .some((value) => Boolean(String(value || '').trim()))
)))
const deliveryFileCount = computed(() => (
  1 + (deliverySubtitleAvailable.value ? 1 : 0) + (currentEpisodeVideoUrl.value ? 1 : 0)
))

const videoDownloadStatus = ref('idle')
const videoDownloadError = ref('')

async function downloadCurrentEpisodeVideo() {
  if (videoDownloadStatus.value === 'downloading') return
  videoDownloadStatus.value = 'downloading'
  videoDownloadError.value = ''
  try {
    const blob = await fetchVerifiedVideoBlob(currentEpisodeVideoUrl.value)
    const filename = buildEpisodeVideoFilename(
      store.drama?.title,
      currentEpisode.value?.episode_number,
      blob,
    )
    triggerBlobDownload(blob, filename)
    videoDownloadStatus.value = 'success'
    ElMessage.success('成片下载已完成')
  } catch (error) {
    videoDownloadError.value = friendlyVideoDownloadError(error)
    videoDownloadStatus.value = 'error'
    ElMessage.error(videoDownloadError.value)
  }
}

const deliveryExportStatus = reactive({ subtitle: 'idle', project: 'idle' })
const deliveryExportError = ref('')
const deliveryExportHasError = computed(() => (
  deliveryExportStatus.subtitle === 'error' || deliveryExportStatus.project === 'error'
))
const deliveryExportFeedback = computed(() => {
  if (deliveryExportHasError.value) return deliveryExportError.value
  if (deliveryExportStatus.subtitle === 'success') return '字幕下载已完成。'
  if (deliveryExportStatus.project === 'success') return '项目包导出已完成。'
  return ''
})

function buildDeliveryFilename(suffix, extension) {
  return buildDeliveryFilenameFromParts(
    store.drama?.title,
    currentEpisode.value?.episode_number,
    suffix,
    extension,
  )
}

async function downloadCurrentEpisodeSubtitle() {
  if (!currentEpisodeId.value || deliveryExportStatus.subtitle === 'downloading') return
  deliveryExportStatus.subtitle = 'downloading'
  deliveryExportStatus.project = 'idle'
  deliveryExportError.value = ''
  try {
    const blob = await validateDeliveryBlob(
      await timelinesAPI.getEpisodeSrt(currentEpisodeId.value),
      { label: '字幕文件' },
    )
    const filename = buildDeliveryFilename('字幕', 'srt')
    triggerBlobDownload(blob, filename)
    deliveryExportStatus.subtitle = 'success'
    ElMessage.success('字幕下载已完成')
  } catch (_) {
    deliveryExportError.value = '字幕下载失败，可能是本集还没有可导出的字幕。'
    deliveryExportStatus.subtitle = 'error'
    ElMessage.error(deliveryExportError.value)
  }
}

async function exportCurrentProjectPackage() {
  if (!dramaId.value || deliveryExportStatus.project === 'downloading') return
  deliveryExportStatus.project = 'downloading'
  deliveryExportStatus.subtitle = 'idle'
  deliveryExportError.value = ''
  try {
    const blob = await validateDeliveryBlob(await dramaAPI.exportDrama(dramaId.value), { label: '项目包', kind: 'zip' })
    const title = normalizeVideoDownloadFilenamePart(store.drama?.title, 'LocalMiniDrama')
    const filename = `${title}-项目包.zip`
    triggerBlobDownload(blob, filename)
    deliveryExportStatus.project = 'success'
    ElMessage.success('项目包导出已完成')
  } catch (_) {
    deliveryExportError.value = '项目包导出失败，请检查本地服务后重试。'
    deliveryExportStatus.project = 'error'
    ElMessage.error(deliveryExportError.value)
  }
}

watch([currentEpisodeId, currentEpisodeVideoUrl], () => {
  videoDownloadStatus.value = 'idle'
  videoDownloadError.value = ''
  deliveryExportStatus.subtitle = 'idle'
  deliveryExportStatus.project = 'idle'
  deliveryExportError.value = ''
})

const storyboardGenerating = computed(() =>
  isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.GENERATE_STORYBOARD)
)
/** 分镜批量生成结束后，按镜序逐个润色全能片段（仅勾选全能模式且各镜为 universal 且有正文时） */
const universalOmniPolishRunning = ref(false)
const universalOmniPolishAbort = ref(false)
const universalOmniPolishProgress = ref({ current: 0, total: 0, label: '' })
const sbTruncatedWarning = ref(false)
const sbTruncatedDismissed = ref(false)
const videoErrorMsg = ref('')
// 一键全流程流水线
const {
  pipelineRunning,
  pipelineStarting,
  pipelineStopping,
  pipelinePaused,
  pipelineAbortRequested,
  pipelineErrorLog,
  pipelineCurrentStep,
  pipelineStepIndex,
  pipelineStepTotal,
  pipelineOwnedTaskIds,
  activePipelineRunPromise,
  pipelineCountdown,
  pipelineCountdownMsg,
  pipelineConcurrency,
  pipelineVideoConcurrency,
  pipelineActiveTasks,
  loadPipelineConcurrency,
  runConcurrently,
  cancelPipelineRun,
  pollTaskWithPause,
  onPipelineResume,
  addPipelineError,
  checkPause,
  pipelineRest,
  skipPipelineCountdown,
  runPipelineCountdown,
  pipelineWithRetry,
  confirmProductionPipelineCost,
  executeOwnedPipelineRun,
  setPipelineStep,
} = useFilmCreatePipelineRun({
  store,
  videoClipDuration,
  taskAPI,
  genStore,
  trackFilmCreateAction,
  getStoryboardCountForApi: () => getStoryboardCountForApi(),
  get storyboardMediaActionReason() {
    return storyboardMediaActionReason
  },
  resolvePollMeta: (meta) => resolvePollMeta(meta),
})

// ── Composable: Characters ────────────────────────────
const {
  showEditCharacter, editCharacterForm, editCharacterSaving, editCharacterPromptGenerating,
  extractingCharAppearance, extractingAnchors, addCharRefImage, addCharRefFileInput,
  charactersGenerating, generatingCharIds, sd2CertifyingId, showCharSd2Cert, charSd2CertPayload,
  sd2VoiceUploadingId,
  showCharLibrary, charLibraryList, charLibraryLoading, charLibraryPage, charLibraryPageSize,
  charLibraryTotal, charLibraryKeyword, charLibraryTab,
  dramaAllCharList, dramaAllCharLoading, dramaAllCharPage, dramaAllCharPageSize, dramaAllCharTotal, dramaAllCharKeyword,
  showEditCharLibrary, editCharLibraryForm,
  editCharLibrarySaving, addingCharToLibraryId, addingCharToMaterialId, addingCharFromLibraryId,
  charRoleLabel, onGenerateCharacters: onGenerateCharactersRaw, openAddCharacter, stopCharacterPromptPoll, editCharacter,
  saveCharRefImageIfAny, submitEditCharacter, doGenerateCharacterPrompt, doExtractCharFromImage,
  extractIdentityAnchors, clearCharRefImage, onCloseCharDialog, onDeleteCharacter, onGenerateCharacterImage, onSd2CertifyCharacter, onSd2CertifyRefresh, sd2ActionLabel, onSd2PrimaryAction, openCharSd2CertDialog,
  onSd2VoicePrimaryAction, onSd2VoiceReplace, sd2VoiceActionLabel, playSd2Voice,
  loadCharLibraryList, debouncedLoadCharLibrary, loadDramaAllCharList, debouncedLoadDramaAllCharList,
  onCharLibraryDialogOpen, onCharLibraryTabChange, isCharAddToEpisodeLoading,
  openEditCharLibrary, submitEditCharLibrary,
  onDeleteCharLibrary, onAddCharacterToLibrary, onAddCharacterToMaterialLibrary,
  onAddCharFromLibrary, onAddDramaCharToEpisode,
} = useCharacters({
  store,
  dramaId,
  currentEpisodeId,
  getSelectedStyle,
  loadDrama,
  pollTask,
  pollUntilResourceHasImage,
  hasAssetImage,
  ElMessage,
  characterAPI,
  characterLibraryAPI,
  dramaAPI,
  generationAPI,
  uploadAPI,
})

// ── Composable: Props ──────────────────────────────────
const {
  showAddProp, addPropSaving, addPropForm,
  showEditProp, editPropForm, editPropSaving, editPropPromptGenerating,
  extractingPropDesc, addPropRefImage, addPropRefFileInput,
  addPropAddRefImage, addPropAddRefFileInput, extractingPropAddDesc,
  propsExtracting, generatingPropIds,
  showPropLibrary, propLibraryList, propLibraryLoading, propLibraryPage, propLibraryPageSize,
  propLibraryTotal, propLibraryKeyword, propLibraryTab,
  dramaAllPropList, dramaAllPropLoading, dramaAllPropPage, dramaAllPropPageSize, dramaAllPropTotal, dramaAllPropKeyword,
  showEditPropLibrary, editPropLibraryForm,
  editPropLibrarySaving, addingPropToLibraryId, addingPropToMaterialId, addingPropFromLibraryId,
  onExtractProps: onExtractPropsRaw, stopPropPromptPoll, editProp, doGeneratePropPrompt, savePropRefImageIfAny,
  clearPropRefImage, doExtractPropFromImage, submitEditProp, submitAddProp,
  onClosePropDialog, onDeleteProp, onGeneratePropImage,
  loadPropLibraryList, debouncedLoadPropLibrary, loadDramaAllPropList, debouncedLoadDramaAllPropList,
  onPropLibraryDialogOpen, onPropLibraryTabChange, isPropAddToEpisodeLoading,
  openEditPropLibrary, submitEditPropLibrary,
  onDeletePropLibrary, onAddPropToLibrary, onAddPropToMaterialLibrary,
  onAddPropFromLibrary, onAddDramaPropToEpisode,
  doExtractFromRef2,
} = usePropsComposable({
  store,
  dramaId,
  currentEpisodeId,
  getSelectedStyle,
  loadDrama,
  pollTask,
  pollUntilResourceHasImage,
  hasAssetImage,
  ElMessage,
  propAPI,
  propLibraryAPI,
  uploadAPI,
})

// ── Composable: Scenes ─────────────────────────────────
const {
  showEditScene, editSceneForm, editSceneSaving, editScenePromptGenerating,
  extractingSceneDesc, addSceneRefImage, addSceneRefFileInput,
  scenesExtracting, generatingSceneIds,
  // 场景多视角额外 state（由 FilmCreate 管理）
  showSceneLibrary, sceneLibraryList, sceneLibraryLoading, sceneLibraryPage, sceneLibraryPageSize,
  sceneLibraryTotal, sceneLibraryKeyword, sceneLibraryTab,
  dramaAllSceneList, dramaAllSceneLoading, dramaAllScenePage, dramaAllScenePageSize, dramaAllSceneTotal, dramaAllSceneKeyword,
  showEditSceneLibrary, editSceneLibraryForm,
  editSceneLibrarySaving, addingSceneToLibraryId, addingSceneToMaterialId, addingSceneFromLibraryId,
  onExtractScenes: onExtractScenesRaw, openAddScene, stopScenePromptPoll, editScene, doGenerateScenePrompt, doGenerateSceneSinglePrompt,
  saveSceneRefImageIfAny, clearSceneRefImage, doExtractSceneFromImage, submitEditScene,
  onCloseSceneDialog, onDeleteScene, onGenerateSceneImage,
  loadSceneLibraryList, debouncedLoadSceneLibrary, loadDramaAllSceneList, debouncedLoadDramaAllSceneList,
  onSceneLibraryDialogOpen, onSceneLibraryTabChange, isSceneAddToEpisodeLoading,
  openEditSceneLibrary, submitEditSceneLibrary,
  onDeleteSceneLibrary, onAddSceneToLibrary, onAddSceneToMaterialLibrary,
  onAddSceneFromLibrary, onAddDramaSceneToEpisode,
} = useScenes({
  store,
  dramaId,
  currentEpisodeId,
  getSelectedStyle,
  scriptLanguage,
  loadDrama,
  pollTask,
  pollUntilResourceHasImage,
  hasAssetImage,
  dramaAPI,
  ElMessage,
  sceneAPI,
  sceneLibraryAPI,
  uploadAPI,
})

async function onGenerateCharacters() {
  trackFilmCreateAction('generate_characters_click')
  const beforeCount = (store.currentEpisode?.characters || []).length
  try {
    await onGenerateCharactersRaw()
    const afterCount = (store.currentEpisode?.characters || []).length
    trackFilmCreateAction('generate_characters_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('generate_characters_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}

async function onExtractProps() {
  trackFilmCreateAction('extract_props_click')
  const beforeCount = (store.props || []).length
  try {
    await onExtractPropsRaw()
    const afterCount = (store.props || []).length
    trackFilmCreateAction('extract_props_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('extract_props_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}

async function onExtractScenes() {
  trackFilmCreateAction('extract_scenes_click')
  const beforeCount = (store.currentEpisode?.scenes || []).length
  try {
    await onExtractScenesRaw()
    const afterCount = (store.currentEpisode?.scenes || []).length
    trackFilmCreateAction('extract_scenes_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('extract_scenes_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}



// 资源管理大面板及子区块折叠状态
const resourcePanelCollapsed = ref(false)
const charactersBlockCollapsed = ref(false)
const propsBlockCollapsed = ref(false)
const scenesBlockCollapsed = ref(false)
const sceneUseQuadGrid = ref(false)
const propUseQuadGrid = ref(false)  // 道具四视图（与场景四宫格同级选项）

// 分镜行内编辑状态（按 storyboard id 存储）
// navCollapsed/storyboardMenuExpanded/toggleNav → 已移至 useNavigation composable

/** 左侧导航各步骤状态 */
const navSteps = computed(() => {
  const epRunning = genStore.getRunningForEpisode(dramaId.value, currentEpisodeId.value)
  // 剧本
  const hasScript = !!(scriptContent?.value?.trim())
  const scriptStatus = isStoryGenRunning.value
    ? 'generating'
    : hasScript ? 'done' : 'pending'

  // 角色
  const charList = characters.value || []
  const charDone = charList.length > 0 && charList.every(c => hasAssetImage(c))
  const charGen = charactersGenerating.value || generatingCharIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.CHAR_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_CHARACTERS)
  const charStatus = charGen ? 'generating' : charDone ? 'done' : charList.length > 0 ? 'partial' : 'pending'

  // 道具
  const propList = props.value || []
  const propDone = propList.length > 0 && propList.every(p => hasAssetImage(p))
  const propGen = propsExtracting.value || generatingPropIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.PROP_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_PROPS)
  const propStatus = propGen ? 'generating' : propDone ? 'done' : propList.length > 0 ? 'partial' : 'pending'

  // 场景
  const sceneList = scenes.value || []
  const sceneDone = sceneList.length > 0 && sceneList.every(s => hasAssetImage(s))
  const sceneGen = scenesExtracting.value || generatingSceneIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SCENE_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_SCENES)
  const sceneStatus = sceneGen ? 'generating' : sceneDone ? 'done' : sceneList.length > 0 ? 'partial' : 'pending'

  // 分镜脚本
  const sbList = storyboards.value || []
  const sbScriptDone = sbList.length > 0
  const sbScriptGen = storyboardGenerating.value || universalOmniPolishRunning.value
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORYBOARD)
  const sbScriptStatus = sbScriptGen ? 'generating' : sbScriptDone ? 'done' : 'pending'

  // 分镜图
  const sbImgDone = sbList.length > 0 && sbList.every(sb => hasSbImage(sb))
  const sbImgGen = generatingSbImageIds.size > 0 || batchImageRunning.value || epRunning.some((t) =>
    t.resourceType === GEN_RESOURCE.SB_IMAGE
    || t.resourceType === GEN_RESOURCE.SB_FIRST_IMAGE
    || t.resourceType === GEN_RESOURCE.SB_LAST_IMAGE
  )
  const sbImgStatus = sbImgGen ? 'generating' : sbImgDone ? 'done' : sbList.length > 0 ? 'partial' : 'pending'

  // 成片合成：分镜视频齐备只是前置条件，只有整集视频存在才算完成。
  const sbVideoAllDone = sbList.length > 0 && sbList.every(sb => getSbAllVideos(sb.id).length > 0)
  const sbVideoSome = sbList.some(sb => getSbAllVideos(sb.id).length > 0)
  const sbVideoGen = batchVideoRunning.value || generatingSbVideoIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SB_VIDEO)
  const compositeStatus = videoStatus.value === 'generating'
    ? 'generating'
    : currentEpisodeVideoUrl.value
      ? 'done'
      : (sbVideoGen || sbVideoAllDone || sbVideoSome) ? 'partial' : 'pending'

  return [
    { key: 'script',   label: '故事剧本',   anchor: 'anchor-script',     status: scriptStatus,    count: hasScript ? 1 : 0 },
    { key: 'chars',    label: '角色',        anchor: 'anchor-characters', status: charStatus,      count: charList.length },
    { key: 'props',    label: '道具',        anchor: 'anchor-props',      status: propStatus,      count: propList.length },
    { key: 'scenes',   label: '场景',        anchor: 'anchor-scenes',     status: sceneStatus,     count: sceneList.length },
    { key: 'sb',       label: '分镜脚本',   anchor: 'anchor-storyboard', status: sbScriptStatus,  count: sbList.length },
    { key: 'sbimg',    label: '分镜图',      anchor: 'anchor-storyboard-images', status: sbImgStatus, count: sbList.length },
    { key: 'video',    label: '交付与导出', anchor: 'anchor-video',      status: compositeStatus, count: 0 },
  ]
})

/** 聚合所有当前正在运行的任务，用于悬浮任务面板（含跨剧跨集） */
const allActiveTaskItems = computed(() => {
  const items = []
  const seen = new Set()
  function addItem(item) {
    const id = item.id || item.label
    if (!id || seen.has(id)) return
    seen.add(id)
    items.push(item)
  }
  for (const t of genStore.getAllRunningTasks()) {
    addItem({
      id: `gen:${t.key || t.taskId || t.label}`,
      label: t.label || '任务进行中...',
      kind: 'genStore',
      task: t,
    })
  }
  if (pipelineRunning.value) {
    const step = pipelineCurrentStep.value
    addItem({
      id: 'pipeline',
      label: pipelineStopping.value
        ? '正在停止全流程...'
        : pipelineAbortRequested.value
          ? '全流程停止未完成，点击重试'
          : (step ? step.replace(/^\[步骤 \d+\/\d+\] /, '') : '一键全流程运行中...'),
      kind: 'pipeline',
    })
  }
  if (isStoryGenRunning.value && !genStore.getAllRunningTasks().some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)) {
    addItem({ id: 'story-gen-local', label: '生成剧本...', kind: 'storyGenLocal' })
  }
  if (universalOmniPolishRunning.value) {
    const p = universalOmniPolishProgress.value
    addItem({
      id: 'universal-omni-polish',
      label: `润色全能分镜 ${p.current}/${p.total}${p.label ? ' ' + p.label : ''}`,
      kind: 'universalOmniPolish',
    })
  }
  if (batchImageRunning.value) {
    addItem({ id: 'batch-image', label: '批量生成分镜图...', kind: 'batchImage' })
  }
  if (batchVideoRunning.value) {
    const p = batchVideoProgress.value
    const suffix = p?.total ? ` ${p.current}/${p.total}` : ''
    addItem({ id: 'batch-video', label: `批量生成分镜视频${suffix}...`, kind: 'batchVideo' })
  }
  return items
})

const allActiveTaskLabels = computed(() => allActiveTaskItems.value.map((t) => t.label))

async function cancelActiveTask(item) {
  if (!item) return
  try {
    if (item.kind === 'genStore' && item.task) {
      await genStore.cancelTask(item.task)
      ElMessage.success('任务已取消')
      return
    }
    if (item.kind === 'pipeline') {
      await cancelPipelineRun()
      return
    }
    if (item.kind === 'storyGenLocal') {
      storyGenerating.value = false
      scriptGenerating.value = false
      const storyTask = genStore.getAllRunningTasks().find((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)
      if (storyTask) await genStore.cancelTask(storyTask)
      ElMessage.success('已取消剧本生成')
      return
    }
    if (item.kind === 'universalOmniPolish') {
      universalOmniPolishAbort.value = true
      ElMessage.success('正在停止润色...')
      return
    }
    if (item.kind === 'batchImage') {
      batchImageStopping.value = true
      ElMessage.info('正在停止批量生图...')
      return
    }
    if (item.kind === 'batchVideo') {
      batchVideoStopping.value = true
      ElMessage.info('正在停止批量生视频...')
      return
    }
  } catch (e) {
    ElMessage.error(e?.message || '取消失败')
  }
}
const sbCharacterIds = ref({})  // sbId -> number[] 多选角色
const sbPropIds = ref({})       // sbId -> number[] 多选物品
const sbSceneId = ref({})
const sbDialogue = ref({})
const sbNarration = ref({})
const sbShotType = ref({})
/** 视频提示词组成（可编辑），key 为分镜 id */
const sbTitle = ref({})
const sbLocation = ref({})
const sbTime = ref({})
const sbDuration = ref({})
const sbAction = ref({})
const sbResult = ref({})
const sbAtmosphere = ref({})
const sbAngle = ref({})
const sbAngleH = ref({})   // 结构化视角：水平方向
const sbAngleV = ref({})   // 结构化视角：俯仰角度
const sbAngleS = ref({})   // 结构化视角：景别
const sbMovement = ref({})
const sbLighting = ref({})   // 灯光风格
const sbDof = ref({})        // 景深
const sbLayoutDescription = ref({})  // 空间布局与人物站位描述（生成分镜时 AI 输出的最高优先级合同，用于首尾帧强制一致）
const regeneratingLayoutSbIds = reactive(new Set())  // 正在 AI 重新生成布局描述的分镜 id 集合
/** 分镜创作模式：classic | universal（默认 classic，存库 storyboards.creation_mode） */
const sbCreationMode = ref({})
/** 全能模式片段描述（存库 universal_segment_text，与经典参考图字段独立） */
const sbUniversalSegmentText = ref({})
const sbVideoReferenceImageId = ref({})
const {
  sbImages,
  sbVideos,
  storyboardMediaLoadState,
  storyboardMediaLoadError,
  storyboardMediaStateController,
  storyboardMediaActionReason,
  currentStoryboardMediaContext,
  resetStoryboardMediaContext,
  ensureStoryboardMediaContext,
  assertStoryboardMediaReady,
  currentEpisodeStoryboardIds,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  loadStoryboardMedia,
  loadSingleStoryboardMedia,
} = useFilmCreateStoryboardMedia({
  dramaId,
  currentEpisodeId,
  getStoryboards: () => store.storyboards || [],
  imagesAPI,
  videosAPI,
  onSelectionsRestored: () => restoreSelectionsFromBackend(),
})
const sbVideoErrors = ref({})

function captureDramaRefresh(expectedContext = currentStoryboardMediaContext()) {
  const capturedContext = { ...expectedContext }
  return () => loadDrama({ expectedContext: capturedContext })
}
const generatingSbImageIds = reactive(new Set())
const generatingSbVideoIds = reactive(new Set())
const generatingUniversalSegmentIds = reactive(new Set())
// 重新生成角色/场景/道具关联分镜图的 loading set，key: 'char-{id}' | 'scene-{id}' | 'prop-{id}'
const regenSbImagesForAsset = reactive(new Set())
const regenSbImagesProgress = ref({})
// 批量生成分镜图
const batchImageRunning = ref(false)
const batchImageStopping = ref(false)
const batchImageProgress = ref({ current: 0, total: 0, failed: 0 })
const inferringParams = ref(false)
const showVideoParamsDialog = ref(false)
const videoParamsTarget = ref(null)
const videoParamsSaving = ref(false)
const savingSbReferenceImages = reactive(new Set())
const splitByAudioLoading = ref(false)
const batchImageErrors = ref([])
// 批量生成分镜视频
const batchVideoRunning = ref(false)
const batchVideoStopping = ref(false)
const batchVideoProgress = ref({ current: 0, total: 0, failed: 0 })
const batchVideoErrors = ref([])
const projectActionDisabledReason = computed(() => projectResourceDisabledReason({
  hasProject: Boolean(dramaId.value),
}))
const episodeActionDisabledReason = computed(() => episodeResourceDisabledReason({
  hasEpisode: Boolean(currentEpisodeId.value),
}))
const characterGenerationDisabledReason = computed(() => projectResourceDisabledReason({
  hasProject: Boolean(dramaId.value),
  running: charactersGenerating.value,
  label: '角色',
}))
const propsExtractionDisabledReason = computed(() => episodeResourceDisabledReason({
  hasEpisode: Boolean(currentEpisodeId.value),
  running: propsExtracting.value,
  label: '道具',
}))
const scenesExtractionDisabledReason = computed(() => episodeResourceDisabledReason({
  hasEpisode: Boolean(currentEpisodeId.value),
  running: scenesExtracting.value,
  label: '场景',
}))
const pipelineActionDisabledReason = computed(() => pipelineDisabledReason({
  hasEpisode: Boolean(currentEpisodeId.value),
  pipelineRunning: pipelineRunning.value,
}))
const productionPipelineActionDisabledReason = computed(() => (
  pipelineActionDisabledReason.value
  || storyboardMediaActionReason.value
  || productionReadinessReason.value
))
const storyboardActionDisabledReason = computed(() => storyboardDisabledReason({
  hasEpisode: Boolean(currentEpisodeId.value),
  storyboardGenerating: storyboardGenerating.value,
  omniPolishing: universalOmniPolishRunning.value,
}))
const batchActionDisabledReason = computed(() => (
  storyboardMediaActionReason.value || batchGenerationDisabledReason({
    hasEpisode: Boolean(currentEpisodeId.value),
    pipelineRunning: pipelineRunning.value,
    storyboardGenerating: storyboardGenerating.value,
    omniPolishing: universalOmniPolishRunning.value,
    batchImageRunning: batchImageRunning.value,
    batchVideoRunning: batchVideoRunning.value,
  })
))
const batchVideoActionDisabledReason = computed(() => (
  batchActionDisabledReason.value || videoCapabilityReason.value
))
const playableStoryboardVideoCount = computed(() => (
  storyboards.value.filter((storyboard) => Boolean(assetVideoUrl(getSbVideo(storyboard.id)))).length
))
const composeActionDisabledReason = computed(() => composeVideoDisabledReason({
  hasEpisode: Boolean(currentEpisodeId.value),
  storyboardCount: storyboards.value.length,
  playableVideoCount: playableStoryboardVideoCount.value,
  videoGenerating: videoStatus.value === 'generating',
  pipelineRunning: pipelineRunning.value,
  storyboardGenerating: storyboardGenerating.value,
  omniPolishing: universalOmniPolishRunning.value,
  batchImageRunning: batchImageRunning.value,
  batchVideoRunning: batchVideoRunning.value,
}))
// P0-1: 连贯帧模式
const videoFrameContiguity = ref(false)
// P0-3: 分镜超分辨率 loading set
const upscalingSbIds = reactive(new Set())
// P2-4: TTS 状态
const ttsSbIds = reactive(new Set())
const ttsSbNarrationIds = reactive(new Set())
function ttsGenerationDisabledReason(storyboardId, kind = 'dialogue') {
  const running = kind === 'narration'
    ? ttsSbNarrationIds.has(storyboardId)
    : ttsSbIds.has(storyboardId)
  if (running) return '正在生成配音，请等待完成'
  return ttsCapabilityReason.value
}
// 尾帧衔接 loading 状态
const linkingTailFrameIds = reactive(new Set())
// “上镜尾帧”（将上一分镜尾帧图片直接设为当前首帧）loading 状态
const usingPrevTailAsFirstIds = reactive(new Set())
/** 对白 TTS 路径缓存（与 storyboards.audio_local_path 一致） */
const sbDialogueAudioPaths = ref({})
/** 解说旁白 TTS 路径缓存（与 storyboards.narration_audio_local_path 一致） */
const sbNarrationAudioPaths = ref({})
/** 分镜 TTS 试听：避免多条同时播放 */
/** 正在编辑视频提示词的分镜 id；编辑中显示文本框与保存/取消 */
const editingSbVideoPromptId = ref(null)
const editingSbVideoPromptText = ref('')
/** 正在编辑图片提示词的分镜 id（行内编辑，保留供内部 onSaveSbImagePrompt 使用） */
const editingSbImagePromptId = ref(null)
const editingSbImagePromptText = ref('')
/** 分镜提示词弹窗 */
const showSbPromptDialog = ref(false)
const sbPromptTarget = ref(null)
const sbPromptImageText = ref('')       // 原始 image_prompt
const sbPromptPolishedText = ref('')    // AI 优化后 polished_prompt
const sbPromptVideoText = ref('')       // video_prompt
const sbPromptSaving = ref(false)
const sbPromptPolishing = ref(false)
/** 首尾帧提示词编辑器 */
const showFramePromptEditor = ref(false)
const editingFramePromptSb = ref(null)
const editingFramePromptSlot = ref('first') // 'first' | 'last'
const editingFramePromptText = ref('')
const editingFramePromptSaving = ref(false)
const editingFramePromptRegenerating = ref(false)
const uploadingSbImageId = ref(null)
const sbImageFileInput = ref(null)
const sbImageUploadForId = ref(null)
// 角色/道具/场景 上传图片
const resourceImageFileInput = ref(null)
const resourceUploadType = ref(null) // 'character' | 'prop' | 'scene'
const resourceUploadId = ref(null)
const uploadingResourceId = ref(null) // 'char-1' | 'prop-2' | 'scene-3'
const dragOverResourceKey = ref(null) // 'char-1' | 'prop-2' | 'scene-3'
const dragOverSbId = ref(null)
// 公共库弹窗状态已移至各 composable
const storyboardCount = ref(null) // 分镜数量
const videoDuration = ref(null) // 视频总长度
/** 分镜生成时是否要求 AI 输出 narration（解说旁白） */
const storyboardIncludeNarration = ref(false)
/** 分镜生成是否使用全能模式（universal_segment_text，对接 Seedance / 可灵 Omni） */
const storyboardUniversalOmni = ref(false)
const storyboardUseFirstLastFrame = ref(false)
const exportingStoryboardSheet = ref(false)
/** 生成尾帧时是否注入首帧作站位/构图参考（默认开启） */
const lastFrameUseFirstLayoutLock = ref(true)
const gridMode = ref('single') // 序列图模式：single / quad_grid / nine_grid

// ── 剧本长度 → 估算总时长；自动分镜数与项目「每段秒数」(videoClipDuration) 对齐 ──

/** 用于估算的每段时长（秒），与一键成片处「X秒/段」一致 */
function clipSecondsForStoryboardEstimate() {
  return resolveClipSeconds(videoClipDuration.value)
}

function shotCountEstimateFromDurationSec(sec) {
  return resolveShotCountEstimate(sec, clipSecondsForStoryboardEstimate())
}

const scriptStoryboardEstimate = computed(() => (
  buildScriptStoryboardEstimate(scriptContent.value, clipSecondsForStoryboardEstimate())
))

const scriptEstimateVideoDurationHint = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  return `（约 ${e.sec}s）`
})

const scriptEstimateVideoDurationTitle = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  return `按当前剧本文本约 ${e.len} 个字符（含标点；常见汉字在浏览器里一字一算，并非按 UTF-8 字节翻倍）、短剧公式 round(10+(字符/600)×60) 粗估总时长约 ${e.sec} 秒；未填输入框时该值会作为约束传给生成接口。仅供参考`
})

const scriptEstimateStoryboardHint = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  if (e.range && e.range.min !== e.range.max) {
    return `（约 ${e.locked} 镜，参考 ${e.range.min}–${e.range.max}）`
  }
  return `（约 ${e.locked} 镜）`
})

const scriptEstimateStoryboardTitle = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  return `按估算时长 ${e.sec}s ÷ 项目「每段 ${e.clip} 秒」四舍五入粗估约 ${e.locked} 镜；旁注区间为 ±1 镜供参考。切换「X秒/段」会同步改变本估算。`
})

function scriptTextTrimmedForEstimate() {
  return (scriptContent.value || '').toString().trim()
}

function userFilledStoryboardCount() {
  const v = storyboardCount.value
  return v != null && Number.isFinite(Number(v)) && Number(v) >= 1
}

function userFilledVideoDuration() {
  const v = videoDuration.value
  return v != null && Number.isFinite(Number(v)) && Number(v) >= 10
}

/** 请求后端的视频总时长：仅未手动填时传剧本估算 */
function getVideoDurationForApi() {
  if (userFilledVideoDuration()) return Math.round(Number(videoDuration.value))
  const len = scriptTextTrimmedForEstimate().length
  if (len < 1) return undefined
  return estimateVideoDurationSecFromCharLen(len) ?? undefined
}

/** 请求后端的分镜数量：仅未手动填时按「估算总时长 ÷ 每段秒数」推算，与项目 X秒/段 一致 */
function getStoryboardCountForApi() {
  if (userFilledStoryboardCount()) return Math.round(Number(storyboardCount.value))
  const sec = getVideoDurationForApi()
  if (sec == null || !Number.isFinite(sec)) return undefined
  return shotCountEstimateFromDurationSec(sec).locked
}

function getFirstImageFile(dataTransfer) {
  if (!dataTransfer?.files?.length) return null
  const file = Array.from(dataTransfer.files).find((f) => f.type.startsWith('image/'))
  return file || null
}

// ── 参考图文件读取工具 ──────────────────────────────────
function readFileAsRefImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve({ dataUrl: ev.target.result, filename: file.name })
    reader.readAsDataURL(file)
  })
}

/**
 * 处理角色/道具/场景参考图文件选择（<input type="file"> change 事件）
 * type: 'character' | 'prop' | 'scene'
 */
async function onRefImageFileChange(type, event) {
  const file = event.target?.files?.[0]
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'character') addCharRefImage.value = result
  else if (type === 'prop') addPropRefImage.value = result
  else if (type === 'scene') addSceneRefImage.value = result
  event.target.value = ''
}

/**
 * 处理角色/道具/场景参考图拖放（drop 事件）
 * type: 'character' | 'prop' | 'scene'
 */
async function onRefImageDrop(type, event) {
  const file = getFirstImageFile(event.dataTransfer)
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'character') addCharRefImage.value = result
  else if (type === 'prop') addPropRefImage.value = result
  else if (type === 'scene') addSceneRefImage.value = result
}

/**
 * 处理"添加道具"简单弹窗的参考图文件选择
 * type: 'addProp'
 */
async function onRefImageFileChange2(type, event) {
  const file = event.target?.files?.[0]
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'addProp') addPropAddRefImage.value = result
  event.target.value = ''
}

/**
 * 处理"添加道具"简单弹窗的参考图拖放
 * type: 'addProp'
 */
async function onRefImageDrop2(type, event) {
  const file = getFirstImageFile(event.dataTransfer)
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'addProp') addPropAddRefImage.value = result
}

/**
 * 从本地选择（尚未保存到服务器）的参考图中提取特征描述
 * type: 'character' | 'prop' | 'scene'
 */
async function doExtractFromRef(type) {
  if (type === 'character') {
    const refImage = addCharRefImage.value
    if (!refImage) return
    extractingCharAppearance.value = true
    try {
      const name = editCharacterForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('character', refImage.dataUrl, name)
      if (res?.description && editCharacterForm.value) {
        editCharacterForm.value.appearance = res.description
        ElMessage.success('已从参考图提取外貌描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingCharAppearance.value = false
    }
  } else if (type === 'prop') {
    const refImage = addPropRefImage.value
    if (!refImage) return
    extractingPropDesc.value = true
    try {
      const name = editPropForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('prop', refImage.dataUrl, name)
      if (res?.description && editPropForm.value) {
        editPropForm.value.description = res.description
        ElMessage.success('已从参考图提取特征描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingPropDesc.value = false
    }
  } else if (type === 'scene') {
    const refImage = addSceneRefImage.value
    if (!refImage) return
    extractingSceneDesc.value = true
    try {
      const name = editSceneForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('scene', refImage.dataUrl, name)
      if (res?.description && editSceneForm.value) {
        editSceneForm.value.description = res.description
        ElMessage.success('已从参考图提取场景描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingSceneDesc.value = false
    }
  }
}

function onResourceDragOver(e, type, id) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  const key = type === 'character' ? 'char-' : type === 'prop' ? 'prop-' : 'scene-'
  dragOverResourceKey.value = key + id
}
function onResourceDragLeave(e, key) {
  e.preventDefault()
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
  if (key && dragOverResourceKey.value !== key) return
  dragOverResourceKey.value = null
}
function onResourceDrop(e, type, id) {
  e.preventDefault()
  e.stopPropagation()
  dragOverResourceKey.value = null
  const file = getFirstImageFile(e.dataTransfer)
  if (file) doUploadResourceImage(type, id, file)
}
function onSbImageDragOver(e, sbId) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOverSbId.value = sbId
}
function onSbImageDragLeave(e, sbId) {
  e.preventDefault()
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
  if (sbId != null && dragOverSbId.value !== sbId) return
  dragOverSbId.value = null
}
function onSbImageDrop(e, sb) {
  e.preventDefault()
  e.stopPropagation()
  dragOverSbId.value = null
  const file = getFirstImageFile(e.dataTransfer)
  if (file && sb?.id) doUploadSbImage(sb.id, file)
}

const baseUrl = ref('')
const previewImageUrl = ref(null)
let previewImageRequestId = 0
function imageUrl(url) {
  if (!url) return ''
  if (url.startsWith('http')) return url
  const base = (baseUrl.value || '').replace(/\/$/, '')
  return base ? base + '/' + url.replace(/^\//, '') : url
}
/** 优先使用本地地址，避免远程图失效。item 为 { image_url, local_path } 或字符串 url */
function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') return isPlaceholderMediaUrl(item) ? '' : imageUrl(item)
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath && !isPlaceholderMediaUrl(localPath)) {
    const p = localPath.replace(/^\//, '')
    return '/static/' + p
  }
  if (item.image_url && !isPlaceholderMediaUrl(item.image_url)) return imageUrl(item.image_url)
  return ''
}
function hasAssetImage(item) {
  if (!item) return false
  return hasRealMediaValue(item.image_url) || hasRealMediaValue(item.local_path)
}
function getSelectedStyle() {
  return getSelectedStylePrompt()
}
async function openImagePreview(url) {
  const source = String(url || '').trim()
  if (!source || isPlaceholderMediaUrl(source)) {
    ElMessage.info('这是草稿占位图，尚无可预览的真实图片。')
    return
  }
  const requestId = ++previewImageRequestId
  const renderable = await probeImageSource(source)
  if (requestId !== previewImageRequestId) return
  if (!renderable) {
    ElMessage.warning('图片无法加载，请检查文件是否仍存在或重新生成。')
    return
  }
  previewImageUrl.value = source
}
function closeImagePreview() {
  previewImageRequestId += 1
  previewImageUrl.value = null
}
/** 视频地址：优先 local_path（/static/），否则 video_url */
function assetVideoUrl(item) {
  if (!item) return ''
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath && !isPlaceholderMediaUrl(localPath)) return '/static/' + localPath.replace(/^\//, '')
  if (item.video_url && !isPlaceholderMediaUrl(item.video_url)) return imageUrl(item.video_url)
  return ''
}
/** 远程视频须为 http(s)，避免上游 FAILURE 时把错误文案写入 video_url */
function isHttpVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}
/** 列表项是否具备可播放地址（避免仅有空白 local_path 时外层有卡片、内层无 <video>） */
function recordHasPlayableVideoUrl(i) {
  if (!i) return false
  const lp = i.local_path && String(i.local_path).trim()
  if (lp && !isPlaceholderMediaUrl(lp)) return true
  return isHttpVideoUrl(i.video_url)
}
/** 主播放器强制随记录/地址重建，避免重新生成后 <video> 仍缓存旧 src */
function sbMainVideoPlayerKey(sbId) {
  const v = getSbVideo(sbId)
  if (!v) return ''
  const src = assetVideoUrl(v)
  return `${v.id}:${v.updated_at || ''}:${src.slice(0, 160)}`
}
function onStoryboardUseFirstLastFrameChange() {
  if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
    gridMode.value = 'single'
    ElMessage.info('首尾帧模式已开启，序列图已切换为单张')
  }
  saveProjectSettings(false)
}

function uploadingSbImageSlot(sbId) {
  return sbImageUploadSlotById.value[sbId] || null
}

function frameTypeForSlot(slot) {
  return slot === 'last' ? 'storyboard_last' : 'storyboard_first'
}

function resolveSbImageById(storyboardId, imageId) {
  if (imageId == null) return null
  const images = getSbAllImages(storyboardId)
  return images.find((i) => i.id === imageId) || null
}

/** 首帧图（首尾帧模式下严格优先服务器绑定的 first_frame_image_id） */
function getSbFirstImage(storyboardId) {
  const images = getSbAllImages(storyboardId)
  const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

  // 最高权威：服务器已绑定的首帧
  if (sb?.first_frame_image_id != null) {
    const bound = resolveSbImageById(storyboardId, sb.first_frame_image_id)
    if (bound) return bound
  }

  const sel = sbSelectedImgId.value[storyboardId]
  if (sel != null) {
    const found = images.find((i) => i.id === sel)
    if (found) return found
  }

  const typed = images.find((i) => i.frame_type === 'storyboard_first')
  if (typed) return typed
  // 不再回退到 images[0]，避免把尾帧图片误显示为首帧
  return null
}

/** 尾帧图（首尾帧模式下严格优先服务器绑定的 last_frame_image_id） */
function getSbLastImage(storyboardId) {
  const images = getSbAllImages(storyboardId)
  const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

  // 最高权威：服务器已绑定的尾帧（后端 bindStoryboardFrameImage 正确写入的 last_frame_image_id）
  if (sb?.last_frame_image_id != null) {
    const bound = resolveSbImageById(storyboardId, sb.last_frame_image_id)
    if (bound) return bound
  }

  // 仅在没有服务器绑定时才考虑手动选择（首尾帧生成后我们会主动清除手动选择）
  const sel = sbSelectedLastImgId.value[storyboardId]
  if (sel != null) {
    const found = images.find((i) => i.id === sel)
    if (found) return found
  }

  const typed = images.find((i) => i.frame_type === 'storyboard_last')
  if (typed) return typed

  if (hasRealMediaValue(sb?.last_frame_image_url) || hasRealMediaValue(sb?.last_frame_local_path)) {
    return {
      id: sb.last_frame_image_id,
      image_url: sb.last_frame_image_url,
      local_path: sb.last_frame_local_path,
      frame_type: 'storyboard_last',
    }
  }
  return null
}

/** 该分镜是否有图（接口拉取的或 composed_image） */
function hasSbImage(sb) {
  if (storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)) {
    return !!(
      getSbFirstImage(sb.id)
      || hasRealMediaValue(sb?.composed_image)
      || hasRealMediaValue(sb?.image_url)
      || hasRealMediaValue(sb?.local_path)
    )
  }
  return !!(
    getSbImage(sb.id)
    || hasRealMediaValue(sb?.composed_image)
    || hasRealMediaValue(sb?.image_url)
    || hasRealMediaValue(sb?.local_path)
  )
}

function hasSbFirstLastPair(sb) {
  return !!(getSbFirstImage(sb.id) && getSbLastImage(sb.id))
}
/** 取该分镜下所有已完成的非四宫格图片列表 */
function getSbAllImages(storyboardId) {
  return getSbImagesList(sbImages.value, storyboardId)
}
function hasSbDraftImagePlaceholder(sb) {
  const directValues = [sb?.image_url, sb?.local_path, sb?.composed_image]
  if (directValues.some((value) => isPlaceholderMediaUrl(value))) return true
  const records = sbImages.value[sb?.id]
  return Array.isArray(records) && records.some((record) => (
    isPlaceholderMediaUrl(record?.image_url) || isPlaceholderMediaUrl(record?.local_path)
  ))
}
/** 取当前主图（首尾帧模式下等同首帧） */
function getSbImage(storyboardId) {
  if (storyboardUseFirstLastFrame.value) return getSbFirstImage(storyboardId)
  const images = getSbAllImages(storyboardId)
  if (!images.length) return null
  const selectedId = sbSelectedImgId.value[storyboardId]
  if (selectedId != null) {
    const found = images.find((i) => i.id === selectedId)
    if (found) return found
  }
  return images[0]
}
/** 取该分镜下的四宫格整图记录 */
/** 取该分镜下的四宫格整图记录 */
function getQuadGridImage(storyboardId) {
  const list = sbImages.value[storyboardId]
  if (!Array.isArray(list)) return null
  return list.find((i) => (
    i.status === 'completed'
    && (i.frame_type === 'quad_grid' || i.frame_type === 'nine_grid')
    && (hasRealMediaValue(i.image_url) || hasRealMediaValue(i.local_path))
  )) || null
}
/** 取该分镜所有已完成的视频记录 */
function getSbAllVideos(storyboardId) {
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
}
/** 取该分镜当前选中的视频（尊重 sbSelectedVideoId，否则默认第一条） */
function getSbVideo(storyboardId) {
  const all = getSbAllVideos(storyboardId)
  if (all.length === 0) return null
  const selectedId = sbSelectedVideoId.value[storyboardId]
  if (selectedId != null) {
    const found = all.find((v) => v.id === selectedId)
    if (found) return found
  }
  return all[0]
}
/** 取下一个分镜（按 storyboard_number 顺序） */
function getNextStoryboard(storyboardId) {
  const list = store.storyboards || []
  const idx = list.findIndex((s) => s.id === storyboardId)
  if (idx === -1 || idx === list.length - 1) return null
  return list[idx + 1]
}

/** 取上一个分镜（按 storyboard_number 顺序，用于“上镜尾帧”快速衔接） */
function getPrevStoryboard(storyboardId) {
  const list = store.storyboards || []
  const idx = list.findIndex((s) => s.id === storyboardId)
  if (idx === -1 || idx === 0) return null
  return list[idx - 1]
}

/** 辅助判断：当前分镜是否有“上一镜尾帧”可用于快速替换首帧 */
function canUsePrevTailAsFirst(sb) {
  const p = getPrevStoryboard(sb?.id)
  return !!(p && getSbLastImage(p.id))
}

/** 视频历史条：返回非当前选中的已完成视频列表 */
function getVideoStripItems(storyboardId) {
  const all = getSbAllVideos(storyboardId)
  const current = getSbVideo(storyboardId)
  return all
    .filter((v) => !current || v.id !== current.id)
    .map((v, idx) => ({
      key: `vid-${v.id}`,
      video: v,
      src: assetVideoUrl(v),
      label: `历史${idx + 2}`,
    }))
}
/** 选中某条历史视频为当前视频，并持久化到分镜记录供合成视频使用 */
function onSelectSbMainVideo(sb, video) {
  sbSelectedVideoId.value = { ...sbSelectedVideoId.value, [sb.id]: video.id }
  storyboardsAPI.update(sb.id, {
    video_url: video.video_url || null,
    video_local_path: video.local_path || null,
  }).catch(e => console.warn('[主视频] 保存后端失败', e))
}
/** 取该分镜最近一次视频生成的错误信息（从 API 返回的记录或本地即时错误） */
function getSbVideoError(storyboardId) {
  if (sbVideoErrors.value[storyboardId]) {
    return userFacingVideoGenerationError(sbVideoErrors.value[storyboardId])
  }
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list) || list.length === 0) return ''
  const hasCompleted = list.some((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
  if (hasCompleted) return ''
  const bogusCompleted = list.find(
    (i) => i.status === 'completed' && i.video_url && !recordHasPlayableVideoUrl(i)
  )
  if (bogusCompleted) {
    const u = String(bogusCompleted.video_url || '').trim()
    if (u) return userFacingVideoGenerationError(u)
    if (bogusCompleted.error_msg) return userFacingVideoGenerationError(bogusCompleted.error_msg)
  }
  const failed = list.filter((i) => i.status === 'failed' && i.error_msg)
  if (failed.length === 0) return ''
  return userFacingVideoGenerationError(failed[0].error_msg)
}

function getGeneratingSetsBag() {
  return {
    generatingCharIds,
    generatingPropIds,
    generatingSceneIds,
    generatingSbImageIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    generatingSbVideoIds,
  }
}

function buildSbGenMeta(sb, resourceType, labelPrefix) {
  const num = sb?.storyboard_number ?? sb?.id
  const epNum = store.currentEpisode?.episode_number
  const dramaTitle = store.drama?.title || ''
  const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
  return {
    dramaId: dramaId.value,
    episodeId: currentEpisodeId.value,
    dramaTitle,
    episodeNumber: epNum,
    resourceType,
    resourceId: sb.id,
    label: `${epLabel} ${labelPrefix} #${num}`,
  }
}

/** 分镜视频是否正在生成（单条点击、批量、一键成片、任务恢复均覆盖） */
function isSbVideoGenerating(sbId) {
  if (generatingSbVideoIds.has(sbId)) return true
  if (sbId == null || dramaId.value == null || currentEpisodeId.value == null) return false
  return genStore.isRunning({
    dramaId: dramaId.value,
    episodeId: currentEpisodeId.value,
    resourceType: GEN_RESOURCE.SB_VIDEO,
    resourceId: sbId,
  })
}

async function recoverAndSyncEpisodeTasks(epId) {
  const did = dramaId.value
  const eid = epId ?? currentEpisodeId.value
  if (!did || !eid) return
  const ctx = buildEpisodeContext(store, did, eid)
  const mediaContext = currentStoryboardMediaContext(did, eid)
  await genStore.recoverPendingForEpisode({
    ...ctx,
    ElMessage,
    callbacks: {
      onStoryboardMedia: (sbId) => loadSingleStoryboardMedia(sbId, mediaContext),
      onDramaRefresh: captureDramaRefresh(mediaContext),
      onEpisodeMergeComplete: () => {
        store.setVideoStatus('done', did, eid)
        store.setVideoProgress(100, did, eid)
      },
      onEpisodeMergeFailed: (err) => {
        store.setVideoStatus('error', did, eid)
        videoErrorMsg.value = err || '视频生成失败'
      },
    },
  })
  syncGeneratingSetsFromStore(genStore, did, eid, getGeneratingSetsBag())
  const mergeRunning = genStore.getRunningForEpisode(did, eid).some(
    (t) => t.resourceType === GEN_RESOURCE.EPISODE_MERGE
  )
  if (mergeRunning) {
    store.setVideoStatus('generating', did, eid)
  }
}

// ── 主图选择 ─────────────────────────────────────────────────────────

const sbSelectedImgId = ref({})   // sbId → 选中的首帧/主图 image_generation.id
const sbSelectedLastImgId = ref({}) // sbId → 选中的尾帧 image_generation.id
const sbSelectedVideoId = ref({}) // sbId → 选中的 video_generation.id
const generatingSbFirstImageIds = reactive(new Set())
const generatingSbLastImageIds = reactive(new Set())
/** sbId → 'first' | 'last'，上传目标槽位 */
const sbImageUploadSlotById = ref({})

/**
 * 从后端 storyboard.image_url / local_path 恢复主图选择状态。
 * 与 image_generation 记录比对，找到匹配的记录并恢复 sbSelectedImgId。
 */
function restoreSelectionsFromBackend() {
  const boards = store.storyboards || []
  for (const sb of boards) {
    const images = getSbAllImages(sb.id)
    if (sbSelectedImgId.value[sb.id] == null) {
      if (sb.first_frame_image_id != null) {
        sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: sb.first_frame_image_id }
      } else {
        const sbPath = (sb.local_path || '').trim()
        const sbUrl = (sb.image_url || '').trim()
        if (sbPath || sbUrl) {
          const matched = images.find(
            (img) =>
              (sbPath && img.local_path && img.local_path === sbPath) ||
              (sbUrl && img.image_url && img.image_url === sbUrl)
          )
          if (matched) {
            sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: matched.id }
          }
        }
      }
    }
    if (sbSelectedLastImgId.value[sb.id] == null && sb.last_frame_image_id != null) {
      sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: sb.last_frame_image_id }
    }
  }
}

/** 获取缩略图条数据：已绑定首尾帧以外的历史图 */
function getStripItems(storyboardId) {
  const allImgs = getSbAllImages(storyboardId)
  const firstImg = storyboardUseFirstLastFrame.value ? getSbFirstImage(storyboardId) : getSbImage(storyboardId)
  const lastImg = storyboardUseFirstLastFrame.value ? getSbLastImage(storyboardId) : null
  const boundIds = new Set([firstImg?.id, lastImg?.id].filter((x) => x != null))
  return allImgs
    .filter((img) => !boundIds.has(img.id))
    .map((img) => ({
      key: `img-${img.id}`,
      src: assetImageUrl(img),
      type: 'img',
      img,
      label: quadPanelLabel(img.frame_type),
      frameBadge: img.frame_type === 'storyboard_first' ? '首' : img.frame_type === 'storyboard_last' ? '尾' : null,
      prompt: img.prompt || '',
    }))
}

function historyImageLabel(sb, storyboardIndex, item, historyIndex) {
  const storyboardNumber = sb?.storyboard_number || storyboardIndex + 1
  const panelLabel = item?.label ? `${item.label}` : ''
  return `分镜${storyboardNumber}${panelLabel}历史图${historyIndex + 1}`
}

function stripItemTitle(sbId, item, accessibleLabel = '') {
  const lines = [accessibleLabel, item.label, item.prompt].filter(Boolean)
  if (storyboardUseFirstLastFrame.value) {
    lines.unshift('点击：设为首帧或尾帧')
  } else {
    lines.unshift('点击设为主图')
  }
  return lines.join('\n\n')
}

async function onStripItemClick(sb, item) {
  if (!storyboardUseFirstLastFrame.value) {
    onSelectStripItem(sb, item)
    return
  }
  try {
    await ElMessageBox.confirm('将此图绑定到哪个槽位？', '设置参考帧', {
      confirmButtonText: '设为首帧',
      cancelButtonText: '设为尾帧',
      distinguishCancelAndClose: true,
      type: 'info',
    })
    onSelectSbFrameImage(sb, item.img, 'first')
    ElMessage.success('已设为首帧')
  } catch (action) {
    if (action === 'cancel') {
      onSelectSbFrameImage(sb, item.img, 'last')
      ElMessage.success('已设为尾帧')
    }
  }
}

/** 宫格子图位置标签 */
function quadPanelLabel(frameType) {
  const map = {
    quad_panel_0: '左上', quad_panel_1: '右上', quad_panel_2: '左下', quad_panel_3: '右下',
    nine_panel_0: '左上', nine_panel_1: '中上', nine_panel_2: '右上',
    nine_panel_3: '左中', nine_panel_4: '中间', nine_panel_5: '右中',
    nine_panel_6: '左下', nine_panel_7: '中下', nine_panel_8: '右下',
  }
  return map[frameType] || null
}

/** 点击缩略图条中的图片切换为主图 */
function onSelectStripItem(sb, item) {
  onSelectSbMainImage(sb, item.img)
}

/** 选定首帧或尾帧参考图（持久化到后端） */
function onSelectSbFrameImage(sb, img, slot) {
  if (!sb?.id || !img) return
  const isLast = slot === 'last'

  // 本地选中状态（用于部分回退逻辑）
  if (isLast) {
    sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: img.id }
  } else {
    sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: img.id }
  }

  // 关键：乐观更新 store 里分镜的权威绑定字段（storyboards 数组是 getSbFirst/LastImage 的主要数据源）
  // 这样点击后立即生效，无需刷新页面；getStripItems 也会立即把这张图从历史条里过滤掉
  const list = store.currentEpisode?.storyboards
  if (Array.isArray(list)) {
    const row = list.find((x) => Number(x.id) === Number(sb.id))
    if (row) {
      const now = new Date().toISOString()
      if (isLast) {
        row.last_frame_image_id = img.id
        row.last_frame_image_url = img.image_url || null
        row.last_frame_local_path = img.local_path || null
      } else {
        row.first_frame_image_id = img.id
        row.image_url = img.image_url || null
        row.local_path = img.local_path || null
      }
      row.updated_at = now
    }
  }

  // 发送到后端持久化（静默，调用方按需提示）
  const patch = { updated_at: new Date().toISOString() }
  if (isLast) {
    patch.last_frame_image_id = img.id
    patch.last_frame_image_url = img.image_url || null
    patch.last_frame_local_path = img.local_path || undefined
  } else {
    patch.image_url = img.image_url || null
    patch.local_path = img.local_path || undefined
    patch.first_frame_image_id = img.id
  }

  storyboardsAPI.update(sb.id, patch).catch((e) => console.warn('[参考帧] 保存失败', e))
}

/** 选定某张 API 图为主图（持久化到后端） */
function onSelectSbMainImage(sb, img) {
  onSelectSbFrameImage(sb, img, 'first')
}

/** 删除分镜历史参考图（strip 中的未绑定历史图，类似资源 extra 图的移除） */
async function onRemoveSbHistoryImage(storyboardId, imageGenId) {
  if (!storyboardId || !imageGenId) return
  try {
    await ElMessageBox.confirm('确定删除这张历史参考图？此操作不可恢复。', '删除历史图', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      distinguishCancelAndClose: true,
    })
    await imagesAPI.delete(imageGenId)
    await refreshStoryboardMediaForCurrentContext(storyboardId)
    ElMessage.success('历史图已删除')
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(err?.message || '删除失败')
    }
  }
}

const {
  buildFirstFrameImagePrompt,
  buildLastFrameImagePrompt,
  getCachedFramePromptFromDb,
  ensureProfessionalFramePrompt,
  openFramePromptEditor,
  showSbFramePromptPreview,
  saveEditingFramePrompt,
  regenerateEditingFramePrompt,
  onGenerateSbFrameImage,
  onGenerateSbFramePair,
  onGenerateSbImage,
} = useFilmCreateStoryboardImageGeneration({
  dramaId,
  store,
  storyboardsAPI,
  imagesAPI,
  genStore,
  pollTask,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  restoreSelectionsFromBackend,
  loadDrama,
  getSelectedStyle,
  getSelectedStylePrompt,
  getSelectedStylePromptZh,
  angleToPromptFragment: (...args) => angleToPromptFragment(...args),
  frameTypeForSlot,
  getSbFirstImage,
  buildSbGenMeta,
  assertStoryboardMediaReady,
  storyboardMediaActionReason,
  projectAspectRatio,
  gridMode,
  storyboardUseFirstLastFrame,
  lastFrameUseFirstLayoutLock,
  sbLocation,
  sbTime,
  sbShotType,
  sbAngleH,
  sbAngleV,
  sbAngleS,
  sbResult,
  sbAction,
  sbAtmosphere,
  sbCharacterIds,
  sbSelectedImgId,
  sbSelectedLastImgId,
  generatingSbImageIds,
  generatingSbFirstImageIds,
  generatingSbLastImageIds,
  showFramePromptEditor,
  editingFramePromptSb,
  editingFramePromptSlot,
  editingFramePromptText,
  editingFramePromptSaving,
  editingFramePromptRegenerating,
})

const {
  onUploadSbImageClick,
  doUploadSbImage,
  onSbImageFileChange,
} = useFilmCreateStoryboardUpload({
  dramaId,
  store,
  uploadAPI,
  imagesAPI,
  storyboardUseFirstLastFrame,
  sbImageUploadForId,
  sbImageUploadSlotById,
  uploadingSbImageId,
  sbSelectedImgId,
  frameTypeForSlot,
  onSelectSbFrameImage,
  refreshStoryboardMediaForCurrentContext,
  restoreSelectionsFromBackend,
})

function syncStoryboardStateFromEpisode(ep) {
  const boards = ep?.storyboards || []
  const nextCharIds = {}
  const nextPropIds = {}
  const nextScene = {}
  const nextDialogue = {}
  const nextNarration = {}
  const nextShot = {}
  const nextTitle = {}
  const nextLocation = {}
  const nextTime = {}
  const nextDuration = {}
  const nextAction = {}
  const nextResult = {}
  const nextAtmosphere = {}
  const nextAngle = {}
  const nextAngleH = {}
  const nextAngleV = {}
  const nextAngleS = {}
  const nextMovement = {}
  const nextLighting = {}
  const nextDof = {}
  const nextLayoutDescription = {}
  const nextCreationMode = {}
  const nextUniversalSegment = {}
  const nextVideoReferenceImageId = {}
  for (const sb of boards) {
    nextScene[sb.id] = sb.scene_id ?? null
    nextDialogue[sb.id] = sb.dialogue ?? ''
    nextNarration[sb.id] = sb.narration ?? ''
    nextShot[sb.id] = (sb.shot_type ?? '').toString() || ''
    nextTitle[sb.id] = (sb.title ?? '').toString()
    nextLocation[sb.id] = (sb.location ?? '').toString()
    nextTime[sb.id] = (sb.time ?? '').toString()
    nextDuration[sb.id] = sb.duration != null ? Number(sb.duration) : 5
    nextAction[sb.id] = (sb.action ?? '').toString()
    nextResult[sb.id] = (sb.result ?? '').toString()
    nextAtmosphere[sb.id] = (sb.atmosphere ?? '').toString()
    nextAngle[sb.id] = (sb.angle ?? '').toString()
    nextAngleH[sb.id] = sb.angle_h || ''
    nextAngleV[sb.id] = sb.angle_v || ''
    nextAngleS[sb.id] = sb.angle_s || ''
    nextMovement[sb.id] = (sb.movement ?? '').toString()
    nextLighting[sb.id] = sb.lighting_style || ''
    nextDof[sb.id] = sb.depth_of_field || ''
    nextLayoutDescription[sb.id] = (sb.layout_description ?? '').toString()
    const charList = Array.isArray(sb.characters) ? sb.characters : (sb.characters != null ? [sb.characters] : [])
    nextCharIds[sb.id] = charList.map((c) => (typeof c === 'object' && c != null ? Number(c.id) : Number(c))).filter((n) => Number.isFinite(n))
    nextPropIds[sb.id] = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
    nextCreationMode[sb.id] = sb.creation_mode === 'universal' ? 'universal' : 'classic'
    nextUniversalSegment[sb.id] = (sb.universal_segment_text ?? '').toString()
    nextVideoReferenceImageId[sb.id] = sb.video_reference_image_id ? Number(sb.video_reference_image_id) : ''
  }
  sbCharacterIds.value = nextCharIds
  sbPropIds.value = nextPropIds
  sbSceneId.value = nextScene
  sbDialogue.value = nextDialogue
  sbNarration.value = nextNarration
  sbShotType.value = nextShot
  sbTitle.value = nextTitle
  sbLocation.value = nextLocation
  sbTime.value = nextTime
  sbDuration.value = nextDuration
  sbAction.value = nextAction
  sbResult.value = nextResult
  sbAtmosphere.value = nextAtmosphere
  sbAngle.value = nextAngle
  sbAngleH.value = nextAngleH
  sbAngleV.value = nextAngleV
  sbAngleS.value = nextAngleS
  sbMovement.value = nextMovement
  sbLighting.value = nextLighting
  sbDof.value = nextDof
  sbLayoutDescription.value = nextLayoutDescription
  sbCreationMode.value = nextCreationMode
  sbUniversalSegmentText.value = nextUniversalSegment
  sbVideoReferenceImageId.value = nextVideoReferenceImageId
}
function getSbGridImages(storyboardId) {
  const list = sbImages.value[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((image) => (
    image.status === 'completed' &&
    (image.frame_type === 'quad_grid' || image.frame_type === 'nine_grid') &&
    (hasRealMediaValue(image.image_url) || hasRealMediaValue(image.local_path))
  ))
}

function getSbVideoReferenceGrid(sb) {
  if (!sb?.id) return null
  const selectedId = Number(sbVideoReferenceImageId.value[sb.id] || sb.video_reference_image_id)
  if (!Number.isFinite(selectedId) || selectedId <= 0) return null
  return getSbGridImages(sb.id).find((image) => Number(image.id) === selectedId) || null
}

async function onEpisodeSelect(epId) {
  try {
    const result = await episodeSwitchController.select(epId)
    if (!result.changed) syncEpisodeRouteQuery(selectedEpisodeId.value)
    return result
  } catch (_) {
    syncEpisodeRouteQuery(selectedEpisodeId.value)
    ElMessage.error('当前剧本保存失败，未切换剧集，请重试。')
    return { changed: false, episode: store.currentEpisode || null, reason: 'save_failed' }
  }
}

function applySelectedEpisode(ep) {
  resetStoryboardMediaContext(dramaId.value, ep?.id ?? null)
  if (!ep) {
    store.setCurrentEpisode(null)
    store.setScriptContent('')
    scriptTitle.value = ''
    selectedEpisodeId.value = null
    syncStoryboardStateFromEpisode(null)
    markScriptDraftSaved()
    return
  }
  store.setCurrentEpisode(ep)
  store.setScriptContent(ep.script_content || '')
  scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
  selectedEpisodeId.value = ep.id
  syncStoryboardStateFromEpisode(ep)
  markScriptDraftSaved()
}

function friendlyFilmProjectLoadError(error) {
  const status = Number(error?.status || error?.response?.status)
  if (status === 404) return '该项目不存在，或已移入回收站。'
  if (status >= 500) return '本地服务暂时不可用，请稍后重试。'
  return '无法连接本地服务，请确认服务已经启动后重试。'
}

async function refreshProjectDependencies(episodeId, { includeProjectCapabilities = false } = {}) {
  const dependencyRequestId = ++projectDependencyRequestId
  projectDependencyLoading.value = true
  projectDependencyWarning.value = ''
  const dependencyJobs = [
    loadStoryboardMedia(),
    recoverAndSyncEpisodeTasks(episodeId),
  ]
  if (includeProjectCapabilities) {
    dependencyJobs.push(
      loadPipelineConcurrency(),
      refreshVideoGenerationCapability(),
      refreshProductionReadiness(),
    )
  }
  const [mediaResult, taskResult] = await Promise.allSettled(dependencyJobs)
  if (dependencyRequestId !== projectDependencyRequestId) return false

  const mediaFailed = mediaResult.status === 'rejected' || mediaResult.value?.failedCount > 0
  const warnings = []
  if (taskResult.status === 'rejected') warnings.push('生成任务状态暂时无法同步')
  projectDependencyWarning.value = warnings.length
    ? `${warnings.join('；')}。项目已正常打开，可重试加载素材。`
    : ''
  projectDependencyLoading.value = false
  return !mediaFailed && warnings.length === 0
}

async function retryProjectDependencies() {
  if (projectLoadState.value !== 'ready') return
  await refreshProjectDependencies(currentEpisodeId.value, { includeProjectCapabilities: true })
}

const coreDramaAPI = projectLifecycle.guardApi({
  get(id) {
    return requestCoreJson(`/dramas/${encodeURIComponent(id)}`)
  },
  saveOutline(id, data) {
    return requestCoreJson(`/dramas/${encodeURIComponent(id)}/outline`, { method: 'PUT', body: data })
  },
})

async function loadDrama({
  blocking = projectLoadState.value !== 'ready',
  expectedContext,
} = {}) {
  if (expectedContext && !storyboardMediaStateController.isCurrentContext(expectedContext)) {
    return { stale: true }
  }
  const requestedDramaId = Number(store.dramaId)
  if (!Number.isFinite(requestedDramaId) || requestedDramaId <= 0) return false
  const requestId = ++projectLoadRequestId
  projectLoadPending.value = true
  projectLoadError.value = ''
  projectLoadNotFound.value = false
  projectDependencyWarning.value = ''
  if (blocking) projectLoadState.value = 'loading'
  try {
    let d = await coreDramaAPI.get(requestedDramaId)
    d = await backfillDramaStylePromptMetadataIfNeeded(coreDramaAPI, requestedDramaId, d)
    if (
      requestId !== projectLoadRequestId
      || (expectedContext && !storyboardMediaStateController.isCurrentContext(expectedContext))
    ) return { stale: true }
    store.setDrama(d)
    // 项目描述仅用于项目说明；生成草稿独立存储，不能隐式触发生成语义。
    storyInput.value = (d.metadata?.story_generation_draft || '').toString().trim()
    storyStyle.value = (d.metadata && d.metadata.story_style) ? d.metadata.story_style : ''
    storyType.value = d.genre || ''
    generationStyle.value = d.style || ''
    projectAspectRatio.value = (d.metadata && d.metadata.aspect_ratio) ? d.metadata.aspect_ratio : '16:9'
    videoClipDuration.value = (d.metadata && d.metadata.video_clip_duration) ? Number(d.metadata.video_clip_duration) : 5
    storyboardIncludeNarration.value = !!(d.metadata && d.metadata.storyboard_include_narration)
    storyboardUniversalOmni.value = !!(d.metadata && d.metadata.storyboard_universal_omni)
    storyboardUseFirstLastFrame.value = !!(d.metadata && d.metadata.storyboard_use_first_last_frame)
    lastFrameUseFirstLayoutLock.value = d.metadata?.last_frame_use_first_layout_lock !== false
    if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
      gridMode.value = 'single'
    }
    const list = d.episodes || []
    // 优先保持当前选中的集（按 id 在最新列表中查找），避免 AI 生成角色等操作后误切到其他集
    const currentId = selectedEpisodeId.value
    let ep = currentId != null ? list.find((e) => Number(e.id) === Number(currentId)) : null
    if (!ep) {
      const wantNum = savedCurrentEpisodeNumber.value
      ep = list.find((e) => Number(e.episode_number) === Number(wantNum)) || list[0] || null
    }
    store.setCurrentEpisode(ep)
    if (ep) {
      store.setScriptContent(ep.script_content || '')
      scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
      selectedEpisodeId.value = ep.id
    } else {
      store.setScriptContent('')
      scriptTitle.value = ''
      selectedEpisodeId.value = null
    }
    ensureStoryboardMediaContext(requestedDramaId, ep?.id ?? null)
    markScriptDraftSaved()
    syncStoryboardStateFromEpisode(ep)
    projectLoadState.value = 'ready'
    projectLoadNotFound.value = false
    await refreshProjectDependencies(ep?.id, { includeProjectCapabilities: true })
    return true
  } catch (e) {
    if (requestId !== projectLoadRequestId) return false
    scriptDraftController.dispose()
    store.reset()
    store.setDrama({ id: requestedDramaId })
    projectLoadNotFound.value = Number(e?.status || e?.response?.status) === 404
    projectLoadError.value = friendlyFilmProjectLoadError(e)
    projectLoadState.value = 'error'
    projectDependencyWarning.value = ''
    await nextTick()
    projectLoadFailureRef.value?.focus()
    return false
  } finally {
    if (requestId === projectLoadRequestId) projectLoadPending.value = false
  }
}

async function retryFilmProjectLoad() {
  await loadDrama({ blocking: true })
}

const EMPTY_ARR = []
/** 当前分镜已选角色 id 列表（供 el-select 绑定） */
function getSbCharacterIds(sbId) {
  const arr = sbCharacterIds.value[sbId]
  return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
}

/** 运镜值的简短中文标签（用于分镜控制栏显示） */
function getMovementLabel(m) {
  if (!m) return ''
  const map = {
    static: '固定',
    push: '推镜',
    pull: '拉镜',
    pan: '横摇',
    tilt: '纵摇',
    tracking: '跟镜',
    crane_up: '升镜',
    crane_dn: '降镜',
    orbit: '环绕',
    handheld: '手持',
    zoom: '变焦',
    roll: '旋转',
    whip_pan: '甩镜',
    spiral: '螺旋',
    hitchcock_zoom: '希区柯克',
    bullet_time: '子弹时间',
    dutch_angle_move: '荷兰角',
    dolly_track: '推轨',
    slowmo_orbit: '升格环绕',
    'slow push in': '缓慢推镜',
    'static hold': '固定镜头'
  }
  return map[m] || m
}

function setSbCharacterIds(sbId, v) {
  const next = Array.isArray(v) ? v : []
  sbCharacterIds.value = { ...sbCharacterIds.value, [sbId]: next }
  onStoryboardCharacterChange(sbId)
}

/** 当前分镜尚未勾选的角色（供缩略图旁「+」下拉添加） */
function charactersAvailableToAddToSb(sbId) {
  const all = characters.value ?? []
  const cur = new Set((getSbCharacterIds(sbId) || []).map((x) => Number(x)))
  return all.filter((c) => c && !cur.has(Number(c.id)))
}

function onSbAddCharacterCommand(sbId, charId) {
  const id = Number(charId)
  if (!Number.isFinite(id)) return
  const cur = [...(getSbCharacterIds(sbId) || [])]
  if (cur.some((x) => Number(x) === id)) return
  cur.push(id)
  setSbCharacterIds(sbId, cur)
}

/** 当前分镜已选物品 id 列表 */
function getSbPropIds(sbId) {
  const arr = sbPropIds.value[sbId]
  return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
}

function setSbPropIds(sbId, v) {
  sbPropIds.value = { ...sbPropIds.value, [sbId]: Array.isArray(v) ? v : [] }
  onStoryboardPropChange(sbId)
}

function onStoryboardPropChange(sbId) {
  const ids = sbPropIds.value[sbId] || []
  storyboardsAPI.update(sbId, { prop_ids: ids }).catch(() => {})
}

/** 当前分镜选中的场景对象（用于下方缩略图） */
function getSbSelectedScene(sbId) {
  const sceneId = sbSceneId.value[sbId]
  if (sceneId == null) return null
  const list = scenes.value ?? []
  return list.find((s) => Number(s.id) === Number(sceneId)) || null
}

/** 当前分镜选中的角色对象列表（用于下方缩略图） */
function getSbSelectedCharacters(sbId) {
  const ids = getSbCharacterIds(sbId)
  if (!ids.length) return []
  const list = characters.value ?? []
  return ids.map((id) => list.find((c) => Number(c.id) === Number(id))).filter(Boolean)
}

/** 当前分镜选中的物品对象列表（用于下方缩略图） */
function getSbSelectedProps(sbId) {
  const ids = getSbPropIds(sbId)
  if (!ids.length) return []
  const list = props.value ?? []
  return ids.map((id) => list.find((p) => Number(p.id) === Number(id))).filter(Boolean)
}

async function onStoryboardCharacterChange(sbId) {
  const ids = sbCharacterIds.value[sbId] || []
  try {
    await storyboardsAPI.update(sbId, { character_ids: ids })
    // 首/尾帧提示词保留（含用户手动保存版）；图生时后端会按当前勾选做 sanitize
  } catch (e) {
    console.warn('[分镜] 保存角色失败', e)
  }
}

function onLastFrameLayoutLockChange() {
  saveProjectSettings()
}

function onStoryboardSceneChange(sbId) {
  const sceneId = sbSceneId.value[sbId] ?? null
  storyboardsAPI.update(sbId, { scene_id: sceneId }).catch(() => {})
}

/** 同镜号多行时只保留 id 最大的一条（与后端 dedupe 一致，避免「影响的分镜」重复 #N） */
function dedupeStoryboardsForAssetLink(list) {
  const byNum = new Map()
  const extras = []
  for (const sb of list || []) {
    const n = Number(sb?.storyboard_number)
    if (Number.isFinite(n) && n > 0) {
      const prev = byNum.get(n)
      if (!prev || Number(sb.id) > Number(prev.id)) byNum.set(n, sb)
    } else {
      extras.push(sb)
    }
  }
  return [...byNum.values(), ...extras].sort(
    (a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0)
  )
}

/** 返回包含指定角色的所有分镜（已排序） */
function getCharAffectedStoryboards(charId) {
  const matched = (storyboards.value || []).filter((sb) => {
    if (!sb.characters) return false
    const chars = Array.isArray(sb.characters) ? sb.characters : []
    return chars.some((c) => Number(typeof c === 'object' && c != null ? c.id : c) === Number(charId))
  })
  return dedupeStoryboardsForAssetLink(matched)
}

/** 返回指定场景关联的所有分镜 */
function getSceneAffectedStoryboards(sceneId) {
  const matched = (storyboards.value || []).filter(
    (sb) => sb.scene_id != null && Number(sb.scene_id) === Number(sceneId)
  )
  return dedupeStoryboardsForAssetLink(matched)
}

/** 返回包含指定道具的所有分镜（已排序） */
function getPropAffectedStoryboards(propId) {
  const matched = (storyboards.value || []).filter((sb) => {
    if (!sb.prop_ids) return false
    const pids = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
    return pids.some((pid) => Number(pid) === Number(propId))
  })
  return dedupeStoryboardsForAssetLink(matched)
}

/** 点击分镜 chip → 滚动到对应分镜行 */
function scrollToStoryboard(sbId) {
  const el = document.getElementById('sb-' + sbId)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const {
  onRegenAffectedSbImages,
} = useFilmCreateLinkedStoryboardRegen({
  dramaId,
  imagesAPI,
  taskAPI,
  assertStoryboardMediaReady,
  captureStoryboardMediaRefresh,
  storyboardUseFirstLastFrame,
  isSbUniversalMode,
  ensureProfessionalFramePrompt,
  getSelectedStyle,
  projectAspectRatio,
  regenSbImagesForAsset,
  regenSbImagesProgress,
  sbSelectedImgId,
})

function updateStoryboardDialogue(sbId) {
  // 可在此防抖后调用后端更新 dialogue
}

const {
  saveScriptToBackend,
  saveProjectSettings,
  onGenerateStory,
} = useFilmCreateScriptPersistence({
  store,
  dramaAPI,
  router,
  route,
  scriptTitle,
  storyType,
  generationStyle,
  storyStyle,
  storyInput,
  projectAspectRatio,
  videoClipDuration,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  storyboardUseFirstLastFrame,
  lastFrameUseFirstLayoutLock,
  projectStylePromptMetadata,
  loadDrama,
  savedCurrentEpisodeNumber,
  selectedEpisodeId,
  onEpisodeSelect,
  storyGenerating,
  scriptGenerating,
  pollTask,
  trackFilmCreateAction,
  storyEpisodeCount,
})

const {
  openSelectScriptDialog,
  returnToScriptCreation,
  returnToCharacterPanel,
  loadSelectScriptList,
  onPickScriptFromDialog,
  novelImportReset,
  onNovelFileChange,
  onImportNovel,
  onGenerateScript,
  onAddEpisode,
} = useFilmCreateScriptWorkspace({
  store,
  dramaAPI,
  router,
  route,
  loadDrama,
  scrollToAnchor,
  saveScriptToBackend,
  flushScriptDraft,
  markScriptDraftSaved,
  trackFilmCreateAction,
  scriptTitle,
  scriptContent,
  scriptGenerating,
  savedCurrentEpisodeNumber,
  selectedEpisodeId,
  selectPreviewEpisodeId,
  showSelectScriptDialog,
  scriptWorkbenchMode,
  showCharLibrary,
  resourcePanelCollapsed,
  charactersBlockCollapsed,
  selectScriptLoading,
  selectScriptDramas,
  selectScriptImporting,
  novelText,
  novelFileName,
  novelFileContent,
  novelImportMode,
  novelImporting,
  novelMaxChapters,
  novelAiSummarize,
  showNovelImport,
})

const {
  onUploadResourceClick,
  parseExtraImages,
  localPathToUrl,
  findResource,
  doUploadResourceImage,
  onSetPrimaryImage,
  onRemoveExtraImage,
  onResourceImageFileChange,
} = useFilmCreateResourceUpload({
  dramaId,
  store,
  uploadAPI,
  characterAPI,
  propAPI,
  sceneAPI,
  loadDrama,
  resourceUploadType,
  resourceUploadId,
  resourceImageFileInput,
  uploadingResourceId,
})

function getSbFirstFrameUrl(sb) {
  const img = storyboardUseFirstLastFrame.value ? getSbFirstImage(sb.id) : getSbImage(sb.id)
  if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
  return storyboardImageUrl(sb)
}

function getSbLastFrameUrl(sb) {
  const img = getSbLastImage(sb.id)
  if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
  if (hasRealMediaValue(sb.last_frame_image_url) || hasRealMediaValue(sb.last_frame_local_path)) {
    return assetImageUrl({ image_url: sb.last_frame_image_url, local_path: sb.last_frame_local_path })
  }
  return ''
}

/** 经典模式视频：首帧 URL（连贯帧可覆盖首帧）+ 可选尾帧 */
function sbVideoFirstLastUrls(sb, universal, contiguityFirstFrameUrl) {
  let first =
    contiguityFirstFrameUrl ||
    (universal ? '' : toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || ''))
  if (!first && !universal) {
    first = toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || '')
  }
  let last = undefined
  if (storyboardUseFirstLastFrame.value && !universal) {
    const lu = getSbLastFrameUrl(sb)
    if (lu) last = toAbsoluteImageUrl(lu)
  }
  return { first: first || undefined, last }
}

/** 获取分镜主图的本地路径（用于超分辨率判断） */
function getSbLocalImage(sb) {
  const img = getSbImage(sb.id)
  return img?.local_path || sb.local_path || null
}

/**
 * P0-1: 从视频 URL 捕获末帧（浏览器 canvas 方案）
 * 返回 Blob（JPEG），失败返回 null
 */
async function captureVideoLastFrame(videoUrl) {
  return new Promise((resolve) => {
    if (!videoUrl) return resolve(null)
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'
    let captured = false
    const timeout = setTimeout(() => { if (!captured) resolve(null) }, 12000)
    video.addEventListener('error', () => { clearTimeout(timeout); if (!captured) resolve(null) })
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.max(0, video.duration - 0.5)
    })
    video.addEventListener('seeked', () => {
      if (captured) return
      captured = true
      clearTimeout(timeout)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 512
        canvas.height = video.videoHeight || 288
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
      } catch (_) {
        resolve(null)
      }
    })
    video.src = videoUrl
  })
}

/** P0-3: 对分镜图执行超分辨率（2x） */
async function onUpscaleSbImage(sb) {
  if (!sb?.id || upscalingSbIds.has(sb.id)) return
  upscalingSbIds.add(sb.id)
  try {
    await storyboardsAPI.upscale(sb.id)
    ElMessage.success('超分完成，图片已更新为高清版本')
    await refreshStoryboardMediaForCurrentContext(sb.id)
  } catch (e) {
    ElMessage.error(e.message || '超分辨率失败')
  } finally {
    upscalingSbIds.delete(sb.id)
  }
}

const {
  normalizeAudioRelPath,
  sbDialogueAudioRelPath,
  sbNarrationAudioRelPath,
  playSbTtsFromRel,
  playSbDialogueTts,
  playSbNarrationTts,
  onTtsSbDialogue,
  onTtsSbNarration,
} = useFilmCreateStoryboardTts({
  ttsSbIds,
  ttsSbNarrationIds,
  sbDialogueAudioPaths,
  sbNarrationAudioPaths,
  sbNarration,
  ttsGenerationDisabledReason,
  projectLifecycle,
})

function formatSrtTimestamp(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const z = Math.floor(ms % 1000)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`
}

/** 导出当前集分镜表（每镜一行；首尾帧模式含首/尾帧专用提示词） */
async function onExportStoryboardSheet() {
  const boards = storyboards.value || []
  if (!boards.length) {
    ElMessage.warning('暂无分镜')
    return
  }
  const epNum = store.currentEpisode?.episode_number
  const dramaTitle = (store.drama?.title || 'project').replace(/[\\/:*?"<>|]/g, '_')
  const epLabel = epNum != null ? `第${epNum}集` : `ep${currentEpisodeId.value || '1'}`
  const filenameBase = `${dramaTitle}-${epLabel}-分镜表`
  const useFirstLast = !!storyboardUseFirstLastFrame.value

  exportingStoryboardSheet.value = true
  const framePromptBySbId = {}
  try {
    await Promise.all(
      boards.map(async (sb) => {
        try {
          const res = await storyboardsAPI.getFramePrompts(sb.id)
          const fps = res?.frame_prompts || []
          framePromptBySbId[sb.id] = {
            first: fps.find((r) => r.frame_type === 'first')?.prompt?.trim() || '',
            last: fps.find((r) => r.frame_type === 'last')?.prompt?.trim() || '',
          }
        } catch (_) {
          framePromptBySbId[sb.id] = { first: '', last: '' }
        }
      })
    )
  } finally {
    exportingStoryboardSheet.value = false
  }

  function resolveFirstFramePrompt(sbId) {
    const cached = framePromptBySbId[sbId]?.first
    if (cached) return cached
    const imgPrompt = getSbFirstImage(sbId)?.prompt?.trim()
    if (imgPrompt) return imgPrompt
    if (useFirstLast) return buildFirstFrameImagePrompt(sbId)
    return ''
  }

  function resolveLastFramePrompt(sbId) {
    const cached = framePromptBySbId[sbId]?.last
    if (cached) return cached
    const imgPrompt = getSbLastImage(sbId)?.prompt?.trim()
    if (imgPrompt) return imgPrompt
    if (useFirstLast) return buildLastFrameImagePrompt(sbId)
    return ''
  }

  const result = exportStoryboardSheet(
    {
      storyboards: boards,
      getScene: (sbId) => getSbSelectedScene(sbId),
      getCharacters: (sbId) => getSbSelectedCharacters(sbId),
      getProps: (sbId) => getSbSelectedProps(sbId),
      getMovementLabel,
      getFirstFramePrompt: resolveFirstFramePrompt,
      getLastFramePrompt: resolveLastFramePrompt,
      getField(sb, key) {
        const id = sb.id
        const map = {
          title: sbTitle.value[id],
          location: sbLocation.value[id],
          time: sbTime.value[id],
          duration: sbDuration.value[id] ?? sb.duration,
          dialogue: sbDialogue.value[id],
          narration: sbNarration.value[id],
          action: sbAction.value[id],
          result: sbResult.value[id],
          atmosphere: sbAtmosphere.value[id],
          shot_type: sbShotType.value[id],
          movement: sbMovement.value[id],
          layout_description: sbLayoutDescription.value[id],
          universal_segment_text: sbUniversalSegmentText.value[id],
        }
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          const v = map[key]
          return v != null && v !== '' ? v : sb[key]
        }
        return sb[key]
      },
    },
    filenameBase
  )

  if (!result.ok) {
    ElMessage.warning('当前分镜没有可导出的内容')
    return
  }
  ElMessage.success(`已导出分镜表（${result.count} 个镜头）`)
}

function onExportNarrationSrt() {
  const boards = storyboards.value || []
  if (!boards.length) {
    ElMessage.warning('暂无分镜')
    return
  }
  let tMs = 0
  const lines = []
  let idx = 1
  for (const sb of boards) {
    const durSec = Number(sbDuration.value[sb.id] ?? sb.duration)
    const sec = Number.isFinite(durSec) && durSec > 0 ? durSec : 5
    const durMs = Math.round(sec * 1000)
    const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
    if (text) {
      const start = formatSrtTimestamp(tMs)
      const end = formatSrtTimestamp(tMs + durMs)
      lines.push(String(idx++), `${start} --> ${end}`, text, '')
    }
    tMs += durMs
  }
  if (!lines.length) {
    ElMessage.warning('当前分镜没有可导出的解说文案')
    return
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `narration-${currentEpisodeId.value || 'episode'}.srt`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已下载解说 SRT')
}

async function onSaveSbNarrationField(sb) {
  if (!sb?.id) return
  const next = (sbNarration.value[sb.id] || '').toString().trim()
  const prev = (sb.narration || '').toString().trim()
  if (next === prev) return
  try {
    await storyboardsAPI.update(sb.id, { narration: next || null })
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.narration = next || null
    }
  } catch (_) { /* 静默失败，避免打断输入 */ }
}

function isSbUniversalMode(sbId) {
  return sbCreationMode.value[sbId] === 'universal'
}

function setSbCreationModeId(sbId, mode) {
  if (sbId == null) return
  const m = mode === 'universal' ? 'universal' : 'classic'
  sbCreationMode.value = { ...sbCreationMode.value, [sbId]: m }
}

async function onToggleSbUniversalMode(sb) {
  if (!sb?.id) return
  const cur = isSbUniversalMode(sb.id) ? 'universal' : 'classic'
  const next = cur === 'universal' ? 'classic' : 'universal'
  sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: next }
  try {
    await storyboardsAPI.update(sb.id, { creation_mode: next })
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.creation_mode = next
    }
  } catch (e) {
    sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: cur }
    ElMessage.error(e.message || '保存失败')
  }
}

async function onSaveUniversalSegmentField(sb) {
  if (!sb?.id) return
  const next = (sbUniversalSegmentText.value[sb.id] || '').toString()
  const prev = (sb.universal_segment_text || '').toString()
  if (next === prev) return
  try {
    await storyboardsAPI.update(sb.id, { universal_segment_text: next.trim() || null })
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.universal_segment_text = next.trim() || null
    }
  } catch (_) { /* 静默失败，避免打断输入 */ }
}

function universalSegmentDurationSecForSb(sb) {
  const dUi = Number(sbDuration.value[sb?.id])
  const dRow = Number(sb?.duration)
  const dProj = Number(videoClipDuration.value)
  return Number.isFinite(dUi) && dUi > 0
    ? dUi
    : Number.isFinite(dRow) && dRow > 0
      ? dRow
      : Number.isFinite(dProj) && dProj > 0
        ? dProj
        : 5
}

/** 提交视频 API 时使用的时长：优先本分镜配置，其次项目「每段秒数」 */
function getSbVideoDurationForApi(sb) {
  const perSb = Number(sbDuration.value[sb?.id] ?? sb?.duration)
  if (Number.isFinite(perSb) && perSb > 0) return perSb
  const clip = Number(videoClipDuration.value)
  if (Number.isFinite(clip) && clip > 0) return clip
  return undefined
}

/** 全能提示词生成/润色：提交当前编辑区中的分镜字段（避免未点保存时仍用库内旧对白） */
const {
  buildUniversalSegmentFieldOverrides,
  universalSegmentAtImageToGrokTags,
  onUniversalSegmentToGrokVideoTags,
  onUniversalSegmentPromptMenu,
  onGenerateUniversalSegmentPrompt,
  onPolishUniversalSegmentPromptStream,
  polishUniversalSegmentsAfterGeneration,
} = useFilmCreateUniversalSegment({
  store,
  storyboardsAPI,
  generatingUniversalSegmentIds,
  sbUniversalSegmentText,
  sbUniversalSegmentTrimmed,
  universalSegmentDurationSecForSb,
  isSbUniversalMode,
  storyboardUniversalOmni,
  universalOmniPolishRunning,
  universalOmniPolishAbort,
  universalOmniPolishProgress,
  pipelineRest,
  onSaveUniversalSegmentField,
})

/** 为视频生成获取参考图的真实 URL */
async function getMainImageUrlForVideo(sb) {
  return getSbFirstFrameUrl(sb)
}

/** 转为视频接口可请求的绝对 URL（后端/第三方需能访问） */
function toAbsoluteImageUrl(url) {
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  const base = (baseUrl.value || '').replace(/\/$/, '') || (typeof window !== 'undefined' ? window.location.origin : '')
  return base ? base + (s.startsWith('/') ? s : '/' + s) : s
}

function sbUniversalSegmentTrimmed(sb) {
  if (!sb?.id) return ''
  return (sbUniversalSegmentText.value[sb.id] ?? sb.universal_segment_text ?? '').toString().trim()
}

function sbCanSubmitVideo(sb) {
  if (!sb) return false
  const vp = (sb.video_prompt || '').toString().trim()
  if (vp) return true
  if (isSbUniversalMode(sb.id)) return !!sbUniversalSegmentTrimmed(sb)
  return false
}

function sbVideoGenerationDisabledReason(sb) {
  if (storyboardMediaActionReason.value) return storyboardMediaActionReason.value
  if (isSbVideoGenerating(sb?.id)) return '正在生成分镜视频，请等待完成'
  if (videoCapabilityReason.value) return videoCapabilityReason.value
  if (sbCanSubmitVideo(sb)) return ''
  return isSbUniversalMode(sb?.id)
    ? '请先填写视频提示词或全能片段描述'
    : '请先填写视频提示词'
}

/** 提交给视频 API 的文案：全能模式有片段描述时仅提交该段（不拼接 video_prompt，避免动作/旁白盖过 @图片 等编排） */
function buildSbVideoPromptForApi(sb, { preferClassicPrompt = false } = {}) {
  const vp = (sb.video_prompt || '').toString().trim()
  const seg = sbUniversalSegmentTrimmed(sb)
  if (preferClassicPrompt) return vp || seg
  if (isSbUniversalMode(sb.id)) {
    if (seg) return seg
    return vp
  }
  return vp
}

const {
  currentStoryboardReferenceState,
  findStoryboardRow,
  mergeStoryboardIntoStore,
  getSbFreeReferenceItems,
  getSbPrimaryFreeReferenceItem,
  collectSbFreeReferenceAbsoluteUrls,
  uniqueStoryboardReferenceUrls,
  saveStoryboardReferenceImages,
  openGlobalMediaPicker,
  onGlobalMediaAssetSelected,
  onRemoveSbFreeReferenceImage,
  onPromoteSbFreeReferenceImage,
  currentDramaReferenceEntities,
  getSbUniversalOmniRefSlots,
  collectSbOmniReferenceAbsoluteUrls,
  collectSbSceneOnlyReferenceAbsoluteUrls,
  getSbPrimaryReferenceAbsoluteUrl,
  buildStoryboardVideoReferencePayload,
} = useFilmCreateStoryboardReferences({
  store,
  storyboards,
  storyboardsAPI,
  sbSceneId,
  sbCharacterIds,
  sbPropIds,
  videoParamsTarget,
  toAbsoluteImageUrl,
  assetImageUrl,
  scenes,
  characters,
  props,
  savingSbReferenceImages,
  globalMediaPickerMode,
  globalMediaPickerTarget,
  showGlobalMediaPicker,
  getMainImageUrlForVideo,
  sbVideoFirstLastUrls,
})

let activeVideoAiConfigCache = null
let activeVideoAiConfigCacheAt = 0
const ACTIVE_VIDEO_AI_CONFIG_TTL_MS = 15000
const productionReadinessRequestGuard = createLatestRequestGuard()
const videoCapabilityRequestGuard = createLatestRequestGuard()

function invalidateActiveVideoAiConfigCache() {
  activeVideoAiConfigCache = null
  activeVideoAiConfigCacheAt = 0
}

function getNovel2AnimeReadiness(data) {
  return requestCoreJson('/workflows/novel2anime/readiness', { method: 'POST', body: data })
}

async function refreshProductionReadiness() {
  const requestGeneration = productionReadinessRequestGuard.begin()
  productionReadinessRequestGuard.commit(requestGeneration, () => {
    productionReadinessLoading.value = true
    productionReadinessFailed.value = false
    authoritativeProductionReadiness.value = null
  })
  try {
    const readiness = await getNovel2AnimeReadiness({
      drama_id: dramaId.value,
      qa_mode: 'production',
    })
    productionReadinessRequestGuard.commit(requestGeneration, () => {
      authoritativeProductionReadiness.value = normalizeProductionReadiness(readiness)
    })
  } catch (_) {
    productionReadinessRequestGuard.commit(requestGeneration, () => {
      productionReadinessFailed.value = true
    })
  } finally {
    productionReadinessRequestGuard.commit(requestGeneration, () => {
      productionReadinessLoading.value = false
    })
  }
  return {
    ready: !productionReadinessFailed.value
      && Boolean(authoritativeProductionReadiness.value?.ready),
    reason: productionReadinessReason.value,
  }
}

async function refreshVideoGenerationCapability() {
  const requestGeneration = videoCapabilityRequestGuard.begin()
  videoCapabilityRequestGuard.commit(requestGeneration, () => {
    videoCapabilityLoading.value = true
    videoCapabilityFailed.value = false
  })
  let capability
  try {
    const rows = await requestCoreJson('/ai-configs?service_type=video')
    const normalizedRows = Array.isArray(rows) ? rows : []
    capability = getVideoGenerationCapability(normalizedRows)
    videoCapabilityRequestGuard.commit(requestGeneration, () => {
      videoCapabilityConfigs.value = normalizedRows
      activeVideoAiConfigCache = capability.config
    })
  } catch (_) {
    capability = getVideoGenerationCapability([], { failed: true })
    videoCapabilityRequestGuard.commit(requestGeneration, () => {
      videoCapabilityConfigs.value = []
      videoCapabilityFailed.value = true
      activeVideoAiConfigCache = null
    })
  } finally {
    videoCapabilityRequestGuard.commit(requestGeneration, () => {
      activeVideoAiConfigCacheAt = Date.now()
      videoCapabilityLoading.value = false
    })
  }
  return videoCapabilityRequestGuard.isLatest(requestGeneration)
    ? capability
    : videoGenerationCapability.value
}

async function getActiveVideoAiConfig() {
  const now = Date.now()
  if (now - activeVideoAiConfigCacheAt < ACTIVE_VIDEO_AI_CONFIG_TTL_MS) {
    return activeVideoAiConfigCache
  }
  const capability = await refreshVideoGenerationCapability()
  return capability.config
}

/** 全能分镜 + 当前视频配置是否可走多图参考（火山 Seedance 2.0、可灵 Omni、Agnes Video 等） */
function canUseUniversalOmniVideoApi(cfg) {
  return videoConfigSupportsOmni(cfg)
}

async function confirmUniversalNonSeedance2Video() {
  await ElMessageBox.confirm(
    '你当前视频模型不支持多图参考，全能模式将降级：优先用分镜主图，否则仅传场景参考图。是否继续？',
    '全能模式与模型不匹配',
    { confirmButtonText: '继续', cancelButtonText: '取消', type: 'warning' }
  )
}

const {
  onEditSbImagePrompt,
  onOpenSbPromptDialog,
  formatVideoPromptForEdit,
  onPolishSbPrompt,
  onSaveSbPromptDialog,
  onSaveSbImagePrompt,
  onEditSbVideoPrompt,
  angleToPromptFragment,
  onSaveSbVideoFields,
  onSaveSbVideoPrompt,
  onOpenVideoParamsDialog,
  onVideoParamsDialogClosed,
  countDialogueLinesInSb,
  canSplitSbByAudio,
  onSplitSbByAudio,
  onSaveVideoParams,
  onBatchInferParams,
  onRegenerateLayoutDescription,
} = useFilmCreateStoryboardPrompts({
  currentEpisodeId,
  storyboards,
  storyboardsAPI,
  loadDrama,
  refreshStoryboardsOnly: (...args) => refreshStoryboardsOnly(...args),
  editingSbImagePromptId,
  editingSbImagePromptText,
  sbPromptTarget,
  sbPromptImageText,
  sbPromptPolishedText,
  sbPromptVideoText,
  showSbPromptDialog,
  sbPromptPolishing,
  sbPromptSaving,
  editingSbVideoPromptId,
  editingSbVideoPromptText,
  sbTitle,
  sbLocation,
  sbTime,
  sbDuration,
  sbAction,
  sbDialogue,
  sbNarration,
  sbAtmosphere,
  sbResult,
  sbAngle,
  sbAngleH,
  sbAngleV,
  sbAngleS,
  sbMovement,
  sbLighting,
  sbDof,
  sbShotType,
  sbLayoutDescription,
  sbCreationMode,
  sbUniversalSegmentText,
  sbVideoReferenceImageId,
  regeneratingLayoutSbIds,
  inferringParams,
  videoParamsTarget,
  showVideoParamsDialog,
  videoParamsSaving,
  splitByAudioLoading,
})

const {
  onGenerateSbVideo,
} = useFilmCreateStoryboardVideoGeneration({
  dramaId,
  videosAPI,
  storyboardsAPI,
  genStore,
  pollTask,
  captureStoryboardMediaRefresh,
  sbVideoGenerationDisabledReason,
  isSbUniversalMode,
  sbVideoReferenceImageId,
  getSbVideoReferenceGrid,
  getActiveVideoAiConfig,
  canUseUniversalOmniVideoApi,
  confirmUniversalNonSeedance2Video,
  toAbsoluteImageUrl,
  assetImageUrl,
  collectSbOmniReferenceAbsoluteUrls,
  collectSbSceneOnlyReferenceAbsoluteUrls,
  collectSbFreeReferenceAbsoluteUrls,
  getSbFirstFrameUrl,
  getSbPrimaryReferenceAbsoluteUrl,
  generatingSbVideoIds,
  buildSbGenMeta,
  sbVideoErrors,
  buildStoryboardVideoReferencePayload,
  assertStoryboardMediaReady,
  buildSbVideoPromptForApi,
  getSelectedStyle,
  projectAspectRatio,
  videoResolution,
  getSbVideoDurationForApi,
  sbSelectedVideoId,
  userFacingVideoGenerationError,
})

const {
  onLinkTailFrameToNext,
  onUsePrevTailAsFirst,
} = useFilmCreateTailFrameLink({
  dramaId,
  storyboardsAPI,
  imagesAPI,
  getNextStoryboard,
  getPrevStoryboard,
  getSbVideo,
  getSbLastImage,
  linkingTailFrameIds,
  usingPrevTailAsFirstIds,
  refreshStoryboardMediaForCurrentContext,
  refreshStoryboardsOnly: (...args) => refreshStoryboardsOnly(...args),
  onSelectSbFrameImage,
  sbSelectedImgId,
})

const {
  refreshStoryboardsForEpisode,
  refreshStoryboardsOnly,
  onGenerateStoryboard,
  onAddSingleStoryboard,
  onDeleteSingleStoryboard,
  onInsertStoryboardBefore,
} = useFilmCreateStoryboardCrud({
  currentEpisodeId,
  dramaId,
  store,
  dramaAPI,
  storyboardsAPI,
  genStore,
  pollTask,
  captureDramaRefresh,
  loadDrama,
  getSelectedStyle,
  getStoryboardCountForApi,
  getVideoDurationForApi,
  projectAspectRatio,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  sbTruncatedWarning,
  sbTruncatedDismissed,
  polishUniversalSegmentsAfterGeneration,
  trackFilmCreateAction,
})

const {
  startBatchImageGeneration,
  startBatchVideoGeneration,
} = useFilmCreateBatchGeneration({
  currentEpisodeId,
  dramaId,
  store,
  pipelineRunning,
  pipelineConcurrency,
  pipelineVideoConcurrency,
  storyboardMediaActionReason,
  batchImageRunning,
  batchImageStopping,
  batchImageErrors,
  batchImageProgress,
  batchVideoRunning,
  batchVideoStopping,
  batchVideoErrors,
  batchVideoProgress,
  sbImages,
  sbVideos,
  sbSelectedImgId,
  sbSelectedVideoId,
  gridMode,
  storyboardUseFirstLastFrame,
  videoFrameContiguity,
  projectAspectRatio,
  videoResolution,
  generatingSbVideoIds,
  loadStoryboardMedia,
  hasSbImage,
  isSbUniversalMode,
  ensureProfessionalFramePrompt,
  assertStoryboardMediaReady,
  imagesAPI,
  videosAPI,
  storyboardsAPI,
  uploadAPI,
  pollTask,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  restoreSelectionsFromBackend,
  getSelectedStyle,
  getSbVideoReferenceGrid,
  sbCanSubmitVideo,
  getSbFirstFrameUrl,
  collectSbSceneOnlyReferenceAbsoluteUrls,
  collectSbOmniReferenceAbsoluteUrls,
  getSbPrimaryReferenceAbsoluteUrl,
  toAbsoluteImageUrl,
  assetImageUrl,
  recordHasPlayableVideoUrl,
  buildStoryboardVideoReferencePayload,
  buildSbVideoPromptForApi,
  getSbVideoDurationForApi,
  captureVideoLastFrame,
  buildSbGenMeta,
  refreshVideoGenerationCapability,
  canUseUniversalOmniVideoApi,
})

function getFinalizeMergeOptions() {
  return {
    burn_narration_subtitles: !!videoSubtitle.value,
    burn_dialogue_audio: !!videoBurnDialogue.value,
    watermark_text: videoWatermark.value ? String(videoWatermarkText.value || '').trim().slice(0, 200) : '',
  }
}

async function onGenerateVideo() {
  if (composeActionDisabledReason.value) {
    ElMessage.warning(composeActionDisabledReason.value)
    return
  }
  const epId = currentEpisodeId.value
  const did = dramaId.value
  const dramaTitle = store.drama?.title || ''
  const epNum = store.currentEpisode?.episode_number
  const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
  const mergeMeta = {
    dramaId: did,
    episodeId: epId,
    dramaTitle,
    episodeNumber: epNum,
    resourceType: GEN_RESOURCE.EPISODE_MERGE,
    resourceId: epId,
    label: `${epLabel} 合成视频`,
  }
  store.setVideoStatus('generating', did, epId)
  store.setVideoProgress(5, did, epId)
  genStore.markRunning(mergeMeta)
  videoErrorMsg.value = ''
  try {
    const result = await dramaAPI.finalizeEpisode(epId, getFinalizeMergeOptions())
    if (result?.task_id != null) {
      store.setVideoProgress(10, did, epId)
      ElMessage.success(result?.message || '视频合成任务已提交，请稍后查看')
      const pollResult = await pollTask(result.task_id, captureDramaRefresh(), mergeMeta)
      await loadDrama()
      if (pollResult?.status === 'completed') {
        store.setVideoProgress(100, did, epId)
        if (currentEpisodeVideoUrl.value) {
          store.setVideoStatus('done', did, epId)
          ElMessage.success('视频生成完成')
        } else {
          store.setVideoStatus('error', did, epId)
          videoErrorMsg.value = '视频生成完成但未获取到播放地址，请稍后刷新'
          ElMessage.warning(videoErrorMsg.value)
        }
      } else if (pollResult?.status === 'failed') {
        store.setVideoStatus('error', did, epId)
        videoErrorMsg.value = pollResult?.error || '视频生成失败'
      } else if (pollResult?.status === 'timeout') {
        store.setVideoStatus('generating', did, epId)
        videoErrorMsg.value = '任务仍在排队或生成中，请稍后刷新查看'
        ElMessage.warning(videoErrorMsg.value)
      }
    } else {
      store.setVideoStatus('error', did, epId)
      const msg = result?.message || '本集没有可合成的视频片段'
      videoErrorMsg.value = msg
      ElMessage.warning(msg)
    }
  } catch (e) {
    videoErrorMsg.value = e.message || '生成失败'
    store.setVideoStatus('error', did, epId)
  } finally {
    if (store.getVideoStatus(did, epId) !== 'generating') {
      genStore.markDone(mergeMeta)
    }
  }
}

/** 无 task_id 时轮询刷新直到资源出现图片或超时（用于角色/道具/场景图生成） */
async function pollUntilResourceHasImage(checker, maxAttempts = 20, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    await loadDrama()
    if (checker()) return
  }
}

function resolvePollMeta(meta = {}) {
  return {
    dramaId: meta.dramaId ?? dramaId.value,
    episodeId: meta.episodeId ?? currentEpisodeId.value,
    dramaTitle: meta.dramaTitle ?? store.drama?.title,
    episodeNumber: meta.episodeNumber ?? store.currentEpisode?.episode_number,
    resourceType: meta.resourceType || 'unknown',
    resourceId: meta.resourceId,
    label: meta.label,
    ...meta,
  }
}

function pollTask(taskId, onDone, meta = {}) {
  return genStore.pollTask(taskId, resolvePollMeta(meta), onDone, { ElMessage })
}

const {
  startOneClickPipeline,
  startTextFrameworkPipeline,
  runOneClickPipeline,
  startRepairPipeline,
  runRepairPipeline,
} = useFilmCreatePipelineStages({
  currentEpisodeId,
  dramaId,
  store,
  storyInput,
  scriptLanguage,
  generationAPI,
  dramaAPI,
  propAPI,
  characterAPI,
  sceneAPI,
  imagesAPI,
  videosAPI,
  loadDrama,
  loadStoryboardMedia,
  refreshStoryboardsOnly,
  getStoryboardCountForApi,
  getVideoDurationForApi,
  projectAspectRatio,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  polishUniversalSegmentsAfterGeneration,
  hasAssetImage,
  hasSbImage,
  generatingCharIds,
  generatingSceneIds,
  generatingPropIds,
  generatingSbImageIds,
  generatingSbVideoIds,
  getSelectedStyle,
  captureDramaRefresh,
  captureStoryboardMediaRefresh,
  refreshStoryboardMediaForCurrentContext,
  pollUntilResourceHasImage,
  sceneUseQuadGrid,
  storyboardUseFirstLastFrame,
  isSbUniversalMode,
  ensureProfessionalFramePrompt,
  assertStoryboardMediaReady,
  sbVideos,
  recordHasPlayableVideoUrl,
  sbCanSubmitVideo,
  collectSbOmniReferenceAbsoluteUrls,
  getSbFirstFrameUrl,
  buildStoryboardVideoReferencePayload,
  buildSbVideoPromptForApi,
  getSbVideoDurationForApi,
  videoResolution,
  buildSbGenMeta,
  getFinalizeMergeOptions,
  refreshProductionReadiness,
  trackFilmCreateAction,
  pipelineStarting,
  pipelineRunning,
  pipelineStopping,
  activePipelineRunPromise,
  pipelineAbortRequested,
  pipelineErrorLog,
  pipelineCurrentStep,
  pipelineStepIndex,
  pipelineActiveTasks,
  pipelineOwnedTaskIds,
  pipelineStepTotal,
  pipelineConcurrency,
  pipelineVideoConcurrency,
  executeOwnedPipelineRun,
  confirmProductionPipelineCost,
  checkPause,
  pollTaskWithPause,
  addPipelineError,
  pipelineRest,
  runPipelineCountdown,
  pipelineWithRetry,
  runConcurrently,
  setPipelineStep,
  storyboardMediaActionReason,
})

const {
  hasActivePipelineWork,
  handleBeforeUnload,
  requestAiConfigWorkspaceNavigation,
  flushDraftBeforeNavigation,
  confirmPipelineNavigation,
  allowNavigationAfterDraftFlush,
} = useFilmCreateNavigationGuards({
  pipelineStarting,
  pipelineRunning,
  pipelineStopping,
  activePipelineRunPromise,
  pipelineOwnedTaskIds,
  showAiConfigDialog,
  aiConfigContentRef,
  scriptDraftController,
  flushScriptDraft,
  cancelPipelineRun,
})

onBeforeRouteLeave(allowNavigationAfterDraftFlush)
onBeforeRouteUpdate(allowNavigationAfterDraftFlush)

onBeforeUnmount(() => {
  projectLoadRequestId += 1
  projectDependencyRequestId += 1
  projectLifecycle.dispose()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  scriptDraftController.dispose()
})

function applyRouteToStore() {
  const id = route.params.id
  projectLoadRequestId += 1
  projectDependencyRequestId += 1
  resetStoryboardMediaContext(id && id !== 'new' ? Number(id) : null, null)
  projectLoadError.value = ''
  projectLoadNotFound.value = false
  projectDependencyWarning.value = ''
  projectLoadPending.value = false
  projectDependencyLoading.value = false
  if (id && id !== 'new') {
    projectLoadState.value = 'loading'
    store.reset()
    store.setDrama({ id: Number(id) })
    if (route.query.episode) {
      selectedEpisodeId.value = Number(route.query.episode)
    } else {
      selectedEpisodeId.value = null
    }
    loadDrama({ blocking: true })
  } else {
    projectLoadState.value = 'ready'
    store.reset()
    storyInput.value = ''
    scriptTitle.value = ''
    selectedEpisodeId.value = null
    savedCurrentEpisodeNumber.value = 1
    storyStyle.value = ''
    storyType.value = ''
    scriptLanguage.value = 'zh'
    scriptStoryboardStyle.value = ''
    generationStyle.value = ''
    markScriptDraftSaved()
  }
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  applyRouteToStore()
  if (!route.params.id || route.params.id === 'new') {
    Promise.allSettled([
      loadPipelineConcurrency(),
      refreshVideoGenerationCapability(),
      refreshProductionReadiness(),
    ])
  }
})

// 剧本分集切换时同步 URL query 参数（?episode=<episode_id>），使刷新/分享页面仍保持当前选中集
// 同时监听 query 变化，支持浏览器前进/后退时自动切换对应集次
function syncEpisodeRouteQuery(episodeId) {
  if (!dramaId.value) return
  const currentInQuery = route.query.episode != null ? Number(route.query.episode) : null
  const desired = episodeId != null ? Number(episodeId) : null
  if (currentInQuery === desired) return
  const newQuery = { ...route.query }
  if (desired != null) newQuery.episode = String(desired)
  else delete newQuery.episode
  router.replace({ query: newQuery }).catch(() => {})
}

watch(
  () => selectedEpisodeId.value,
  syncEpisodeRouteQuery,
  { flush: 'post' }
)

watch(
  () => route.query.episode,
  (newEp) => {
    if (!dramaId.value) return
    const newVal = newEp != null ? Number(newEp) : null
    const currentSel = selectedEpisodeId.value != null ? Number(selectedEpisodeId.value) : null
    if (currentSel !== newVal) {
      onEpisodeSelect(newVal)
    }
  }
)
</script>

<style scoped>
.film-create {
  --film-nav-width: 180px;
  min-height: 100vh;
  background: #16171e;
  background-image:
    radial-gradient(ellipse 80% 50% at 60% -5%, rgba(99, 102, 241, 0.13) 0%, transparent 65%),
    radial-gradient(ellipse 50% 40% at 90% 50%, rgba(139, 92, 246, 0.07) 0%, transparent 55%),
    radial-gradient(ellipse 45% 35% at 5% 75%, rgba(79, 70, 229, 0.06) 0%, transparent 55%),
    linear-gradient(180deg, #16171e 0%, #1a1b24 40%, #1e1f29 100%);
  color: #e4e4e7;
}
.film-create.sidebar-collapsed { --film-nav-width: 48px; }
html.light .film-create {
  background: #f8f7ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 10% -10%, rgba(139, 92, 246, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 50% 40% at 85% 110%, rgba(99, 102, 241, 0.06) 0%, transparent 50%);
  color: #1e1b4b;
}
.header {
  background: rgba(20, 21, 28, 0.78);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 28px;
  position: sticky;
  top: 0;
  z-index: 200;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.15), 0 4px 20px rgba(0, 0, 0, 0.2);
  margin-left: var(--film-nav-width);
}
.sidebar-collapsed .header {
  margin-left: var(--film-nav-width);
}
html.light .header {
  background: #ffffff !important;
  border-bottom-color: rgba(139, 92, 246, 0.1) !important;
  box-shadow: 0 1px 0 rgba(139,92,246,0.06), 0 4px 20px rgba(139, 92, 246, 0.05) !important;
}
.header-inner {
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover { filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.5)); }
.logo-main {
  font-size: 1.05rem;
  font-weight: 700;
  background: linear-gradient(135deg, #d0d5e8 0%, #a8b0cc 50%, #8890b0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.01em;
  filter: drop-shadow(0 0 8px rgba(160, 170, 200, 0.15));
}
.logo-sub {
  font-size: 0.65rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: #52525e;
  -webkit-text-fill-color: #52525e;
  text-transform: uppercase;
}
html.light .logo-main {
  background: linear-gradient(135deg, #6d28d9, #4f46e5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.breadcrumb-sep {
  color: #3a3a44;
  font-size: 0.9rem;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}
html.light .breadcrumb-sep { color: #d1d5db; }
.page-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 500;
  color: #7a7a88;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 4px 12px;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.light .page-title {
  color: #6b7280;
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.1);
}
.header-context {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
}
.header-context-label {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.header-add-episode {
  flex-shrink: 0;
}
.header-episode-select {
  width: min(240px, 20vw);
  min-width: 170px;
  flex-shrink: 0;
}
.header-episode-select :deep(.el-select__selected-item) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-back-drama {
  flex-shrink: 0;
}
.header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.workspace-actions > .el-button,
.header-actions > .el-button {
  margin-left: 0;
}
.workspace-actions {
  min-width: 0;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.workspace-actions > * {
  min-height: 32px;
}
@media (min-width: 769px) and (max-width: 1400px) {
  .header-inner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      "brand project"
      "actions actions";
    gap: 8px 16px;
  }
  .header-inner .logo { grid-area: brand; }
  .header-inner .breadcrumb-sep { display: none; }
  .header-inner > .header-context { grid-area: project; }
  .workspace-actions {
    grid-column: 1 / -1;
    grid-row: 2;
    display: grid;
    grid-template-columns: minmax(170px, 1fr) auto auto auto;
    margin-left: 0;
    width: 100%;
  }
  .workspace-actions .header-actions {
    margin-left: 0;
  }
}
@media (min-width: 769px) and (max-width: 960px) {
  .film-create {
    --film-create-sticky-offset: 144px;
  }
  .workspace-actions {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      "episode episode episode"
      "back canvas utilities";
  }
  .workspace-actions > .header-context { grid-area: episode; }
  .workspace-actions > .btn-back-drama { grid-area: back; }
  .workspace-actions > .btn-canvas-mode { grid-area: canvas; }
  .workspace-actions > .header-actions {
    grid-area: utilities;
    justify-self: end;
  }
}
.btn-theme {
  --el-button-bg-color: rgba(255, 255, 255, 0.04);
  --el-button-border-color: rgba(255, 255, 255, 0.08);
  --el-button-text-color: #8b8b96;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-button-hover-border-color: rgba(255, 255, 255, 0.18);
  --el-button-hover-text-color: #c8c8d0;
  transition: all 0.2s ease;
}
html.light .btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.04);
  --el-button-border-color: rgba(99, 102, 241, 0.12);
  --el-button-text-color: #6b7280;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.08);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.3);
  --el-button-hover-text-color: #4f46e5;
}
/* ===== 左侧固定侧边栏 ===== */
.quick-nav {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 210;
  display: flex;
  flex-direction: column;
  padding: 14px 0 10px;
  background: linear-gradient(180deg, #131318 0%, #111116 50%, #0f0f14 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 1px 0 0 rgba(255,255,255,0.02), 4px 0 24px rgba(0, 0, 0, 0.4);
  width: var(--film-nav-width);
  overflow-y: auto;
  overflow-x: hidden;
}
html.light .quick-nav {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 247, 255, 0.99) 100%);
  border-right-color: rgba(139, 92, 246, 0.1);
  box-shadow: 1px 0 0 rgba(139,92,246,0.06), 4px 0 20px rgba(139, 92, 246, 0.04);
}
.quick-nav::-webkit-scrollbar { width: 4px; }
.quick-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.quick-nav::-webkit-scrollbar-track { background: transparent; }
.quick-nav.collapsed {
  width: 48px;
  padding: 12px 0;
}
.quick-nav.collapsed .nav-steps,
.quick-nav.collapsed .nav-group {
  display: none;
}
@media (max-width: 768px) {
  .quick-nav { width: 48px; padding: 12px 0; }
  .quick-nav .nav-steps, .quick-nav .nav-group { display: none; }
  .quick-nav .nav-sidebar-title { display: none; }
  .quick-nav .nav-sidebar-header { justify-content: center; padding: 0 4px 8px; }
  .header, .main { margin-left: 48px !important; }
  .main { padding: 16px 12px 48px; }
  .asset-list-two { grid-template-columns: 1fr; }
}
/* 当前任务面板 */
.atp-panel {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 6px 0 4px;
}
.atp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 4px;
}
.atp-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  letter-spacing: 0.03em;
  flex: 1;
}
.atp-count-badge {
  font-size: 0.68rem;
  background: rgba(139, 92, 246, 0.25);
  color: #c4b5fd;
  border-radius: 8px;
  padding: 1px 5px;
  min-width: 16px;
  text-align: center;
}
.atp-spin-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  flex-shrink: 0;
  animation: atp-pulse 1.2s ease-in-out infinite;
}
@keyframes atp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
.atp-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.atp-list :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
  min-width: 0;
}
.atp-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 6px;
  transition: background 0.15s;
  min-width: 0;
  cursor: default;
}
.atp-item:hover { background: rgba(255,255,255,0.05); }
.atp-item-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #7c3aed;
  flex-shrink: 0;
  animation: atp-pulse 1.6s ease-in-out infinite;
}
.atp-item-label {
  font-size: 0.72rem;
  color: #a1a1aa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.atp-item-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.atp-item:hover .atp-item-close,
.atp-item-close:focus-visible {
  opacity: 1;
}
.atp-item-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.atp-more {
  font-size: 0.68rem;
  color: #71717a;
  padding: 2px 10px 2px 19px;
}
/* 折叠态任务徽章 */
.atp-collapsed-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px 0;
  cursor: default;
}
.atp-collapsed-count {
  font-size: 0.65rem;
  color: #a78bfa;
  font-weight: 700;
  line-height: 1;
}
html.light .atp-title { color: #7c3aed; }
html.light .atp-count-badge { background: rgba(139,92,246,0.12); color: #7c3aed; }
html.light .atp-spin-dot { background: #7c3aed; }
html.light .atp-item-dot { background: #8b5cf6; }
html.light .atp-item-label { color: #374151; }
html.light .atp-item:hover { background: rgba(0,0,0,0.04); }
html.light .atp-item-close { color: #9ca3af; }
html.light .atp-item-close:hover { background: rgba(239,68,68,0.1); color: #dc2626; }
html.light .atp-panel { border-top-color: rgba(139,92,246,0.15); }
.nav-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
  flex-shrink: 0;
}
html.light .nav-sidebar-header { border-bottom-color: rgba(139, 92, 246, 0.12); }
.quick-nav.collapsed .nav-sidebar-header {
  justify-content: center;
  padding: 0 4px 8px;
}
.nav-sidebar-title {
  font-size: 13px;
  font-weight: 600;
  color: #7a7a88;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
}
html.light .nav-sidebar-title { color: #7c3aed; }
.nav-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: #5a5a66;
  font: inherit;
  transition: color 0.15s, background 0.15s;
  border-radius: 6px;
  flex-shrink: 0;
  font-size: 16px;
}
.nav-toggle:hover { color: #c8c8d0; background: rgba(255,255,255,0.06); }
html.light .nav-toggle { color: #9ca3af; }
html.light .nav-toggle:hover { color: #374151; background: rgba(0,0,0,0.05); }

/* ─── Steps ─── */
.nav-steps {
  display: flex;
  flex-direction: column;
  padding: 0 10px 0 10px;
}
.nav-step {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  padding: 3px 6px 3px 0;
  transition: background 0.2s ease;
  user-select: none;
}
.nav-step:hover { background: rgba(255,255,255,0.04); }
.nav-step.is-current {
  background: rgba(99, 102, 241, 0.11);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
html.light .nav-step.is-current { background: rgba(99, 102, 241, 0.09); }
.nav-step.is-current .step-label { font-weight: 700; }
html.light .nav-step:hover { background: rgba(99,102,241,0.05); }

/* connector column */
.step-connector-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}
.step-line {
  width: 2px;
  flex: 1;
  min-height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 1px;
  transition: background 0.3s;
}
html.light .step-line { background: rgba(0,0,0,0.1); }
.step-line.filled { background: rgba(34, 197, 94, 0.5); }

/* dot */
.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  transition: all 0.25s;
  border: 2px solid transparent;
}
.dot-pending {
  background: rgba(39,39,42,0.6);
  border-color: rgba(63,63,70,0.4);
  color: #52525b;
}
html.light .dot-pending {
  background: rgba(229,231,235,0.6);
  border-color: rgba(156,163,175,0.3);
  color: #9ca3af;
}
.dot-partial {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.45);
  color: #f59e0b;
}
.dot-generating {
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.5);
  color: #a78bfa;
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.2);
}
.dot-done {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.5);
  color: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.15);
}
.dot-icon { font-size: 13px; }
.dot-num { font-size: 11px; line-height: 1; }

/* step body */
.step-body {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding: 3px 0;
  min-width: 0;
}
.step-label {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #71717a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.2s ease;
}
html.light .step-label { color: #6b7280; }
.nav-step:hover .step-label { color: #d4d4d8; }
html.light .nav-step:hover .step-label { color: #1e1b4b; }
.status-done .step-label { color: #6ee7b7; }
html.light .status-done .step-label { color: #059669; }
.status-generating .step-label { color: #c4b5fd; }
html.light .status-generating .step-label { color: #7c3aed; }
.status-partial .step-label { color: #fbbf24; }
html.light .status-partial .step-label { color: #d97706; }

.step-count {
  font-size: 10px;
  color: #52525b;
  background: rgba(255,255,255,0.04);
  border-radius: 10px;
  padding: 1px 5px;
  flex-shrink: 0;
  font-weight: 500;
}
html.light .step-count { background: rgba(0,0,0,0.04); color: #9ca3af; }

.step-badge {
  display: flex;
  align-items: center;
  font-size: 11px;
  flex-shrink: 0;
}
.partial-badge { color: #f59e0b; }
.gen-badge { color: #a78bfa; }

/* spin animation */
@keyframes navSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin { animation: navSpin 1s linear infinite; display: inline-flex; }

/* sub-toggle & sub-list */
.nav-group { margin-top: 4px; }
.nav-sub-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 12px;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  font-size: 12px;
  color: #5a5a66;
  cursor: pointer;
  transition: color 0.15s;
  border-top: 1px solid rgba(255,255,255,0.04);
}
html.light .nav-sub-toggle { border-top-color: rgba(0,0,0,0.07); color: #9ca3af; }
.nav-sub-toggle:hover { color: #e4e4e7; }
html.light .nav-sub-toggle:hover { color: #374151; }
.nav-sub-list {
  background: rgba(0,0,0,0.15);
  padding: 4px 0;
  border-radius: 0 0 6px 6px;
}
html.light .nav-sub-list { background: rgba(99,102,241,0.03); }
.nav-sub-item {
  display: block;
  width: calc(100% - 8px);
  padding: 4px 10px 4px 26px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  font-size: 11.5px;
  color: #52525b;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s, background 0.15s;
  border-radius: 4px;
  margin: 0 4px;
}
html.light .nav-sub-item { color: #9ca3af; }
.nav-sub-item:hover { color: #d4d4d8; background: rgba(255,255,255,0.04); }
html.light .nav-sub-item:hover { color: #1e1b4b; background: rgba(99,102,241,0.06); }
.nav-toggle:focus-visible,
.nav-step:focus-visible,
.nav-sub-toggle:focus-visible,
.nav-sub-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.logo:focus-visible { outline: 2px solid #818cf8; outline-offset: 4px; }

.main {
  margin-left: var(--film-nav-width);
  margin-right: 0;
  padding: 24px 32px 48px;
}

@media (min-width: 769px) {
  .film-create {
    --film-create-sticky-offset: 84px;
  }

  .main :is([id^="anchor-"], [id^="sb-"]) {
    scroll-margin-top: var(--film-create-sticky-offset);
  }
}

.project-state-active .header,
.project-state-active .main {
  margin-left: 0;
}
.project-state-active.sidebar-collapsed .main { margin-left: 0; }
.project-state-main {
  min-height: calc(100vh - 72px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.project-load-state {
  width: min(760px, 100%);
  min-height: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 32px;
  padding: 40px;
  border: 1px solid rgba(113, 113, 122, 0.45);
  border-radius: 8px;
  background: rgba(30, 31, 40, 0.94);
  text-align: center;
}
.project-load-state:focus { outline: none; }
.project-load-state:focus-visible { outline: 2px solid #818cf8; outline-offset: 3px; }
.project-load-state--error { border-color: rgba(248, 113, 113, 0.48); }
.project-load-state-icon { font-size: 36px; color: #a1a1aa; }
.project-load-state--error .project-load-state-icon { color: #f87171; }
.project-load-state h1 { margin: 4px 0 0; font-size: 1.3rem; color: #f4f4f5; }
.project-load-state p { max-width: 620px; margin: 0; color: #a1a1aa; line-height: 1.65; }
.project-load-state .project-load-state-assurance { color: #d4d4d8; }
.project-load-state-actions { display: flex; gap: 10px; margin-top: 12px; }
.project-dependency-warning {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding: 10px 12px;
  border: 1px solid rgba(245, 158, 11, 0.38);
  border-radius: 6px;
  background: rgba(120, 53, 15, 0.15);
  color: #fcd34d;
}
.project-dependency-warning span { flex: 1; line-height: 1.5; }
html.light .project-load-state { background: #fff; border-color: #d4d4d8; }
html.light .project-load-state--error { border-color: #fca5a5; }
html.light .project-load-state h1 { color: #18181b; }
html.light .project-load-state p { color: #52525b; }
html.light .project-dependency-warning { background: #fffbeb; color: #92400e; border-color: #fcd34d; }
.sidebar-collapsed .main {
  margin-left: var(--film-nav-width);
}
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
/* 批量生成分镜图/视频 */
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
.batch-status {
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.batch-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}
.batch-failed {
  color: var(--el-color-danger);
  font-size: 12px;
}
.batch-stopping {
  color: var(--el-color-warning);
  font-size: 12px;
}
.batch-error-log {
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  font-size: 13px;
  color: #fca5a5;
  max-height: 160px;
  overflow-y: auto;
}
.batch-error-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #f87171;
}
.batch-error-line {
  margin-bottom: 3px;
  word-break: break-all;
}
/* 角色/场景/道具 → 影响的分镜 */
/* 参考图上传区（添加角色/道具/场景弹窗顶部） */

/* 资源管理大面板 + 可折叠标题 */
.collapse-heading {
  margin: 0;
  font: inherit;
}
.collapse-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 14px 20px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}
.collapse-header:hover {
  background: rgba(255, 255, 255, 0.04);
}
.collapse-header:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.resource-panel .collapse-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.resource-panel .collapse-header .section-title {
  margin: 0;
}
.collapse-icon {
  font-size: 1.1rem;
  color: #a1a1aa;
  flex-shrink: 0;
  margin-left: 8px;
}
.resource-block-header .collapse-icon {
  font-size: 1rem;
}
.section-desc {
  color: #52525b;
  font-size: 0.82rem;
  margin: 0 0 14px;
  line-height: 1.5;
}
html.light .section-desc { color: #6b7280; }
.row { display: flex; flex-wrap: wrap; align-items: center; }
.gap { gap: 12px; }
.cover-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.btn-delete-icon { flex-shrink: 0; padding: 2px 4px !important; opacity: 0.45; transition: opacity 0.15s; }
.btn-delete-icon:hover { opacity: 1; }
/* 图片 + 操作按钮 竖向包裹 */
/* 额外参考图缩略图条 */
.thumb-preview-btn {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  background: rgba(59,130,246,0.85);
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 9px;
  line-height: 1;
  text-align: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb-preview-btn .el-icon,
.thumb-preview-btn svg {
  width: 10px;
  height: 10px;
}
.empty-tip {
  color: #5a5a66;
  font-size: 0.9rem;
  padding: 16px 0;
}

/* 亮色模式：资源卡片 */
html.light .empty-tip {
  color: #9ca3af;
}

/* 分镜：每行一个，三列布局 */
/* ── 段落分隔标头 ─────────────────────────────── */
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

/* 左侧导航段落标签 */
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
/* ── 分镜控制栏（卡片外，缩进） ── */
/* 有四宫格或多图时，image-area 改为纵向滚动布局 */
/* 普通多图缩略图条 */
/* 主图容器 */
/* 主图下方提示词预览 */
/* 四宫格整图作为上方预览时稍微缩小 */
/* 四宫格拆分中占位 */
.quad-splitting-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 8px;
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
/* 分镜生成中提示条 */
/* 解说导出行：避免浅色主题下勾选文案与卡片背景对比度不足 */
/* 分镜内解说旁白输入框：强制字/底对比，避免主题变量与页面继承冲突导致「看不见字」 */
.sub-title {
  font-size: 1rem;
  margin: 16px 0 8px;
  color: #e4e4e7;
}
.video-progress, .video-done, .video-error {
  margin-top: 16px;
}
.video-preview-wrap {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.video-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}
.video-preview-label {
  margin: 0;
  font-size: 0.95rem;
  color: #a1a1aa;
}
.video-preview-player {
  display: block;
  max-width: 100%;
  max-height: 360px;
  border-radius: 8px;
  background: #1a1b24;
}
.video-download-status {
  margin: 10px 0 0;
  color: #a1a1aa;
  font-size: 0.875rem;
  line-height: 1.5;
}
.video-download-status.is-error { color: #f87171; }

@media (max-width: 760px) {
  .delivery-overview {
    grid-template-columns: 1fr;
  }
  .delivery-stat + .delivery-stat {
    border-top: 1px solid var(--el-border-color-lighter);
    border-left: 0;
  }
}

/* 公共库弹窗 */
.char-library-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }

/* 专业帧提示词弹窗 - 干净美观版 */

/* 首尾帧提示词编辑器 */

/* 空间布局锚点展示（首尾帧一致性合同） */

</style>
