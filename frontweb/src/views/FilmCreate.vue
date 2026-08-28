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
          <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" :aria-label="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
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
        <div v-if="navCollapsed" class="atp-collapsed-badge" role="status" aria-live="polite" :aria-label="`进行中任务 ${allActiveTaskItems.length} 个：${allActiveTaskLabels.join('、')}`" :title="allActiveTaskLabels.join('\n')">
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
  createEpisodeSwitchController,
} from '@/utils/scriptDraft'
import { isPlaceholderMediaUrl, storyboardImageUrl } from '@/utils/mediaUrl'
import FilmCreateAiConfigDialog from '@/components/filmCreate/FilmCreateAiConfigDialog.vue'
import GlobalMediaPickerDialog from '@/components/GlobalMediaPickerDialog.vue'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import UniversalSegmentOmniAtEditor from '@/components/UniversalSegmentOmniAtEditor.vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import FilmCreateDeliveryPanel from '@/components/filmCreate/FilmCreateDeliveryPanel.vue'
import FilmCreateVideoSettingsPanel from '@/components/filmCreate/FilmCreateVideoSettingsPanel.vue'
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
  pipelineDisabledReason,
  projectResourceDisabledReason,
  storyboardDisabledReason,
  userFacingVideoGenerationError,
} from '@/utils/filmCreateActionState'
import { normalizeProjectListReturnTo } from '@/utils/projectListRoute'
import {
  generationStyleOptions,
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
import { useFilmCreateProjectLoad } from '@/composables/filmCreate/useFilmCreateProjectLoad'
import { useFilmCreateStoryboardBindings } from '@/composables/filmCreate/useFilmCreateStoryboardBindings'
import { useFilmCreateStoryboardExport } from '@/composables/filmCreate/useFilmCreateStoryboardExport'
import { useFilmCreateEpisodeCompose } from '@/composables/filmCreate/useFilmCreateEpisodeCompose'
import { useFilmCreateProductionReadiness } from '@/composables/filmCreate/useFilmCreateProductionReadiness'
import { useFilmCreateRouteSync } from '@/composables/filmCreate/useFilmCreateRouteSync'
import { useFilmCreateTaskPolling } from '@/composables/filmCreate/useFilmCreateTaskPolling'
import { useFilmCreateMediaPreview } from '@/composables/filmCreate/useFilmCreateMediaPreview'
import { useFilmCreateTaskRecovery } from '@/composables/filmCreate/useFilmCreateTaskRecovery'
import { useFilmCreateStoryboardAccessors } from '@/composables/filmCreate/useFilmCreateStoryboardAccessors'
import { useFilmCreateStoryboardStateSync } from '@/composables/filmCreate/useFilmCreateStoryboardStateSync'
import { useFilmCreateStoryboardVideoFields } from '@/composables/filmCreate/useFilmCreateStoryboardVideoFields'
import { useFilmCreateRefImageDrop } from '@/composables/filmCreate/useFilmCreateRefImageDrop'
import { useFilmCreateStylePrompts } from '@/composables/filmCreate/useFilmCreateStylePrompts'
import { useFilmCreateWorkspaceNav } from '@/composables/filmCreate/useFilmCreateWorkspaceNav'
import { useFilmCreateAiConfigWorkspace } from '@/composables/filmCreate/useFilmCreateAiConfigWorkspace'
import { useFilmCreateDeliveryActions } from '@/composables/filmCreate/useFilmCreateDeliveryActions'
import { useFilmCreateScriptEstimates } from '@/composables/filmCreate/useFilmCreateScriptEstimates'
import { useFilmCreateTaskCancel } from '@/composables/filmCreate/useFilmCreateTaskCancel'
import { useFilmCreateActiveTasks } from '@/composables/filmCreate/useFilmCreateActiveTasks'
import { useFilmCreateNavSteps } from '@/composables/filmCreate/useFilmCreateNavSteps'
import { trackFilmCreateAction } from '@/utils/filmCreateActionLog'
import { useFilmCreateScriptDraft } from '@/composables/filmCreate/useFilmCreateScriptDraft'
import { useFilmCreateResourceGenerate } from '@/composables/filmCreate/useFilmCreateResourceGenerate'
import { useFilmCreateTtsDisableReason } from '@/composables/filmCreate/useFilmCreateTtsDisableReason'
import { useFilmCreateFirstLastFrameSetting } from '@/composables/filmCreate/useFilmCreateFirstLastFrameSetting'
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
const projectPageTitle = computed(() => {
  if (projectLoadState.value === 'loading') return '正在加载项目'
  if (projectLoadState.value === 'error') return '项目加载失败'
  return store.dramaId ? (store.drama?.title || '项目') : '新建故事'
})

// ── Composable: Navigation ─────────────────────────────
const { navCollapsed, storyboardMenuExpanded, activeNavAnchor, toggleNav, scrollToTop, scrollToAnchor } = useNavigation({
  getAnchorIds: () => navSteps.value.map((step) => step.anchor),
})


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

const {
  openAiConfig,
  openAiConfigFromPipeline,
  onAiConfigurationChanged,
  confirmAiConfigWorkspaceClose,
  requestAiConfigWorkspaceClose,
} = useFilmCreateAiConfigWorkspace({
  ElMessage,
  showAiConfigDialog,
  aiConfigContentRef,
  pipelinePanelRef,
  aiConfigInitialServiceType,
  aiConfigChanged,
  aiConfigOpenedFromPipelineAction,
  invalidateActiveVideoAiConfigCache: (...args) => invalidateActiveVideoAiConfigCache(...args),
  refreshVideoGenerationCapability: (...args) => refreshVideoGenerationCapability(...args),
  refreshProductionReadiness: (...args) => refreshProductionReadiness(...args),
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

const {
  getSelectedStylePrompt,
  getSelectedStylePromptZh,
  projectStylePromptMetadata,
  getSelectedStyle,
} = useFilmCreateStylePrompts({
  generationStyle,
})


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

const {
  invalidateActiveVideoAiConfigCache,
  getNovel2AnimeReadiness,
  refreshProductionReadiness,
  refreshVideoGenerationCapability,
  getActiveVideoAiConfig,
  canUseUniversalOmniVideoApi,
  confirmUniversalNonSeedance2Video,
  videoGenerationCapability,
  videoCapabilityReason,
  productionCapabilityGaps,
  productionReadinessState,
  productionReadinessReason,
  ttsCapabilityReason,
} = useFilmCreateProductionReadiness({
  dramaId,
  productionReadinessLoading,
  productionReadinessFailed,
  authoritativeProductionReadiness,
  videoCapabilityLoading,
  videoCapabilityFailed,
  videoCapabilityConfigs,
})
const productionReadinessServiceType = computed(() => (
  productionCapabilityGaps.value.find((gap) => gap.service_type)?.service_type || ''
))

const {
  pollUntilResourceHasImage,
  resolvePollMeta,
  pollTask,
} = useFilmCreateTaskPolling({
  genStore,
  dramaId,
  currentEpisodeId,
  store,
  ElMessage,
  loadDrama: (...args) => loadDrama(...args),
})

const {
  baseUrl,
  previewImageUrl,
  imageUrl,
  assetImageUrl,
  hasAssetImage,
  openImagePreview,
  closeImagePreview,
  assetVideoUrl,
  isHttpVideoUrl,
  recordHasPlayableVideoUrl,
  toAbsoluteImageUrl,
} = useFilmCreateMediaPreview({
  ElMessage,
})
const hasAnyEpisode = computed(() => (store.drama?.episodes || []).length > 0)
const showGlobalMediaPicker = ref(false)

const {
  goList,
  goCanvasMode,
  openMediaLibraryFromPicker,
} = useFilmCreateWorkspaceNav({
  router,
  route,
  dramaId,
  selectedEpisodeId,
  projectListReturnTo,
  showGlobalMediaPicker,
})
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

const {
  scriptDraftController,
  captureScriptDraft,
  markScriptDraftSaved,
  persistScriptDraftSnapshot,
  flushScriptDraft,
} = useFilmCreateScriptDraft({
  store,
  dramaAPI,
  scriptTitle,
  scriptContent,
  scriptDraftStatus,
  currentEpisodeId,
})

const episodeSwitchController = createEpisodeSwitchController({
  flushDraft: flushScriptDraft,
  resolveEpisode: (episodeId) => (store.drama?.episodes || []).find((episode) => (
    Number(episode.id) === Number(episodeId)
  )) || null,
  commitEpisode: (episode) => applySelectedEpisode(episode),
  refreshEpisode: (...args) => refreshProjectDependencies(...args),
  onBusyChange: (busy) => {
    episodeSwitching.value = busy
  },
})

const videoProgress = computed(() => store.videoProgress)
const videoStatus = computed(() => store.videoStatus)


const {
  currentEpisodeVideoUrl,
  deliveryCompositeStatusLabel,
  deliverySubtitleAvailable,
  deliveryFileCount,
  videoDownloadStatus,
  videoDownloadError,
  deliveryExportStatus,
  deliveryExportError,
  deliveryExportHasError,
  deliveryExportFeedback,
  buildDeliveryFilename,
  downloadCurrentEpisodeVideo,
  downloadCurrentEpisodeSubtitle,
  exportCurrentProjectPackage,
} = useFilmCreateDeliveryActions({
  store,
  ElMessage,
  dramaId,
  currentEpisode,
  currentEpisodeId,
  storyboards,
  videoStatus,
  videoProgress,
  timelinesAPI,
  dramaAPI,
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
  loadDrama: (...args) => loadDrama(...args),
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
  loadDrama: (...args) => loadDrama(...args),
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
  loadDrama: (...args) => loadDrama(...args),
  pollTask,
  pollUntilResourceHasImage,
  hasAssetImage,
  dramaAPI,
  ElMessage,
  sceneAPI,
  sceneLibraryAPI,
  uploadAPI,
})

const {
  onGenerateCharacters,
  onExtractProps,
  onExtractScenes,
} = useFilmCreateResourceGenerate({
  store,
  trackFilmCreateAction,
  onGenerateCharactersRaw,
  onExtractPropsRaw,
  onExtractScenesRaw,
})


// 资源管理大面板及子区块折叠状态
const resourcePanelCollapsed = ref(false)
const charactersBlockCollapsed = ref(false)
const propsBlockCollapsed = ref(false)
const scenesBlockCollapsed = ref(false)
const sceneUseQuadGrid = ref(false)
const propUseQuadGrid = ref(false)  // 道具四视图（与场景四宫格同级选项）

// 分镜行内编辑状态（按 storyboard id 存储）
// navCollapsed/storyboardMenuExpanded/toggleNav → 已移至 useNavigation composable

const sbCharacterIds = ref({})  // sbId -> number[] 多选角色
const sbPropIds = ref({})       // sbId -> number[] 多选道具
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
  captureDramaRefresh,
} = useFilmCreateStoryboardMedia({
  dramaId,
  currentEpisodeId,
  getStoryboards: () => store.storyboards || [],
  imagesAPI,
  videosAPI,
  onSelectionsRestored: () => restoreSelectionsFromBackend(),
  loadDrama: (...args) => loadDrama(...args),
})
const sbVideoErrors = ref({})
const generatingSbImageIds = reactive(new Set())
const generatingSbVideoIds = reactive(new Set())
const generatingUniversalSegmentIds = reactive(new Set())
const generatingSbFirstImageIds = reactive(new Set())
const generatingSbLastImageIds = reactive(new Set())
const {
  getGeneratingSetsBag,
  buildSbGenMeta,
  isSbVideoGenerating,
  recoverAndSyncEpisodeTasks,
} = useFilmCreateTaskRecovery({
  dramaId,
  currentEpisodeId,
  store,
  genStore,
  ElMessage,
  videoErrorMsg,
  generatingCharIds,
  generatingPropIds,
  generatingSceneIds,
  generatingSbImageIds,
  generatingSbFirstImageIds,
  generatingSbLastImageIds,
  generatingSbVideoIds,
  currentStoryboardMediaContext,
  loadSingleStoryboardMedia,
  captureDramaRefresh,
})
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

const {
  cancelActiveTask,
} = useFilmCreateTaskCancel({
  ElMessage,
  genStore,
  cancelPipelineRun,
  storyGenerating,
  scriptGenerating,
  universalOmniPolishAbort,
  batchImageStopping,
  batchVideoStopping,
})
const batchVideoProgress = ref({ current: 0, total: 0, failed: 0 })

const {
  allActiveTaskItems,
  allActiveTaskLabels,
} = useFilmCreateActiveTasks({
  genStore,
  pipelineRunning,
  pipelineStopping,
  pipelineAbortRequested,
  pipelineCurrentStep,
  isStoryGenRunning,
  universalOmniPolishRunning,
  universalOmniPolishProgress,
  batchImageRunning,
  batchVideoRunning,
  batchVideoProgress,
})
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

const {
  ttsGenerationDisabledReason,
} = useFilmCreateTtsDisableReason({
  ttsSbIds,
  ttsSbNarrationIds,
  ttsCapabilityReason,
})
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

const {
  getFirstImageFile,
  readFileAsRefImage,
  onRefImageFileChange,
  onRefImageDrop,
  onRefImageFileChange2,
  onRefImageDrop2,
  doExtractFromRef,
  onResourceDragOver,
  onResourceDragLeave,
  onResourceDrop,
  onSbImageDragOver,
  onSbImageDragLeave,
  onSbImageDrop,
} = useFilmCreateRefImageDrop({
  ElMessage,
  uploadAPI,
  addCharRefImage,
  addPropRefImage,
  addSceneRefImage,
  addPropAddRefImage,
  extractingCharAppearance,
  extractingPropDesc,
  extractingSceneDesc,
  editCharacterForm,
  editPropForm,
  editSceneForm,
  dragOverResourceKey,
  dragOverSbId,
  doUploadResourceImage: (...args) => doUploadResourceImage(...args),
  doUploadSbImage: (...args) => doUploadSbImage(...args),
})
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

const {
  sbSelectedImgId,
  sbSelectedLastImgId,
  sbSelectedVideoId,
  sbImageUploadSlotById,
  uploadingSbImageSlot,
  frameTypeForSlot,
  resolveSbImageById,
  getSbFirstImage,
  getSbLastImage,
  hasSbImage,
  hasSbFirstLastPair,
  getSbAllImages,
  hasSbDraftImagePlaceholder,
  getSbImage,
  getQuadGridImage,
  getSbAllVideos,
  getSbVideo,
  getNextStoryboard,
  getPrevStoryboard,
  canUsePrevTailAsFirst,
  getVideoStripItems,
  onSelectSbMainVideo,
  getSbVideoError,
  sbMainVideoPlayerKey,
  restoreSelectionsFromBackend,
  getStripItems,
  historyImageLabel,
  stripItemTitle,
  onStripItemClick,
  quadPanelLabel,
  onSelectStripItem,
  onSelectSbFrameImage,
  onSelectSbMainImage,
  onRemoveSbHistoryImage,
  getSbGridImages,
  getSbVideoReferenceGrid,
  getSbFirstFrameUrl,
  getSbLastFrameUrl,
  sbVideoFirstLastUrls,
  getSbLocalImage,
} = useFilmCreateStoryboardAccessors({
  store,
  sbImages,
  sbVideos,
  sbVideoErrors,
  storyboardUseFirstLastFrame,
  isSbUniversalMode: (...args) => isSbUniversalMode(...args),
  storyboardsAPI,
  imagesAPI,
  ElMessage,
  ElMessageBox,
  refreshStoryboardMediaForCurrentContext,
  assetImageUrl,
  assetVideoUrl,
  recordHasPlayableVideoUrl,
  toAbsoluteImageUrl,
  userFacingVideoGenerationError,
  sbVideoReferenceImageId,
})

const {
  navSteps,
} = useFilmCreateNavSteps({
  genStore,
  dramaId,
  currentEpisodeId,
  scriptContent,
  isStoryGenRunning,
  characters,
  hasAssetImage,
  charactersGenerating,
  generatingCharIds,
  props,
  propsExtracting,
  generatingPropIds,
  scenes,
  scenesExtracting,
  generatingSceneIds,
  storyboards,
  storyboardGenerating,
  universalOmniPolishRunning,
  hasSbImage,
  generatingSbImageIds,
  batchImageRunning,
  getSbAllVideos,
  batchVideoRunning,
  generatingSbVideoIds,
  videoStatus,
  currentEpisodeVideoUrl,
})

const {
  captureVideoLastFrame,
  onUpscaleSbImage,
  onSaveSbNarrationField,
  isSbUniversalMode,
  setSbCreationModeId,
  onToggleSbUniversalMode,
  onSaveUniversalSegmentField,
  universalSegmentDurationSecForSb,
  getSbVideoDurationForApi,
  getMainImageUrlForVideo,
  sbUniversalSegmentTrimmed,
  sbCanSubmitVideo,
  sbVideoGenerationDisabledReason,
  buildSbVideoPromptForApi,
} = useFilmCreateStoryboardVideoFields({
  store,
  storyboardsAPI,
  ElMessage,
  upscalingSbIds,
  refreshStoryboardMediaForCurrentContext,
  sbNarration,
  sbCreationMode,
  sbUniversalSegmentText,
  sbDuration,
  videoClipDuration,
  getSbFirstFrameUrl,
  storyboardMediaActionReason,
  isSbVideoGenerating,
  videoCapabilityReason,
})

const {
  clipSecondsForStoryboardEstimate,
  shotCountEstimateFromDurationSec,
  scriptStoryboardEstimate,
  scriptEstimateVideoDurationHint,
  scriptEstimateVideoDurationTitle,
  scriptEstimateStoryboardHint,
  scriptEstimateStoryboardTitle,
  scriptTextTrimmedForEstimate,
  userFilledStoryboardCount,
  userFilledVideoDuration,
  getVideoDurationForApi,
  getStoryboardCountForApi,
} = useFilmCreateScriptEstimates({
  videoClipDuration,
  scriptContent,
  storyboardCount,
  videoDuration,
})

const {
  onStoryboardUseFirstLastFrameChange,
} = useFilmCreateFirstLastFrameSetting({
  storyboardUseFirstLastFrame,
  gridMode,
  ElMessage,
  saveProjectSettings: (...args) => saveProjectSettings(...args),
})


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
  loadDrama: (...args) => loadDrama(...args),
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


const {
  syncStoryboardStateFromEpisode,
} = useFilmCreateStoryboardStateSync({
  sbCharacterIds,
  sbPropIds,
  sbSceneId,
  sbDialogue,
  sbNarration,
  sbShotType,
  sbTitle,
  sbLocation,
  sbTime,
  sbDuration,
  sbAction,
  sbResult,
  sbAtmosphere,
  sbAngle,
  sbAngleH,
  sbAngleV,
  sbAngleS,
  sbMovement,
  sbLighting,
  sbDof,
  sbLayoutDescription,
  sbCreationMode,
  sbUniversalSegmentText,
  sbVideoReferenceImageId,
})

const {
  onEpisodeSelect,
  applySelectedEpisode,
  friendlyFilmProjectLoadError,
  refreshProjectDependencies,
  retryProjectDependencies,
  loadDrama,
  retryFilmProjectLoad,
  invalidateProjectLoads,
} = useFilmCreateProjectLoad({
  store,
  dramaId,
  currentEpisodeId,
  projectLifecycle,
  episodeSwitchController,
  syncEpisodeRouteQuery: (episodeId) => syncEpisodeRouteQuery(episodeId),
  resetStoryboardMediaContext,
  ensureStoryboardMediaContext,
  storyboardMediaStateController,
  syncStoryboardStateFromEpisode,
  markScriptDraftSaved,
  loadStoryboardMedia,
  recoverAndSyncEpisodeTasks,
  loadPipelineConcurrency,
  refreshVideoGenerationCapability: (...args) => refreshVideoGenerationCapability(...args),
  refreshProductionReadiness: (...args) => refreshProductionReadiness(...args),
  scriptTitle,
  selectedEpisodeId,
  savedCurrentEpisodeNumber,
  storyInput,
  storyStyle,
  storyType,
  generationStyle,
  projectAspectRatio,
  videoClipDuration,
  storyboardIncludeNarration,
  storyboardUniversalOmni,
  storyboardUseFirstLastFrame,
  lastFrameUseFirstLayoutLock,
  gridMode,
  projectLoadState,
  projectLoadPending,
  projectLoadError,
  projectLoadNotFound,
  projectDependencyWarning,
  projectDependencyLoading,
  projectLoadFailureRef,
  scriptDraftController,
})

const {
  getSbCharacterIds,
  getMovementLabel,
  setSbCharacterIds,
  charactersAvailableToAddToSb,
  onSbAddCharacterCommand,
  getSbPropIds,
  setSbPropIds,
  onStoryboardPropChange,
  getSbSelectedScene,
  getSbSelectedCharacters,
  getSbSelectedProps,
  onStoryboardCharacterChange,
  onLastFrameLayoutLockChange,
  onStoryboardSceneChange,
  dedupeStoryboardsForAssetLink,
  getCharAffectedStoryboards,
  getSceneAffectedStoryboards,
  getPropAffectedStoryboards,
  scrollToStoryboard,
} = useFilmCreateStoryboardBindings({
  storyboards,
  characters,
  props,
  scenes,
  storyboardsAPI,
  sbCharacterIds,
  sbPropIds,
  sbSceneId,
  saveProjectSettings: (...args) => saveProjectSettings(...args),
})

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

const {
  formatSrtTimestamp,
  onExportStoryboardSheet,
  onExportNarrationSrt,
} = useFilmCreateStoryboardExport({
  store,
  currentEpisodeId,
  storyboards,
  storyboardsAPI,
  storyboardUseFirstLastFrame,
  exportingStoryboardSheet,
  getSbFirstImage,
  getSbLastImage,
  buildFirstFrameImagePrompt,
  buildLastFrameImagePrompt,
  getSbSelectedScene,
  getSbSelectedCharacters,
  getSbSelectedProps,
  getMovementLabel,
  sbTitle,
  sbLocation,
  sbTime,
  sbDuration,
  sbDialogue,
  sbNarration,
  sbAction,
  sbResult,
  sbAtmosphere,
  sbShotType,
  sbMovement,
  sbLayoutDescription,
  sbUniversalSegmentText,
})


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
  sbTitle,
  sbLocation,
  sbTime,
  sbAction,
  sbDialogue,
  sbNarration,
  sbResult,
  sbAtmosphere,
  sbShotType,
  sbMovement,
  sbLayoutDescription,
})


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

