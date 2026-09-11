<template>
  <!-- 道具资源库 -->
  <AccessibleDialog v-model="showPropLibrary" title="道具资源库" width="720px" destroy-on-close class="library-dialog" @open="onPropLibraryDialogOpen">
    <el-tabs v-model="propLibraryTab" class="char-library-tabs" aria-label="道具资源库分类" @tab-change="onPropLibraryTabChange">
      <el-tab-pane label="本剧道具库" name="library">
        <div class="library-toolbar">
          <el-input v-model="propLibraryKeyword" aria-label="搜索道具素材" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadPropLibrary()" />
        </div>
        <div v-loading="propLibraryLoading" class="library-list">
          <div v-for="item in propLibraryList" :key="'plib-' + item.id" class="library-item">
            <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.name || '道具'}图片`" @click="openImagePreview(assetImageUrl(item))">
              <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.name || '道具图片'" />
              <span v-else class="library-item-placeholder">暂无图</span>
            </button>
            <div class="library-item-info">
              <div class="library-item-name">{{ item.name || '未命名' }}</div>
              <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
              <div class="library-item-actions">
                <ActionGate :reason="addToEpisodeDisabledReason" label="加入本集">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('library', item.id)" :disabled="Boolean(addToEpisodeDisabledReason)" :title="addToEpisodeDisabledReason || undefined" @click="onAddPropFromLibrary(item)">加入本集</el-button>
                </ActionGate>
                <el-button size="small" @click="openEditPropLibrary(item)">编辑</el-button>
                <el-button size="small" type="danger" plain @click="onDeletePropLibrary(item)">删除</el-button>
              </div>
            </div>
          </div>
          <div v-if="!propLibraryLoading && propLibraryList.length === 0" class="library-empty">
            <p>暂无本剧道具库记录，可将本剧道具「加入本剧库」后在此查看</p>
            <el-button type="primary" @click="returnToPropPanel">去道具面板</el-button>
          </div>
        </div>
        <div class="library-pagination">
          <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
        </div>
      </el-tab-pane>
      <el-tab-pane label="本剧所有道具" name="drama">
        <div class="library-toolbar">
          <el-input v-model="dramaAllPropKeyword" aria-label="搜索本剧道具" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllPropList()" />
        </div>
        <div v-loading="dramaAllPropLoading" class="library-list">
          <div v-for="item in dramaAllPropList" :key="'pdr-' + item.id" class="library-item">
            <button type="button" class="library-item-cover" :disabled="!assetImageUrl(item)" :aria-label="`预览${item.name || '道具'}图片`" @click="openImagePreview(assetImageUrl(item))">
              <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" :alt="item.name || '道具图片'" />
              <span v-else class="library-item-placeholder">暂无图</span>
            </button>
            <div class="library-item-info">
              <div class="library-item-name">{{ item.name || '未命名' }}</div>
              <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
              <div class="library-item-actions">
                <ActionGate :reason="addToEpisodeDisabledReason" label="加入本集">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('drama', item.id)" :disabled="Boolean(addToEpisodeDisabledReason)" :title="addToEpisodeDisabledReason || undefined" @click="onAddDramaPropToEpisode(item)">加入本集</el-button>
                </ActionGate>
              </div>
            </div>
          </div>
          <div v-if="!dramaAllPropLoading && dramaAllPropList.length === 0" class="library-empty">
            <p>本剧暂无制作道具，请先在道具面板创建</p>
            <el-button type="primary" @click="returnToPropPanel">创建道具</el-button>
          </div>
        </div>
        <div class="library-pagination">
          <el-pagination v-model:current-page="dramaAllPropPage" v-model:page-size="dramaAllPropPageSize" :total="dramaAllPropTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllPropList" @size-change="loadDramaAllPropList" />
        </div>
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button @click="showPropLibrary = false">关闭</el-button>
    </template>
  </AccessibleDialog>
  <!-- 编辑公共道具 -->
  <AccessibleDialog v-model="showEditPropLibrary" title="编辑公共道具" width="440px" @close="editPropLibraryForm = null">
    <el-form v-if="editPropLibraryForm" label-width="80px">
      <el-form-item label="名称">
        <el-input v-model="editPropLibraryForm.name" aria-label="公共道具名称" placeholder="道具名称" />
      </el-form-item>
      <el-form-item label="分类">
        <el-input v-model="editPropLibraryForm.category" aria-label="公共道具分类" placeholder="可选" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="editPropLibraryForm.description" type="textarea" :rows="3" aria-label="公共道具描述" placeholder="可选" />
      </el-form-item>
      <el-form-item label="标签">
        <el-input v-model="editPropLibraryForm.tags" aria-label="公共道具标签" placeholder="可选，逗号分隔" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showEditPropLibrary = false">取消</el-button>
      <el-button type="primary" :loading="editPropLibrarySaving" :title="editPropLibrarySaving ? '正在保存公共道具，请稍候' : undefined" @click="submitEditPropLibrary">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import ActionGate from './ActionGate.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  dramaAllPropList: { type: Array, default: () => [] },
  dramaAllPropLoading: { type: Boolean, default: false },
  dramaAllPropTotal: { type: Number, default: 0 },
  editPropLibrarySaving: { type: Boolean, default: false },
  propLibraryList: { type: Array, default: () => [] },
  propLibraryLoading: { type: Boolean, default: false },
  propLibraryTotal: { type: Number, default: 0 },
  assetImageUrl: { type: Function, required: true },
  debouncedLoadDramaAllPropList: { type: Function, required: true },
  debouncedLoadPropLibrary: { type: Function, required: true },
  isPropAddToEpisodeLoading: { type: Function, required: true },
  loadDramaAllPropList: { type: Function, required: true },
  loadPropLibraryList: { type: Function, required: true },
  onAddDramaPropToEpisode: { type: Function, required: true },
  onAddPropFromLibrary: { type: Function, required: true },
  onDeletePropLibrary: { type: Function, required: true },
  onPropLibraryDialogOpen: { type: Function, required: true },
  onPropLibraryTabChange: { type: Function, required: true },
  openEditPropLibrary: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  returnToPropPanel: { type: Function, default: () => {} },
  submitEditPropLibrary: { type: Function, required: true },
  addToEpisodeDisabledReason: { type: String, default: '' },
})

const editPropLibraryForm = defineModel('editPropLibraryForm', { type: Object, default: null })
const showPropLibrary = defineModel('showPropLibrary', { type: Boolean, default: false })
const showEditPropLibrary = defineModel('showEditPropLibrary', { type: Boolean, default: false })
const propLibraryKeyword = defineModel('propLibraryKeyword', { type: String, default: '' })
const propLibraryPage = defineModel('propLibraryPage', { type: Number, default: 1 })
const propLibraryPageSize = defineModel('propLibraryPageSize', { type: Number, default: 20 })
const propLibraryTab = defineModel('propLibraryTab', { type: String, default: '' })
const dramaAllPropKeyword = defineModel('dramaAllPropKeyword', { type: String, default: '' })
const dramaAllPropPage = defineModel('dramaAllPropPage', { type: Number, default: 1 })
const dramaAllPropPageSize = defineModel('dramaAllPropPageSize', { type: Number, default: 20 })
</script>

<style scoped src="./filmCreateResourceLibrary.css"></style>
