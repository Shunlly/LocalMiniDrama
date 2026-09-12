<template>
  <div class="film-create-resource-dialogs">
    <FilmCreateCharacterEditDialog
      v-model:show-edit-character="showEditCharacter"
      v-model:add-char-ref-image="addCharRefImage"
      :edit-character-form="editCharacterForm"
      :edit-character-prompt-generating="editCharacterPromptGenerating"
      :edit-character-saving="editCharacterSaving"
      :extracting-anchors="extractingAnchors"
      :extracting-char-appearance="extractingCharAppearance"
      :asset-image-url="assetImageUrl"
      :clear-char-ref-image="clearCharRefImage"
      :do-extract-char-from-image="doExtractCharFromImage"
      :do-extract-from-ref="doExtractFromRef"
      :do-generate-character-prompt="doGenerateCharacterPrompt"
      :extract-identity-anchors="extractIdentityAnchors"
      :on-close-char-dialog="onCloseCharDialog"
      :on-ref-image-drop="onRefImageDrop"
      :on-ref-image-file-change="onRefImageFileChange"
      :submit-edit-character="submitEditCharacter"
    />

    <FilmCreateCharacterLibraryDialogs
      v-model:show-char-library="showCharLibrary"
      v-model:show-char-sd2-cert="showCharSd2Cert"
      v-model:show-edit-char-library="showEditCharLibrary"
      v-model:edit-char-library-form="editCharLibraryForm"
      v-model:char-library-keyword="charLibraryKeyword"
      v-model:char-library-page="charLibraryPage"
      v-model:char-library-page-size="charLibraryPageSize"
      v-model:char-library-tab="charLibraryTab"
      v-model:drama-all-char-keyword="dramaAllCharKeyword"
      v-model:drama-all-char-page="dramaAllCharPage"
      v-model:drama-all-char-page-size="dramaAllCharPageSize"
      :add-to-episode-disabled-reason="addToEpisodeDisabledReason"
      :char-library-list="charLibraryList"
      :char-library-loading="charLibraryLoading"
      :char-library-total="charLibraryTotal"
      :char-sd2-cert-payload="charSd2CertPayload"
      :drama-all-char-list="dramaAllCharList"
      :drama-all-char-loading="dramaAllCharLoading"
      :drama-all-char-total="dramaAllCharTotal"
      :edit-char-library-saving="editCharLibrarySaving"
      :asset-image-url="assetImageUrl"
      :char-role-label="charRoleLabel"
      :debounced-load-char-library="debouncedLoadCharLibrary"
      :debounced-load-drama-all-char-list="debouncedLoadDramaAllCharList"
      :is-char-add-to-episode-loading="isCharAddToEpisodeLoading"
      :load-char-library-list="loadCharLibraryList"
      :load-drama-all-char-list="loadDramaAllCharList"
      :on-add-char-from-library="onAddCharFromLibrary"
      :on-add-drama-char-to-episode="onAddDramaCharToEpisode"
      :on-char-library-dialog-open="onCharLibraryDialogOpen"
      :on-char-library-tab-change="onCharLibraryTabChange"
      :on-delete-char-library="onDeleteCharLibrary"
      :open-edit-char-library="openEditCharLibrary"
      :open-image-preview="openImagePreview"
      :return-to-character-panel="returnToCharacterPanel"
      :submit-edit-char-library="submitEditCharLibrary"
    />

    <FilmCreatePropEditDialog
      v-model:show-add-prop="showAddProp"
      v-model:show-edit-prop="showEditProp"
      v-model:add-prop-form="addPropForm"
      v-model:add-prop-add-ref-image="addPropAddRefImage"
      v-model:add-prop-ref-image="addPropRefImage"
      :add-prop-saving="addPropSaving"
      :edit-prop-form="editPropForm"
      :edit-prop-prompt-generating="editPropPromptGenerating"
      :edit-prop-saving="editPropSaving"
      :extracting-prop-add-desc="extractingPropAddDesc"
      :extracting-prop-desc="extractingPropDesc"
      :asset-image-url="assetImageUrl"
      :clear-prop-ref-image="clearPropRefImage"
      :do-extract-from-ref="doExtractFromRef"
      :do-extract-from-ref2="doExtractFromRef2"
      :do-extract-prop-from-image="doExtractPropFromImage"
      :do-generate-prop-prompt="doGeneratePropPrompt"
      :on-close-prop-dialog="onClosePropDialog"
      :on-ref-image-drop="onRefImageDrop"
      :on-ref-image-drop2="onRefImageDrop2"
      :on-ref-image-file-change="onRefImageFileChange"
      :on-ref-image-file-change2="onRefImageFileChange2"
      :submit-add-prop="submitAddProp"
      :submit-edit-prop="submitEditProp"
    />

    <FilmCreatePropLibraryDialogs
      v-model:show-prop-library="showPropLibrary"
      v-model:show-edit-prop-library="showEditPropLibrary"
      v-model:edit-prop-library-form="editPropLibraryForm"
      v-model:prop-library-keyword="propLibraryKeyword"
      v-model:prop-library-page="propLibraryPage"
      v-model:prop-library-page-size="propLibraryPageSize"
      v-model:prop-library-tab="propLibraryTab"
      v-model:drama-all-prop-keyword="dramaAllPropKeyword"
      v-model:drama-all-prop-page="dramaAllPropPage"
      v-model:drama-all-prop-page-size="dramaAllPropPageSize"
      :add-to-episode-disabled-reason="addToEpisodeDisabledReason"
      :drama-all-prop-list="dramaAllPropList"
      :drama-all-prop-loading="dramaAllPropLoading"
      :drama-all-prop-total="dramaAllPropTotal"
      :edit-prop-library-saving="editPropLibrarySaving"
      :prop-library-list="propLibraryList"
      :prop-library-loading="propLibraryLoading"
      :prop-library-total="propLibraryTotal"
      :asset-image-url="assetImageUrl"
      :debounced-load-drama-all-prop-list="debouncedLoadDramaAllPropList"
      :debounced-load-prop-library="debouncedLoadPropLibrary"
      :is-prop-add-to-episode-loading="isPropAddToEpisodeLoading"
      :load-drama-all-prop-list="loadDramaAllPropList"
      :load-prop-library-list="loadPropLibraryList"
      :on-add-drama-prop-to-episode="onAddDramaPropToEpisode"
      :on-add-prop-from-library="onAddPropFromLibrary"
      :on-delete-prop-library="onDeletePropLibrary"
      :on-prop-library-dialog-open="onPropLibraryDialogOpen"
      :on-prop-library-tab-change="onPropLibraryTabChange"
      :open-edit-prop-library="openEditPropLibrary"
      :open-image-preview="openImagePreview"
      :return-to-prop-panel="returnToPropPanel"
      :submit-edit-prop-library="submitEditPropLibrary"
    />

    <FilmCreateSceneEditDialog
      v-model:show-edit-scene="showEditScene"
      v-model:add-scene-ref-image="addSceneRefImage"
      :edit-scene-form="editSceneForm"
      :edit-scene-prompt-generating="editScenePromptGenerating"
      :edit-scene-saving="editSceneSaving"
      :extracting-scene-desc="extractingSceneDesc"
      :asset-image-url="assetImageUrl"
      :clear-scene-ref-image="clearSceneRefImage"
      :do-extract-from-ref="doExtractFromRef"
      :do-extract-scene-from-image="doExtractSceneFromImage"
      :do-generate-scene-prompt="doGenerateScenePrompt"
      :do-generate-scene-single-prompt="doGenerateSceneSinglePrompt"
      :on-close-scene-dialog="onCloseSceneDialog"
      :on-ref-image-drop="onRefImageDrop"
      :on-ref-image-file-change="onRefImageFileChange"
      :submit-edit-scene="submitEditScene"
    />

    <FilmCreateSceneLibraryDialogs
      v-model:show-scene-library="showSceneLibrary"
      v-model:show-edit-scene-library="showEditSceneLibrary"
      v-model:edit-scene-library-form="editSceneLibraryForm"
      v-model:scene-library-keyword="sceneLibraryKeyword"
      v-model:scene-library-page="sceneLibraryPage"
      v-model:scene-library-page-size="sceneLibraryPageSize"
      v-model:scene-library-tab="sceneLibraryTab"
      v-model:drama-all-scene-keyword="dramaAllSceneKeyword"
      v-model:drama-all-scene-page="dramaAllScenePage"
      v-model:drama-all-scene-page-size="dramaAllScenePageSize"
      :add-to-episode-disabled-reason="addToEpisodeDisabledReason"
      :drama-all-scene-list="dramaAllSceneList"
      :drama-all-scene-loading="dramaAllSceneLoading"
      :drama-all-scene-total="dramaAllSceneTotal"
      :edit-scene-library-saving="editSceneLibrarySaving"
      :scene-library-list="sceneLibraryList"
      :scene-library-loading="sceneLibraryLoading"
      :scene-library-total="sceneLibraryTotal"
      :asset-image-url="assetImageUrl"
      :debounced-load-drama-all-scene-list="debouncedLoadDramaAllSceneList"
      :debounced-load-scene-library="debouncedLoadSceneLibrary"
      :is-scene-add-to-episode-loading="isSceneAddToEpisodeLoading"
      :load-drama-all-scene-list="loadDramaAllSceneList"
      :load-scene-library-list="loadSceneLibraryList"
      :on-add-drama-scene-to-episode="onAddDramaSceneToEpisode"
      :on-add-scene-from-library="onAddSceneFromLibrary"
      :on-delete-scene-library="onDeleteSceneLibrary"
      :on-scene-library-dialog-open="onSceneLibraryDialogOpen"
      :on-scene-library-tab-change="onSceneLibraryTabChange"
      :open-edit-scene-library="openEditSceneLibrary"
      :open-image-preview="openImagePreview"
      :return-to-scene-panel="returnToScenePanel"
      :submit-edit-scene-library="submitEditSceneLibrary"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { describeAddToEpisodeDisabledReason } from '@/components/filmCreate/filmCreateResourceDialogsCopy.js'
