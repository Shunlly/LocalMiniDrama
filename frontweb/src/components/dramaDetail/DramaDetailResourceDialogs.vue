<template>
  <div class="drama-detail-resource-dialogs">
    <DramaDetailCharacterEditDialogs
      v-model:editDramaCharVisible="editDramaCharVisible"
      v-model:editDramaCharForm="editDramaCharForm"
      v-model:editCharVisible="editCharVisible"
      v-model:editCharForm="editCharForm"
      :editDramaCharSaving="editDramaCharSaving"
      :editCharSaving="editCharSaving"
      :assetImageUrl="assetImageUrl"
      :characterLibraryAPI="characterLibraryAPI"
      :doGenerateLibImg="doGenerateLibImg"
      :doUploadLibImg="doUploadLibImg"
      :generateDramaCharImg="generateDramaCharImg"
      :loadCharList="loadCharList"
      :openPreview="openPreview"
      :requestResourceEditorClose="requestResourceEditorClose"
      :saveChar="saveChar"
      :saveDramaChar="saveDramaChar"
      :uploadDramaCharImg="uploadDramaCharImg"
    />

    <DramaDetailSceneEditDialogs
      v-model:editDramaSceneVisible="editDramaSceneVisible"
      v-model:editDramaSceneForm="editDramaSceneForm"
      v-model:editSceneVisible="editSceneVisible"
      v-model:editSceneForm="editSceneForm"
      :editDramaSceneSaving="editDramaSceneSaving"
      :editSceneSaving="editSceneSaving"
      :assetImageUrl="assetImageUrl"
      :doGenerateLibImg="doGenerateLibImg"
      :doUploadLibImg="doUploadLibImg"
      :generateDramaSceneImg="generateDramaSceneImg"
      :loadSceneList="loadSceneList"
      :openPreview="openPreview"
      :requestResourceEditorClose="requestResourceEditorClose"
      :saveDramaScene="saveDramaScene"
      :saveScene="saveScene"
      :sceneLibraryAPI="sceneLibraryAPI"
      :uploadDramaSceneImg="uploadDramaSceneImg"
    />

    <DramaDetailPropEditDialogs
      v-model:editDramaPropVisible="editDramaPropVisible"
      v-model:editDramaPropForm="editDramaPropForm"
      v-model:editPropVisible="editPropVisible"
      v-model:editPropForm="editPropForm"
      :editDramaPropSaving="editDramaPropSaving"
      :editPropSaving="editPropSaving"
      :assetImageUrl="assetImageUrl"
      :doGenerateLibImg="doGenerateLibImg"
      :doUploadLibImg="doUploadLibImg"
      :generateDramaPropImg="generateDramaPropImg"
      :loadPropList="loadPropList"
      :openPreview="openPreview"
      :propLibraryAPI="propLibraryAPI"
      :requestResourceEditorClose="requestResourceEditorClose"
      :saveDramaProp="saveDramaProp"
      :saveProp="saveProp"
      :uploadDramaPropImg="uploadDramaPropImg"
    />

    <!-- 从素材库导入 -->
    <AccessibleDialog
      v-model="importVisible"
      :title="`从素材库导入${importType === 'char' ? '角色' : importType === 'scene' ? '场景' : '道具'}`"
      width="760px"
      destroy-on-close
      :close-on-press-escape="true"
      @open="loadImportList"
    >
      <div class="library-toolbar">
        <el-input v-model="importKw" placeholder="搜索关键词" aria-label="搜索待导入素材" clearable style="width: 220px" @input="onImportKwInput" />
        <span class="import-tip">点击「导入」将素材复制到本剧资源库</span>
      </div>
      <div v-loading="importLoading" class="library-list import-list">
        <div v-if="importError" class="library-error" role="alert">
          <span>
            {{ importError }}
            <template v-if="importList.length">当前仍显示上次成功加载的素材。</template>
          </span>
          <el-button size="small" type="primary" plain :loading="importLoading" :aria-label="importLoading ? '正在加载可导入列表' : '重试加载可导入列表'" @click="loadImportList">重试</el-button>
        </div>
        <div v-for="item in importList" :key="item.id" class="library-item">
          <button
            v-if="assetImageUrl(item)"
            type="button"
            class="library-item-cover"
            :aria-label="`预览待导入素材「${importType === 'scene' ? (item.location || item.time || '未命名') : (item.name || '未命名')}」图片`"
            @click="openPreview(assetImageUrl(item))"
          >
            <img :src="assetImageUrl(item)" alt="待导入素材图片" />
          </button>
          <div
            v-else
            class="library-item-cover library-item-cover--empty"
            role="img"
            :aria-label="`待导入素材「${importType === 'scene' ? (item.location || item.time || '未命名') : (item.name || '未命名')}」暂无图片`"
          >
            <span class="library-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">
              {{ importType === 'scene' ? (item.location || item.time || '未命名') : (item.name || '未命名') }}
            </div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
            <div class="library-item-actions">
              <el-button size="small" type="primary" :loading="importingId === item.id" :aria-label="importingId === item.id ? '正在导入' : `导入${item.name || item.location || '该资源'}`" @click="doImport(item)">导入</el-button>
            </div>
          </div>
        </div>
        <div v-if="!importLoading && !importError && importList.length === 0" class="library-empty resource-empty-state" role="status">
          <div class="empty-state-title">{{ importKw.trim() ? '没有匹配的素材' : '素材库暂无内容' }}</div>
          <div class="empty-state-copy">{{ importKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : (currentEpisodeId ? '可前往制作页新增素材并加入素材库。' : '请先新增一集，再去制作页提取素材。') }}</div>
          <el-button v-if="importKw.trim()" size="small" aria-label="清除导入搜索" @click="importKw = ''; loadImportList()">清除搜索</el-button>
          <el-button v-else size="small" type="primary" :loading="!currentEpisodeId && addingEpisode" :aria-label="currentEpisodeId ? '前往制作页新增并入库' : '新增一集后再去制作页提取素材'" @click="goCreateOrAddEpisode">
            {{ currentEpisodeId ? '前往制作页新增并入库' : '先去新增一集' }}
          </el-button>
        </div>
      </div>
      <div class="library-pagination">
        <el-pagination
          v-model:current-page="importPage"
          v-model:page-size="importPageSize"
          :total="importTotal"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          aria-label="导入素材分页"
          @current-change="loadImportList"
          @size-change="loadImportList"
        />
      </div>
      <template #footer>
        <el-button aria-label="关闭导入弹窗" @click="importVisible = false">关闭</el-button>
      </template>
    </AccessibleDialog>

    <ImagePreviewDialog
      :model-value="Boolean(previewUrl)"
      :src="previewUrl || ''"
      title="资源图片预览"
      @update:model-value="(visible) => { if (!visible) previewUrl = null }"
    />
  </div>
