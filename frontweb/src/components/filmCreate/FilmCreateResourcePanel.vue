<template>
  <div class="film-create-resource-root">
      <input
        ref="resourceImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        tabindex="-1"
        aria-hidden="true"
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
          <!-- 角色 -->
          <div id="anchor-characters" class="resource-block card">
            <h3 class="collapse-heading">
              <button
                type="button"
                class="collapse-header resource-block-header"
                :aria-expanded="!charactersBlockCollapsed"
                aria-controls="characters-block-body"
                @click="charactersBlockCollapsed = !charactersBlockCollapsed"
              >
                <span class="resource-block-title">角色</span>
                <el-icon class="collapse-icon"><ArrowUp v-if="!charactersBlockCollapsed" /><ArrowDown v-else /></el-icon>
              </button>
            </h3>
            <div id="characters-block-body" v-show="!charactersBlockCollapsed" class="resource-block-body">
              <FilmCreateCharacterBlock v-bind="characterBlockProps" v-on="characterBlockEvents">
                <template #empty>
                  <div
                  v-if="characters.length === 0"
                  class="empty-tip resource-empty-tip"
                  role="status"
                >
                  <p class="resource-empty-copy">暂无角色，可用「剧本自动提取角色」或「添加角色」</p>
                  <div class="resource-empty-actions">
                    <template v-if="needsEpisode">
                      <el-button v-if="!hasAnyEpisode" type="primary" size="small" aria-label="去创建剧集后再提取角色" @click="goCreateEpisode">去创建剧集</el-button>
                      <el-button v-else type="primary" size="small" aria-label="去选择剧集后再提取角色" @click="goSelectEpisode">去选择剧集</el-button>
                    </template>
                    <template v-else>
                      <ActionGate :reason="characterGenerationDisabledReason" label="剧本自动提取角色">
                        <el-button type="primary" size="small" :loading="charactersGenerating" :disabled="Boolean(characterGenerationDisabledReason)" :title="charactersGenerating ? '正在提取角色，请稍候' : (characterGenerationDisabledReason || undefined)" aria-label="剧本自动提取角色" @click="emit('generate-characters')">剧本自动提取角色</el-button>
                      </ActionGate>
                      <ActionGate :reason="projectActionDisabledReason" label="添加角色">
                        <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" :title="projectActionDisabledReason || undefined" aria-label="添加角色" @click="emit('add-character')">添加角色</el-button>
                      </ActionGate>
                    </template>
                  </div>
                </div>
                </template>
              </FilmCreateCharacterBlock>
</div>
          </div>

          <!-- 道具 -->
          <div id="anchor-props" class="resource-block card">
            <h3 class="collapse-heading">
              <button
                type="button"
                class="collapse-header resource-block-header"
                :aria-expanded="!propsBlockCollapsed"
                aria-controls="props-block-body"
                @click="propsBlockCollapsed = !propsBlockCollapsed"
              >
                <span class="resource-block-title">道具</span>
                <el-icon class="collapse-icon"><ArrowUp v-if="!propsBlockCollapsed" /><ArrowDown v-else /></el-icon>
              </button>
            </h3>
            <div id="props-block-body" v-show="!propsBlockCollapsed" class="resource-block-body">
              <FilmCreatePropBlock v-bind="propBlockProps" v-on="propBlockEvents" v-model:prop-use-quad-grid="propUseQuadGrid">
                <template #empty>
                  <div
                  v-if="propItems.length === 0"
                  class="empty-tip resource-empty-tip"
                  role="status"
                >
                  <p class="resource-empty-copy">暂无道具，可用「从剧本提取道具」或「添加道具」</p>
                  <div class="resource-empty-actions">
                    <template v-if="needsEpisode">
                      <el-button v-if="!hasAnyEpisode" type="primary" size="small" aria-label="去创建剧集后再提取道具" @click="goCreateEpisode">去创建剧集</el-button>
                      <el-button v-else type="primary" size="small" aria-label="去选择剧集后再提取道具" @click="goSelectEpisode">去选择剧集</el-button>
                    </template>
                    <template v-else>
                      <ActionGate :reason="propsExtractionDisabledReason" label="从剧本提取道具">
                        <el-button type="primary" size="small" :loading="propsExtracting" :disabled="Boolean(propsExtractionDisabledReason)" :title="propsExtracting ? '正在提取道具，请稍候' : (propsExtractionDisabledReason || undefined)" aria-label="从剧本提取道具" @click="emit('extract-props')">从剧本提取道具</el-button>
                      </ActionGate>
                      <ActionGate :reason="projectActionDisabledReason" label="添加道具">
                        <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" :title="projectActionDisabledReason || undefined" aria-label="添加道具" @click="emit('add-prop')">添加道具</el-button>
                      </ActionGate>
                    </template>
                  </div>
                </div>
                </template>
              </FilmCreatePropBlock>
