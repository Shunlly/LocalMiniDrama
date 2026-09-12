<template>
  <div class="film-list-prop-library-dialogs">
    <!-- 公共道具库 -->
    <AccessibleDialog v-model="showPropLibrary" title="素材库 · 道具" width="720px" destroy-on-close class="library-dialog" @open="loadPropLibraryList">
      <p v-if="listWriteLocked && listWriteLockReason" id="prop-library-write-lock-reason" class="visually-hidden">{{ listWriteLockReason }}</p>
      <div class="library-toolbar">
        <el-input v-model="propLibraryKeyword" placeholder="搜索名称或描述" aria-label="搜索道具素材" clearable style="width: 200px" @input="debouncedLoadPropLibrary()" />
      </div>
      <div v-loading="propLibraryLoading" class="library-list">
        <div v-for="item in propLibraryList" :key="item.id" class="library-item">
          <button
            v-if="assetImageUrl(item)"
            type="button"
            class="library-item-cover"
            :aria-label="`预览道具素材「${item.name || '未命名'}」图片`"
            @click="openImagePreview(assetImageUrl(item), `道具素材「${item.name || '未命名'}」预览图`)"
          >
            <img :src="assetImageUrl(item)" :alt="`道具素材「${item.name || '未命名'}」预览图`" />
          </button>
          <div
            v-else
            class="library-item-cover library-item-cover--empty"
            role="img"
            :aria-label="`道具素材「${item.name || '未命名'}」暂无图片`"
          >
            <span class="library-item-placeholder" aria-hidden="true">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.name || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="top">
                <span class="tooltip-trigger" :tabindex="listWriteLocked ? 0 : undefined" :aria-label="listWriteLocked ? `编辑公共道具${item.name || '未命名道具'}不可用：${listWriteLockReason}` : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'prop-library-write-lock-reason' : undefined">
                  <el-button size="small" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'prop-library-write-lock-reason' : undefined" :aria-label="listWriteLocked ? `编辑公共道具${item.name || '未命名道具'}不可用：${listWriteLockReason}` : `编辑公共道具${item.name || '未命名道具'}`" @click="openEditPropLibrary(item)">编辑</el-button>
                </span>
              </el-tooltip>
              <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="top">
                <span class="tooltip-trigger" :tabindex="listWriteLocked ? 0 : undefined" :aria-label="listWriteLocked ? `删除公共道具${item.name || '未命名道具'}不可用：${listWriteLockReason}` : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'prop-library-write-lock-reason' : undefined">
                  <el-button size="small" type="danger" plain :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'prop-library-write-lock-reason' : undefined" :aria-label="listWriteLocked ? `删除公共道具${item.name || '未命名道具'}不可用：${listWriteLockReason}` : `删除公共道具${item.name || '未命名道具'}`" @click="onDeletePropLibrary(item)">删除</el-button>
                </span>
              </el-tooltip>
            </div>
          </div>
        </div>
        <div v-if="propLibraryError" class="library-error" role="alert">
          <p>{{ propLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="propLibraryLoading" :aria-label="propLibraryLoading ? '正在加载道具库，请稍候' : '重试加载道具库'" @click="loadPropLibraryList">重试</el-button>
        </div>
        <div v-if="!propLibraryLoading && !propLibraryError && propLibraryList.length === 0" class="library-empty" role="status" aria-live="polite">
          <p>{{ propLibraryKeyword.trim() ? '没有匹配的道具，试试其他关键词。' : '素材库暂无道具，可在项目中将道具「加入素材库」后在此查看' }}</p>
          <el-button v-if="propLibraryKeyword.trim()" size="small" aria-label="清除道具素材搜索" @click="clearPropLibraryKeyword">清除道具素材搜索</el-button>
          <el-button v-else size="small" aria-label="关闭道具库并回到项目列表" @click="showPropLibrary = false">关闭道具库并回到项目列表</el-button>
        </div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" aria-label="道具素材分页" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
      </div>
      <template #footer><el-button aria-label="关闭道具库" @click="showPropLibrary = false">关闭</el-button></template>
    </AccessibleDialog>
    <!-- 编辑公共道具 -->
    <AccessibleDialog v-model="showEditPropLibrary" title="编辑素材道具" width="480px" @close="editPropLibraryForm = null">
      <el-form v-if="editPropLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button
              v-if="assetImageUrl(editPropLibraryForm)"
              type="button"
              class="lib-img-thumb"
              :aria-label="`预览道具素材「${editPropLibraryForm.name || '未命名'}」图片`"
              @click="openImagePreview(assetImageUrl(editPropLibraryForm), `道具素材「${editPropLibraryForm.name || '未命名'}」预览图`)"
            >
              <img :src="assetImageUrl(editPropLibraryForm)" :alt="`道具素材「${editPropLibraryForm.name || '未命名'}」预览图`" />
            </button>
            <div v-else class="lib-img-thumb lib-img-thumb--empty" role="img" aria-label="道具素材暂无图片">
              <div class="lib-img-empty"><el-icon aria-hidden="true"><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-tooltip :content="libraryUploadDisabledReason(editPropLibraryForm)" :disabled="!libraryUploadDisabledReason(editPropLibraryForm)" placement="top">
                <span
                  class="tooltip-trigger"
                  :tabindex="libraryUploadDisabledReason(editPropLibraryForm) ? 0 : undefined"
                  :aria-label="libraryUploadDisabledReason(editPropLibraryForm) ? `上传道具图片不可用：${libraryUploadDisabledReason(editPropLibraryForm)}` : undefined"
                  :aria-describedby="libraryUploadDisabledReason(editPropLibraryForm) ? 'prop-library-upload-reason' : undefined"
                >
                  <p v-if="libraryUploadDisabledReason(editPropLibraryForm)" id="prop-library-upload-reason" class="visually-hidden">{{ libraryUploadDisabledReason(editPropLibraryForm) }}</p>
                  <el-button size="small" :loading="editPropLibraryForm.imgUploading" :disabled="Boolean(libraryUploadDisabledReason(editPropLibraryForm))" :title="libraryUploadDisabledReason(editPropLibraryForm) || undefined" :aria-describedby="libraryUploadDisabledReason(editPropLibraryForm) ? 'prop-library-upload-reason' : undefined" :aria-label="editPropLibraryForm.imgUploading ? '正在上传图片，请稍候' : (libraryUploadDisabledReason(editPropLibraryForm) || '上传道具图片')" @click="propLibFileRef.click()">上传图片</el-button>
                </span>
              </el-tooltip>
              <el-tooltip :content="libraryGenerateDisabledReason(editPropLibraryForm)" :disabled="!libraryGenerateDisabledReason(editPropLibraryForm)" placement="top">
                <span
                  class="tooltip-trigger"
                  :tabindex="libraryGenerateDisabledReason(editPropLibraryForm) ? 0 : undefined"
                  :aria-label="libraryGenerateDisabledReason(editPropLibraryForm) ? `AI 生成道具图不可用：${libraryGenerateDisabledReason(editPropLibraryForm)}` : undefined"
                  :aria-describedby="libraryGenerateDisabledReason(editPropLibraryForm) ? 'prop-library-generate-reason' : undefined"
                >
                  <p v-if="libraryGenerateDisabledReason(editPropLibraryForm)" id="prop-library-generate-reason" class="visually-hidden">{{ libraryGenerateDisabledReason(editPropLibraryForm) }}</p>
                  <el-button size="small" type="primary" :loading="editPropLibraryForm.imgGenerating" :disabled="Boolean(libraryGenerateDisabledReason(editPropLibraryForm))" :title="libraryGenerateDisabledReason(editPropLibraryForm) || undefined" :aria-describedby="libraryGenerateDisabledReason(editPropLibraryForm) ? 'prop-library-generate-reason' : undefined" :aria-label="editPropLibraryForm.imgGenerating ? '正在生成道具图，请稍候' : (libraryGenerateDisabledReason(editPropLibraryForm) || 'AI 生成道具图')" @click="doGenerateLibImg(editPropLibraryForm, (editPropLibraryForm.name + (editPropLibraryForm.description ? ', ' + editPropLibraryForm.description : '')), propLibraryAPI, loadPropLibraryList)">AI 生成</el-button>
                </span>
              </el-tooltip>
            </div>
          </div>
          <input ref="propLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editPropLibraryForm, propLibraryAPI, loadPropLibraryList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editPropLibraryForm.name" aria-label="道具名称" placeholder="道具名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editPropLibraryForm.category" aria-label="道具分类" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editPropLibraryForm.description" type="textarea" :rows="3" aria-label="道具描述" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editPropLibraryForm.tags" aria-label="道具标签" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button aria-label="取消编辑公共道具" @click="showEditPropLibrary = false">取消</el-button>
        <el-tooltip :content="listWriteLockReason" :disabled="!listWriteLocked" placement="top">
          <span class="tooltip-trigger" :tabindex="listWriteLocked ? 0 : undefined" :aria-label="listWriteLocked ? `保存公共道具不可用：${listWriteLockReason}` : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'prop-library-write-lock-reason' : undefined">
            <el-button type="primary" :loading="editPropLibrarySaving" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" :aria-describedby="listWriteLocked && listWriteLockReason ? 'prop-library-write-lock-reason' : undefined" :aria-label="editPropLibrarySaving ? '正在保存公共道具，请稍候' : (listWriteLocked ? `保存公共道具不可用：${listWriteLockReason}` : '保存公共道具')" @click="submitEditPropLibrary">保存</el-button>
          </span>
        </el-tooltip>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { PictureFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { propLibraryAPI } from '@/api/propLibrary'
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
const showPropLibrary = defineModel({ type: Boolean, default: false })

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

const propLibFileRef = ref(null)
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

const propLibraryList = ref([])
const propLibraryLoading = ref(false)
const propLibraryPage = ref(1)
const propLibraryPageSize = ref(20)
const propLibraryTotal = ref(0)
const propLibraryKeyword = ref('')
const propLibraryError = ref('')
const showEditPropLibrary = ref(false)
const editPropLibraryForm = ref(null)
const editPropLibrarySaving = ref(false)
let propLibraryKeywordTimer = null

async function loadPropLibraryList() {
  propLibraryLoading.value = true
  try {
    const res = await propLibraryAPI.list({ page: propLibraryPage.value, page_size: propLibraryPageSize.value, keyword: propLibraryKeyword.value || undefined, global: 1 })
    propLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    propLibraryTotal.value = p.total ?? 0
    if (p.page != null) propLibraryPage.value = p.page
    if (p.page_size != null) propLibraryPageSize.value = p.page_size
    propLibraryError.value = ''
  } catch (error) {
    propLibraryError.value = describeServiceLoadError(error, { serviceLabel: '道具素材服务' })
  } finally { propLibraryLoading.value = false }
}
function debouncedLoadPropLibrary() {
  if (propLibraryKeywordTimer) clearTimeout(propLibraryKeywordTimer)
  propLibraryKeywordTimer = setTimeout(() => { propLibraryPage.value = 1; loadPropLibraryList() }, 300)
}
function clearPropLibraryKeyword() {
  propLibraryKeyword.value = ''
  propLibraryPage.value = 1
  loadPropLibraryList()
}
function openEditPropLibrary(item) {
  if (props.listWriteLocked) return
  editPropLibraryForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditPropLibrary.value = true
}
async function submitEditPropLibrary() {
  if (props.listWriteLocked) return
  if (!editPropLibraryForm.value?.id) return
  editPropLibrarySaving.value = true
  try {
    await propLibraryAPI.update(editPropLibraryForm.value.id, { name: editPropLibraryForm.value.name, category: editPropLibraryForm.value.category || null, description: editPropLibraryForm.value.description || null, tags: editPropLibraryForm.value.tags || null, image_url: editPropLibraryForm.value.image_url || null, local_path: editPropLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditPropLibrary.value = false
    loadPropLibraryList()
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '保存失败'))
  } finally { editPropLibrarySaving.value = false }
}
async function onDeletePropLibrary(item) {
  if (props.listWriteLocked) return
  try { await ElMessageBox.confirm(`确定删除公共道具「${(item.name || '未命名').slice(0, 20)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await propLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadPropLibraryList() } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '删除失败'))
  }
}

function hasPendingImageWork() {
  return hasPendingLibraryImageWork({
    form: editPropLibraryForm.value,
    saving: editPropLibrarySaving.value,
  })
}
defineExpose({ hasPendingImageWork })

onBeforeUnmount(() => {
  if (propLibraryKeywordTimer) clearTimeout(propLibraryKeywordTimer)
})
</script>

<style scoped src="./filmListLibraryDialogs.css"></style>
<style>
.library-dialog .el-dialog__body { padding-top: 8px; }
</style>
