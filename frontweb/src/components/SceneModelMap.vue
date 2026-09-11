<template>
  <div class="scene-model-map-page">
    <div class="page-header">
      <div class="header-left">
        <p class="page-desc">
          配置不同业务场景使用的 AI 模型路由。当文本生成请求指定业务场景时，系统会优先使用此处配置的模型。
        </p>
      </div>
      <div class="header-right">
        <el-button type="primary" :disabled="writeLocked" :title="writeLocked ? writeLockReason : undefined" aria-label="添加业务场景配置" @click="openAdd">
          <el-icon><Plus /></el-icon>
          添加业务场景配置
        </el-button>
      </div>
    </div>

    <div v-if="loading && !hasSuccessfulLoad" v-loading="true" class="loading-wrap" />

    <template v-else>
      <el-alert
        v-if="loadError"
        class="load-error-alert"
        type="error"
        show-icon
        :closable="false"
        :title="loadError"
      >
        <el-button size="small" type="primary" plain :loading="loading" :disabled="loading" :title="loading ? '正在重新加载场景模型映射，请稍候' : undefined" aria-label="重新加载场景模型映射" @click="load">
          重新加载
        </el-button>
      </el-alert>

      <SceneModelMapTable
        v-if="list.length > 0"
        :list="list"
        :loading="loading"
        :write-locked="writeLocked"
        :write-lock-reason="writeLockReason"
        @edit="openEdit"
        @delete="onDelete"
      />

      <el-empty v-else-if="hasSuccessfulLoad && !loadError" description="暂无场景模型映射配置">
        <el-button type="primary" :disabled="writeLocked" :title="writeLocked ? writeLockReason : undefined" aria-label="添加业务场景配置" @click="openAdd">添加业务场景配置</el-button>
      </el-empty>
    </template>

    <AccessibleDialog
      v-model="dialogVisible"
      :title="editingKey ? '编辑业务场景映射' : '添加业务场景映射'"
      width="560px"
      :close-on-click-modal="false"
      :before-close="confirmDialogClose"
      @closed="resetForm"
    >
      <SceneModelMapForm
        ref="formRef"
        v-model:form="form"
        :editing-key="editingKey"
        :filtered-configs="filteredConfigs"
        :selected-config-models="selectedConfigModels"
        :model-override-disabled-reason="modelOverrideDisabledReason"
        @key-change="onKeyChange"
        @config-change="onConfigChange"
      />

      <template #footer>
        <el-button :disabled="saving" :title="saving ? '正在保存场景模型映射，请稍候' : undefined" @click="requestDialogClose">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" :title="saving ? '正在保存场景模型映射，请稍候' : undefined" @click="save">保存</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { Plus } from '@element-plus/icons-vue'
import { sceneModelMapAPI } from '@/api/sceneModelMap'
import { aiAPI } from '@/api/ai'
import { getSelectableModels } from '@/utils/modelSelection'
import SceneModelMapTable from './sceneModelMap/SceneModelMapTable.vue'
import SceneModelMapForm from './sceneModelMap/SceneModelMapForm.vue'
import {
  SCENE_MODEL_PREDEFINED_KEYS,
  applySceneKeyChange,
  createEmptySceneModelForm,
  decorateMapRow,
  describeModelOverrideDisabledReason,
  describeWriteLockReason,
  filterConfigsForService,
  formFromMapRow,
  getSceneKeyLabel,
  isWriteLocked,
} from './sceneModelMap/sceneModelMapCatalog.js'

const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const hasSuccessfulLoad = ref(false)
const list = ref([])
const configs = ref([])
const dialogVisible = ref(false)
const editingKey = ref(null)
const formRef = ref(null)
const formBaseline = ref('')

const form = ref(createEmptySceneModelForm())

function formFingerprint() {
  return JSON.stringify(form.value)
}

function hasUnsavedChanges() {
  return dialogVisible.value
    && Boolean(formBaseline.value)
    && formFingerprint() !== formBaseline.value
}

async function confirmDiscard() {
  try {
    await ElMessageBox.confirm(
      '当前业务场景映射尚未保存，关闭后本次修改会丢失。',
      '放弃未保存修改？',
      {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        type: 'warning',
        distinguishCancelAndClose: true,
      },
    )
    return true
  } catch (_) {
    return false
  }
}

