<template>

              <div class="asset-actions">
                <ActionGate :reason="characterGenerationDisabledReason" label="剧本自动提取角色">
                  <el-button :type="characters.length ? 'primary' : undefined" size="small" :loading="charactersGenerating" :disabled="Boolean(characterGenerationDisabledReason)" :title="charactersGenerating ? '正在提取角色，请稍候' : (characterGenerationDisabledReason || undefined)" :aria-label="extractCharactersAriaLabel" @click="emit('generate-characters')">
                    剧本自动提取角色
                  </el-button>
                </ActionGate>
                <ActionGate :reason="projectActionDisabledReason" label="添加角色">
                  <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" :title="projectActionDisabledReason || undefined" :aria-label="addCharacterAriaLabel" @click="emit('add-character')">添加角色</el-button>
                </ActionGate>
                <el-button size="small" aria-label="打开本剧角色库" @click="emit('open-char-library')">本剧角色库</el-button>
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
                      <el-button size="small" :aria-label="`编辑角色${char.name || '未命名角色'}`" @click="emit('edit-character', char)">编辑</el-button>
                      <ActionGate :reason="missingAssetImageReason(char, 'character')" label="加入本剧库">
                        <el-button size="small" :loading="addingCharToLibraryId === char.id" :disabled="!hasAssetImage(char)" :aria-label="addingCharToLibraryId === char.id ? '正在将角色加入本剧库，请稍候' : `将${char.name || '未命名角色'}加入本剧库`" @click="emit('add-character-to-library', char)">
                          加入本剧库
                        </el-button>
                      </ActionGate>
                      <ActionGate :reason="missingAssetImageReason(char, 'character')" label="加入素材库">
                        <el-button size="small" :loading="addingCharToMaterialId === char.id" :disabled="!hasAssetImage(char)" :aria-label="addingCharToMaterialId === char.id ? '正在将角色加入素材库，请稍候' : `将${char.name || '未命名角色'}加入素材库`" @click="emit('add-character-to-material', char)">
                          加入素材库
                        </el-button>
                      </ActionGate>
                      <ActionGate :reason="missingAssetImageReason(char, 'character')" :label="sd2ActionLabel(char)">
                        <el-button
                          size="small"
                          :type="char.seedance2_asset?.status === 'active' ? 'success' : 'warning'"
                          plain
                          :loading="sd2CertifyingId === char.id"
                          :disabled="!hasAssetImage(char)"
                          :title="sd2CertActionTitle(char)"
                          :aria-label="sd2ActionLabel(char)"
                          @click="emit('sd2-primary-action', char)"
                        >
                          {{ sd2ActionLabel(char) }}
                        </el-button>
                      </ActionGate>
                    </div>

                    <!-- Seedance 2.0 音色参考（仅该模型有效，其他模型不生效） -->
                    <div class="sd2-voice-row" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <template v-if="char.seedance2_voice_asset?.status === 'active'">
                        <!-- 音色参考已设置：显示试听 + 更换 -->
                        <el-button
                          size="small"
                          type="success"
                          plain
                          title="试听角色音色"
                          :aria-label="`试听${char.name || '角色'}音色`"
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
                          title="更换角色音色"
                          :aria-label="`更换${char.name || '角色'}音色`"
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
                          :title="sd2VoiceActionLabel(char)"
                          :aria-label="sd2VoiceActionLabel(char)"
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
                      <button
                        v-for="sb in getCharAffectedStoryboards(char.id)"
                        :key="sb.id"
                        type="button"
                        class="asl-chip"
                        :title="`跳转到分镜 ${sb.storyboard_number}`"
                        :aria-label="`跳转到分镜 ${sb.storyboard_number}`"
                        @click="emit('scroll-to-storyboard', sb.id)"
                      >#{{ sb.storyboard_number }}</button>
                      <span v-if="regenSbImagesForAsset.has('char-' + char.id) && regenSbImagesProgress['char-' + char.id]" class="asl-progress">
                        {{ regenSbImagesProgress['char-' + char.id].current }}/{{ regenSbImagesProgress['char-' + char.id].total }}
                      </span>
                      <ActionGate :reason="storyboardMediaActionReason" label="重新生成关联分镜图">
                        <el-button
                          size="small"
                          class="asl-regen-btn"
                          :loading="regenSbImagesForAsset.has('char-' + char.id)"
                          :disabled="Boolean(storyboardMediaActionReason)"
                          :title="storyboardMediaActionReason || undefined"
                          :aria-label="regenSbImagesForAsset.has('char-' + char.id) ? '正在重新生成相关分镜图，请稍候' : (storyboardMediaActionReason || `重新生成${char.name || '未命名角色'}相关分镜图`)"
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
                      :role="hasAssetImage(char) ? 'button' : undefined"
                      :tabindex="hasAssetImage(char) ? 0 : undefined"
                      :aria-label="hasAssetImage(char) ? `预览${char.name || '角色'}图片` : undefined"
                      @click="hasAssetImage(char) && emit('preview-image', assetImageUrl(char))"
                      @keydown.enter.prevent="hasAssetImage(char) && emit('preview-image', assetImageUrl(char))"
                      @keydown.space.prevent="hasAssetImage(char) && emit('preview-image', assetImageUrl(char))"
                      @dragover="resourceDragOver($event, 'character', char.id)"
                      @dragleave="resourceDragLeave($event, 'char-' + char.id)"
                      @drop="resourceDrop($event, 'character', char.id)"
                    >
                      <img v-if="hasAssetImage(char)" :src="assetImageUrl(char)" class="cover-img" alt="" />
                      <div v-else-if="char.error_msg || char.errorMsg" class="cover-placeholder error" :title="displayAssetError(char)">{{ displayAssetError(char) }}</div>
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
                      <el-button type="primary" size="small" :loading="generatingCharIds.has(char.id)" :title="generatingCharIds.has(char.id) ? '正在生成角色图，请稍候' : undefined" :aria-label="generatingCharIds.has(char.id) ? '正在生成角色图，请稍候' : `AI 生成${char.name || '未命名角色'}图片`" @click="emit('generate-character-image', char)">
                        <el-icon v-if="!generatingCharIds.has(char.id)"><MagicStick /></el-icon>
                        AI 生成
                      </el-button>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'char-' + char.id" :aria-label="uploadingResourceId === 'char-' + char.id ? '正在上传角色图，请稍候' : `上传${char.name || '未命名角色'}图片`" @click="uploadResourceClick('character', char.id)">
                        <el-icon v-if="uploadingResourceId !== 'char-' + char.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                  </div>
                </div>
                <slot name="empty" />

              </div>
