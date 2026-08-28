<template>
  <div class="film-create-resource-root">
      <input
        ref="resourceImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        @change="onResourceImageFileChange"
      />
      <!-- 资源管理：角色 / 道具 / 场景 -->
      <section class="section card resource-panel">
        <h2 class="collapse-heading">
          <button
            type="button"
            class="collapse-header"
            :aria-expanded="!resourcePanelCollapsed"
            aria-controls="resource-panel-body"
            @click="resourcePanelCollapsed = !resourcePanelCollapsed"
          >
            <span class="section-title">资源管理</span>
            <el-icon class="collapse-icon"><ArrowUp v-if="!resourcePanelCollapsed" /><ArrowDown v-else /></el-icon>
          </button>
        </h2>
        <div id="resource-panel-body" v-show="!resourcePanelCollapsed" class="resource-panel-body">
          <!-- 角色生成 -->
          <div id="anchor-characters" class="resource-block card">
            <h3 class="collapse-heading">
              <button
                type="button"
                class="collapse-header resource-block-header"
                :aria-expanded="!charactersBlockCollapsed"
                aria-controls="characters-block-body"
                @click="charactersBlockCollapsed = !charactersBlockCollapsed"
              >
                <span class="resource-block-title">角色生成</span>
                <el-icon class="collapse-icon"><ArrowUp v-if="!charactersBlockCollapsed" /><ArrowDown v-else /></el-icon>
              </button>
            </h3>
            <div id="characters-block-body" v-show="!charactersBlockCollapsed" class="resource-block-body">
              <div class="asset-actions">
                <ActionGate :reason="characterGenerationDisabledReason" label="剧本自动提取角色">
                  <el-button type="primary" size="small" :loading="charactersGenerating" :disabled="Boolean(characterGenerationDisabledReason)" @click="emit('generate-characters')">
                    剧本自动提取角色
                  </el-button>
                </ActionGate>
                <ActionGate :reason="projectActionDisabledReason" label="添加角色">
                  <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" @click="emit('add-character')">添加角色</el-button>
                </ActionGate>
                <el-button size="small" @click="emit('open-char-library')">本剧角色库</el-button>
              </div>
              <div class="asset-list asset-list-two">
                <div v-for="char in characters" :key="char.id" class="asset-item asset-item-left-right">
                  <div class="asset-info">
                    <div class="asset-name">
                      <span style="display:inline-flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ char.name }}</span>
                        <el-tag v-if="char.role" size="small" effect="plain" :type="char.role === 'main' ? 'danger' : char.role === 'supporting' ? 'warning' : 'info'" style="flex-shrink:0;padding:0 5px;font-size:11px;height:18px;line-height:18px">{{ charRoleLabel(char.role) }}</el-tag>
                      </span>
                      <el-button type="danger" text size="small" class="btn-delete-icon" title="删除" :aria-label="`删除角色${char.name || '未命名角色'}`" @click="emit('delete-character', char)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                    <div class="asset-desc-full">{{ char.appearance || char.description || '暂无描述' }}</div>
                    <div class="asset-btns">
                      <el-button size="small" @click="emit('edit-character', char)">编辑</el-button>
                      <el-button size="small" :loading="addingCharToLibraryId === char.id" :disabled="!hasAssetImage(char)" @click="emit('add-character-to-library', char)">
                        加入本剧库
                      </el-button>
                      <el-button size="small" :loading="addingCharToMaterialId === char.id" :disabled="!hasAssetImage(char)" @click="emit('add-character-to-material', char)">
                        加入素材库
                      </el-button><el-button
                        size="small"
                        :type="char.seedance2_asset?.status === 'active' ? 'success' : 'warning'"
                        plain
                        :loading="sd2CertifyingId === char.id"
                        :disabled="!hasAssetImage(char)"
                        @click="emit('sd2-primary-action', char)"
                      >
                        {{ sd2ActionLabel(char) }}
                      </el-button>
                    </div>

                    <!-- Seedance 2.0 音色参考（仅该模型有效，其他模型不生效） -->
                    <div class="sd2-voice-row" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <template v-if="char.seedance2_voice_asset?.status === 'active'">
                        <!-- 音色参考已设置：显示试听 + 更换 -->
                        <el-button
                          size="small"
                          type="success"
                          plain
                          @click="emit('play-sd2-voice', char)"
                        >
                          <el-icon><VideoPlay /></el-icon>
                          <span style="margin-left:4px">试听</span>
                        </el-button>
                        <el-button
                          size="small"
                          type="primary"
                          plain
                          :loading="sd2VoiceUploadingId === char.id"
                          @click="emit('sd2-voice-replace', char)"
                        >
                          更换
                        </el-button>
                        <span style="font-size:11px;color:#67c23a">音色已设置</span>
                      </template>
                      <template v-else>
                        <el-button
                          size="small"
                          :type="char.seedance2_voice_asset?.status === 'stale' ? 'warning' : 'info'"
                          plain
                          :loading="sd2VoiceUploadingId === char.id"
                          @click="emit('sd2-voice-primary-action', char)"
                        >
                          {{ sd2VoiceActionLabel(char) }}
                        </el-button>
                        <span v-if="char.seedance2_voice_asset?.status === 'stale'" style="font-size:11px;color:#e6a23c">需刷新</span>
                      </template>
                      <span style="font-size:10px;color:#909399">仅 Seedance 2.0 模型生效</span>
                    </div>
                    <div v-if="getCharAffectedStoryboards(char.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <span
                        v-for="sb in getCharAffectedStoryboards(char.id)"
                        :key="sb.id"
                        class="asl-chip"
                        title="点击跳转到该分镜"
                        @click="emit('scroll-to-storyboard', sb.id)"
                      >#{{ sb.storyboard_number }}</span>
                      <span v-if="regenSbImagesForAsset.has('char-' + char.id) && regenSbImagesProgress['char-' + char.id]" class="asl-progress">
                        {{ regenSbImagesProgress['char-' + char.id].current }}/{{ regenSbImagesProgress['char-' + char.id].total }}
                      </span>
                      <ActionGate :reason="storyboardMediaActionReason" label="重新生成关联分镜图">
                        <el-button
                          size="small"
                          class="asl-regen-btn"
                          :loading="regenSbImagesForAsset.has('char-' + char.id)"
                          :disabled="Boolean(storyboardMediaActionReason)"
                          @click="emit('regen-affected-sb-images', 'char-' + char.id, getCharAffectedStoryboards(char.id))"
                        >
                          <span v-if="!regenSbImagesForAsset.has('char-' + char.id)">↻ 重新生成分镜图</span>
                        </el-button>
                      </ActionGate>
                    </div>
                  </div>
                  <div class="asset-cover-wrap">
                    <div
                      class="asset-cover"
                      :class="{ 'asset-cover--clickable': hasAssetImage(char), 'asset-cover--dragover': dragOverResourceKey === 'char-' + char.id }"
                      role="button"
                      :tabindex="hasAssetImage(char) ? 0 : -1"
                      :aria-label="hasAssetImage(char) ? `预览${char.name || '角色'}图片` : undefined"
                      @click="hasAssetImage(char) && emit('preview-image', assetImageUrl(char))"
                      @keydown.enter.prevent="hasAssetImage(char) && emit('preview-image', assetImageUrl(char))"
                      @keydown.space.prevent="hasAssetImage(char) && emit('preview-image', assetImageUrl(char))"
                      @dragover="onResourceDragOver($event, 'character', char.id)"
                      @dragleave="onResourceDragLeave($event, 'char-' + char.id)"
                      @drop="onResourceDrop($event, 'character', char.id)"
                    >
                      <img v-if="hasAssetImage(char)" :src="assetImageUrl(char)" class="cover-img" alt="" />
                      <div v-else-if="char.error_msg || char.errorMsg" class="cover-placeholder error" :title="char.error_msg || char.errorMsg">{{ char.error_msg || char.errorMsg }}</div>
                      <div v-else class="cover-placeholder">暂无图</div>
                      <div v-if="dragOverResourceKey === 'char-' + char.id" class="asset-cover-drop-hint">松开上传</div>
                    </div>
                    <!-- 额外参考图条 -->
                    <div v-if="parseExtraImages(char).length" class="extra-images-strip">
                      <div v-for="(ep, imageIndex) in parseExtraImages(char)" :key="ep" class="extra-thumb" :title="'点击设为主图（悬停左上角可放大预览）'">
                        <button type="button" class="extra-thumb-primary" :aria-label="`将${char.name || '角色'}参考图${imageIndex + 1}设为主图`" @click="emit('set-primary-image', 'character', char, ep)">
                          <img :src="localPathToUrl(ep)" alt="" />
                        </button>
                        <button type="button" class="thumb-preview-btn" title="放大预览" :aria-label="`预览${char.name || '角色'}参考图${imageIndex + 1}`" @click.stop="emit('preview-image', localPathToUrl(ep))">
                          <el-icon :size="10"><ZoomIn /></el-icon>
                        </button>
                        <button type="button" class="extra-thumb-remove" title="移除" :aria-label="`移除${char.name || '角色'}参考图${imageIndex + 1}`" @click.stop="emit('remove-extra-image', 'character', char, ep)">×</button>
                      </div>
                    </div>
                    <div class="asset-cover-actions">
                      <el-button type="primary" size="small" :loading="generatingCharIds.has(char.id)" @click="emit('generate-character-image', char)">
                        <el-icon v-if="!generatingCharIds.has(char.id)"><MagicStick /></el-icon>
                        AI 生成
                      </el-button>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'char-' + char.id" @click="onUploadResourceClick('character', char.id)">
                        <el-icon v-if="uploadingResourceId !== 'char-' + char.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                  </div>
                </div>
                <div v-if="characters.length === 0" class="empty-tip">暂无角色，可用「剧本自动提取角色」或「添加角色」</div>
              </div>
            </div>
          </div>

          <!-- 道具生成 -->
          <div id="anchor-props" class="resource-block card">
            <h3 class="collapse-heading">
              <button
                type="button"
                class="collapse-header resource-block-header"
                :aria-expanded="!propsBlockCollapsed"
                aria-controls="props-block-body"
                @click="propsBlockCollapsed = !propsBlockCollapsed"
              >
                <span class="resource-block-title">道具生成</span>
                <el-icon class="collapse-icon"><ArrowUp v-if="!propsBlockCollapsed" /><ArrowDown v-else /></el-icon>
              </button>
            </h3>
            <div id="props-block-body" v-show="!propsBlockCollapsed" class="resource-block-body">
              <div class="asset-actions">
                <ActionGate :reason="propsExtractionDisabledReason" label="从剧本提取道具">
                  <el-button type="primary" size="small" :loading="propsExtracting" :disabled="Boolean(propsExtractionDisabledReason)" @click="emit('extract-props')">从剧本提取道具</el-button>
                </ActionGate>
                <ActionGate :reason="projectActionDisabledReason" label="添加道具">
                  <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" @click="emit('add-prop')">添加道具</el-button>
                </ActionGate>
                <el-button size="small" @click="emit('open-prop-library')">本剧道具库</el-button>
              </div>
              <div class="prop-gen-mode" style="margin: 8px 0; font-size: 13px;">
                <el-checkbox v-model="propUseQuadGrid">生成四视图道具（默认单图，纯色无缝背景）</el-checkbox>
              </div>
              <div class="asset-list asset-list-two">
                <div v-for="prop in propItems" :key="prop.id" class="asset-item asset-item-left-right">
                  <div class="asset-info">
                    <div class="asset-name">
                      <span>{{ prop.name }}</span>
                      <el-button type="danger" text size="small" class="btn-delete-icon" title="删除" :aria-label="`删除道具${prop.name || '未命名道具'}`" @click="emit('delete-prop', prop)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                    <div class="asset-desc-full">{{ prop.description || prop.prompt || '暂无描述' }}</div>
                    <div class="asset-btns">
                      <el-button size="small" @click="emit('edit-prop', prop)">编辑</el-button>
                      <el-button size="small" :loading="addingPropToLibraryId === prop.id" :disabled="!hasAssetImage(prop)" @click="emit('add-prop-to-library', prop)">
                        加入本剧库
                      </el-button>
                      <el-button size="small" :loading="addingPropToMaterialId === prop.id" :disabled="!hasAssetImage(prop)" @click="emit('add-prop-to-material', prop)">
                        加入素材库
                      </el-button></div>
                    <div v-if="getPropAffectedStoryboards(prop.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <span
                        v-for="sb in getPropAffectedStoryboards(prop.id)"
                        :key="sb.id"
                        class="asl-chip"
                        title="点击跳转到该分镜"
                        @click="emit('scroll-to-storyboard', sb.id)"
                      >#{{ sb.storyboard_number }}</span>
                      <span v-if="regenSbImagesForAsset.has('prop-' + prop.id) && regenSbImagesProgress['prop-' + prop.id]" class="asl-progress">
                        {{ regenSbImagesProgress['prop-' + prop.id].current }}/{{ regenSbImagesProgress['prop-' + prop.id].total }}
                      </span>
                      <ActionGate :reason="storyboardMediaActionReason" label="重新生成关联分镜图">
                        <el-button
                          size="small"
                          class="asl-regen-btn"
                          :loading="regenSbImagesForAsset.has('prop-' + prop.id)"
                          :disabled="Boolean(storyboardMediaActionReason)"
                          @click="emit('regen-affected-sb-images', 'prop-' + prop.id, getPropAffectedStoryboards(prop.id))"
                        >
                          <span v-if="!regenSbImagesForAsset.has('prop-' + prop.id)">↻ 重新生成分镜图</span>
                        </el-button>
                      </ActionGate>
                    </div>
                  </div>
                  <div class="asset-cover-wrap">
                    <div
                      class="asset-cover"
                      :class="{ 'asset-cover--clickable': hasAssetImage(prop), 'asset-cover--dragover': dragOverResourceKey === 'prop-' + prop.id }"
                      role="button"
                      :tabindex="hasAssetImage(prop) ? 0 : -1"
                      :aria-label="hasAssetImage(prop) ? `预览${prop.name || '道具'}图片` : undefined"
                      @click="hasAssetImage(prop) && emit('preview-image', assetImageUrl(prop))"
                      @keydown.enter.prevent="hasAssetImage(prop) && emit('preview-image', assetImageUrl(prop))"
                      @keydown.space.prevent="hasAssetImage(prop) && emit('preview-image', assetImageUrl(prop))"
                      @dragover="onResourceDragOver($event, 'prop', prop.id)"
                      @dragleave="onResourceDragLeave($event, 'prop-' + prop.id)"
                      @drop="onResourceDrop($event, 'prop', prop.id)"
                    >
                      <img v-if="hasAssetImage(prop)" :src="assetImageUrl(prop)" class="cover-img" alt="" />
                      <div v-else-if="prop.error_msg || prop.errorMsg" class="cover-placeholder error" :title="prop.error_msg || prop.errorMsg">{{ prop.error_msg || prop.errorMsg }}</div>
                      <div v-else class="cover-placeholder">暂无图</div>
                      <div v-if="dragOverResourceKey === 'prop-' + prop.id" class="asset-cover-drop-hint">松开上传</div>
                    </div>
                    <div v-if="parseExtraImages(prop).length" class="extra-images-strip">
                      <div v-for="(ep, imageIndex) in parseExtraImages(prop)" :key="ep" class="extra-thumb" title="点击设为主图（悬停左上角可放大预览）">
                        <button type="button" class="extra-thumb-primary" :aria-label="`将${prop.name || '道具'}参考图${imageIndex + 1}设为主图`" @click="emit('set-primary-image', 'prop', prop, ep)">
                          <img :src="localPathToUrl(ep)" alt="" />
                        </button>
                        <button type="button" class="thumb-preview-btn" title="放大预览" :aria-label="`预览${prop.name || '道具'}参考图${imageIndex + 1}`" @click.stop="emit('preview-image', localPathToUrl(ep))">
                          <el-icon :size="10"><ZoomIn /></el-icon>
                        </button>
                        <button type="button" class="extra-thumb-remove" title="移除" :aria-label="`移除${prop.name || '道具'}参考图${imageIndex + 1}`" @click.stop="emit('remove-extra-image', 'prop', prop, ep)">×</button>
                      </div>
                    </div>
                    <div class="asset-cover-actions">
                      <el-tooltip :content="propUseQuadGrid ? '四视图道具（前/侧/后/顶，纯色无缝背景）' : '单图道具（纯色无缝背景）'" placement="top">
                        <el-button type="primary" size="small" :loading="generatingPropIds.has(prop.id)" @click="emit('generate-prop-image', prop, propUseQuadGrid)">
                          <el-icon v-if="!generatingPropIds.has(prop.id)"><MagicStick /></el-icon>
                          AI 生成
                        </el-button>
                      </el-tooltip>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'prop-' + prop.id" @click="onUploadResourceClick('prop', prop.id)">
                        <el-icon v-if="uploadingResourceId !== 'prop-' + prop.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                  </div>
                </div>
                <div v-if="propItems.length === 0" class="empty-tip">暂无道具，可从剧本提取或添加</div>
              </div>
            </div>
          </div>

          <!-- 场景生成 -->
          <div id="anchor-scenes" class="resource-block card">
            <h3 class="collapse-heading">
              <button
                type="button"
                class="collapse-header resource-block-header"
                :aria-expanded="!scenesBlockCollapsed"
                aria-controls="scenes-block-body"
                @click="scenesBlockCollapsed = !scenesBlockCollapsed"
              >
                <span class="resource-block-title">场景生成</span>
                <el-icon class="collapse-icon"><ArrowUp v-if="!scenesBlockCollapsed" /><ArrowDown v-else /></el-icon>
              </button>
            </h3>
            <div id="scenes-block-body" v-show="!scenesBlockCollapsed" class="resource-block-body">
              <div class="asset-actions">
                <ActionGate :reason="scenesExtractionDisabledReason" label="从剧本提取场景">
                  <el-button type="primary" size="small" :loading="scenesExtracting" :disabled="Boolean(scenesExtractionDisabledReason)" @click="emit('extract-scenes')">
                    从剧本提取场景
                  </el-button>
                </ActionGate>
                <ActionGate :reason="projectActionDisabledReason" label="添加场景">
                  <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" @click="emit('add-scene')">添加场景</el-button>
                </ActionGate>
                <el-button size="small" @click="emit('open-scene-library')">本剧场景库</el-button>
              </div>
              <div class="scene-gen-mode" style="margin: 8px 0; font-size: 13px;">
                <el-checkbox v-model="sceneUseQuadGrid">生成四宫格场景（默认单图）</el-checkbox>
              </div>
              <div class="asset-list asset-list-two">
                <div v-for="scene in scenes" :key="scene.id" class="asset-item asset-item-left-right">
                  <div class="asset-info">
                    <div class="asset-name">
                      <span>{{ scene.location }}</span>
                      <el-button type="danger" text size="small" class="btn-delete-icon" title="删除" :aria-label="`删除场景${scene.location || '未命名场景'}`" @click="emit('delete-scene', scene)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                    <div class="asset-desc-full">{{ scene.description || scene.prompt || scene.time || '暂无描述' }}</div>
                    <div class="asset-btns">
                      <el-button size="small" @click="emit('edit-scene', scene)">编辑</el-button>
                      <el-button size="small" :loading="addingSceneToLibraryId === scene.id" :disabled="!hasAssetImage(scene)" @click="emit('add-scene-to-library', scene)">
                        加入本剧库
                      </el-button>
                      <el-button size="small" :loading="addingSceneToMaterialId === scene.id" :disabled="!hasAssetImage(scene)" @click="emit('add-scene-to-material', scene)">
                        加入素材库
                      </el-button></div>
                    <div v-if="getSceneAffectedStoryboards(scene.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <span
                        v-for="sb in getSceneAffectedStoryboards(scene.id)"
                        :key="sb.id"
                        class="asl-chip"
                        title="点击跳转到该分镜"
                        @click="emit('scroll-to-storyboard', sb.id)"
                      >#{{ sb.storyboard_number }}</span>
                      <span v-if="regenSbImagesForAsset.has('scene-' + scene.id) && regenSbImagesProgress['scene-' + scene.id]" class="asl-progress">
                        {{ regenSbImagesProgress['scene-' + scene.id].current }}/{{ regenSbImagesProgress['scene-' + scene.id].total }}
                      </span>
                      <ActionGate :reason="storyboardMediaActionReason" label="重新生成关联分镜图">
                        <el-button
                          size="small"
                          class="asl-regen-btn"
                          :loading="regenSbImagesForAsset.has('scene-' + scene.id)"
                          :disabled="Boolean(storyboardMediaActionReason)"
                          @click="emit('regen-affected-sb-images', 'scene-' + scene.id, getSceneAffectedStoryboards(scene.id))"
                        >
                          <span v-if="!regenSbImagesForAsset.has('scene-' + scene.id)">↻ 重新生成分镜图</span>
                        </el-button>
                      </ActionGate>
                    </div>
                  </div>
                  <div class="asset-cover-wrap">
                    <div
                      class="asset-cover"
                      :class="{ 'asset-cover--clickable': hasAssetImage(scene), 'asset-cover--dragover': dragOverResourceKey === 'scene-' + scene.id }"
                      role="button"
                      :tabindex="hasAssetImage(scene) ? 0 : -1"
                      :aria-label="hasAssetImage(scene) ? `预览${scene.location || '场景'}图片` : undefined"
                      @click="hasAssetImage(scene) && emit('preview-image', assetImageUrl(scene))"
                      @keydown.enter.prevent="hasAssetImage(scene) && emit('preview-image', assetImageUrl(scene))"
                      @keydown.space.prevent="hasAssetImage(scene) && emit('preview-image', assetImageUrl(scene))"
                      @dragover="onResourceDragOver($event, 'scene', scene.id)"
                      @dragleave="onResourceDragLeave($event, 'scene-' + scene.id)"
                      @drop="onResourceDrop($event, 'scene', scene.id)"
                    >
                      <img v-if="hasAssetImage(scene)" :src="assetImageUrl(scene)" class="cover-img" alt="" />
                      <div v-else-if="scene.error_msg || scene.errorMsg" class="cover-placeholder error" :title="scene.error_msg || scene.errorMsg">{{ scene.error_msg || scene.errorMsg }}</div>
                      <div v-else class="cover-placeholder">暂无图</div>
                      <div v-if="dragOverResourceKey === 'scene-' + scene.id" class="asset-cover-drop-hint">松开上传</div>
                    </div>
                    <div v-if="parseExtraImages(scene).length" class="extra-images-strip">
                      <div v-for="(ep, imageIndex) in parseExtraImages(scene)" :key="ep" class="extra-thumb" title="点击设为主图（悬停左上角可放大预览）">
                        <button type="button" class="extra-thumb-primary" :aria-label="`将${scene.location || '场景'}参考图${imageIndex + 1}设为主图`" @click="emit('set-primary-image', 'scene', scene, ep)">
                          <img :src="localPathToUrl(ep)" alt="" />
                        </button>
                        <button type="button" class="thumb-preview-btn" title="放大预览" :aria-label="`预览${scene.location || '场景'}参考图${imageIndex + 1}`" @click.stop="emit('preview-image', localPathToUrl(ep))">
                          <el-icon :size="10"><ZoomIn /></el-icon>
                        </button>
                        <button type="button" class="extra-thumb-remove" title="移除" :aria-label="`移除${scene.location || '场景'}参考图${imageIndex + 1}`" @click.stop="emit('remove-extra-image', 'scene', scene, ep)">×</button>
                      </div>
                    </div>
                    <div class="asset-cover-actions">
                      <el-tooltip :content="sceneUseQuadGrid ? '四宫格场景（正/侧/俯/仰）' : '单图场景'" placement="top">
                        <el-button type="primary" size="small" :loading="generatingSceneIds.has(scene.id)" @click="emit('generate-scene-image', scene, sceneUseQuadGrid)">
                          <el-icon v-if="!generatingSceneIds.has(scene.id)"><MagicStick /></el-icon>
                          AI 生成
                        </el-button>
                      </el-tooltip>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'scene-' + scene.id" @click="onUploadResourceClick('scene', scene.id)">
                        <el-icon v-if="uploadingResourceId !== 'scene-' + scene.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                  </div>
                </div>
                <div v-if="scenes.length === 0" class="empty-tip">暂无场景，可从剧本提取或添加场景</div>
              </div>
            </div>
          </div>
        </div>
      </section>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowDown, ArrowUp, Delete, MagicStick, Upload, VideoPlay, ZoomIn } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  characters: { type: Array, default: () => [] },
  propItems: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  characterGenerationDisabledReason: { type: String, default: '' },
  projectActionDisabledReason: { type: String, default: '' },
  propsExtractionDisabledReason: { type: String, default: '' },
  scenesExtractionDisabledReason: { type: String, default: '' },
  storyboardMediaActionReason: { type: String, default: '' },
  charactersGenerating: { type: Boolean, default: false },
  propsExtracting: { type: Boolean, default: false },
  scenesExtracting: { type: Boolean, default: false },
  generatingCharIds: { type: [Set, Object], default: () => new Set() },
  generatingPropIds: { type: [Set, Object], default: () => new Set() },
  generatingSceneIds: { type: [Set, Object], default: () => new Set() },
  uploadingResourceId: { type: [String, null], default: null },
  addingCharToLibraryId: { type: [Number, String, null], default: null },
  addingCharToMaterialId: { type: [Number, String, null], default: null },
  addingPropToLibraryId: { type: [Number, String, null], default: null },
  addingPropToMaterialId: { type: [Number, String, null], default: null },
  addingSceneToLibraryId: { type: [Number, String, null], default: null },
  addingSceneToMaterialId: { type: [Number, String, null], default: null },
  regenSbImagesForAsset: { type: [Set, Object], default: () => new Set() },
  regenSbImagesProgress: { type: Object, default: () => ({}) },
  sd2CertifyingId: { type: [Number, String, null], default: null },
  sd2VoiceUploadingId: { type: [Number, String, null], default: null },
  hasAssetImage: { type: Function, required: true },
  assetImageUrl: { type: Function, required: true },
  charRoleLabel: { type: Function, required: true },
  localPathToUrl: { type: Function, required: true },
  parseExtraImages: { type: Function, required: true },
  getCharAffectedStoryboards: { type: Function, required: true },
  getPropAffectedStoryboards: { type: Function, required: true },
  getSceneAffectedStoryboards: { type: Function, required: true },
  sd2ActionLabel: { type: Function, required: true },
  sd2VoiceActionLabel: { type: Function, required: true },
})

