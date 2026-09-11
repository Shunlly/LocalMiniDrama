<template>
  <div class="film-list-scene-library-dialogs">
    <!-- 公共场景库 -->
    <AccessibleDialog v-model="showSceneLibrary" title="素材库 · 场景" width="720px" destroy-on-close class="library-dialog" @open="loadSceneLibraryList">
      <div class="library-toolbar">
        <el-input v-model="sceneLibraryKeyword" placeholder="搜索地点或描述" aria-label="搜索场景素材" clearable style="width: 200px" @input="debouncedLoadSceneLibrary()" />
      </div>
      <div v-loading="sceneLibraryLoading" class="library-list">
        <div v-for="item in sceneLibraryList" :key="item.id" class="library-item">
          <button
            v-if="assetImageUrl(item)"
            type="button"
            class="library-item-cover"
            :aria-label="`预览场景素材「${item.location || item.time || '未命名'}」图片`"
            @click="openImagePreview(assetImageUrl(item), `场景素材「${item.location || item.time || '未命名'}」预览图`)"
          >
            <img :src="assetImageUrl(item)" :alt="`场景素材「${item.location || item.time || '未命名'}」预览图`" />
          </button>
          <div v-else class="library-item-cover library-item-cover--empty">
            <span class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-label="listWriteLocked ? listWriteLockReason : `编辑公共场景${item.location || '未命名场景'}`" @click="openEditSceneLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-label="listWriteLocked ? listWriteLockReason : `删除公共场景${item.location || '未命名场景'}`" @click="onDeleteSceneLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="sceneLibraryError" class="library-error" role="alert">
          <p>{{ sceneLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="sceneLibraryLoading" :aria-label="sceneLibraryLoading ? '正在加载场景库，请稍候' : '重试加载场景库'" @click="loadSceneLibraryList">重试</el-button>
        </div>
        <div v-if="!sceneLibraryLoading && !sceneLibraryError && sceneLibraryList.length === 0" class="library-empty" role="status">
          <p>{{ sceneLibraryKeyword.trim() ? '没有匹配的场景，试试其他关键词。' : '素材库暂无场景，可在项目中将场景「加入素材库」后在此查看' }}</p>
          <el-button v-if="sceneLibraryKeyword.trim()" size="small" aria-label="清除场景素材搜索" @click="clearSceneLibraryKeyword">清除搜索</el-button>
        </div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" aria-label="场景素材分页" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
      </div>
      <template #footer><el-button aria-label="关闭场景库" @click="showSceneLibrary = false">关闭</el-button></template>
    </AccessibleDialog>
    <!-- 编辑公共场景 -->
    <AccessibleDialog v-model="showEditSceneLibrary" title="编辑素材场景" width="480px" @close="editSceneLibraryForm = null">
      <el-form v-if="editSceneLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button
              v-if="assetImageUrl(editSceneLibraryForm)"
              type="button"
              class="lib-img-thumb"
              :aria-label="`预览场景素材「${editSceneLibraryForm.location || editSceneLibraryForm.time || '未命名'}」图片`"
              @click="openImagePreview(assetImageUrl(editSceneLibraryForm), `场景素材「${editSceneLibraryForm.location || editSceneLibraryForm.time || '未命名'}」预览图`)"
            >
              <img :src="assetImageUrl(editSceneLibraryForm)" :alt="`场景素材「${editSceneLibraryForm.location || editSceneLibraryForm.time || '未命名'}」预览图`" />
            </button>
            <div v-else class="lib-img-thumb lib-img-thumb--empty" role="img" aria-label="场景素材暂无图片">
              <div class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editSceneLibraryForm.imgUploading" :disabled="Boolean(libraryUploadDisabledReason(editSceneLibraryForm))" :title="libraryUploadDisabledReason(editSceneLibraryForm) || undefined" :aria-label="editSceneLibraryForm.imgUploading ? '正在上传图片，请稍候' : (libraryUploadDisabledReason(editSceneLibraryForm) || '上传场景图片')" @click="sceneLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editSceneLibraryForm.imgGenerating" :disabled="Boolean(libraryGenerateDisabledReason(editSceneLibraryForm))" :title="libraryGenerateDisabledReason(editSceneLibraryForm) || undefined" :aria-label="editSceneLibraryForm.imgGenerating ? '正在生成场景图，请稍候' : (libraryGenerateDisabledReason(editSceneLibraryForm) || 'AI 生成场景图')" @click="doGenerateLibImg(editSceneLibraryForm, ([editSceneLibraryForm.location, editSceneLibraryForm.time, editSceneLibraryForm.description].filter(Boolean).join(', ')), sceneLibraryAPI, loadSceneLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="sceneLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editSceneLibraryForm, sceneLibraryAPI, loadSceneLibraryList)" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="editSceneLibraryForm.location" aria-label="场景地点" placeholder="场景地点" /></el-form-item>
        <el-form-item label="时间"><el-input v-model="editSceneLibraryForm.time" aria-label="场景时间" placeholder="如：浅色/夜晚" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editSceneLibraryForm.category" aria-label="场景分类" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editSceneLibraryForm.description" type="textarea" :rows="3" aria-label="场景描述" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editSceneLibraryForm.tags" aria-label="场景标签" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button aria-label="取消编辑公共场景" @click="showEditSceneLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editSceneLibrarySaving" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-label="editSceneLibrarySaving ? '正在保存公共场景，请稍候' : (listWriteLocked ? listWriteLockReason : '保存公共场景')" @click="submitEditSceneLibrary">保存</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { PictureFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { uploadAPI } from '@/api/upload'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { describeServiceLoadError } from '@/utils/requestError'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { assetImageUrl, createLibraryImageActions } from './filmListLibraryImage.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
})

const emit = defineEmits(['preview'])
const showSceneLibrary = defineModel({ type: Boolean, default: false })

function libraryWriteReason() {
  return props.listWriteLocked ? props.listWriteLockReason : ''
}
function libraryUploadDisabledReason(form) {
  if (libraryWriteReason()) return libraryWriteReason()
  if (form?.imgGenerating) return '正在生成图片，请稍候'
  return ''
}
function libraryGenerateDisabledReason(form) {
  if (libraryWriteReason()) return libraryWriteReason()
  if (form?.imgUploading) return '正在上传图片，请稍候'
  return ''
}

const sceneLibFileRef = ref(null)
const imageActions = createLibraryImageActions({
  getListWriteLocked: () => props.listWriteLocked,
  uploadAPI,
  imagesAPI,
  taskAPI,
  ElMessage,
  isUserFacingAbort,
  toUserFacingError,
})

async function doUploadLibImg(event, form, api, reloadFn) {
  if (props.listWriteLocked || form?.imgGenerating || form?.imgUploading) {
    if (event.target) event.target.value = ''
    return
  }
  return imageActions.doUploadLibImg(event, form, api, reloadFn)
}

async function doGenerateLibImg(form, prompt, api, reloadFn) {
  if (props.listWriteLocked || form?.imgUploading || form?.imgGenerating) return
  return imageActions.doGenerateLibImg(form, prompt, api, reloadFn)
}

function openImagePreview(url, alt = '图片预览') {
  const src = String(url || '').trim()
  if (!src) return
  emit('preview', src, alt)
}

const sceneLibraryList = ref([])
const sceneLibraryLoading = ref(false)
const sceneLibraryPage = ref(1)
const sceneLibraryPageSize = ref(20)
const sceneLibraryTotal = ref(0)
const sceneLibraryKeyword = ref('')
const sceneLibraryError = ref('')
const showEditSceneLibrary = ref(false)
const editSceneLibraryForm = ref(null)
const editSceneLibrarySaving = ref(false)
let sceneLibraryKeywordTimer = null

async function loadSceneLibraryList() {
  sceneLibraryLoading.value = true
  try {
    const res = await sceneLibraryAPI.list({ page: sceneLibraryPage.value, page_size: sceneLibraryPageSize.value, keyword: sceneLibraryKeyword.value || undefined, global: 1 })
    sceneLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    sceneLibraryTotal.value = p.total ?? 0
    if (p.page != null) sceneLibraryPage.value = p.page
    if (p.page_size != null) sceneLibraryPageSize.value = p.page_size
    sceneLibraryError.value = ''
  } catch (error) {
    sceneLibraryError.value = describeServiceLoadError(error, { serviceLabel: '场景素材服务' })
  } finally { sceneLibraryLoading.value = false }
}
function debouncedLoadSceneLibrary() {
  if (sceneLibraryKeywordTimer) clearTimeout(sceneLibraryKeywordTimer)
  sceneLibraryKeywordTimer = setTimeout(() => { sceneLibraryPage.value = 1; loadSceneLibraryList() }, 300)
}
function clearSceneLibraryKeyword() {
  sceneLibraryKeyword.value = ''
  sceneLibraryPage.value = 1
  loadSceneLibraryList()
}
function openEditSceneLibrary(item) {
  if (props.listWriteLocked) return
  editSceneLibraryForm.value = { id: item.id, location: item.location ?? '', time: item.time ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditSceneLibrary.value = true
}
async function submitEditSceneLibrary() {
  if (props.listWriteLocked) return
  if (!editSceneLibraryForm.value?.id) return
  editSceneLibrarySaving.value = true
  try {
    await sceneLibraryAPI.update(editSceneLibraryForm.value.id, { location: editSceneLibraryForm.value.location, time: editSceneLibraryForm.value.time || null, category: editSceneLibraryForm.value.category || null, description: editSceneLibraryForm.value.description || null, tags: editSceneLibraryForm.value.tags || null, image_url: editSceneLibraryForm.value.image_url || null, local_path: editSceneLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditSceneLibrary.value = false
    loadSceneLibraryList()
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '保存失败'))
  } finally { editSceneLibrarySaving.value = false }
}
async function onDeleteSceneLibrary(item) {
  if (props.listWriteLocked) return
  const name = (item.location || item.time || '未命名').slice(0, 20)
  try { await ElMessageBox.confirm(`确定删除公共场景「${name}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await sceneLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadSceneLibraryList() } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '删除失败'))
  }
}

onBeforeUnmount(() => {
  if (sceneLibraryKeywordTimer) clearTimeout(sceneLibraryKeywordTimer)
})
</script>

<style scoped src="./filmListLibraryDialogs.css"></style>
<style>
.library-dialog .el-dialog__body { padding-top: 8px; }
</style>
