<template>
  <el-form label-width="120px" class="sd2-form">
    <el-form-item label="接口地址">
      <el-input
        v-model="baseUrl"
        placeholder="须含 /api/v3，如 https://ark.ap-southeast-1.byteplusapi.com/api/v3（仅域名时后端会尝试自动补全）"
        clearable
        aria-label="接口地址"
      />
      <p class="field-hint">OpenAPI 与推理共用前缀一般为 <code>/api/v3</code>；若只填域名可能导致路由不对、工程名不生效。</p>
    </el-form-item>
    <el-form-item label="鉴权方式">
      <el-radio-group v-model="authMode" aria-label="鉴权方式">
        <el-radio-button value="volc_sign">AK/SK 签名（官方 OpenAPI）</el-radio-button>
        <el-radio-button value="bearer">令牌推理密钥（Bearer）</el-radio-button>
      </el-radio-group>
      <p class="field-hint">选「官方 OpenAPI」路径时，请用本项并填写 AK/SK；选「令牌」仅适合 <code>/asset/…</code> 等中转。</p>
    </el-form-item>
    <el-form-item v-if="authMode === 'bearer'" label="API 密钥">
      <el-input v-model="apiKey" type="password" show-password placeholder="推理用 ARK / 中转 API 密钥" clearable aria-label="API 密钥" />
    </el-form-item>
    <template v-else>
      <el-form-item label="访问密钥 ID">
        <el-input v-model="accessKeyId" placeholder="控制台 IAM 访问密钥 ID" clearable aria-label="访问密钥 ID" />
      </el-form-item>
      <el-form-item label="私有密钥">
        <el-input v-model="secretAccessKey" type="password" show-password placeholder="控制台 IAM 私有密钥" clearable aria-label="私有密钥" />
      </el-form-item>
      <el-form-item label="地域">
        <el-input v-model="signRegion" placeholder="可空：国内 ark 多为 cn-beijing；BytePlus 国际多为 ap-southeast-1" clearable aria-label="地域" />
      </el-form-item>
    </template>
    <el-form-item label="路径模式">
      <el-select v-model="pathMode" style="width: 100%" aria-label="路径模式">
        <el-option label="官方 OpenAPI：POST {接口地址}?Action=…&Version=…（火山/BytePlus 默认）" value="open_api_query" />
        <el-option label="路径：POST {接口地址}/asset/{Action}（部分中转）" value="asset_subpath" />
        <el-option label="扁平：POST {接口地址}/{Action}" value="flat" />
      </el-select>
      <p class="field-hint">官方接口必须在查询参数里带动作名 <code>Action</code>；若用 AnyFast 等自建路径再选中转模式。</p>
    </el-form-item>
    <el-form-item label="接口版本">
      <el-input v-model="apiVersion" placeholder="默认 2024-01-01（仅官方 OpenAPI 模式使用）" clearable aria-label="接口版本" />
    </el-form-item>
    <el-form-item v-if="pathMode === 'open_api_query'" label="工程 / 项目名">
      <el-input
        v-model="projectName"
        placeholder="与控制台「项目」标识完全一致（区分大小写、下划线等）"
        clearable
        aria-label="工程 / 项目名"
      />
      <p class="field-hint">
        会写入查询参数和请求体里的工程名 <code>ProjectName</code>（与动作名一并签名）。
        若仍提示没有权限，且文案里是 <code>project/*</code>，多为 IAM 未授权该动作；请确认策略里资源是否包含你的工程（或 <code>project/*</code>），错误提示不一定替换为具体工程名。
      </p>
    </el-form-item>
    <el-form-item label="模型（可选）">
      <el-input v-model="billingModel" placeholder="部分中转要求计费模型，如 volc-asset；官方直连可留空" clearable aria-label="模型（可选）" />
    </el-form-item>
    <el-form-item label="从配置填入">
      <el-select
        v-model="fillConfigId"
        filterable
        clearable
        placeholder="选择已保存的视频类配置（火山等）"
        style="width: 100%"
        aria-label="从配置填入"
        @change="onFillFromSaved"
      >
        <el-option
          v-for="c in videoLikeConfigs"
          :key="c.id"
          :label="`${c.name} · ${c.base_url || ''}`"
          :value="c.id"
        />
      </el-select>
    </el-form-item>
    <el-form-item label="默认资产组编号">
      <el-input
        v-model="assetGroupIdForCert"
        placeholder="创作页「认证资产」写入此组；可左侧点选资产组自动填入"
        clearable
        aria-label="默认资产组编号"
      />
      <p class="field-hint">保存到 AI 配置时必填。与下方「资产」列表使用的组编号一致。</p>
    </el-form-item>
    <el-form-item label=" ">
      <div class="sd2-save-row">
        <el-button type="primary" :loading="savingConfig" :disabled="Boolean(saveLockReason)" :title="saveLockReason" :aria-label="savingConfig ? '正在保存到 AI 配置' : (saveLockReason || '保存到 AI 配置')" @click="saveToAiConfig">
          保存到 AI 配置
        </el-button>
        <span v-if="savedConfigId" class="sd2-saved-hint">
          已关联配置 #{{ savedConfigId }}（创作页「认证资产」在未配置「即梦2角色认证」时使用）
        </span>
      </div>
    </el-form-item>
  </el-form>
</template>

<script setup>
// 仅展示连接与保存表单；保存、从配置填入和接口调用仍留在认证资产管理页。
defineProps({
  videoLikeConfigs: { type: Array, default: () => [] },
  savedConfigId: { default: null },
  savingConfig: { type: Boolean, default: false },
  saveLockReason: { type: String, default: undefined },
  saveToAiConfig: { type: Function, required: true },
  onFillFromSaved: { type: Function, required: true },
})

const baseUrl = defineModel('baseUrl', { type: String, default: '' })
const apiKey = defineModel('apiKey', { type: String, default: '' })
const pathMode = defineModel('pathMode', { type: String, default: 'open_api_query' })
const apiVersion = defineModel('apiVersion', { type: String, default: '2024-01-01' })
const projectName = defineModel('projectName', { type: String, default: '' })
const authMode = defineModel('authMode', { type: String, default: 'volc_sign' })
const accessKeyId = defineModel('accessKeyId', { type: String, default: '' })
const secretAccessKey = defineModel('secretAccessKey', { type: String, default: '' })
const signRegion = defineModel('signRegion', { type: String, default: '' })
const billingModel = defineModel('billingModel', { type: String, default: '' })
const fillConfigId = defineModel('fillConfigId', { default: null })
const assetGroupIdForCert = defineModel('assetGroupIdForCert', { type: String, default: '' })
</script>

<style scoped>
.sd2-form {
  margin-bottom: 8px;
  max-width: 720px;
}
.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.field-hint code {
  font-size: 11px;
}
.sd2-save-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.sd2-saved-hint {
  font-size: 12px;
  color: #67c23a;
  line-height: 1.5;
}
</style>
