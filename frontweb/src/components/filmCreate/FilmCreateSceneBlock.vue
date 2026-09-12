<template>

              <div class="asset-actions">
                <ActionGate :reason="scenesExtractionDisabledReason" label="从剧本提取场景">
                  <el-button type="primary" size="small" :loading="scenesExtracting" :disabled="Boolean(scenesExtractionDisabledReason)" :title="scenesExtracting ? '正在提取场景，请稍候' : (scenesExtractionDisabledReason || undefined)" :aria-label="scenesExtracting ? '正在提取场景，请稍候' : (scenesExtractionDisabledReason || '从剧本提取场景')" @click="emit('extract-scenes')">
                    从剧本提取场景
                  </el-button>
                </ActionGate>
                <ActionGate :reason="projectActionDisabledReason" label="添加场景">
                  <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" :title="projectActionDisabledReason || undefined" :aria-label="projectActionDisabledReason || '添加场景'" @click="emit('add-scene')">添加场景</el-button>
                </ActionGate>
                <el-button size="small" aria-label="打开本剧场景库" @click="emit('open-scene-library')">本剧场景库</el-button>
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
                      <el-button size="small" :aria-label="`编辑场景${scene.location || '未命名场景'}`" @click="emit('edit-scene', scene)">编辑</el-button>
                      <ActionGate :reason="missingAssetImageReason(scene, 'scene')" label="加入本剧库">
                        <el-button size="small" :loading="addingSceneToLibraryId === scene.id" :disabled="!hasAssetImage(scene)" :aria-label="addingSceneToLibraryId === scene.id ? '正在将场景加入本剧库，请稍候' : `将${scene.location || '未命名场景'}加入本剧库`" @click="emit('add-scene-to-library', scene)">
                          加入本剧库
                        </el-button>
                      </ActionGate>
                      <ActionGate :reason="missingAssetImageReason(scene, 'scene')" label="加入素材库">
                        <el-button size="small" :loading="addingSceneToMaterialId === scene.id" :disabled="!hasAssetImage(scene)" :aria-label="addingSceneToMaterialId === scene.id ? '正在将场景加入素材库，请稍候' : `将${scene.location || '未命名场景'}加入素材库`" @click="emit('add-scene-to-material', scene)">
                          加入素材库
                        </el-button>
                      </ActionGate></div>
                    <div v-if="getSceneAffectedStoryboards(scene.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <button
                        v-for="sb in getSceneAffectedStoryboards(scene.id)"
                        :key="sb.id"
                        type="button"
                        class="asl-chip"
                        :title="`跳转到分镜 ${sb.storyboard_number}`"
                        :aria-label="`跳转到分镜 ${sb.storyboard_number}`"
                        @click="emit('scroll-to-storyboard', sb.id)"
                      >#{{ sb.storyboard_number }}</button>
                      <span v-if="regenSbImagesForAsset.has('scene-' + scene.id) && regenSbImagesProgress['scene-' + scene.id]" class="asl-progress">
                        {{ regenSbImagesProgress['scene-' + scene.id].current }}/{{ regenSbImagesProgress['scene-' + scene.id].total }}
                      </span>
                      <ActionGate :reason="storyboardMediaActionReason" label="重新生成关联分镜图">
                        <el-button
                          size="small"
                          class="asl-regen-btn"
                          :loading="regenSbImagesForAsset.has('scene-' + scene.id)"
                          :disabled="Boolean(storyboardMediaActionReason)"
                          :title="storyboardMediaActionReason || undefined"
                          :aria-label="regenSbImagesForAsset.has('scene-' + scene.id) ? '正在重新生成相关分镜图，请稍候' : (storyboardMediaActionReason || `重新生成${scene.location || '未命名场景'}相关分镜图`)"
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
                      :role="hasAssetImage(scene) ? 'button' : undefined"
                      :tabindex="hasAssetImage(scene) ? 0 : undefined"
                      :aria-label="hasAssetImage(scene) ? `预览${scene.location || '场景'}图片` : undefined"
                      @click="hasAssetImage(scene) && emit('preview-image', assetImageUrl(scene))"
                      @keydown.enter.prevent="hasAssetImage(scene) && emit('preview-image', assetImageUrl(scene))"
                      @keydown.space.prevent="hasAssetImage(scene) && emit('preview-image', assetImageUrl(scene))"
                      @dragover="resourceDragOver($event, 'scene', scene.id)"
                      @dragleave="resourceDragLeave($event, 'scene-' + scene.id)"
                      @drop="resourceDrop($event, 'scene', scene.id)"
                    >
                      <img v-if="hasAssetImage(scene)" :src="assetImageUrl(scene)" class="cover-img" alt="" />
                      <div v-else-if="scene.error_msg || scene.errorMsg" class="cover-placeholder error" :title="assetErrorText(scene)">{{ assetErrorText(scene) }}</div>
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
                        <el-button type="primary" size="small" :loading="generatingSceneIds.has(scene.id)" :title="generatingSceneIds.has(scene.id) ? '正在生成场景图，请稍候' : undefined" :aria-label="generatingSceneIds.has(scene.id) ? '正在生成场景图，请稍候' : `AI 生成${scene.location || '未命名场景'}图片`" @click="emit('generate-scene-image', scene, sceneUseQuadGrid)">
                          <el-icon v-if="!generatingSceneIds.has(scene.id)"><MagicStick /></el-icon>
                          AI 生成
                        </el-button>
                      </el-tooltip>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'scene-' + scene.id" :aria-label="uploadingResourceId === 'scene-' + scene.id ? '正在上传场景图，请稍候' : `上传${scene.location || '未命名场景'}图片`" @click="uploadResourceClick('scene', scene.id)">
                        <el-icon v-if="uploadingResourceId !== 'scene-' + scene.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                    <div class="scene-panorama-row" aria-label="场景全景图">
                      <ActionGate
                        :reason="missingScenePanoramaReason(scene)"
                        :label="(scene.panorama_local_path || scene.panorama_image_url) ? '重新生成全景图' : '生成全景图'"
                      >
                        <el-button
                          size="small"
                          :loading="generatingPanoramaIds.has(scene.id)"
                          :disabled="Boolean(missingScenePanoramaReason(scene))"
                          :title="generatingPanoramaIds.has(scene.id) ? '正在生成全景图，请稍候' : (missingScenePanoramaReason(scene) || undefined)"
                          :aria-label="generatingPanoramaIds.has(scene.id) ? '正在生成全景图，请稍候' : (missingScenePanoramaReason(scene) || ((scene.panorama_local_path || scene.panorama_image_url) ? `重新生成${scene.location || '场景'}全景图` : `生成${scene.location || '场景'}全景图`))"
                          @click="emit('generate-scene-panorama', scene)"
                        >{{ (scene.panorama_local_path || scene.panorama_image_url) ? '重新生成全景图' : '生成全景图' }}</el-button>
                      </ActionGate>
                      <button
                        v-if="scenePanoramaUrl(scene)"
                        type="button"
                        class="scene-panorama-thumb"
                        :aria-label="`预览${scene.location || '场景'}全景图`"
                        @click="emit('preview-image', scenePanoramaUrl(scene))"
                      >
                        <img :src="scenePanoramaUrl(scene)" alt="" />
                      </button>
                      <button
                        v-if="scenePanoramaUrl(scene)"
                        type="button"
                        class="scene-panorama-preview-btn"
                        :aria-label="`预览${scene.location || '场景'}全景图`"
                        @click="emit('preview-image', scenePanoramaUrl(scene))"
                      >预览全景</button>
                      <span v-if="generatingPanoramaIds.has(scene.id)" class="scene-panorama-loading" role="status">生成全景图…</span>
                    </div>
                  </div>
                </div>
                <slot name="empty" />

              </div>
