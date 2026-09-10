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
        <el-button size="small" type="primary" plain :loading="loading" aria-label="重新加载场景模型映射" @click="load">
          重新加载
        </el-button>
      </el-alert>

      <el-table
        v-if="list.length > 0"
        v-loading="loading"
        :data="list"
        stripe
        style="width: 100%"
      >
        <el-table-column prop="key" label="场景键" min-width="220">
          <template #default="{ row }">
            <div class="scene-key-cell">
              <span class="scene-key-label">{{ getSceneKeyLabel(row.key) || row.key }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="service_type" label="服务类型" width="120">
          <template #default="{ row }">
            <el-tag :type="serviceTypeTagType(row.service_type)" size="small">
              {{ serviceTypeLabel(row.service_type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="config_name" label="AI 配置" min-width="220">
          <template #default="{ row }">
            <div class="config-availability">
              <el-tag v-if="!row.config_id" type="info" size="small">使用默认配置</el-tag>
              <template v-else>
                <span>{{ row.config_name || ('配置 #' + row.config_id) }}</span>
                <el-tag v-if="row.config_missing" type="danger" size="small">绑定配置不可用</el-tag>
                <el-tag v-else-if="row.config_inactive" type="warning" size="small">绑定配置已停用</el-tag>
                <el-tag v-else-if="row.config_type_mismatch" type="warning" size="small">服务类型不匹配</el-tag>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="model_override" label="模型覆盖" min-width="180">
          <template #default="{ row }">
            <span v-if="row.model_override" class="model-override">{{ row.model_override }}</span>
            <span v-else class="text-muted">使用配置默认模型</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="writeLocked" :title="writeLocked ? writeLockReason : undefined" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" :disabled="writeLocked" :title="writeLocked ? writeLockReason : undefined" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-else-if="hasSuccessfulLoad && !loadError" description="暂无场景模型映射配置">
        <el-button type="primary" :disabled="writeLocked" :title="writeLocked ? writeLockReason : undefined" aria-label="添加业务场景配置" @click="openAdd">添加业务场景配置</el-button>
      </el-empty>
    </template>

    <!-- 添加/编辑对话框 -->
    <AccessibleDialog
      v-model="dialogVisible"
      :title="editingKey ? '编辑业务场景映射' : '添加业务场景映射'"
      width="560px"
      :close-on-click-modal="false"
      :before-close="confirmDialogClose"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item prop="key" label="场景键">
          <el-select
            v-model="form.key"
            aria-label="场景键"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入场景键"
            style="width: 100%"
            :disabled="!!editingKey"
            :title="editingKey ? '已保存的业务场景不能修改标识' : undefined"
            @change="onKeyChange"
          >
            <el-option
              v-for="k in predefinedKeys"
              :key="k.value"
              :label="k.label"
              :value="k.value"
            />
          </el-select>
          <p class="field-tip">{{ editingKey ? '已保存的业务场景不能修改标识' : '选择后会自动设置对应的服务类型' }}</p>
        </el-form-item>

        <el-form-item prop="service_type" label="服务类型">
          <el-select v-model="form.service_type" aria-label="服务类型" placeholder="选择服务类型" style="width: 100%" disabled title="由场景键自动决定，不可更改">
            <el-option label="文本/对话" value="text" />
            <el-option label="文本生成图片" value="image" />
            <el-option label="分镜图片生成" value="storyboard_image" />
            <el-option label="视频生成" value="video" />
            <el-option label="语音合成 TTS" value="tts" />
          </el-select>
          <p class="field-tip">由场景键自动决定，不可更改</p>
        </el-form-item>

        <el-form-item label="AI 配置">
          <el-select
            v-model="form.config_id"
            aria-label="AI 配置"
            clearable
            placeholder="选择 AI 配置（留空使用默认）"
            style="width: 100%"
            @change="onConfigChange"
          >
            <el-option
              v-for="c in filteredConfigs"
              :key="c.id"
              :label="configOptionLabel(c)"
              :value="c.id"
            />
          </el-select>
          <p class="field-tip">指定具体的 AI 服务配置，不选则使用该类服务的默认配置</p>
          <p v-if="!filteredConfigs.length" class="field-warning">当前服务类型没有可用的启用中 AI 配置，保存后将使用系统默认；请先在 AI 配置中添加并启用对应服务。</p>
        </el-form-item>

        <el-form-item label="模型覆盖">
          <el-select
            v-model="form.model_override"
            aria-label="模型覆盖"
            clearable
            placeholder="选择模型（留空使用配置默认）"
            style="width: 100%"
            :disabled="Boolean(modelOverrideDisabledReason)"
            :title="modelOverrideDisabledReason || undefined"
          >
            <el-option
              v-for="m in selectedConfigModels"
              :key="m"
              :label="m"
              :value="m"
            />
          </el-select>
          <p class="field-tip">
            {{ selectedConfigModels.length ? '从该配置的可用模型中选择' : '请先选择 AI 配置' }}
          </p>
        </el-form-item>
        <el-form-item prop="description" label="描述">
          <el-input
            v-model="form.description"
            aria-label="场景描述"
            placeholder="输入场景描述，便于理解用途"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="requestDialogClose">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" :title="saving ? '正在保存场景模型映射，请稍候' : undefined" @click="save">保存</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { sceneModelMapAPI } from '@/api/sceneModelMap'
import { aiAPI } from '@/api/ai'
import { getSelectableModels } from '@/utils/modelSelection'

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

const form = ref({
  key: '',
  description: '',
  service_type: 'text',
  config_id: null,
  model_override: ''
})

const rules = {
  key: [{ required: true, message: '请输入场景键', trigger: 'blur' }],
  service_type: [{ required: true, message: '请选择服务类型', trigger: 'change' }]
}

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

// 预定义场景键及其对应的服务类型
const predefinedKeys = [
  { value: 'image_polish', label: '分镜图提示词润色', service_type: 'text' },
  // 目前程序里只内置了一个场景键：image_polish
  // 以下为新增的场景键，已添加到对应的接口里
  { value: 'role_image_polish', label: '角色图提示词润色', service_type: 'text' },
  { value: 'prop_image_polish', label: '道具图提示词润色', service_type: 'text' },
  { value: 'scene_image_polish', label: '场景图提示词润色', service_type: 'text' },
  { value: 'role_extraction', label: '角色提取', service_type: 'text' },
  { value: 'prop_extraction', label: '道具提取', service_type: 'text' },
  { value: 'scene_extraction', label: '场景提取', service_type: 'text' },
  { value: 'storyboard_extraction', label: '分镜生成', service_type: 'text' },
  { value: 'identity_anchors', label: '角色视觉锚点提炼', service_type: 'text' },
  { value: 'frame_prompt', label: '帧提示词生成', service_type: 'text' },
  { value: 'novel_import', label: '小说导入改写', service_type: 'text' },
  { value: 'story_generation', label: '故事生成', service_type: 'text' },
  //  以下是其他服务类型...未实现
  // 图片生成
  // { value: 'role_image_gen', label: '角色图片生成', service_type: 'image' },
  // { value: 'prop_image_gen', label: '道具图片生成', service_type: 'image' },
  // { value: 'scene_image_gen', label: '场景图片生成', service_type: 'image' },
  // { value: 'storyboard_image_gen', label: '分镜图片生成', service_type: 'image' },
  // { value: 'video_frame_gen', label: '视频帧生成', service_type: 'video' },// 首尾帧视频生成
  // { value: 'video_full_gen', label: '全能视频生成', service_type: 'video' },// 全能模式视频生成
]

// 根据服务类型筛选配置
const writeLocked = computed(() => loading.value || !hasSuccessfulLoad.value || Boolean(loadError.value))
const writeLockReason = computed(() => {
  if (loading.value) return '场景模型映射正在加载，请稍候'
  if (loadError.value) {
    return hasSuccessfulLoad.value
      ? '场景模型映射刷新失败，成功重试前不能修改'
      : '场景模型映射加载失败，成功重试前不能添加'
  }
  if (!hasSuccessfulLoad.value) return '场景模型映射尚未就绪'
  return ''
})

const filteredConfigs = computed(() => {
  const currentServiceType = form.value.service_type
  const selectedId = form.value.config_id
  return configs.value.filter((item) => {
    if (item.service_type !== currentServiceType) return false
    if (item.is_active) return true
    return selectedId != null && String(item.id) === String(selectedId)
  })
})

// 获取选中配置的可用模型列表
const selectedConfigModels = computed(() => {
  const models = getSelectableModels(configs.value, form.value.service_type, form.value.config_id)
  const current = String(form.value.model_override || '').trim()
  if (current && !models.includes(current)) return [current, ...models]
  return models
})

const modelOverrideDisabledReason = computed(() => {
  if (selectedConfigModels.value.length || form.value.model_override) return ''
  return '请先选择 AI 配置'
})

function serviceTypeLabel(type) {
  const map = {
    text: '文本/对话',
    image: '文本生成图片',
    storyboard_image: '分镜图片生成',
    video: '视频生成',
    tts: '语音合成 TTS'
  }
  return map[type] || type
}

function serviceTypeTagType(type) {
  const map = {
    text: 'primary',
    image: 'success',
    storyboard_image: 'warning',
    video: 'danger',
    tts: 'info'
  }
  return map[type] || ''
}

// 获取场景键的 label
function getSceneKeyLabel(key) {
  return predefinedKeys.find(k => k.value === key)?.label || ''
}

function configOptionLabel(item) {
  const base = `${item.name} (${item.provider})`
  return item.is_active ? base : `${base}（已停用）`
}

function decorateMapRow(item) {
  const config = configs.value.find((entry) => String(entry.id) === String(item.config_id))
  return {
    ...item,
    config_name: config?.name || null,
    config_missing: Boolean(item.config_id) && !config,
    config_inactive: Boolean(config) && !config.is_active,
    config_type_mismatch: Boolean(config && item.service_type && config.service_type !== item.service_type),
  }
}

// 场景键改变时自动设置服务类型
function onKeyChange(key) {
  const matched = predefinedKeys.find(k => k.value === key)
  if (matched) {
    form.value.service_type = matched.service_type
  }
  // 重置配置和模型选择
  form.value.config_id = null
  form.value.model_override = ''
}

// 配置改变时重置模型选择
function onConfigChange(configId) {
  form.value.model_override = ''
}

async function load() {
  loading.value = true
  try {
    const [mapsData, configsData] = await Promise.all([
      sceneModelMapAPI.list(),
      aiAPI.list()
    ])
    configs.value = configsData || []
    list.value = (mapsData || []).map((item) => decorateMapRow(item))
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
  form.value = {
    key: '',
    description: '',
    service_type: 'text',
    config_id: null,
    model_override: ''
  }
  formBaseline.value = formFingerprint()
  dialogVisible.value = true
}

function openEdit(row) {
  if (writeLocked.value) return
  editingKey.value = row.key
  form.value = {
    key: row.key,
    description: row.description || '',
    service_type: row.service_type || 'text',
    config_id: row.config_id || null,
    model_override: row.model_override || ''
  }
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
      model_override: form.value.model_override || null
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
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
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

.scene-key-label {
  font-size: 14px;
  color: #303133;
}

.model-override {
  background: #e6f7ff;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #096dd9;
}

.text-muted {
  color: #999;
  font-size: 13px;
}

.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: #999;
  line-height: 1.4;
}

.field-warning {
  margin: 6px 0 0;
  font-size: 12px;
  color: #b45309;
  line-height: 1.4;
}

.load-error-alert {
  margin-bottom: 16px;
}

.scene-key-cell,
.config-availability {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
