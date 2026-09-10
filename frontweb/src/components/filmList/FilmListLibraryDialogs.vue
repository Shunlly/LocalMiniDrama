<template>
  <div class="film-list-library-dialogs">
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
              <el-button size="small" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="openEditCharLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="onDeleteCharLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="charLibraryError" class="library-error" role="alert">
          <p>{{ charLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="charLibraryLoading" @click="loadCharLibraryList">重试</el-button>
        </div>
        <div v-if="!charLibraryLoading && !charLibraryError && charLibraryList.length === 0" class="library-empty" role="status">
          <p>{{ charLibraryKeyword.trim() ? '没有匹配的角色，试试其他关键词。' : '素材库暂无角色，可在项目中将角色「加入素材库」后在此查看' }}</p>
          <el-button v-if="charLibraryKeyword.trim()" size="small" aria-label="清除角色素材搜索" @click="clearCharLibraryKeyword">清除搜索</el-button>
        </div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="charLibraryPage" v-model:page-size="charLibraryPageSize" :total="charLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" aria-label="角色素材分页" @current-change="loadCharLibraryList" @size-change="loadCharLibraryList" />
      </div>
      <template #footer><el-button @click="showCharLibrary = false">关闭</el-button></template>
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
              <el-button size="small" :loading="editCharLibraryForm.imgUploading" :disabled="Boolean(libraryUploadDisabledReason(editCharLibraryForm))" :title="libraryUploadDisabledReason(editCharLibraryForm) || undefined" @click="charLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editCharLibraryForm.imgGenerating" :disabled="Boolean(libraryGenerateDisabledReason(editCharLibraryForm))" :title="libraryGenerateDisabledReason(editCharLibraryForm) || undefined" @click="doGenerateLibImg(editCharLibraryForm, (editCharLibraryForm.name + (editCharLibraryForm.description ? ', ' + editCharLibraryForm.description : '')), characterLibraryAPI, loadCharLibraryList)">AI 生成</el-button>
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
        <el-button @click="showEditCharLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editCharLibrarySaving" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="submitEditCharLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

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
              <el-button size="small" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="openEditSceneLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="onDeleteSceneLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="sceneLibraryError" class="library-error" role="alert">
          <p>{{ sceneLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="sceneLibraryLoading" @click="loadSceneLibraryList">重试</el-button>
        </div>
        <div v-if="!sceneLibraryLoading && !sceneLibraryError && sceneLibraryList.length === 0" class="library-empty" role="status">
          <p>{{ sceneLibraryKeyword.trim() ? '没有匹配的场景，试试其他关键词。' : '素材库暂无场景，可在项目中将场景「加入素材库」后在此查看' }}</p>
          <el-button v-if="sceneLibraryKeyword.trim()" size="small" aria-label="清除场景素材搜索" @click="clearSceneLibraryKeyword">清除搜索</el-button>
        </div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" aria-label="场景素材分页" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
      </div>
      <template #footer><el-button @click="showSceneLibrary = false">关闭</el-button></template>
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
              <el-button size="small" :loading="editSceneLibraryForm.imgUploading" :disabled="Boolean(libraryUploadDisabledReason(editSceneLibraryForm))" :title="libraryUploadDisabledReason(editSceneLibraryForm) || undefined" @click="sceneLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editSceneLibraryForm.imgGenerating" :disabled="Boolean(libraryGenerateDisabledReason(editSceneLibraryForm))" :title="libraryGenerateDisabledReason(editSceneLibraryForm) || undefined" @click="doGenerateLibImg(editSceneLibraryForm, ([editSceneLibraryForm.location, editSceneLibraryForm.time, editSceneLibraryForm.description].filter(Boolean).join(', ')), sceneLibraryAPI, loadSceneLibraryList)">AI 生成</el-button>
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
        <el-button @click="showEditSceneLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editSceneLibrarySaving" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="submitEditSceneLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 公共道具库 -->
    <AccessibleDialog v-model="showPropLibrary" title="素材库 · 道具" width="720px" destroy-on-close class="library-dialog" @open="loadPropLibraryList">
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
          <div v-else class="library-item-cover library-item-cover--empty">
            <span class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.name || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="openEditPropLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="onDeletePropLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="propLibraryError" class="library-error" role="alert">
          <p>{{ propLibraryError }}</p>
          <el-button size="small" type="primary" plain :loading="propLibraryLoading" @click="loadPropLibraryList">重试</el-button>
        </div>
        <div v-if="!propLibraryLoading && !propLibraryError && propLibraryList.length === 0" class="library-empty" role="status">
          <p>{{ propLibraryKeyword.trim() ? '没有匹配的道具，试试其他关键词。' : '素材库暂无道具，可在项目中将道具「加入素材库」后在此查看' }}</p>
          <el-button v-if="propLibraryKeyword.trim()" size="small" aria-label="清除道具素材搜索" @click="clearPropLibraryKeyword">清除搜索</el-button>
        </div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" aria-label="道具素材分页" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
      </div>
      <template #footer><el-button @click="showPropLibrary = false">关闭</el-button></template>
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
              <el-button size="small" :loading="editPropLibraryForm.imgUploading" :disabled="Boolean(libraryUploadDisabledReason(editPropLibraryForm))" :title="libraryUploadDisabledReason(editPropLibraryForm) || undefined" @click="propLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editPropLibraryForm.imgGenerating" :disabled="Boolean(libraryGenerateDisabledReason(editPropLibraryForm))" :title="libraryGenerateDisabledReason(editPropLibraryForm) || undefined" @click="doGenerateLibImg(editPropLibraryForm, (editPropLibraryForm.name + (editPropLibraryForm.description ? ', ' + editPropLibraryForm.description : '')), propLibraryAPI, loadPropLibraryList)">AI 生成</el-button>
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
        <el-button @click="showEditPropLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editPropLibrarySaving" :disabled="listWriteLocked" :title="listWriteLocked ? listWriteLockReason : undefined" @click="submitEditPropLibrary">保存</el-button>
      </template>
    </AccessibleDialog>

    <ImagePreviewDialog
      v-model="showImagePreview"
      :src="previewImage.src"
      :alt="previewImage.alt"
    />

  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { PictureFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI } from '@/api/propLibrary'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import { uploadAPI } from '@/api/upload'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { describeServiceLoadError } from '@/utils/requestError'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  listWriteLocked: { type: Boolean, default: false },
  listWriteLockReason: { type: String, default: '' },
})

const showCharLibrary = defineModel('showCharLibrary', { type: Boolean, default: false })
const showSceneLibrary = defineModel('showSceneLibrary', { type: Boolean, default: false })
const showPropLibrary = defineModel('showPropLibrary', { type: Boolean, default: false })

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

// 库编辑图片 – 文件输入 refs
const charLibFileRef  = ref(null)
const sceneLibFileRef = ref(null)
const propLibFileRef  = ref(null)

// 共享：上传图片
async function doUploadLibImg(event, form, api, reloadFn) {
  if (props.listWriteLocked || form?.imgGenerating || form?.imgUploading) {
    if (event.target) event.target.value = ''
    return
  }
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file)
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await api.update(form.id, { image_url: url, local_path: null })
    reloadFn()
    ElMessage.success('图片已更新')
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '上传失败'))
  }
  finally { form.imgUploading = false }
}