</template>

<script setup>
import { Delete, MagicStick, Upload, ZoomIn } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineOptions({ inheritAttrs: false })

const sceneUseQuadGrid = defineModel('sceneUseQuadGrid', { type: Boolean, default: false })

defineProps({
  scenes: { type: Array, default: () => [] },
  scenesExtractionDisabledReason: { type: String, default: '' },
  scenesExtracting: { type: Boolean, default: false },
  generatingSceneIds: { type: [Set, Object], default: () => new Set() },
  generatingPanoramaIds: { type: [Set, Object], default: () => new Set() },
  addingSceneToLibraryId: { type: [Number, String, null], default: null },
  addingSceneToMaterialId: { type: [Number, String, null], default: null },
  getSceneAffectedStoryboards: { type: Function, required: true },
  scenePanoramaUrl: { type: Function, required: true },
  missingScenePanoramaReason: { type: Function, required: true },
  hasAssetImage: { type: Function, required: true },
  assetImageUrl: { type: Function, required: true },
  localPathToUrl: { type: Function, required: true },
  parseExtraImages: { type: Function, required: true },
  missingAssetImageReason: { type: Function, required: true },
  assetErrorText: { type: Function, required: true },
  uploadResourceClick: { type: Function, required: true },
  resourceDragOver: { type: Function, required: true },
  resourceDragLeave: { type: Function, required: true },
  resourceDrop: { type: Function, required: true },
  projectActionDisabledReason: { type: String, default: '' },
  storyboardMediaActionReason: { type: String, default: '' },
  uploadingResourceId: { type: [String, null], default: null },
  regenSbImagesForAsset: { type: [Set, Object], default: () => new Set() },
  regenSbImagesProgress: { type: Object, default: () => ({}) },
  dragOverResourceKey: { type: [String, null], default: null },
})

defineEmits([
  'extract-scenes', 'add-scene', 'open-scene-library',
  'generate-scene-image', 'generate-scene-panorama',
  'edit-scene', 'delete-scene',
  'add-scene-to-library', 'add-scene-to-material',
  'regen-affected-sb-images', 'set-primary-image', 'remove-extra-image',
  'preview-image', 'scroll-to-storyboard',
])
</script>

<style scoped src="./filmCreateResourceBlock.css"></style>