const resourcePanelCollapsed = defineModel('resourcePanelCollapsed', { type: Boolean, default: false })
const charactersBlockCollapsed = defineModel('charactersBlockCollapsed', { type: Boolean, default: false })
const propsBlockCollapsed = defineModel('propsBlockCollapsed', { type: Boolean, default: false })
const scenesBlockCollapsed = defineModel('scenesBlockCollapsed', { type: Boolean, default: false })
const propUseQuadGrid = defineModel('propUseQuadGrid', { type: Boolean, default: false })
const sceneUseQuadGrid = defineModel('sceneUseQuadGrid', { type: Boolean, default: false })

const emit = defineEmits([
  'generate-characters', 'add-character', 'open-char-library',
  'extract-props', 'add-prop', 'open-prop-library',
  'extract-scenes', 'add-scene', 'open-scene-library',
  'generate-character-image', 'generate-prop-image', 'generate-scene-image',
  'edit-character', 'edit-prop', 'edit-scene',
  'delete-character', 'delete-prop', 'delete-scene',
  'add-character-to-library', 'add-character-to-material',
  'add-prop-to-library', 'add-prop-to-material',
  'add-scene-to-library', 'add-scene-to-material',
  'regen-affected-sb-images', 'upload-resource-image',
  'set-primary-image', 'remove-extra-image', 'preview-image',
  'scroll-to-storyboard', 'sd2-primary-action', 'sd2-voice-primary-action',
  'sd2-voice-replace', 'play-sd2-voice',
])

