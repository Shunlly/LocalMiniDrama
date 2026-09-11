<template>
  <div class="film-list-char-library-dialogs">
    <!-- 公共角色库 -->
    <AccessibleDialog v-model="showCharLibrary" title="素材库 · 角色" width="720px" destroy-on-close class="library-dialog" @open="loadCharLibraryList">
      <div class="library-toolbar">
        <el-input v-model="charLibraryKeyword" placeholder="搜索名称或描述" aria-label="搜索角色素材" clearable style="width: 200px" @input="debouncedLoadCharLibrary()" />
      </div>
      <div v-loading="charLibraryLoading" class="library-list">
        <div v-for="item in charLibraryList" :key="item.id" class="library-item">
          <button
            v-if="assetImageUrl(item)"
            type="button"
            class="library-item-cover"
            :aria-label="`预览角色素材「${item.name || '未命名'}」图片`"
            @click="openImagePreview(assetImageUrl(item), `角色素材「${item.name || '未命名'}」预览图`)"
          >
            <img :src="assetImageUrl(item)" :alt="`角色素材「${item.name || '未命名'}」预览图`" />
          </button>
          <div v-else class="library-item-cover library-item-cover--empty">
            <span class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.name || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}{{ (item.description || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-label="listWriteLocked ? listWriteLockReason : `编辑公共角色${item.name || '未命名角色'}`" @click="openEditCharLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-label="listWriteLocked ? listWriteLockReason : `删除公共角色${item.name || '未命名角色'}`" @click="onDeleteCharLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="charLibraryError" class="library-error" role="alert">
          <p>{{ charLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="charLibraryLoading" :aria-label="charLibraryLoading ? '正在加载角色库，请稍候' : '重试加载角色库'" @click="loadCharLibraryList">重试</el-button>
        </div>
        <div v-if="!charLibraryLoading && !charLibraryError && charLibraryList.length === 0" class="library-empty" role="status">
          <p>{{ charLibraryKeyword.trim() ? '没有匹配的角色，试试其他关键词。' : '素材库暂无角色，可在项目中将角色「加入素材库」后在此查看' }}</p>
          <el-button v-if="charLibraryKeyword.trim()" size="small" aria-label="清除角色素材搜索" @click="clearCharLibraryKeyword">清除搜索</el-button>
        </div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="charLibraryPage" v-model:page-size="charLibraryPageSize" :total="charLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" aria-label="角色素材分页" @current-change="loadCharLibraryList" @size-change="loadCharLibraryList" />
      </div>
      <template #footer><el-button aria-label="关闭角色库" @click="showCharLibrary = false">关闭</el-button></template>
    </AccessibleDialog>
    <!-- 编辑公共角色 -->
    <AccessibleDialog v-model="showEditCharLibrary" title="编辑素材角色" width="480px" @close="editCharLibraryForm = null">
      <el-form v-if="editCharLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button
              v-if="assetImageUrl(editCharLibraryForm)"
              type="button"
              class="lib-img-thumb"
              :aria-label="`预览角色素材「${editCharLibraryForm.name || '未命名'}」图片`"
              @click="openImagePreview(assetImageUrl(editCharLibraryForm), `角色素材「${editCharLibraryForm.name || '未命名'}」预览图`)"
            >
              <img :src="assetImageUrl(editCharLibraryForm)" :alt="`角色素材「${editCharLibraryForm.name || '未命名'}」预览图`" />
            </button>
            <div v-else class="lib-img-thumb lib-img-thumb--empty" role="img" aria-label="角色素材暂无图片">
              <div class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editCharLibraryForm.imgUploading" :disabled="Boolean(libraryUploadDisabledReason(editCharLibraryForm))" :title="libraryUploadDisabledReason(editCharLibraryForm) || undefined" :aria-label="editCharLibraryForm.imgUploading ? '正在上传图片，请稍候' : (libraryUploadDisabledReason(editCharLibraryForm) || '上传角色图片')" @click="charLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editCharLibraryForm.imgGenerating" :disabled="Boolean(libraryGenerateDisabledReason(editCharLibraryForm))" :title="libraryGenerateDisabledReason(editCharLibraryForm) || undefined" :aria-label="editCharLibraryForm.imgGenerating ? '正在生成角色图，请稍候' : (libraryGenerateDisabledReason(editCharLibraryForm) || 'AI 生成角色图')" @click="doGenerateLibImg(editCharLibraryForm, (editCharLibraryForm.name + (editCharLibraryForm.description ? ', ' + editCharLibraryForm.description : '')), characterLibraryAPI, loadCharLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="charLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editCharLibraryForm, characterLibraryAPI, loadCharLibraryList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editCharLibraryForm.name" aria-label="角色名称" placeholder="角色名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editCharLibraryForm.category" aria-label="角色分类" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editCharLibraryForm.description" type="textarea" :rows="3" aria-label="角色描述" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editCharLibraryForm.tags" aria-label="角色标签" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button aria-label="取消编辑公共角色" @click="showEditCharLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editCharLibrarySaving" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-label="editCharLibrarySaving ? '正在保存公共角色，请稍候' : (listWriteLocked ? listWriteLockReason : '保存公共角色')" @click="submitEditCharLibrary">保存</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { PictureFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { uploadAPI } from '@/api/upload'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { describeServiceLoadError } from '@/utils/requestError'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { assetImageUrl, createLibraryImageActions, hasPendingLibraryImageWork } from './filmListLibraryImage.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
})

const emit = defineEmits(['preview'])
const showCharLibrary = defineModel({ type: Boolean, default: false })

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

const charLibFileRef = ref(null)
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

const charLibraryList = ref([])
const charLibraryLoading = ref(false)
const charLibraryPage = ref(1)
const charLibraryPageSize = ref(20)
const charLibraryTotal = ref(0)
const charLibraryKeyword = ref('')
const charLibraryError = ref('')
const showEditCharLibrary = ref(false)
const editCharLibraryForm = ref(null)
const editCharLibrarySaving = ref(false)
let charLibraryKeywordTimer = null

async function loadCharLibraryList() {
  charLibraryLoading.value = true
  try {
    const res = await characterLibraryAPI.list({ page: charLibraryPage.value, page_size: charLibraryPageSize.value, keyword: charLibraryKeyword.value || undefined, global: 1 })
    charLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    charLibraryTotal.value = p.total ?? 0
    if (p.page != null) charLibraryPage.value = p.page
    if (p.page_size != null) charLibraryPageSize.value = p.page_size
    charLibraryError.value = ''
  } catch (error) {
    charLibraryError.value = describeServiceLoadError(error, { serviceLabel: '角色素材服务' })
  } finally { charLibraryLoading.value = false }
}
function debouncedLoadCharLibrary() {
  if (charLibraryKeywordTimer) clearTimeout(charLibraryKeywordTimer)
  charLibraryKeywordTimer = setTimeout(() => { charLibraryPage.value = 1; loadCharLibraryList() }, 300)
}
function clearCharLibraryKeyword() {
  charLibraryKeyword.value = ''
  charLibraryPage.value = 1
  loadCharLibraryList()
}
function openEditCharLibrary(item) {
  if (props.listWriteLocked) return
  editCharLibraryForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditCharLibrary.value = true
}
async function submitEditCharLibrary() {
  if (props.listWriteLocked) return
  if (!editCharLibraryForm.value?.id) return
  editCharLibrarySaving.value = true
  try {
    await characterLibraryAPI.update(editCharLibraryForm.value.id, { name: editCharLibraryForm.value.name, category: editCharLibraryForm.value.category || null, description: editCharLibraryForm.value.description || null, tags: editCharLibraryForm.value.tags || null, image_url: editCharLibraryForm.value.image_url || null, local_path: editCharLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditCharLibrary.value = false
    loadCharLibraryList()
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '保存失败'))
  } finally { editCharLibrarySaving.value = false }
}
async function onDeleteCharLibrary(item) {
  if (props.listWriteLocked) return
  try { await ElMessageBox.confirm(`确定删除公共角色「${(item.name || '未命名').slice(0, 20)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await characterLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadCharLibraryList() } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '删除失败'))
  }
}

function hasPendingImageWork() {
  return hasPendingLibraryImageWork({
    form: editCharLibraryForm.value,
    saving: editCharLibrarySaving.value,
  })
}
defineExpose({ hasPendingImageWork })

onBeforeUnmount(() => {
  if (charLibraryKeywordTimer) clearTimeout(charLibraryKeywordTimer)
})
</script>

<style scoped src="./filmListLibraryDialogs.css"></style>
<style>
.library-dialog .el-dialog__body { padding-top: 8px; }
</style>