// 共享：AI 生成图片
async function doGenerateLibImg(form, prompt, api, reloadFn) {
  if (props.listWriteLocked || form?.imgUploading || form?.imgGenerating) return
  if (!prompt?.trim()) { ElMessage.warning('请先填写名称或描述'); return }
  form.imgGenerating = true
  try {
    const res = await imagesAPI.create({ prompt: prompt.trim(), drama_id: null })
    const imgData = res?.data ?? res
    const taskId = imgData?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    let task = null
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const tr = await taskAPI.get(taskId)
      task = tr?.data ?? tr
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(task.error || '生成失败')
    }
    if (!task || task.status !== 'completed') throw new Error('生成超时')
    const result = task.result
    const imageUrl = result?.image_url
    const localPath = result?.local_path ?? null
    if (!imageUrl && !localPath) throw new Error('未获取到图片地址')
    form.image_url = imageUrl || ''
    form.local_path = localPath
    await api.update(form.id, { image_url: imageUrl || null, local_path: localPath })
    reloadFn()
    ElMessage.success('AI 图片已生成')
  } catch (e) {
    if (isUserFacingAbort(e) || e === 'cancel') return
    ElMessage.error(toUserFacingError(e, '生成失败'))
  }
  finally { form.imgGenerating = false }
}