const { hasAssetImage, assetImageUrl, charRoleLabel, localPathToUrl, parseExtraImages, getCharAffectedStoryboards, getPropAffectedStoryboards, getSceneAffectedStoryboards, sd2ActionLabel, sd2VoiceActionLabel } = props

const resourceImageFileInput = ref(null)
const pendingUpload = ref(null)
const dragOverResourceKey = ref(null)

function onUploadResourceClick(type, id) {
  pendingUpload.value = { type, id }
  resourceImageFileInput.value?.click()
}
function onResourceImageFileChange(ev) {
  const file = ev.target?.files?.[0]
  const pending = pendingUpload.value
  ev.target.value = ''
  pendingUpload.value = null
  if (!file || !pending) return
  emit('upload-resource-image', pending.type, pending.id, file)
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
  const file = e.dataTransfer?.files ? Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')) : null
  if (file) emit('upload-resource-image', type, id, file)
}
</script>
<style scoped>
.section { margin-bottom: 24px; }
.card { background: #1e1f28; border-radius: 14px; padding: 22px; border: 1px solid rgba(255, 255, 255, 0.06); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15); }
html.light .card { background: rgba(255, 255, 255, 0.75); border-color: rgba(139, 92, 246, 0.08); }
.section-title { font-size: 1.05rem; margin: 0 0 4px; color: #f4f4f5; font-weight: 600; }
html.light .section-title { color: #1e1b4b; }
@media (max-width: 768px) { .asset-list-two { grid-template-columns: 1fr; } }
.asset-storyboard-link {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding: 6px 8px;
  background: rgba(99, 102, 241, 0.07);
  border: 1px solid rgba(99, 102, 241, 0.18);
  border-radius: 6px;
  min-height: 28px;
}
.asl-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}
.asl-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.35);
  color: #a5b4fc;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.asl-chip:hover {
  background: rgba(99, 102, 241, 0.28);
  box-shadow: 0 0 6px rgba(99, 102, 241, 0.4);
  color: #c7d2fe;
}
.asl-regen-btn {
  margin-left: auto !important;
  flex-shrink: 0;
  height: 22px !important;
  padding: 0 10px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  background: rgba(251, 146, 60, 0.15) !important;
  border: 1px solid rgba(251, 146, 60, 0.5) !important;
  color: #fb923c !important;
  border-radius: 11px !important;
  transition: background 0.15s, box-shadow 0.15s !important;
}
.asl-regen-btn:not(.is-loading):hover {
  background: rgba(251, 146, 60, 0.28) !important;
  box-shadow: 0 0 6px rgba(251, 146, 60, 0.35) !important;
  color: #fdba74 !important;
}
.asl-progress {
  font-size: 11px;
  color: #fb923c;
  margin-left: 4px;
  flex-shrink: 0;
}
/* 参考图上传区（添加角色/道具/场景弹窗顶部） */
.resource-panel {
  padding: 0;
  overflow: hidden;
}
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
.resource-panel-body {
  padding: 16px 20px 20px;
}
.resource-block {
  margin-bottom: 20px;
  padding: 0;
  overflow: hidden;
}
.resource-block:last-child {
  margin-bottom: 0;
}
.resource-block-header {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.resource-block-header .collapse-icon {
  font-size: 1rem;
}
.resource-block-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: #e4e4e7;
}
html.light .resource-block-title {
  color: #18181b;
}
.resource-block-body {
  padding: 12px 14px 14px;
}
.resource-block-body .asset-actions {
  margin-bottom: 12px;
}
.resource-block-body .asset-list-two {
  gap: 16px;
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
.asset-actions { margin-bottom: 12px; }
.asset-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.asset-list-two {
  grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
  gap: 20px;
}
.asset-item {
  background: #22232d;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.asset-item-left-right {
  flex-direction: row;
  align-items: stretch;
}
.asset-item-left-right .asset-info {
  flex: 1;
  min-width: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
}
.asset-item-left-right .asset-name {
  font-size: 1.05rem;
  margin-bottom: 8px;
}
.asset-item-left-right .asset-desc-full {
  flex: 1;
  font-size: 0.875rem;
  color: #a1a1aa;
  line-height: 1.5;
  margin-bottom: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.asset-item-left-right .asset-cover-wrap {
  flex-shrink: 0;
  align-self: flex-start;
}
.asset-item-left-right .asset-cover {
  width: 200px;
  height: 200px;
}
.asset-item-left-right .asset-cover.asset-cover--clickable {
  cursor: pointer;
}
.asset-cover {
  width: 100%;
  aspect-ratio: 1;
  background: #2a2b36;
  position: relative;
  overflow: hidden;
}
.asset-item-left-right .asset-cover .cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5a5a66;
  font-size: 0.85rem;
}
.cover-placeholder.error {
  background: #450a0a;
  color: #f87171;
  font-size: 0.8rem;
  padding: 8px;
  line-height: 1.4;
  word-break: break-all;
  text-align: center;
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
.asset-cover--dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  background: rgba(64, 158, 255, 0.08);
}
.asset-cover-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.9rem;
  pointer-events: none;
}
.asset-cover[role="button"]:focus-visible { outline: 2px solid #818cf8; outline-offset: -2px; }
.asset-info { padding: 10px; }
.asset-name { font-weight: 600; margin-bottom: 4px; color: #e4e4e7; }
.asset-desc {
  font-size: 0.8rem;
  color: #a1a1aa;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-desc-full {
  font-size: 0.875rem;
  color: #a1a1aa;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.asset-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.asset-item-left-right .asset-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.asset-item-left-right .asset-name span { flex: 1; min-width: 0; }
.btn-delete-icon { flex-shrink: 0; padding: 2px 4px !important; opacity: 0.45; transition: opacity 0.15s; }
.btn-delete-icon:hover { opacity: 1; }
/* 图片 + 操作按钮 竖向包裹 */
.asset-cover-wrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 200px;
}
.asset-cover-actions {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.asset-cover-actions .el-button { flex: 1; justify-content: center; }
html.light .asset-cover-actions { border-top-color: rgba(139,92,246,0.1); }
/* 额外参考图缩略图条 */
.extra-images-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 5px 8px;
  background: rgba(0,0,0,0.15);
}
.extra-thumb {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: border-color 0.15s;
}
.extra-thumb:hover { border-color: #a78bfa; }
.extra-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.extra-thumb-primary {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.extra-thumb-primary:focus-visible { outline: 2px solid #818cf8; outline-offset: -2px; }
.extra-thumb-remove {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 16px;
  height: 16px;
  background: rgba(239,68,68,0.85);
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
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
.extra-thumb:hover .extra-thumb-remove,
.extra-thumb:hover .thumb-preview-btn,
.extra-thumb:focus-within .extra-thumb-remove,
.extra-thumb:focus-within .thumb-preview-btn { opacity: 1; }
html.light .extra-images-strip { background: rgba(139,92,246,0.05); }
html.light .asset-item {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(139, 92, 246, 0.12);
  box-shadow: 0 2px 10px rgba(139, 92, 246, 0.06);
}
html.light .asset-item:hover {
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.12);
  border-color: rgba(139, 92, 246, 0.3);
  transform: translateY(-2px);
  transition: box-shadow 0.25s, transform 0.2s, border-color 0.25s;
}
html.light .asset-cover {
  background: #f3f4f6;
}
html.light .asset-name {
  color: #18181b;
}
html.light .asset-desc,
html.light .asset-desc-full,
html.light .asset-item-left-right .asset-desc-full {
  color: #6b7280;
}
html.light .cover-placeholder {
  color: #9ca3af;
  background: #f3f4f6;
}
html.light .cover-placeholder.error {
  background: #fef2f2;
  color: #dc2626;
}
html.light .empty-tip {
  color: #9ca3af;
}

/* 分镜：每行一个，三列布局 */
</style>
