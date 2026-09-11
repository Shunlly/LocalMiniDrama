<template>
  <div class="sd2-asset-mgmt tab-content">
    <Sd2AssetIntro />

    <Sd2AssetConnectionForm
      v-model:base-url="baseUrl"
      v-model:api-key="apiKey"
      v-model:path-mode="pathMode"
      v-model:api-version="apiVersion"
      v-model:project-name="projectName"
      v-model:auth-mode="authMode"
      v-model:access-key-id="accessKeyId"
      v-model:secret-access-key="secretAccessKey"
      v-model:sign-region="signRegion"
      v-model:billing-model="billingModel"
      v-model:fill-config-id="fillConfigId"
      v-model:asset-group-id-for-cert="assetGroupIdForCert"
      :video-like-configs="videoLikeConfigs"
      :saved-config-id="savedConfigId"
      :saving-config="savingConfig"
      :save-lock-reason="saveLockReason"
      :save-to-ai-config="saveToAiConfig"
      :on-fill-from-saved="onFillFromSaved"
    />

    <el-row :gutter="16">
      <el-col :span="11">
        <Sd2AssetGroupList
          :group-rows="groupRows"
          :loading-groups="loadingGroups"
          :mutation-locked="mutationLocked"
          :mutation-lock-reason="mutationLockReason"
          :refresh-groups-lock-reason="refreshGroupsLockReason"
          :refresh-groups="refreshGroups"
          :open-create-group="openCreateGroup"
          :get-group-detail="getGroupDetail"
          :open-edit-group="openEditGroup"
          :delete-group="deleteGroup"
          :on-group-row-change="onGroupRowChange"
        />
      </el-col>
      <el-col :span="13">
        <Sd2AssetList
          v-model:asset-group-id-input="assetGroupIdInput"
          :asset-rows="assetRows"
          :loading-assets="loadingAssets"
          :mutation-locked="mutationLocked"
          :mutation-lock-reason="mutationLockReason"
          :refresh-assets-lock-reason="refreshAssetsLockReason"
          :refresh-assets="refreshAssets"
          :open-create-asset="openCreateAsset"
          :get-asset-detail="getAssetDetail"
          :open-edit-asset="openEditAsset"
          :delete-asset="deleteAsset"
        />
      </el-col>
    </el-row>

    <Sd2AssetLastResponse v-model="lastRawJson" />

    <Sd2AssetDialogs
      v-model:dlg-group-create="dlgGroupCreate"
      v-model:form-group-name="formGroupName"
      v-model:form-group-extra-json="formGroupExtraJson"
      v-model:dlg-group-edit="dlgGroupEdit"
      v-model:edit-group-id="editGroupId"
      v-model:edit-group-name="editGroupName"
      v-model:edit-group-full-json="editGroupFullJson"
      v-model:dlg-asset-create="dlgAssetCreate"
      v-model:form-asset-group-id="formAssetGroupId"
      v-model:form-asset-name="formAssetName"
      v-model:form-asset-type="formAssetType"
      v-model:form-asset-model="formAssetModel"
      v-model:form-asset-url="formAssetUrl"
      v-model:dlg-asset-edit="dlgAssetEdit"
      v-model:edit-asset-id="editAssetId"
      v-model:edit-asset-name="editAssetName"
      v-model:edit-asset-full-json="editAssetFullJson"
      v-model:dlg-detail="dlgDetail"
      v-model:detail-json="detailJson"
      :dlg-loading="dlgLoading"
      :submit-lock-reason="submitLockReason"
      :submit-create-group="submitCreateGroup"
      :submit-update-group="submitUpdateGroup"
      :submit-create-asset="submitCreateAsset"
      :submit-update-asset="submitUpdateAsset"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusFeedback.js'
import { aiAPI } from '@/api/ai'
import Sd2AssetIntro from '@/components/sd2/Sd2AssetIntro.vue'
import Sd2AssetConnectionForm from '@/components/sd2/Sd2AssetConnectionForm.vue'
import Sd2AssetGroupList from '@/components/sd2/Sd2AssetGroupList.vue'
import Sd2AssetList from '@/components/sd2/Sd2AssetList.vue'
import Sd2AssetLastResponse from '@/components/sd2/Sd2AssetLastResponse.vue'
import Sd2AssetDialogs from '@/components/sd2/Sd2AssetDialogs.vue'

const props = defineProps({
  /** AI 配置列表（与 AI 配置页同源），用于一键填入接口地址与密钥 */
  configs: { type: Array, default: () => [] },
  writeLocked: { type: Boolean, default: true },
})