</template>

<script setup>
import { computed } from 'vue'
import { Delete, MagicStick, Upload, VideoPlay, ZoomIn } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import { describeActionAriaLabel, toFilmCreateUserFacingText } from './filmCreateActionCopy.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  characters: { type: Array, default: () => [] },
  characterGenerationDisabledReason: { type: String, default: '' },
  charactersGenerating: { type: Boolean, default: false },
  generatingCharIds: { type: [Set, Object], default: () => new Set() },
  addingCharToLibraryId: { type: [Number, String, null], default: null },
  addingCharToMaterialId: { type: [Number, String, null], default: null },
  sd2CertifyingId: { type: [Number, String, null], default: null },
  sd2VoiceUploadingId: { type: [Number, String, null], default: null },
  charRoleLabel: { type: Function, required: true },
  getCharAffectedStoryboards: { type: Function, required: true },
  sd2ActionLabel: { type: Function, required: true },
  sd2VoiceActionLabel: { type: Function, required: true },
  sd2CertActionTitle: { type: Function, required: true },
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

const extractCharactersAriaLabel = computed(() => describeActionAriaLabel('剧本自动提取角色', {
  loading: props.charactersGenerating,
  loadingLabel: '正在剧本自动提取角色',
  disabledReason: props.characterGenerationDisabledReason,
}))
const addCharacterAriaLabel = computed(() => describeActionAriaLabel('添加角色', {
  disabledReason: props.projectActionDisabledReason,
}))

function displayAssetError(asset) {
  return toFilmCreateUserFacingText(props.assetErrorText(asset), '生成失败')
}

defineEmits([
  'generate-characters', 'add-character', 'open-char-library',
  'generate-character-image', 'edit-character', 'delete-character',
  'add-character-to-library', 'add-character-to-material',
  'regen-affected-sb-images', 'set-primary-image', 'remove-extra-image',
  'preview-image', 'scroll-to-storyboard',
  'sd2-primary-action', 'sd2-voice-primary-action', 'sd2-voice-replace', 'play-sd2-voice',
])
</script>

<style scoped src="./filmCreateResourceBlock.css"></style>