async function confirmDialogClose(done) {
  if (!hasUnsavedChanges() || await confirmDiscard()) done()
}

async function requestDialogClose() {
  if (!hasUnsavedChanges() || await confirmDiscard()) dialogVisible.value = false
}

defineExpose({
  hasUnsavedChanges,
})

const writeLocked = computed(() => isWriteLocked({
  loading: loading.value,
  loadError: loadError.value,
  hasSuccessfulLoad: hasSuccessfulLoad.value,
}))
const writeLockReason = computed(() => describeWriteLockReason({
  loading: loading.value,
  loadError: loadError.value,
  hasSuccessfulLoad: hasSuccessfulLoad.value,
}))

const filteredConfigs = computed(() => filterConfigsForService(
  configs.value,
  form.value.service_type,
  form.value.config_id,
))

const selectedConfigModels = computed(() => {
  const models = getSelectableModels(configs.value, form.value.service_type, form.value.config_id)
  const current = String(form.value.model_override || '').trim()
  if (current && !models.includes(current)) return [current, ...models]
  return models
})

const modelOverrideDisabledReason = computed(() => (
  describeModelOverrideDisabledReason(selectedConfigModels.value, form.value.model_override)
))

function onKeyChange(key) {
  form.value = applySceneKeyChange(form.value, key, SCENE_MODEL_PREDEFINED_KEYS)
}

function onConfigChange() {
  form.value.model_override = ''
}

async function load() {
  loading.value = true
  try {
    const [mapsData, configsData] = await Promise.all([
      sceneModelMapAPI.list(),
      aiAPI.list(),
    ])
    configs.value = configsData || []
    list.value = (mapsData || []).map((item) => decorateMapRow(item, configs.value))
    loadError.value = ''
    hasSuccessfulLoad.value = true
  } catch (err) {
    if (isUserFacingAbort(err)) return
    loadError.value = toUserFacingError(err, '加载场景模型映射失败')
    ElMessage.error(toUserFacingError(err, '加载场景模型映射失败'))
  } finally {
    loading.value = false
  }
}

function openAdd() {
  if (writeLocked.value) return
  editingKey.value = null
  form.value = createEmptySceneModelForm()
  formBaseline.value = formFingerprint()
  dialogVisible.value = true
}

function openEdit(row) {
  if (writeLocked.value) return
  editingKey.value = row.key
  form.value = formFromMapRow(row)
  formBaseline.value = formFingerprint()
  dialogVisible.value = true
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const body = {
      description: form.value.description,
      service_type: form.value.service_type,
      config_id: form.value.config_id || null,
      model_override: form.value.model_override || null,
    }

    if (editingKey.value) {
      await sceneModelMapAPI.update(editingKey.value, body)
      ElMessage.success('更新成功')
    } else {
      await sceneModelMapAPI.create({ ...body, key: form.value.key })
      ElMessage.success('创建成功')
    }
    formBaseline.value = formFingerprint()
    dialogVisible.value = false
    await load()
  } catch (err) {
    if (isUserFacingAbort(err)) return
    ElMessage.error(toUserFacingError(err, '保存场景模型映射失败'))
  } finally {
    saving.value = false
  }
}

async function onDelete(row) {
  if (writeLocked.value) return
  try {
    await ElMessageBox.confirm(
      `确定要删除场景「${getSceneKeyLabel(row.key) || row.key}」的模型映射配置吗？`,
      '确认删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await sceneModelMapAPI.delete(row.key)
    ElMessage.success('删除成功')
    await load()
  } catch (err) {
    if (isUserFacingAbort(err) || err === 'cancel') return
    ElMessage.error(toUserFacingError(err, '删除场景模型映射失败'))
  }
}

function resetForm() {
  formRef.value?.resetFields()
  formBaseline.value = ''
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.scene-model-map-page {
  padding: 0;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.page-desc {
  margin: 0;
  color: #666;
  font-size: 14px;
  line-height: 1.6;
}
.loading-wrap {
  padding: 40px;
}
.load-error-alert {
  margin-bottom: 16px;
}
</style>