</template>

<script setup>
import DramaDetailCharacterEditDialogs from './DramaDetailCharacterEditDialogs.vue'
import DramaDetailSceneEditDialogs from './DramaDetailSceneEditDialogs.vue'
import DramaDetailPropEditDialogs from './DramaDetailPropEditDialogs.vue'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  addingEpisode: { type: Boolean, default: false },
  currentEpisodeId: { type: [Number, String, null], default: null },
  editCharSaving: { type: Boolean, default: false },
  editDramaCharSaving: { type: Boolean, default: false },
  editDramaPropSaving: { type: Boolean, default: false },
  editDramaSceneSaving: { type: Boolean, default: false },
  editPropSaving: { type: Boolean, default: false },
  editSceneSaving: { type: Boolean, default: false },
  importError: { type: String, default: '' },
  importList: { type: Array, default: () => [] },
  importLoading: { type: Boolean, default: false },
  importTotal: { type: Number, default: 0 },
  importType: { type: String, default: 'char' },
  importingId: { type: [Number, String, null], default: null },
  assetImageUrl: { type: Function, required: true },
  characterLibraryAPI: { type: Object, required: true },
  doGenerateLibImg: { type: Function, required: true },
  doImport: { type: Function, required: true },
  doUploadLibImg: { type: Function, required: true },
  generateDramaCharImg: { type: Function, required: true },
  generateDramaPropImg: { type: Function, required: true },
  generateDramaSceneImg: { type: Function, required: true },
  goCreateOrAddEpisode: { type: Function, required: true },
  loadCharList: { type: Function, required: true },
  loadImportList: { type: Function, required: true },
  loadPropList: { type: Function, required: true },
  loadSceneList: { type: Function, required: true },
  onImportKwInput: { type: Function, required: true },
  openPreview: { type: Function, required: true },
  propLibraryAPI: { type: Object, required: true },
  requestResourceEditorClose: { type: Function, required: true },
  saveChar: { type: Function, required: true },
  saveDramaChar: { type: Function, required: true },
  saveDramaProp: { type: Function, required: true },
  saveDramaScene: { type: Function, required: true },
  saveProp: { type: Function, required: true },
  saveScene: { type: Function, required: true },
  sceneLibraryAPI: { type: Object, required: true },
  uploadDramaCharImg: { type: Function, required: true },
  uploadDramaPropImg: { type: Function, required: true },
  uploadDramaSceneImg: { type: Function, required: true },
})

