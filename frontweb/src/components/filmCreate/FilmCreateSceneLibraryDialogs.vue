<template>
  <!-- 场景资源库 -->
  <AccessibleDialog v-model="showSceneLibrary" title="场景资源库" width="720px" destroy-on-close class="library-dialog" @open="onSceneLibraryDialogOpen">
    <el-tabs v-model="sceneLibraryTab" class="char-library-tabs" aria-label="场景资源库分类" @tab-change="onSceneLibraryTabChange">
      <el-tab-pane label="本剧场景库" name="library">
        <div class="library-toolbar">
          <el-input v-model="sceneLibraryKeyword" aria-label="搜索场景素材" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadSceneLibrary()" />
        </div>
        <div v-loading="sceneLibraryLoading" class="library-list">
          <div v-for="item in sceneLibraryList" :key="'slib-' + item.id" class="library-item">
            <button v-if="assetImageUrl(item)" type="button" class="library-item-cover" :aria-label="`预览${item.location || item.time || '场景'}图片`" @click="openImagePreview(assetImageUrl(item))">
              <img :src="assetImageUrl(item)" :alt="item.location || item.time || '场景图片'" />
            </button>
            <div v-else class="library-item-cover library-item-cover--empty" role="img" :aria-label="`${item.location || item.time || '场景'}暂无图片`">
              <span class="library-item-placeholder">暂无图</span>
            </div>
            <div class="library-item-info">
              <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
              <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
              <div class="library-item-actions">
                <ActionGate :reason="addToEpisodeDisabledReason" label="加入本集">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('library', item.id)" :disabled="Boolean(addToEpisodeDisabledReason)" :title="addToEpisodeDisabledReason || undefined" :aria-label="isSceneAddToEpisodeLoading('library', item.id) ? '正在将场景加入本集，请稍候' : (addToEpisodeDisabledReason || `将${item.location || item.time || '未命名场景'}加入本集`)" @click="onAddSceneFromLibrary(item)">加入本集</el-button>
                </ActionGate>
                <el-button size="small" :aria-label="`编辑公共场景${item.location || item.time || '未命名场景'}`" @click="openEditSceneLibrary(item)">编辑</el-button>
                <el-button size="small" type="danger" plain :aria-label="`删除公共场景${item.location || item.time || '未命名场景'}`" @click="onDeleteSceneLibrary(item)">删除</el-button>
              </div>
            </div>
          </div>
          <div v-if="!sceneLibraryLoading && sceneLibraryList.length === 0" class="library-empty" role="status">
            <p>暂无本剧场景库记录，可将本剧场景「加入本剧库」后在此查看</p>
            <div class="library-empty-actions">
              <el-button type="primary" aria-label="去场景面板" @click="returnToScenePanel">去场景面板</el-button>
            </div>
          </div>
        </div>
        <div class="library-pagination">
          <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
        </div>
      </el-tab-pane>
      <el-tab-pane label="本剧所有场景" name="drama">
        <div class="library-toolbar">
          <el-input v-model="dramaAllSceneKeyword" aria-label="搜索本剧场景" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllSceneList()" />
        </div>
        <div v-loading="dramaAllSceneLoading" class="library-list">
          <div v-for="item in dramaAllSceneList" :key="'sdr-' + item.id" class="library-item">
            <button v-if="assetImageUrl(item)" type="button" class="library-item-cover" :aria-label="`预览${item.location || item.time || '场景'}图片`" @click="openImagePreview(assetImageUrl(item))">
              <img :src="assetImageUrl(item)" :alt="item.location || item.time || '场景图片'" />
            </button>
            <div v-else class="library-item-cover library-item-cover--empty" role="img" :aria-label="`${item.location || item.time || '场景'}暂无图片`">
              <span class="library-item-placeholder">暂无图</span>
            </div>
            <div class="library-item-info">
              <div class="library-item-name">{{ item.location || '未命名' }}<span v-if="item.time" class="library-item-sub"> · {{ item.time }}</span></div>
              <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
              <div class="library-item-actions">
                <ActionGate :reason="addToEpisodeDisabledReason" label="加入本集">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('drama', item.id)" :disabled="Boolean(addToEpisodeDisabledReason)" :title="addToEpisodeDisabledReason || undefined" :aria-label="isSceneAddToEpisodeLoading('drama', item.id) ? '正在将场景加入本集，请稍候' : (addToEpisodeDisabledReason || `将${item.location || item.time || '未命名场景'}加入本集`)" @click="onAddDramaSceneToEpisode(item)">加入本集</el-button>
                </ActionGate>
              </div>
            </div>
          </div>
          <div v-if="!dramaAllSceneLoading && dramaAllSceneList.length === 0" class="library-empty" role="status">
            <p>本剧暂无制作场景，请先在场景面板创建</p>
            <div class="library-empty-actions">
              <el-button type="primary" aria-label="创建场景" @click="returnToScenePanel">创建场景</el-button>
            </div>
          </div>
        </div>
        <div class="library-pagination">
          <el-pagination v-model:current-page="dramaAllScenePage" v-model:page-size="dramaAllScenePageSize" :total="dramaAllSceneTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllSceneList" @size-change="loadDramaAllSceneList" />
        </div>
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button aria-label="关闭本剧场景库" @click="showSceneLibrary = false">关闭</el-button>
    </template>
  </AccessibleDialog>
  <!-- 编辑公共场景 -->
  <AccessibleDialog v-model="showEditSceneLibrary" title="编辑公共场景" width="440px" @close="editSceneLibraryForm = null">
    <el-form v-if="editSceneLibraryForm" label-width="80px">
      <el-form-item label="地点">
        <el-input v-model="editSceneLibraryForm.location" aria-label="公共场景地点" placeholder="场景地点" />
      </el-form-item>
      <el-form-item label="时间">
        <el-input v-model="editSceneLibraryForm.time" aria-label="公共场景时间" placeholder="如：浅色/夜晚" />
      </el-form-item>
      <el-form-item label="分类">
        <el-input v-model="editSceneLibraryForm.category" aria-label="公共场景分类" placeholder="可选" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="editSceneLibraryForm.description" type="textarea" :rows="3" aria-label="公共场景描述" placeholder="可选" />
      </el-form-item>
      <el-form-item label="标签">
        <el-input v-model="editSceneLibraryForm.tags" aria-label="公共场景标签" placeholder="可选，逗号分隔" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑公共场景" @click="showEditSceneLibrary = false">取消</el-button>
      <el-button type="primary" :loading="editSceneLibrarySaving" :title="editSceneLibrarySaving ? '正在保存公共场景，请稍候' : undefined" :aria-label="editSceneLibrarySaving ? '正在保存公共场景，请稍候' : '保存公共场景'" @click="submitEditSceneLibrary">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import ActionGate from './ActionGate.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  dramaAllSceneList: { type: Array, default: () => [] },
  dramaAllSceneLoading: { type: Boolean, default: false },
  dramaAllSceneTotal: { type: Number, default: 0 },
  editSceneLibrarySaving: { type: Boolean, default: false },
  sceneLibraryList: { type: Array, default: () => [] },
  sceneLibraryLoading: { type: Boolean, default: false },
  sceneLibraryTotal: { type: Number, default: 0 },
  assetImageUrl: { type: Function, required: true },
  debouncedLoadDramaAllSceneList: { type: Function, required: true },
  debouncedLoadSceneLibrary: { type: Function, required: true },
  isSceneAddToEpisodeLoading: { type: Function, required: true },
  loadDramaAllSceneList: { type: Function, required: true },
  loadSceneLibraryList: { type: Function, required: true },
  onAddDramaSceneToEpisode: { type: Function, required: true },
  onAddSceneFromLibrary: { type: Function, required: true },
  onDeleteSceneLibrary: { type: Function, required: true },
  onSceneLibraryDialogOpen: { type: Function, required: true },
  onSceneLibraryTabChange: { type: Function, required: true },
  openEditSceneLibrary: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  returnToScenePanel: { type: Function, default: () => {} },
  submitEditSceneLibrary: { type: Function, required: true },
  addToEpisodeDisabledReason: { type: String, default: '' },
})

const editSceneLibraryForm = defineModel('editSceneLibraryForm', { type: Object, default: null })
const showSceneLibrary = defineModel('showSceneLibrary', { type: Boolean, default: false })
const showEditSceneLibrary = defineModel('showEditSceneLibrary', { type: Boolean, default: false })
const sceneLibraryKeyword = defineModel('sceneLibraryKeyword', { type: String, default: '' })
const sceneLibraryPage = defineModel('sceneLibraryPage', { type: Number, default: 1 })
const sceneLibraryPageSize = defineModel('sceneLibraryPageSize', { type: Number, default: 20 })
const sceneLibraryTab = defineModel('sceneLibraryTab', { type: String, default: '' })
const dramaAllSceneKeyword = defineModel('dramaAllSceneKeyword', { type: String, default: '' })
const dramaAllScenePage = defineModel('dramaAllScenePage', { type: Number, default: 1 })
const dramaAllScenePageSize = defineModel('dramaAllScenePageSize', { type: Number, default: 20 })
</script>

<style scoped src="./filmCreateResourceLibrary.css"></style>