// 图片预览
const showImagePreview = ref(false)
const previewImage = ref({ src: '', alt: '图片预览' })
function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') return item.startsWith('http') ? item : item
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  return item.image_url || ''
}
function openImagePreview(url, alt = '图片预览') {
  const src = String(url || '').trim()
  if (!src) return
  previewImage.value = { src, alt }
  showImagePreview.value = true
}

// 公共角色库
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

// 公共场景库
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

// 公共道具库
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


onBeforeUnmount(() => {
  if (charLibraryKeywordTimer) clearTimeout(charLibraryKeywordTimer)
  if (sceneLibraryKeywordTimer) clearTimeout(sceneLibraryKeywordTimer)
  if (propLibraryKeywordTimer) clearTimeout(propLibraryKeywordTimer)
})
</script>

<style scoped>
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
.library-error p {
  margin: 0;
}
/* 公共库弹窗 */
:global(.library-dialog .el-dialog__body) { padding-top: 8px; }

/* 编辑弹框内图片区 */
.lib-img-editor { display: flex; align-items: center; gap: 14px; }
.lib-img-thumb { width: 88px; height: 88px; padding: 0; border-radius: 8px; overflow: hidden; background: var(--bg-inner, #1c1c1e); border: 1px solid var(--border-color, #27272a); color: inherit; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
button.lib-img-thumb { cursor: zoom-in; }
.lib-img-thumb--empty { cursor: default; }
.lib-img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lib-img-empty { color: var(--text-faint, #52525b); font-size: 26px; }
.lib-img-btns { display: flex; flex-direction: column; gap: 8px; }
.library-toolbar { margin-bottom: 12px; }
.library-list {
  min-height: 200px;
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.library-item {
  display: flex;
  gap: 12px;
  padding: 10px;
  background: #1c1c1e;
  border: 1px solid #27272a;
  border-radius: 8px;
}
.library-item-cover {
  width: 72px;
  height: 72px;
  padding: 0;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #27272a;
  display: flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}
button.library-item-cover { cursor: zoom-in; }
.library-item-cover--empty { cursor: default; }
.library-item-cover:focus-visible,
.lib-img-thumb:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: 2px;
}
.library-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-item-placeholder { font-size: 0.8rem; color: #71717a; }
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; margin-bottom: 4px; color: #fafafa; }
.library-item-desc { font-size: 0.85rem; color: #a1a1aa; margin-bottom: 8px; }
.library-item-actions { display: flex; gap: 8px; }
.library-empty { text-align: center; color: #71717a; padding: 40px 20px; }
.library-empty p { margin: 0; }
.library-empty .el-button { margin-top: 12px; }
.library-pagination { margin-top: 12px; display: flex; justify-content: center; }
html.light .library-item {
  background: #faf9ff;
  border-color: #e5e7eb;
}
html.light .library-item-name { color: #1e1b4b; }
html.light .library-item-desc { color: #4b5563; }
html.light .library-empty { color: #6b7280; }
html.light .library-error { color: #b91c1c; background: #fef2f2; }
html.light .lib-img-thumb {
  background: #f3f4f6;
  border-color: #e5e7eb;
}
html.light .lib-img-empty { color: #9ca3af; }
</style>
