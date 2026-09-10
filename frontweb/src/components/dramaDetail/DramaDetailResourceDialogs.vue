<template>
  <div class="drama-detail-resource-dialogs">
    <AccessibleDialog v-model="editDramaCharVisible" title="编辑制作角色" width="500px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('dramaChar', done)" @close="editDramaCharForm = null">
      <el-form v-if="editDramaCharForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button type="button" class="lib-img-thumb" :disabled="!assetImageUrl(editDramaCharForm)" :title="assetImageUrl(editDramaCharForm) ? undefined : '暂无图片'" aria-label="预览制作角色图片" @click="openPreview(assetImageUrl(editDramaCharForm))">
              <img v-if="editDramaCharForm.image_url || editDramaCharForm.local_path" :src="assetImageUrl(editDramaCharForm)" :alt="editDramaCharForm.name || '制作角色图片'" />
              <span v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></span>
            </button>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editDramaCharForm.imgUploading" :disabled="editDramaCharForm.imgGenerating" :title="editDramaCharForm.imgGenerating ? '正在生成图片，请稍候' : undefined" @click="dramaCharFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editDramaCharForm.imgGenerating" :disabled="editDramaCharForm.imgUploading" :title="editDramaCharForm.imgUploading ? '正在上传图片，请稍候' : undefined" @click="generateDramaCharImg">AI 生成</el-button>
            </div>
          </div>
          <input ref="dramaCharFileRef" type="file" accept="image/*" style="display:none" @change="uploadDramaCharImg" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editDramaCharForm.name" aria-label="制作角色名称" /></el-form-item>
        <el-form-item label="角色类型">
          <el-select v-model="editDramaCharForm.role" aria-label="角色类型" style="width:100%">
            <el-option label="主角" value="main" />
            <el-option label="配角" value="supporting" />
            <el-option label="次要角色" value="minor" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述"><el-input v-model="editDramaCharForm.description" type="textarea" :rows="3" placeholder="角色背景描述" aria-label="制作角色描述" /></el-form-item>
        <el-form-item label="性格"><el-input v-model="editDramaCharForm.personality" placeholder="性格特征" aria-label="制作角色性格" /></el-form-item>
        <el-form-item label="外貌"><el-input v-model="editDramaCharForm.appearance" type="textarea" :rows="2" placeholder="外貌特征（影响图片生成）" aria-label="制作角色外貌" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestResourceEditorClose('dramaChar')">取消</el-button>
        <el-button type="primary" :loading="editDramaCharSaving" :disabled="editDramaCharSaving" :title="editDramaCharSaving ? '正在保存，请稍候' : undefined" @click="saveDramaChar">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 制作场景 编辑 -->
    <AccessibleDialog v-model="editDramaSceneVisible" title="编辑制作场景" width="500px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('dramaScene', done)" @close="editDramaSceneForm = null">
      <el-form v-if="editDramaSceneForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button type="button" class="lib-img-thumb" :disabled="!assetImageUrl(editDramaSceneForm)" :title="assetImageUrl(editDramaSceneForm) ? undefined : '暂无图片'" aria-label="预览制作场景图片" @click="openPreview(assetImageUrl(editDramaSceneForm))">
              <img v-if="editDramaSceneForm.image_url || editDramaSceneForm.local_path" :src="assetImageUrl(editDramaSceneForm)" :alt="editDramaSceneForm.location || '制作场景图片'" />
              <span v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></span>
            </button>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editDramaSceneForm.imgUploading" :disabled="editDramaSceneForm.imgGenerating" :title="editDramaSceneForm.imgGenerating ? '正在生成图片，请稍候' : undefined" @click="dramaSceneFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editDramaSceneForm.imgGenerating" :disabled="editDramaSceneForm.imgUploading" :title="editDramaSceneForm.imgUploading ? '正在上传图片，请稍候' : undefined" @click="generateDramaSceneImg">AI 生成</el-button>
            </div>
          </div>
          <input ref="dramaSceneFileRef" type="file" accept="image/*" style="display:none" @change="uploadDramaSceneImg" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="editDramaSceneForm.location" aria-label="制作场景地点" /></el-form-item>
        <el-form-item label="时间"><el-input v-model="editDramaSceneForm.time" placeholder="如：浅色/夜晚" aria-label="制作场景时间" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editDramaSceneForm.description" type="textarea" :rows="3" placeholder="场景描述" aria-label="制作场景描述" /></el-form-item>
        <el-form-item label="图片提示词"><el-input v-model="editDramaSceneForm.prompt" type="textarea" :rows="2" placeholder="图片生成用的详细提示词" aria-label="制作场景图片提示词" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestResourceEditorClose('dramaScene')">取消</el-button>
        <el-button type="primary" :loading="editDramaSceneSaving" :disabled="editDramaSceneSaving" :title="editDramaSceneSaving ? '正在保存，请稍候' : undefined" @click="saveDramaScene">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 制作道具 编辑 -->
    <AccessibleDialog v-model="editDramaPropVisible" title="编辑制作道具" width="500px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('dramaProp', done)" @close="editDramaPropForm = null">
      <el-form v-if="editDramaPropForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button type="button" class="lib-img-thumb" :disabled="!assetImageUrl(editDramaPropForm)" :title="assetImageUrl(editDramaPropForm) ? undefined : '暂无图片'" aria-label="预览制作道具图片" @click="openPreview(assetImageUrl(editDramaPropForm))">
              <img v-if="editDramaPropForm.image_url || editDramaPropForm.local_path" :src="assetImageUrl(editDramaPropForm)" :alt="editDramaPropForm.name || '制作道具图片'" />
              <span v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></span>
            </button>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editDramaPropForm.imgUploading" :disabled="editDramaPropForm.imgGenerating" :title="editDramaPropForm.imgGenerating ? '正在生成图片，请稍候' : undefined" @click="dramaPropFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editDramaPropForm.imgGenerating" :disabled="editDramaPropForm.imgUploading" :title="editDramaPropForm.imgUploading ? '正在上传图片，请稍候' : undefined" @click="generateDramaPropImg">AI 生成</el-button>
            </div>
          </div>
          <input ref="dramaPropFileRef" type="file" accept="image/*" style="display:none" @change="uploadDramaPropImg" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editDramaPropForm.name" aria-label="制作道具名称" /></el-form-item>
        <el-form-item label="类型"><el-input v-model="editDramaPropForm.type" placeholder="如：关键道具、背景物件" aria-label="制作道具类型" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editDramaPropForm.description" type="textarea" :rows="3" placeholder="道具描述" aria-label="制作道具描述" /></el-form-item>
        <el-form-item label="图片提示词"><el-input v-model="editDramaPropForm.prompt" type="textarea" :rows="2" placeholder="图片生成用的详细提示词" aria-label="制作道具图片提示词" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestResourceEditorClose('dramaProp')">取消</el-button>
        <el-button type="primary" :loading="editDramaPropSaving" :disabled="editDramaPropSaving" :title="editDramaPropSaving ? '正在保存，请稍候' : undefined" @click="saveDramaProp">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 编辑角色 -->
    <AccessibleDialog v-model="editCharVisible" title="编辑角色库" width="480px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('char', done)" @close="editCharForm = null">
      <el-form v-if="editCharForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button type="button" class="lib-img-thumb" :disabled="!assetImageUrl(editCharForm)" :title="assetImageUrl(editCharForm) ? undefined : '暂无图片'" aria-label="预览角色库图片" @click="openPreview(assetImageUrl(editCharForm))">
              <img v-if="editCharForm.image_url || editCharForm.local_path" :src="assetImageUrl(editCharForm)" :alt="editCharForm.name || '角色库图片'" />
              <span v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></span>
            </button>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editCharForm.imgUploading" :disabled="editCharForm.imgGenerating" :title="editCharForm.imgGenerating ? '正在生成图片，请稍候' : undefined" @click="charFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editCharForm.imgGenerating" :disabled="editCharForm.imgUploading" :title="editCharForm.imgUploading ? '正在上传图片，请稍候' : undefined" @click="doGenerateLibImg(editCharForm, (editCharForm.name + (editCharForm.description ? ', ' + editCharForm.description : '')), characterLibraryAPI, loadCharList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="charFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editCharForm, characterLibraryAPI, loadCharList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editCharForm.name" aria-label="角色名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editCharForm.category" placeholder="可选" aria-label="角色分类" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editCharForm.description" type="textarea" :rows="3" placeholder="可选" aria-label="角色描述" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editCharForm.tags" placeholder="逗号分隔" aria-label="角色标签" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestResourceEditorClose('char')">取消</el-button>
        <el-button type="primary" :loading="editCharSaving" :disabled="editCharSaving" :title="editCharSaving ? '正在保存，请稍候' : undefined" @click="saveChar">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 编辑场景 -->
    <AccessibleDialog v-model="editSceneVisible" title="编辑场景库" width="480px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('scene', done)" @close="editSceneForm = null">
      <el-form v-if="editSceneForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button type="button" class="lib-img-thumb" :disabled="!assetImageUrl(editSceneForm)" :title="assetImageUrl(editSceneForm) ? undefined : '暂无图片'" aria-label="预览场景库图片" @click="openPreview(assetImageUrl(editSceneForm))">
              <img v-if="editSceneForm.image_url || editSceneForm.local_path" :src="assetImageUrl(editSceneForm)" :alt="editSceneForm.location || '场景库图片'" />
              <span v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></span>
            </button>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editSceneForm.imgUploading" :disabled="editSceneForm.imgGenerating" :title="editSceneForm.imgGenerating ? '正在生成图片，请稍候' : undefined" @click="sceneFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editSceneForm.imgGenerating" :disabled="editSceneForm.imgUploading" :title="editSceneForm.imgUploading ? '正在上传图片，请稍候' : undefined" @click="doGenerateLibImg(editSceneForm, ([editSceneForm.location, editSceneForm.time, editSceneForm.description].filter(Boolean).join(', ')), sceneLibraryAPI, loadSceneList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="sceneFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editSceneForm, sceneLibraryAPI, loadSceneList)" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="editSceneForm.location" aria-label="场景地点" /></el-form-item>
        <el-form-item label="时间"><el-input v-model="editSceneForm.time" placeholder="如：浅色/夜晚" aria-label="场景时间" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editSceneForm.category" placeholder="可选" aria-label="场景分类" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editSceneForm.description" type="textarea" :rows="3" placeholder="可选" aria-label="场景描述" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editSceneForm.tags" placeholder="逗号分隔" aria-label="场景标签" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestResourceEditorClose('scene')">取消</el-button>
        <el-button type="primary" :loading="editSceneSaving" :disabled="editSceneSaving" :title="editSceneSaving ? '正在保存，请稍候' : undefined" @click="saveScene">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 编辑道具 -->
    <AccessibleDialog v-model="editPropVisible" title="编辑道具库" width="480px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('prop', done)" @close="editPropForm = null">
      <el-form v-if="editPropForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <button type="button" class="lib-img-thumb" :disabled="!assetImageUrl(editPropForm)" :title="assetImageUrl(editPropForm) ? undefined : '暂无图片'" aria-label="预览道具库图片" @click="openPreview(assetImageUrl(editPropForm))">
              <img v-if="editPropForm.image_url || editPropForm.local_path" :src="assetImageUrl(editPropForm)" :alt="editPropForm.name || '道具库图片'" />
              <span v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></span>
            </button>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editPropForm.imgUploading" :disabled="editPropForm.imgGenerating" :title="editPropForm.imgGenerating ? '正在生成图片，请稍候' : undefined" @click="propFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editPropForm.imgGenerating" :disabled="editPropForm.imgUploading" :title="editPropForm.imgUploading ? '正在上传图片，请稍候' : undefined" @click="doGenerateLibImg(editPropForm, (editPropForm.name + (editPropForm.description ? ', ' + editPropForm.description : '')), propLibraryAPI, loadPropList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="propFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editPropForm, propLibraryAPI, loadPropList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editPropForm.name" aria-label="道具名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editPropForm.category" placeholder="可选" aria-label="道具分类" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editPropForm.description" type="textarea" :rows="3" placeholder="可选" aria-label="道具描述" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editPropForm.tags" placeholder="逗号分隔" aria-label="道具标签" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestResourceEditorClose('prop')">取消</el-button>
        <el-button type="primary" :loading="editPropSaving" :disabled="editPropSaving" :title="editPropSaving ? '正在保存，请稍候' : undefined" @click="saveProp">保存</el-button>
      </template>
    </AccessibleDialog>

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
          <el-button size="small" type="primary" plain :loading="importLoading" @click="loadImportList">重试</el-button>
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
              <el-button size="small" type="primary" :loading="importingId === item.id" @click="doImport(item)">导入</el-button>
            </div>
          </div>
        </div>
        <div v-if="!importLoading && !importError && importList.length === 0" class="library-empty resource-empty-state" role="status">
          <div class="empty-state-title">{{ importKw.trim() ? '没有匹配的素材' : '素材库暂无内容' }}</div>
          <div class="empty-state-copy">{{ importKw.trim() ? '试试其他关键词，或清除搜索后重新查看。' : (currentEpisodeId ? '可前往制作页新增素材并加入素材库。' : '请先新增一集，再去制作页提取素材。') }}</div>
          <el-button v-if="importKw.trim()" size="small" @click="importKw = ''; loadImportList()">清除搜索</el-button>
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
        <el-button @click="importVisible = false">关闭</el-button>
      </template>
    </AccessibleDialog>

  </div>
</template>

<script setup>
import { ref } from 'vue'
import { PictureFilled } from '@element-plus/icons-vue'

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

const charFileRef = ref(null)
const sceneFileRef = ref(null)
const propFileRef = ref(null)
const dramaCharFileRef = ref(null)
const dramaSceneFileRef = ref(null)
const dramaPropFileRef = ref(null)
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
.lib-img-editor { display: flex; align-items: center; gap: 14px; }
.lib-img-thumb { width: 88px; height: 88px; padding: 0; border-radius: 8px; overflow: hidden; cursor: zoom-in; background: var(--bg-inner, #1c1c1e); color: inherit; font: inherit; border: 1px solid var(--border-color, #27272a); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lib-img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lib-img-empty { color: var(--text-faint, #52525b); font-size: 26px; }
.lib-img-btns { display: flex; flex-direction: column; gap: 8px; }
.library-item-cover:focus-visible,
.lib-img-thumb:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.library-item-cover:disabled,
.library-item-cover--empty,
.lib-img-thumb:disabled { cursor: default; }
</style>

