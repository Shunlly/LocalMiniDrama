<template>

              <div class="asset-actions">
                <ActionGate :reason="propsExtractionDisabledReason" label="从剧本提取道具">
                  <el-button type="primary" size="small" :loading="propsExtracting" :disabled="Boolean(propsExtractionDisabledReason)" :title="propsExtracting ? '正在提取道具，请稍候' : (propsExtractionDisabledReason || undefined)" @click="emit('extract-props')">从剧本提取道具</el-button>
                </ActionGate>
                <ActionGate :reason="projectActionDisabledReason" label="添加道具">
                  <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" :title="projectActionDisabledReason || undefined" @click="emit('add-prop')">添加道具</el-button>
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
                      <ActionGate :reason="missingAssetImageReason(prop, 'prop')" label="加入本剧库">
                        <el-button size="small" :loading="addingPropToLibraryId === prop.id" :disabled="!hasAssetImage(prop)" @click="emit('add-prop-to-library', prop)">
                          加入本剧库
                        </el-button>
                      </ActionGate>
                      <ActionGate :reason="missingAssetImageReason(prop, 'prop')" label="加入素材库">
                        <el-button size="small" :loading="addingPropToMaterialId === prop.id" :disabled="!hasAssetImage(prop)" @click="emit('add-prop-to-material', prop)">
                          加入素材库
                        </el-button>
                      </ActionGate></div>
                    <div v-if="getPropAffectedStoryboards(prop.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <button
                        v-for="sb in getPropAffectedStoryboards(prop.id)"
                        :key="sb.id"
                        type="button"
                        class="asl-chip"
                        :title="`跳转到分镜 ${sb.storyboard_number}`"
                        :aria-label="`跳转到分镜 ${sb.storyboard_number}`"
                        @click="emit('scroll-to-storyboard', sb.id)"
                      >#{{ sb.storyboard_number }}</button>
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
                      :role="hasAssetImage(prop) ? 'button' : undefined"
                      :tabindex="hasAssetImage(prop) ? 0 : undefined"
                      :aria-label="hasAssetImage(prop) ? `预览${prop.name || '道具'}图片` : undefined"
                      @click="hasAssetImage(prop) && emit('preview-image', assetImageUrl(prop))"
                      @keydown.enter.prevent="hasAssetImage(prop) && emit('preview-image', assetImageUrl(prop))"
                      @keydown.space.prevent="hasAssetImage(prop) && emit('preview-image', assetImageUrl(prop))"
                      @dragover="resourceDragOver($event, 'prop', prop.id)"
                      @dragleave="resourceDragLeave($event, 'prop-' + prop.id)"
                      @drop="resourceDrop($event, 'prop', prop.id)"
                    >
                      <img v-if="hasAssetImage(prop)" :src="assetImageUrl(prop)" class="cover-img" alt="" />
                      <div v-else-if="prop.error_msg || prop.errorMsg" class="cover-placeholder error" :title="assetErrorText(prop)">{{ assetErrorText(prop) }}</div>
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
                        <el-button type="primary" size="small" :loading="generatingPropIds.has(prop.id)" :title="generatingPropIds.has(prop.id) ? '正在生成道具图，请稍候' : undefined" @click="emit('generate-prop-image', prop, propUseQuadGrid)">
                          <el-icon v-if="!generatingPropIds.has(prop.id)"><MagicStick /></el-icon>
                          AI 生成
                        </el-button>
                      </el-tooltip>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'prop-' + prop.id" @click="uploadResourceClick('prop', prop.id)">
                        <el-icon v-if="uploadingResourceId !== 'prop-' + prop.id"><Upload /></el-icon>
                        上传
                      </el-button>
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

const propUseQuadGrid = defineModel('propUseQuadGrid', { type: Boolean, default: false })

defineProps({
  propItems: { type: Array, default: () => [] },
  propsExtractionDisabledReason: { type: String, default: '' },
  propsExtracting: { type: Boolean, default: false },
  generatingPropIds: { type: [Set, Object], default: () => new Set() },
  addingPropToLibraryId: { type: [Number, String, null], default: null },
  addingPropToMaterialId: { type: [Number, String, null], default: null },
  getPropAffectedStoryboards: { type: Function, required: true },
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
  'extract-props', 'add-prop', 'open-prop-library',
  'generate-prop-image', 'edit-prop', 'delete-prop',
  'add-prop-to-library', 'add-prop-to-material',
  'regen-affected-sb-images', 'set-primary-image', 'remove-extra-image',
  'preview-image', 'scroll-to-storyboard',
])
</script>

<style scoped src="./filmCreateResourceBlock.css"></style>