const emit = defineEmits(['saved'])

const MASKED_SECRET = '********'
function isMaskedSecret(value) {
  return String(value || '').trim() === MASKED_SECRET
}

const baseUrl = ref('')
const apiKey = ref('')
const pathMode = ref('open_api_query')
const apiVersion = ref('2024-01-01')
/** OpenAPI 可选查询参数 ProjectName（与控制台项目对应，便于 IAM 精确到 project/某工程 而非 project/*） */
const projectName = ref('')
const authMode = ref('volc_sign')
const accessKeyId = ref('')
const secretAccessKey = ref('')
const signRegion = ref('')
/** 仅合并到 List / Create 类请求，避免影响 Get/Update/Delete */
const billingModel = ref('')
const fillConfigId = ref(null)
const savedConfigId = ref(null)
const sourceConfigId = ref(null)
const savingConfig = ref(false)
/** 创作页 SD2 认证默认写入的资产组 */
const assetGroupIdForCert = ref('')
const loadingGroups = ref(false)
const loadingAssets = ref(false)
const dlgLoading = ref(false)
const lastRawJson = ref('')
const assetGroupIdInput = ref('')
const lastListGroupsPayload = ref(null)
const lastListAssetsPayload = ref(null)

const dlgGroupCreate = ref(false)
const formGroupName = ref('')
const formGroupExtraJson = ref('')

const dlgGroupEdit = ref(false)
const editGroupId = ref('')
const editGroupName = ref('')
const editGroupFullJson = ref('')

const dlgAssetCreate = ref(false)
const formAssetGroupId = ref('')
const formAssetName = ref('')
const formAssetType = ref('Image')
const formAssetModel = ref('')
const formAssetUrl = ref('')

const dlgAssetEdit = ref(false)
const editAssetId = ref('')
const editAssetName = ref('')
const editAssetFullJson = ref('')

const dlgDetail = ref(false)
const detailJson = ref('')

const videoLikeConfigs = computed(() => {
  const rows = props.configs || []
  return rows.filter((c) => {
    if (c.service_type !== 'video') return false
    const u = (c.base_url || '').toLowerCase()
    const p = (c.api_protocol || '').toLowerCase()
    return (
      p.includes('volc') ||
      u.includes('volces.com') ||
      u.includes('byteplus') ||
      u.includes('byteplustech') ||
      u.includes('/ark')
    )
  })
})

const savedModelArkConfigs = computed(() => {
  return (props.configs || []).filter((c) => c.service_type === 'model_ark_asset')
})
const mutationLocked = computed(() => props.writeLocked)
const mutationLockReason = computed(() => (
  mutationLocked.value ? '配置尚未就绪，暂时不能修改资产' : undefined
))
const saveLockReason = computed(() => {
  if (mutationLocked.value) return mutationLockReason.value
  if (savingConfig.value) return '正在保存到 AI 配置，请稍候'
  return undefined
})
const submitLockReason = computed(() => {
  if (mutationLocked.value) return mutationLockReason.value
  if (dlgLoading.value) return '正在提交资产请求，请稍候'
  return undefined
})
const refreshGroupsLockReason = computed(() => (
  loadingGroups.value ? '正在刷新资产组，请稍候' : undefined
))
const refreshAssetsLockReason = computed(() => (
  loadingAssets.value ? '正在刷新资产列表，请稍候' : undefined
))

const MUTATING_ACTIONS = new Set([
  'CreateAssetGroup',
  'UpdateAssetGroup',
  'DeleteAssetGroup',
  'CreateAsset',
  'UpdateAsset',
  'DeleteAsset',
])