const editDramaCharVisible = defineModel('editDramaCharVisible', { type: Boolean, default: false })
const editDramaCharForm = defineModel('editDramaCharForm', { type: Object, default: null })
const editDramaSceneVisible = defineModel('editDramaSceneVisible', { type: Boolean, default: false })
const editDramaSceneForm = defineModel('editDramaSceneForm', { type: Object, default: null })
const editDramaPropVisible = defineModel('editDramaPropVisible', { type: Boolean, default: false })
const editDramaPropForm = defineModel('editDramaPropForm', { type: Object, default: null })
const editCharVisible = defineModel('editCharVisible', { type: Boolean, default: false })
const editCharForm = defineModel('editCharForm', { type: Object, default: null })
const editSceneVisible = defineModel('editSceneVisible', { type: Boolean, default: false })
const editSceneForm = defineModel('editSceneForm', { type: Object, default: null })
const editPropVisible = defineModel('editPropVisible', { type: Boolean, default: false })
const editPropForm = defineModel('editPropForm', { type: Object, default: null })
const importVisible = defineModel('importVisible', { type: Boolean, default: false })
const importKw = defineModel('importKw', { type: String, default: '' })
const importPage = defineModel('importPage', { type: Number, default: 1 })
const importPageSize = defineModel('importPageSize', { type: Number, default: 20 })
const previewUrl = defineModel('previewUrl', { default: null })
</script>

<style scoped>
.library-toolbar { margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
.import-tip { font-size: 0.8rem; color: #71717a; }
.import-list { max-height: 480px; }
.library-list { min-height: 120px; display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; }
.library-item { display: flex; gap: 12px; padding: 10px; background: #1c1c1e; border: 1px solid #27272a; border-radius: 8px; }
.library-item-cover { width: 72px; height: 72px; flex-shrink: 0; padding: 0; border: 0; border-radius: 6px; overflow: hidden; background: #27272a; color: inherit; font: inherit; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.library-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-item-cover--empty { cursor: default; }
.library-placeholder { font-size: 0.8rem; color: #71717a; }
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; color: #fafafa; margin-bottom: 4px; }
.library-item-desc { font-size: 0.85rem; color: #a1a1aa; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.library-item-actions { display: flex; gap: 8px; }
.library-empty { text-align: center; color: #71717a; padding: 40px 20px; }
.library-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-left: 3px solid #f87171;
  background: rgba(239, 68, 68, 0.08);
  color: #fca5a5;
}
.resource-empty-state { display: grid; justify-items: center; gap: 12px; width: 100%; }
.library-pagination { margin-top: 12px; display: flex; justify-content: center; }
.library-item-cover:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.library-item-cover:disabled,
.library-item-cover--empty { cursor: default; }
</style>