const {
  getFinalizeMergeOptions,
  onGenerateVideo,
} = useFilmCreateEpisodeCompose({
  store,
  dramaId,
  currentEpisodeId,
  dramaAPI,
  genStore,
  pollTask: (...args) => pollTask(...args),
  captureDramaRefresh,
  loadDrama,
  composeActionDisabledReason,
  currentEpisodeVideoUrl,
  videoErrorMsg,
  videoSubtitle,
  videoBurnDialogue,
  videoWatermark,
  videoWatermarkText,
})


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
  invalidateProjectLoads()
  projectLifecycle.dispose()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  scriptDraftController.dispose()
})

const {
  applyRouteToStore,
  syncEpisodeRouteQuery,
} = useFilmCreateRouteSync({
  route,
  router,
  store,
  dramaId,
  invalidateProjectLoads,
  resetStoryboardMediaContext,
  loadDrama,
  projectLoadError,
  projectLoadNotFound,
  projectDependencyWarning,
  projectLoadPending,
  projectDependencyLoading,
  projectLoadState,
  selectedEpisodeId,
  savedCurrentEpisodeNumber,
  storyInput,
  scriptTitle,
  storyStyle,
  storyType,
  scriptLanguage,
  scriptStoryboardStyle,
  generationStyle,
  markScriptDraftSaved,
  onEpisodeSelect,
})

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

</script>


<style scoped src="./FilmCreate.css"></style>