function parseSettingsJson(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function loadFromSavedRow(row) {
  if (!row) return
  savedConfigId.value = row.id
  sourceConfigId.value = row.id
  baseUrl.value = (row.base_url || '').replace(/\/$/, '')
  apiKey.value = row.api_key || ''
  const s = parseSettingsJson(row.settings)
  authMode.value = s.auth_mode || 'volc_sign'
  pathMode.value = s.path_mode || 'open_api_query'
  apiVersion.value = s.api_version || '2024-01-01'
  projectName.value = s.project_name || ''
  billingModel.value = s.billing_model || ''
  assetGroupIdForCert.value = s.asset_group_id || ''
  accessKeyId.value = s.access_key_id || ''
  secretAccessKey.value = s.secret_access_key || ''
  signRegion.value = s.sign_region || ''
  if (assetGroupIdForCert.value) assetGroupIdInput.value = assetGroupIdForCert.value
}

function applyDefaultSavedConfig() {
  const rows = savedModelArkConfigs.value
  if (!rows.length) return
  const pick = rows.find((c) => c.is_default) || rows[0]
  loadFromSavedRow(pick)
}

watch(
  () => props.configs,
  () => {
    if (!savedConfigId.value) applyDefaultSavedConfig()
    else {
      const row = (props.configs || []).find((c) => c.id === savedConfigId.value)
      if (row) loadFromSavedRow(row)
    }
  },
  { immediate: true }
)

onMounted(() => {
  applyDefaultSavedConfig()
})

async function saveToAiConfig() {
  if (mutationLocked.value) return
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || '请先完成连接信息')
    return
  }
  if (!assetGroupIdForCert.value.trim()) {
    ElMessage.warning('请填写默认资产组编号（创作页「认证资产」需要）')
    return
  }
  if (authMode.value === 'bearer' && isMaskedSecret(apiKey.value) && !savedConfigId.value) {
    ElMessage.warning('当前 API 密钥是掩码，请先更新已关联配置，或重新输入真实密钥后再保存')
    return
  }
  const settings = {
    auth_mode: authMode.value,
    path_mode: pathMode.value,
    api_version: apiVersion.value.trim() || '2024-01-01',
    project_name: projectName.value.trim(),
    billing_model: billingModel.value.trim(),
    asset_group_id: assetGroupIdForCert.value.trim(),
  }
  if (authMode.value === 'volc_sign') {
    settings.access_key_id = accessKeyId.value.trim()
    settings.secret_access_key = secretAccessKey.value.trim()
    if (signRegion.value.trim()) settings.sign_region = signRegion.value.trim()
  }
  const payload = {
    service_type: 'model_ark_asset',
    name: '认证资产库',
    provider: 'model_ark',
    base_url: baseUrl.value.trim(),
    api_key: authMode.value === 'bearer'
      ? (isMaskedSecret(apiKey.value) ? undefined : apiKey.value)
      : '',
    model: ['-'],
    default_model: '-',
    priority: 10,
    is_default: true,
    settings: JSON.stringify(settings),
  }
  savingConfig.value = true
  try {
    if (savedConfigId.value) {
      await aiAPI.update(savedConfigId.value, payload)
      ElMessage.success('已更新 AI 配置')
    } else {
      const created = await aiAPI.create(payload)
      savedConfigId.value = created?.id ?? null
      ElMessage.success('已保存到 AI 配置')
    }
    emit('saved')
  } catch (_) {
    /* request 已统一报错 */
  } finally {
    savingConfig.value = false
  }
}

function setLastJson(obj) {
  try {
    lastRawJson.value = JSON.stringify(obj, null, 2)
  } catch (_) {
    lastRawJson.value = String(obj)
  }
}

function extractRows(resp) {
  if (!resp) return []
  if (Array.isArray(resp)) return resp
  const keys = [
    'Items',
    'List',
    'AssetGroups',
    'Assets',
    'Groups',
    'Data',
  ]
  for (const k of keys) {
    if (Array.isArray(resp[k])) return resp[k]
  }
  const r = resp.Result || resp.result
  if (r && typeof r === 'object') {
    for (const k of keys) {
      if (Array.isArray(r[k])) return r[k]
    }
  }
  return []
}

const groupRows = computed(() => extractRows(lastListGroupsPayload.value))
const assetRows = computed(() => extractRows(lastListAssetsPayload.value))

function onFillFromSaved(id) {
  if (id == null || id === '') return
  const c = (props.configs || []).find((x) => x.id === id)
  if (!c) return
  sourceConfigId.value = c.id
  baseUrl.value = (c.base_url || '').replace(/\/$/, '')
  apiKey.value = c.api_key || ''
  ElMessage.success('已填入所选配置的接口地址；密钥将复用该配置')
}

function onGroupRowChange(row) {
  if (row && row.Id) {
    assetGroupIdInput.value = row.Id
    if (!assetGroupIdForCert.value.trim()) assetGroupIdForCert.value = row.Id
  }
}

function mergeBillingModel(payload, withModel) {
  const p = { ...(payload || {}) }
  if (withModel && billingModel.value.trim() && !String(p.model || '').trim()) {
    p.model = billingModel.value.trim()
  }
  return p
}

