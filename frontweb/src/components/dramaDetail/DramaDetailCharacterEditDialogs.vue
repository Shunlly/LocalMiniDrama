<template>
  <AccessibleDialog v-model="editDramaCharVisible" title="编辑制作角色" width="500px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('dramaChar', done)" @close="editDramaCharForm = null">
    <el-form v-if="editDramaCharForm" label-width="80px">
      <DramaDetailResourceImageEditor
        :form="editDramaCharForm"
        preview-label="预览制作角色图片"
        fallback-alt="制作角色图片"
        alt-key="name"
        :asset-image-url="assetImageUrl"
        @preview="openPreview"
        @upload="uploadDramaCharImg"
        @generate="generateDramaCharImg"
      />
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
      <el-button aria-label="取消编辑制作角色" @click="requestResourceEditorClose('dramaChar')">取消</el-button>
      <el-button type="primary" :loading="editDramaCharSaving" :disabled="editDramaCharSaving" :title="editDramaCharSaving ? '正在保存，请稍候' : undefined" :aria-label="editDramaCharSaving ? '正在保存，请稍候' : '保存制作角色'" @click="saveDramaChar">保存</el-button>
    </template>
  </AccessibleDialog>

  <AccessibleDialog v-model="editCharVisible" title="编辑角色库" width="480px" :close-on-press-escape="true" :before-close="(done) => requestResourceEditorClose('char', done)" @close="editCharForm = null">
    <el-form v-if="editCharForm" label-width="80px">
      <DramaDetailResourceImageEditor
        :form="editCharForm"
        preview-label="预览角色库图片"
        fallback-alt="角色库图片"
        alt-key="name"
        :asset-image-url="assetImageUrl"
        @preview="openPreview"
        @upload="(event) => doUploadLibImg(event, editCharForm, characterLibraryAPI, loadCharList)"
        @generate="doGenerateLibImg(editCharForm, (editCharForm.name + (editCharForm.description ? ', ' + editCharForm.description : '')), characterLibraryAPI, loadCharList)"
      />
      <el-form-item label="名称"><el-input v-model="editCharForm.name" aria-label="角色名称" /></el-form-item>
      <el-form-item label="分类"><el-input v-model="editCharForm.category" placeholder="可选" aria-label="角色分类" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="editCharForm.description" type="textarea" :rows="3" placeholder="可选" aria-label="角色描述" /></el-form-item>
      <el-form-item label="标签"><el-input v-model="editCharForm.tags" placeholder="逗号分隔" aria-label="角色标签" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button aria-label="取消编辑角色" @click="requestResourceEditorClose('char')">取消</el-button>
      <el-button type="primary" :loading="editCharSaving" :disabled="editCharSaving" :title="editCharSaving ? '正在保存，请稍候' : undefined" :aria-label="editCharSaving ? '正在保存，请稍候' : '保存角色'" @click="saveChar">保存</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
import DramaDetailResourceImageEditor from './DramaDetailResourceImageEditor.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  editDramaCharSaving: { type: Boolean, default: false },
  editCharSaving: { type: Boolean, default: false },
  assetImageUrl: { type: Function, required: true },
  characterLibraryAPI: { type: Object, required: true },
  doGenerateLibImg: { type: Function, required: true },
  doUploadLibImg: { type: Function, required: true },
  generateDramaCharImg: { type: Function, required: true },
  loadCharList: { type: Function, required: true },
  openPreview: { type: Function, required: true },
  requestResourceEditorClose: { type: Function, required: true },
  saveChar: { type: Function, required: true },
  saveDramaChar: { type: Function, required: true },
  uploadDramaCharImg: { type: Function, required: true },
})

const editDramaCharVisible = defineModel('editDramaCharVisible', { type: Boolean, default: false })
const editDramaCharForm = defineModel('editDramaCharForm', { type: Object, default: null })
const editCharVisible = defineModel('editCharVisible', { type: Boolean, default: false })
const editCharForm = defineModel('editCharForm', { type: Object, default: null })
</script>