</div>
          </div>

          <!-- 场景 -->
          <div id="anchor-scenes" class="resource-block card">
            <h3 class="collapse-heading">
              <button
                type="button"
                class="collapse-header resource-block-header"
                :aria-expanded="!scenesBlockCollapsed"
                aria-controls="scenes-block-body"
                @click="scenesBlockCollapsed = !scenesBlockCollapsed"
              >
                <span class="resource-block-title">场景</span>
                <el-icon class="collapse-icon"><ArrowUp v-if="!scenesBlockCollapsed" /><ArrowDown v-else /></el-icon>
              </button>
            </h3>
            <div id="scenes-block-body" v-show="!scenesBlockCollapsed" class="resource-block-body">
              <FilmCreateSceneBlock v-bind="sceneBlockProps" v-on="sceneBlockEvents" v-model:scene-use-quad-grid="sceneUseQuadGrid">
                <template #empty>
                  <div
                  v-if="scenes.length === 0"
                  class="empty-tip resource-empty-tip"
                  role="status"
                >
                  <p class="resource-empty-copy">暂无场景，可用「从剧本提取场景」或「添加场景」</p>
                  <div class="resource-empty-actions">
                    <template v-if="needsEpisode">
                      <el-button v-if="!hasAnyEpisode" type="primary" size="small" aria-label="去创建剧集后再提取场景" @click="goCreateEpisode">去创建剧集</el-button>
                      <el-button v-else type="primary" size="small" aria-label="去选择剧集后再提取场景" @click="goSelectEpisode">去选择剧集</el-button>
                    </template>
                    <template v-else>
                      <ActionGate :reason="scenesExtractionDisabledReason" label="从剧本提取场景">
                        <el-button type="primary" size="small" :loading="scenesExtracting" :disabled="Boolean(scenesExtractionDisabledReason)" :title="scenesExtracting ? '正在提取场景，请稍候' : (scenesExtractionDisabledReason || undefined)" aria-label="从剧本提取场景" @click="emit('extract-scenes')">从剧本提取场景</el-button>
                      </ActionGate>
                      <ActionGate :reason="projectActionDisabledReason" label="添加场景">
                        <el-button size="small" :disabled="Boolean(projectActionDisabledReason)" :title="projectActionDisabledReason || undefined" aria-label="添加场景" @click="emit('add-scene')">添加场景</el-button>
                      </ActionGate>
                    </template>
                  </div>
                </div>
                </template>
              </FilmCreateSceneBlock>
</div>
          </div>
        </div>
      </section>
  </div>
</template>
<script setup>
import { toUserFacingError } from '@/utils/userFacingError'
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import FilmCreateCharacterBlock from '@/components/filmCreate/FilmCreateCharacterBlock.vue'
import FilmCreatePropBlock from '@/components/filmCreate/FilmCreatePropBlock.vue'
import FilmCreateSceneBlock from '@/components/filmCreate/FilmCreateSceneBlock.vue'

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
  generatingPanoramaIds: { type: [Set, Object], default: () => new Set() },
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
  onAddEpisode: { type: Function, default: undefined },
  onSelectEpisode: { type: Function, default: undefined },
  hasAnyEpisode: { type: Boolean, default: false },
})

const resourcePanelCollapsed = defineModel('resourcePanelCollapsed', { type: Boolean, default: false })
const charactersBlockCollapsed = defineModel('charactersBlockCollapsed', { type: Boolean, default: false })
const propsBlockCollapsed = defineModel('propsBlockCollapsed', { type: Boolean, default: false })
const scenesBlockCollapsed = defineModel('scenesBlockCollapsed', { type: Boolean, default: false })
const propUseQuadGrid = defineModel('propUseQuadGrid', { type: Boolean, default: false })
const sceneUseQuadGrid = defineModel('sceneUseQuadGrid', { type: Boolean, default: false })