function connReady() {
  if (!baseUrl.value.trim()) return false
  if (savedConfigId.value) return true
  if (authMode.value === 'volc_sign') {
    return !!(accessKeyId.value.trim() && secretAccessKey.value.trim())
  }
  return !!apiKey.value.trim()
}

function connWarn() {
  if (!baseUrl.value.trim()) return '请先填写接口地址（Base URL）'
  if (savedConfigId.value) return ''
  if (authMode.value === 'volc_sign') {
    if (!accessKeyId.value.trim() || !secretAccessKey.value.trim()) {
      return '官方 OpenAPI 请填写访问密钥 ID 与私有密钥（控制台 IAM，非推理 API 密钥）'
    }
  } else if (!apiKey.value.trim()) {
    return '请先填写 API 密钥'
  }
  if (authMode.value === 'volc_sign' && pathMode.value !== 'open_api_query') {
    return 'AK/SK 签名请配合「官方 OpenAPI」路径模式'
  }
  return ''
}

async function call(action, payload, opts = {}) {
  if (mutationLocked.value && MUTATING_ACTIONS.has(action)) {
    throw new Error('当前 AI 配置依赖未就绪或处于厂商锁定模式，资产写操作已暂停。')
  }
  const { withBillingModel = false } = opts
  const body = {
    config_id: savedConfigId.value || sourceConfigId.value || undefined,
    base_url: baseUrl.value.trim(),
    action,
    path_mode: pathMode.value,
    api_version: apiVersion.value.trim() || undefined,
    auth_mode: authMode.value,
    payload: mergeBillingModel(payload, withBillingModel),
  }
  if (pathMode.value === 'open_api_query' && projectName.value.trim()) {
    body.project_name = projectName.value.trim()
  }
  if (authMode.value === 'bearer') {
    body.api_key = isMaskedSecret(apiKey.value) ? undefined : apiKey.value
  } else {
    body.access_key_id = isMaskedSecret(accessKeyId.value) ? undefined : accessKeyId.value.trim()
    body.secret_access_key = isMaskedSecret(secretAccessKey.value) ? undefined : secretAccessKey.value.trim()
    if (signRegion.value.trim()) body.sign_region = signRegion.value.trim()
  }
  return aiAPI.modelArkAsset(body)
}

async function refreshGroups() {
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || '请先完成连接信息')
    return
  }
  loadingGroups.value = true
  try {
    const body = {
      PageNumber: 1,
      PageSize: 50,
      /** Filter、Filter.GroupType 均为官方 ListAssetGroups 必填；AIGC 为私有资产库常用类型 */
      Filter: {
        GroupType: 'AIGC',
      },
    }
    const data = await call('ListAssetGroups', body, { withBillingModel: true })
    lastListGroupsPayload.value = data
    setLastJson(data)
  } catch (e) {
    lastListGroupsPayload.value = null
  } finally {
    loadingGroups.value = false
  }
}

async function refreshAssets() {
  const gid = assetGroupIdInput.value.trim()
  const w = connWarn()
  if (!connReady() || w) {
    ElMessage.warning(w || '请先完成连接信息')
    return
  }
  if (!gid) {
    ElMessage.warning('请填写或选择资产组编号')
    return
  }
  loadingAssets.value = true
  try {
    const body = {
      PageNumber: 1,
      PageSize: 50,
      Filter: {
        GroupType: 'AIGC',
        GroupIds: [gid],
      },
    }
    const data = await call('ListAssets', body, { withBillingModel: true })
    lastListAssetsPayload.value = data
    setLastJson(data)
  } catch (e) {
    lastListAssetsPayload.value = null
  } finally {
    loadingAssets.value = false
  }
}

function openCreateGroup() {
  if (mutationLocked.value) return
  formGroupName.value = ''
  formGroupExtraJson.value = ''
  dlgGroupCreate.value = true
}