import FilmCreateCharacterEditDialog from './FilmCreateCharacterEditDialog.vue'
import FilmCreateCharacterLibraryDialogs from './FilmCreateCharacterLibraryDialogs.vue'
import FilmCreatePropEditDialog from './FilmCreatePropEditDialog.vue'
import FilmCreatePropLibraryDialogs from './FilmCreatePropLibraryDialogs.vue'
import FilmCreateSceneEditDialog from './FilmCreateSceneEditDialog.vue'
import FilmCreateSceneLibraryDialogs from './FilmCreateSceneLibraryDialogs.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  addPropSaving: { type: Boolean, default: false },
  charLibraryList: { type: Array, default: () => [] },
  charLibraryLoading: { type: Boolean, default: false },
  charLibraryTotal: { type: Number, default: 0 },
  charSd2CertPayload: { type: Object, default: null },
  currentEpisodeId: { type: [Number, String, null], default: null },
  dramaAllCharList: { type: Array, default: () => [] },
  dramaAllCharLoading: { type: Boolean, default: false },
  dramaAllCharTotal: { type: Number, default: 0 },
  dramaAllPropList: { type: Array, default: () => [] },
  dramaAllPropLoading: { type: Boolean, default: false },
  dramaAllPropTotal: { type: Number, default: 0 },
  dramaAllSceneList: { type: Array, default: () => [] },
  dramaAllSceneLoading: { type: Boolean, default: false },
  dramaAllSceneTotal: { type: Number, default: 0 },
  editCharLibrarySaving: { type: Boolean, default: false },
  editCharacterForm: { type: Object, default: null },
  editCharacterPromptGenerating: { type: Boolean, default: false },
  editCharacterSaving: { type: Boolean, default: false },
  editPropForm: { type: Object, default: null },
  editPropLibrarySaving: { type: Boolean, default: false },
  editPropPromptGenerating: { type: Boolean, default: false },
  editPropSaving: { type: Boolean, default: false },
  editSceneForm: { type: Object, default: null },
  editSceneLibrarySaving: { type: Boolean, default: false },
  editScenePromptGenerating: { type: Boolean, default: false },
  editSceneSaving: { type: Boolean, default: false },
  extractingAnchors: { type: Boolean, default: false },
  extractingCharAppearance: { type: Boolean, default: false },
  extractingPropAddDesc: { type: Boolean, default: false },
  extractingPropDesc: { type: Boolean, default: false },
  extractingSceneDesc: { type: Boolean, default: false },
  propLibraryList: { type: Array, default: () => [] },
  propLibraryLoading: { type: Boolean, default: false },
  propLibraryTotal: { type: Number, default: 0 },
  sceneLibraryList: { type: Array, default: () => [] },
  sceneLibraryLoading: { type: Boolean, default: false },
  sceneLibraryTotal: { type: Number, default: 0 },
  assetImageUrl: { type: Function, required: true },
  charRoleLabel: { type: Function, required: true },
  clearCharRefImage: { type: Function, required: true },
  clearPropRefImage: { type: Function, required: true },
  clearSceneRefImage: { type: Function, required: true },
  debouncedLoadCharLibrary: { type: Function, required: true },
  debouncedLoadDramaAllCharList: { type: Function, required: true },
  debouncedLoadDramaAllPropList: { type: Function, required: true },
  debouncedLoadDramaAllSceneList: { type: Function, required: true },
  debouncedLoadPropLibrary: { type: Function, required: true },
  debouncedLoadSceneLibrary: { type: Function, required: true },
  doExtractCharFromImage: { type: Function, required: true },
  doExtractFromRef: { type: Function, required: true },
  doExtractFromRef2: { type: Function, required: true },
  doExtractPropFromImage: { type: Function, required: true },
  doExtractSceneFromImage: { type: Function, required: true },
  doGenerateCharacterPrompt: { type: Function, required: true },
  doGeneratePropPrompt: { type: Function, required: true },
  doGenerateScenePrompt: { type: Function, required: true },
  doGenerateSceneSinglePrompt: { type: Function, required: true },
  extractIdentityAnchors: { type: Function, required: true },
  isCharAddToEpisodeLoading: { type: Function, required: true },
  isPropAddToEpisodeLoading: { type: Function, required: true },
  isSceneAddToEpisodeLoading: { type: Function, required: true },
  loadCharLibraryList: { type: Function, required: true },
  loadDramaAllCharList: { type: Function, required: true },
  loadDramaAllPropList: { type: Function, required: true },
  loadDramaAllSceneList: { type: Function, required: true },
  loadPropLibraryList: { type: Function, required: true },
  loadSceneLibraryList: { type: Function, required: true },
  onAddCharFromLibrary: { type: Function, required: true },
  onAddDramaCharToEpisode: { type: Function, required: true },
  onAddDramaPropToEpisode: { type: Function, required: true },
  onAddDramaSceneToEpisode: { type: Function, required: true },
  onAddPropFromLibrary: { type: Function, required: true },
  onAddSceneFromLibrary: { type: Function, required: true },
  onCharLibraryDialogOpen: { type: Function, required: true },
  onCharLibraryTabChange: { type: Function, required: true },
  onCloseCharDialog: { type: Function, required: true },
  onClosePropDialog: { type: Function, required: true },
  onCloseSceneDialog: { type: Function, required: true },
  onDeleteCharLibrary: { type: Function, required: true },
  onDeletePropLibrary: { type: Function, required: true },
  onDeleteSceneLibrary: { type: Function, required: true },
  onPropLibraryDialogOpen: { type: Function, required: true },
  onPropLibraryTabChange: { type: Function, required: true },
  onRefImageDrop: { type: Function, required: true },
  onRefImageDrop2: { type: Function, required: true },
  onRefImageFileChange: { type: Function, required: true },
  onRefImageFileChange2: { type: Function, required: true },
  onSceneLibraryDialogOpen: { type: Function, required: true },
  onSceneLibraryTabChange: { type: Function, required: true },
  openEditCharLibrary: { type: Function, required: true },
  openEditPropLibrary: { type: Function, required: true },
  openEditSceneLibrary: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  returnToCharacterPanel: { type: Function, required: true },
  returnToPropPanel: { type: Function, default: () => {} },
  returnToScenePanel: { type: Function, default: () => {} },
  submitAddProp: { type: Function, required: true },
  submitEditCharLibrary: { type: Function, required: true },
  submitEditCharacter: { type: Function, required: true },
  submitEditProp: { type: Function, required: true },
  submitEditPropLibrary: { type: Function, required: true },
  submitEditScene: { type: Function, required: true },
  submitEditSceneLibrary: { type: Function, required: true },
})