const emit = defineEmits([
  'add-episode',
  'select-episode',
  'generate-characters', 'add-character', 'open-char-library',
  'extract-props', 'add-prop', 'open-prop-library',
  'extract-scenes', 'add-scene', 'open-scene-library',
  'generate-character-image', 'generate-prop-image', 'generate-scene-image', 'generate-scene-panorama',
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

const { hasAssetImage, assetImageUrl } = props

function missingAssetImageReason(item, kind) {
  if (hasAssetImage(item)) return ''
  if (kind === 'prop') return '请先为该道具生成或上传主图'
  if (kind === 'scene') return '请先为该场景生成或上传主图'
  return '请先为该角色生成或上传主图'
}

/** 认证按钮的悬停帮助文案 */
function sd2CertActionTitle(char) {
  const status = String(char?.seedance2_asset?.status || '').toLowerCase()
  if (status === 'active') return '查看认证资产详情'
  if (status === 'processing') return '刷新认证资产状态'
  if (status === 'failed') return '重新提交认证资产'
  return '将角色主图登记为认证资产'
}

function scenePanoramaUrl(scene) {
  return assetImageUrl({
    local_path: scene?.panorama_local_path,
    image_url: scene?.panorama_image_url,
  })
}

function assetErrorText(asset) {
  return toUserFacingError(asset?.error_msg || asset?.errorMsg, '生成失败')
}

function missingScenePanoramaReason(scene) {
  return hasAssetImage(scene) ? '' : '请先为该场景生成或上传主图'
}

const EPISODE_REQUIRED_REASON = '请先创建或选择剧集'
const needsEpisode = computed(() => (
  props.propsExtractionDisabledReason === EPISODE_REQUIRED_REASON
  || props.scenesExtractionDisabledReason === EPISODE_REQUIRED_REASON
))

function goCreateEpisode() {
  if (typeof props.onAddEpisode === 'function') {
    props.onAddEpisode()
    return
  }
  emit('add-episode')
}

function goSelectEpisode() {
  if (typeof props.onSelectEpisode === 'function') {
    props.onSelectEpisode()
    return
  }
  emit('select-episode')
}

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

/** 把子区块事件原样转发给制作页 */
function forward(name) {
  return (...args) => emit(name, ...args)
}

const sharedBlockProps = computed(() => ({
  projectActionDisabledReason: props.projectActionDisabledReason,
  storyboardMediaActionReason: props.storyboardMediaActionReason,
  uploadingResourceId: props.uploadingResourceId,
  regenSbImagesForAsset: props.regenSbImagesForAsset,
  regenSbImagesProgress: props.regenSbImagesProgress,
  dragOverResourceKey: dragOverResourceKey.value,
  hasAssetImage: props.hasAssetImage,
  assetImageUrl: props.assetImageUrl,
  localPathToUrl: props.localPathToUrl,
  parseExtraImages: props.parseExtraImages,
  missingAssetImageReason,
  assetErrorText,
  uploadResourceClick: onUploadResourceClick,
  resourceDragOver: onResourceDragOver,
  resourceDragLeave: onResourceDragLeave,
  resourceDrop: onResourceDrop,
}))

const characterBlockProps = computed(() => ({
  ...sharedBlockProps.value,
  characters: props.characters,
  characterGenerationDisabledReason: props.characterGenerationDisabledReason,
  charactersGenerating: props.charactersGenerating,
  generatingCharIds: props.generatingCharIds,
  addingCharToLibraryId: props.addingCharToLibraryId,
  addingCharToMaterialId: props.addingCharToMaterialId,
  sd2CertifyingId: props.sd2CertifyingId,
  sd2VoiceUploadingId: props.sd2VoiceUploadingId,
  charRoleLabel: props.charRoleLabel,
  getCharAffectedStoryboards: props.getCharAffectedStoryboards,
  sd2ActionLabel: props.sd2ActionLabel,
  sd2VoiceActionLabel: props.sd2VoiceActionLabel,
  sd2CertActionTitle,
}))

const propBlockProps = computed(() => ({
  ...sharedBlockProps.value,
  propItems: props.propItems,
  propsExtractionDisabledReason: props.propsExtractionDisabledReason,
  propsExtracting: props.propsExtracting,
  generatingPropIds: props.generatingPropIds,
  addingPropToLibraryId: props.addingPropToLibraryId,
  addingPropToMaterialId: props.addingPropToMaterialId,
  getPropAffectedStoryboards: props.getPropAffectedStoryboards,
}))

const sceneBlockProps = computed(() => ({
  ...sharedBlockProps.value,
  scenes: props.scenes,
  scenesExtractionDisabledReason: props.scenesExtractionDisabledReason,
  scenesExtracting: props.scenesExtracting,
  generatingSceneIds: props.generatingSceneIds,
  generatingPanoramaIds: props.generatingPanoramaIds,
  addingSceneToLibraryId: props.addingSceneToLibraryId,
  addingSceneToMaterialId: props.addingSceneToMaterialId,
  getSceneAffectedStoryboards: props.getSceneAffectedStoryboards,
  scenePanoramaUrl,
  missingScenePanoramaReason,
}))

const characterBlockEvents = {
  'generate-characters': forward('generate-characters'),
  'add-character': forward('add-character'),
  'open-char-library': forward('open-char-library'),
  'generate-character-image': forward('generate-character-image'),
  'edit-character': forward('edit-character'),
  'delete-character': forward('delete-character'),
  'add-character-to-library': forward('add-character-to-library'),
  'add-character-to-material': forward('add-character-to-material'),
  'regen-affected-sb-images': forward('regen-affected-sb-images'),
  'set-primary-image': forward('set-primary-image'),
  'remove-extra-image': forward('remove-extra-image'),
  'preview-image': forward('preview-image'),
  'scroll-to-storyboard': forward('scroll-to-storyboard'),
  'sd2-primary-action': forward('sd2-primary-action'),
  'sd2-voice-primary-action': forward('sd2-voice-primary-action'),
  'sd2-voice-replace': forward('sd2-voice-replace'),
  'play-sd2-voice': forward('play-sd2-voice'),
}

const propBlockEvents = {
  'extract-props': forward('extract-props'),
  'add-prop': forward('add-prop'),
  'open-prop-library': forward('open-prop-library'),
  'generate-prop-image': forward('generate-prop-image'),
  'edit-prop': forward('edit-prop'),
  'delete-prop': forward('delete-prop'),
  'add-prop-to-library': forward('add-prop-to-library'),
  'add-prop-to-material': forward('add-prop-to-material'),
  'regen-affected-sb-images': forward('regen-affected-sb-images'),
  'set-primary-image': forward('set-primary-image'),
  'remove-extra-image': forward('remove-extra-image'),
  'preview-image': forward('preview-image'),
  'scroll-to-storyboard': forward('scroll-to-storyboard'),
}

const sceneBlockEvents = {
  'extract-scenes': forward('extract-scenes'),
  'add-scene': forward('add-scene'),
  'open-scene-library': forward('open-scene-library'),
  'generate-scene-image': forward('generate-scene-image'),
  'generate-scene-panorama': forward('generate-scene-panorama'),
  'edit-scene': forward('edit-scene'),
  'delete-scene': forward('delete-scene'),
  'add-scene-to-library': forward('add-scene-to-library'),
  'add-scene-to-material': forward('add-scene-to-material'),
  'regen-affected-sb-images': forward('regen-affected-sb-images'),
  'set-primary-image': forward('set-primary-image'),
  'remove-extra-image': forward('remove-extra-image'),
  'preview-image': forward('preview-image'),
  'scroll-to-storyboard': forward('scroll-to-storyboard'),
}
</script>

<style scoped>
.section { margin-bottom: 24px; }
.card { background: #1e1f28; border-radius: 14px; padding: 22px; border: 1px solid rgba(255, 255, 255, 0.06); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15); }
html.light .card { background: rgba(255, 255, 255, 0.75); border-color: rgba(139, 92, 246, 0.08); }
.section-title { font-size: 1.05rem; margin: 0 0 4px; color: #f4f4f5; font-weight: 600; }
html.light .section-title { color: #1e1b4b; }
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
  padding: 14px 16px 16px;
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
.empty-tip {
  color: var(--film-empty-copy, #a1a1aa);
  font-size: 0.9rem;
  line-height: 1.55;
  padding: 16px 0;
}
.resource-empty-tip {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.resource-empty-copy {
  margin: 0;
}
.resource-empty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
}
.resource-empty-actions :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
.resource-empty-actions :deep(.action-gate-wrap) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 100%;
}
html.light .empty-tip {
  color: var(--film-empty-copy, #64748b);
}

</style>