async function submitCreateGroup() {
  if (mutationLocked.value) return
  if (!formGroupName.value.trim()) {
    ElMessage.warning('请填写名称')
    return
  }
  dlgLoading.value = true
  try {
    let extra = {}
    if (formGroupExtraJson.value.trim()) {
      try {
        extra = JSON.parse(formGroupExtraJson.value)
      } catch (_) {
        ElMessage.error('扩展 JSON 格式无效')
        return
      }
    }
    const payload = { Name: formGroupName.value.trim(), ...extra }
    const data = await call('CreateAssetGroup', payload, { withBillingModel: true })
    setLastJson(data)
    ElMessage.success('已创建')
    dlgGroupCreate.value = false
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

async function getGroupDetail(row) {
  dlgLoading.value = true
  try {
    const data = await call('GetAssetGroup', { Id: row.Id })
    detailJson.value = JSON.stringify(data, null, 2)
    dlgDetail.value = true
    setLastJson(data)
  } finally {
    dlgLoading.value = false
  }
}

function openEditGroup(row) {
  if (mutationLocked.value) return
  editGroupId.value = row.Id
  editGroupName.value = row.Name || ''
  editGroupFullJson.value = ''
  dlgGroupEdit.value = true
}

async function submitUpdateGroup() {
  if (mutationLocked.value) return
  dlgLoading.value = true
  try {
    let payload
    if (editGroupFullJson.value.trim()) {
      try {
        payload = JSON.parse(editGroupFullJson.value)
      } catch (_) {
        ElMessage.error('完整 JSON 无效')
        return
      }
    } else {
      payload = { Id: editGroupId.value, Name: editGroupName.value }
    }
    const data = await call('UpdateAssetGroup', payload)
    setLastJson(data)
    ElMessage.success('已更新')
    dlgGroupEdit.value = false
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

async function deleteGroup(row) {
  if (mutationLocked.value) return
  try {
    await ElMessageBox.confirm(`确定删除资产组「${row.Name || row.Id}」？`, '删除资产组', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch (_) {
    return
  }
  dlgLoading.value = true
  try {
    const data = await call('DeleteAssetGroup', { Id: row.Id })
    setLastJson(data)
    ElMessage.success('已删除')
    if (assetGroupIdInput.value === row.Id) assetGroupIdInput.value = ''
    await refreshGroups()
  } finally {
    dlgLoading.value = false
  }
}

function openCreateAsset() {
  if (mutationLocked.value) return
  formAssetGroupId.value = assetGroupIdInput.value.trim()
  formAssetName.value = ''
  formAssetType.value = 'Image'
  formAssetModel.value = ''
  formAssetUrl.value = ''
  dlgAssetCreate.value = true
}

async function submitCreateAsset() {
  if (mutationLocked.value) return
  if (!formAssetGroupId.value.trim() || !formAssetName.value.trim()) {
    ElMessage.warning('请填写资产组编号与名称')
    return
  }
  dlgLoading.value = true
  try {
    const payload = {
      GroupId: formAssetGroupId.value.trim(),
      Name: formAssetName.value.trim(),
      AssetType: formAssetType.value,
    }
    if (formAssetUrl.value.trim()) payload.URL = formAssetUrl.value.trim()
    if (formAssetModel.value.trim()) payload.model = formAssetModel.value.trim()
    const data = await call('CreateAsset', payload, { withBillingModel: true })
    setLastJson(data)
    ElMessage.success('已创建')
    dlgAssetCreate.value = false
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}

async function getAssetDetail(row) {
  dlgLoading.value = true
  try {
    const data = await call('GetAsset', { Id: row.Id })
    detailJson.value = JSON.stringify(data, null, 2)
    dlgDetail.value = true
    setLastJson(data)
  } finally {
    dlgLoading.value = false
  }
}

function openEditAsset(row) {
  if (mutationLocked.value) return
  editAssetId.value = row.Id
  editAssetName.value = row.Name || ''
  editAssetFullJson.value = ''
  dlgAssetEdit.value = true
}

async function submitUpdateAsset() {
  if (mutationLocked.value) return
  dlgLoading.value = true
  try {
    let payload
    if (editAssetFullJson.value.trim()) {
      try {
        payload = JSON.parse(editAssetFullJson.value)
      } catch (_) {
        ElMessage.error('完整 JSON 无效')
        return
      }
    } else {
      payload = { Id: editAssetId.value, Name: editAssetName.value }
    }
    const data = await call('UpdateAsset', payload)
    setLastJson(data)
    ElMessage.success('已更新')
    dlgAssetEdit.value = false
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}

async function deleteAsset(row) {
  if (mutationLocked.value) return
  try {
    await ElMessageBox.confirm(`确定删除资产「${row.Name || row.Id}」？`, '删除资产', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch (_) {
    return
  }
  dlgLoading.value = true
  try {
    const data = await call('DeleteAsset', { Id: row.Id })
    setLastJson(data)
    ElMessage.success('已删除')
    await refreshAssets()
  } finally {
    dlgLoading.value = false
  }
}
</script>

<style scoped>
.sd2-asset-mgmt {
  max-width: 1100px;
}
</style>