const addPropForm = defineModel('addPropForm', { type: Object, default: () => ({ name: '', type: '', description: '', prompt: '' }) })
const addPropAddRefImage = defineModel('addPropAddRefImage', { type: Object, default: null })
const addCharRefImage = defineModel('addCharRefImage', { type: Object, default: null })
const addPropRefImage = defineModel('addPropRefImage', { type: Object, default: null })
const addSceneRefImage = defineModel('addSceneRefImage', { type: Object, default: null })
const editCharLibraryForm = defineModel('editCharLibraryForm', { type: Object, default: null })
const editPropLibraryForm = defineModel('editPropLibraryForm', { type: Object, default: null })
const editSceneLibraryForm = defineModel('editSceneLibraryForm', { type: Object, default: null })
const showAddProp = defineModel('showAddProp', { type: Boolean, default: false })
const showCharLibrary = defineModel('showCharLibrary', { type: Boolean, default: false })
const showCharSd2Cert = defineModel('showCharSd2Cert', { type: Boolean, default: false })
const showEditCharLibrary = defineModel('showEditCharLibrary', { type: Boolean, default: false })
const showEditCharacter = defineModel('showEditCharacter', { type: Boolean, default: false })
const showEditProp = defineModel('showEditProp', { type: Boolean, default: false })
const showEditPropLibrary = defineModel('showEditPropLibrary', { type: Boolean, default: false })
const showEditScene = defineModel('showEditScene', { type: Boolean, default: false })
const showEditSceneLibrary = defineModel('showEditSceneLibrary', { type: Boolean, default: false })
const showPropLibrary = defineModel('showPropLibrary', { type: Boolean, default: false })
const showSceneLibrary = defineModel('showSceneLibrary', { type: Boolean, default: false })
const charLibraryKeyword = defineModel('charLibraryKeyword', { type: String, default: '' })
const charLibraryPage = defineModel('charLibraryPage', { type: Number, default: 1 })
const charLibraryPageSize = defineModel('charLibraryPageSize', { type: Number, default: 20 })
const charLibraryTab = defineModel('charLibraryTab', { type: String, default: '' })
const dramaAllCharKeyword = defineModel('dramaAllCharKeyword', { type: String, default: '' })
const dramaAllCharPage = defineModel('dramaAllCharPage', { type: Number, default: 1 })
const dramaAllCharPageSize = defineModel('dramaAllCharPageSize', { type: Number, default: 20 })
const dramaAllPropKeyword = defineModel('dramaAllPropKeyword', { type: String, default: '' })
const dramaAllPropPage = defineModel('dramaAllPropPage', { type: Number, default: 1 })
const dramaAllPropPageSize = defineModel('dramaAllPropPageSize', { type: Number, default: 20 })
const dramaAllSceneKeyword = defineModel('dramaAllSceneKeyword', { type: String, default: '' })
const dramaAllScenePage = defineModel('dramaAllScenePage', { type: Number, default: 1 })
const dramaAllScenePageSize = defineModel('dramaAllScenePageSize', { type: Number, default: 20 })
const propLibraryKeyword = defineModel('propLibraryKeyword', { type: String, default: '' })
const propLibraryPage = defineModel('propLibraryPage', { type: Number, default: 1 })
const propLibraryPageSize = defineModel('propLibraryPageSize', { type: Number, default: 20 })
const propLibraryTab = defineModel('propLibraryTab', { type: String, default: '' })
const sceneLibraryKeyword = defineModel('sceneLibraryKeyword', { type: String, default: '' })
const sceneLibraryPage = defineModel('sceneLibraryPage', { type: Number, default: 1 })
const sceneLibraryPageSize = defineModel('sceneLibraryPageSize', { type: Number, default: 20 })
const sceneLibraryTab = defineModel('sceneLibraryTab', { type: String, default: '' })

const addToEpisodeDisabledReason = computed(() => describeAddToEpisodeDisabledReason(props.currentEpisodeId))
</script>
