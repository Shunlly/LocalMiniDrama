<template>
  <section class="config-form-section">
    <div class="config-section-header">
      <div>
        <h4>厂商与认证</h4>
        <p>选择预设厂商可自动带入中文名称、Base URL 和常用模型，也支持自定义兼容服务。预设只用于填表，不代表对应厂商已在本应用中真实跑通生成。</p>
      </div>
      <span class="config-section-index">02</span>
    </div>
    <el-form-item prop="provider">
      <template #label>
        <span class="form-label-tip">厂商
          <el-tooltip placement="top" popper-class="cfg-tip-popper">
            <template #content>
              <div class="cfg-tip-content">
                从下拉选择预设厂商，会自动填入 Base URL 和模型列表。<br>
                覆盖 OpenRouter、硅基流动、Moonshot、DeepSeek、智谱、MiniMax、可灵、Runway、Luma、Ollama、ComfyUI 等常见目录。<br>
                也可选择「自定义」并直接输入厂商名（需手动填写其他字段）。<br>
                <b>推荐</b>：通义千问 / 火山引擎 / 硅基流动，国内访问较稳。预设不代表已真实接入生成。
              </div>
            </template>
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-select
        v-model="form.provider"
        data-ai-config-field="provider"
        aria-label="厂商"
        placeholder="选择预设厂商（自动填充 URL 和模型）"
        no-data-text="没有匹配的厂商，可直接输入自定义名称"
        clearable
        filterable
        allow-create
        default-first-option
        style="width: 100%"
        :aria-invalid="isConfigFieldInvalid('provider')"
        :aria-describedby="configFieldDescriptionId('provider')"
        @change="onProviderChange"
      >
        <el-option
          v-for="p in availableProviderOptions"
          :key="p.id"
          :label="p.name"
          :value="p.id"
          :class="p.id === '__custom__' ? 'provider-custom-option' : ''"
        />
      </el-select>
      <span :id="configFieldDescriptionId('provider')" class="config-field-a11y-description">
        {{ configFieldDescription('provider') }}
      </span>
    </el-form-item>
    <el-form-item prop="api_key">
      <template #label>
        <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? '令牌（Token）' : 'API 密钥' }}
          <el-tooltip placement="top" popper-class="cfg-tip-popper">
            <template #content>
              <div class="cfg-tip-content">
                <template v-if="form.service_type === 'jimeng2_character_auth'">
                  素材库要求的 <code>Authorization: Bearer …</code> Token，由网关或即梦侧签发。
                </template>
                <template v-else>
                  在对应 AI 平台申请的密钥，用于身份验证。<br>
                  通义：<b>dashscope.aliyuncs.com</b><br>
                  火山：<b>console.volcengine.com/ark</b>
                </template>
              </div>
            </template>
            <el-icon class="tip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-input
        :ref="bindApiKeyInputRef"
        v-model="form.api_key"
        data-ai-config-field="api_key"
        type="password"
        :placeholder="form.service_type === 'jimeng2_character_auth' ? '请输入 Bearer 令牌' : (form.provider === 'jimeng_ai_api' ? '即梦 Session，多个用英文逗号分隔' : 'API 密钥')"
        show-password
        :aria-invalid="isConfigFieldInvalid('api_key')"
        :aria-describedby="configFieldDescriptionId('api_key')"
      />
      <span :id="configFieldDescriptionId('api_key')" class="config-field-a11y-description">
        {{ configFieldDescription('api_key') }}
      </span>
    </el-form-item>
    <el-form-item v-if="form.service_type === 'jimeng2_character_auth'">
      <template #label><span class="form-label-tip">素材列表</span></template>
      <div class="jimeng2-assets-actions">
        <el-button type="primary" plain :loading="jimeng2AssetsLoading" :aria-label="jimeng2AssetsLoading ? '正在加载素材' : '列出素材'" @click="openJimeng2MaterialAssetsDialog">
          列出素材
        </el-button>
        <span class="field-tip jimeng2-assets-tip">
          调用网关的素材列表接口，与
          <a href="https://83zi.com/sd2realperson.html" target="_blank" rel="noopener noreferrer">素材管理 API 文档</a>
          一致（使用当前表单中的网关地址与令牌，无需先保存）。
        </span>
      </div>
    </el-form-item>
    <el-alert
      v-if="form.service_type === 'jimeng2_character_auth'"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
      title="用于创作页「角色」面板的「认证资产」"
      description="保存后，系统从此处读取网关地址与令牌，调用素材登记接口登记角色图；可用「列出素材」核对素材状态。角色主图需为外网可访问的网址（图床或本服务对外访问地址）。"
    />
    <template v-if="form.service_type === 'video' && form.api_protocol === 'kling_omni'">
      <el-form-item>
        <template #label><span class="form-label-tip">访问密钥（AccessKey）</span></template>
        <el-input
          v-model="form.kling_access_key"
          type="password"
          show-password
          placeholder="可灵开放平台 AccessKey（与 SecretKey 成对，可不填上方 API Key）"
          autocomplete="off"
        />
        <p class="field-tip">
          官方 JWT 规则见
          <a href="https://klingai.com/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">commonInfo</a>
          （<a href="https://app.klingai.com/cn/dev/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">中文版</a>）。
          后端使用与官方示例一致的 HS256（<code>iss</code>=AccessKey，<code>exp</code>、<code>nbf</code>）生成 Token。
          若接口返回签名无效（错误码 <code>1000 Authorization signature is invalid</code>）：请确认访问密钥和私有密钥未填反、无多余空格；并尝试勾选下方「私有密钥为 Base64」；
          Base URL 区域（<code>api-beijing.klingai.com</code> / <code>api-singapore.klingai.com</code>）须与密钥所属区域一致。
        </p>
      </el-form-item>
      <el-form-item>
        <template #label><span class="form-label-tip">私有密钥（SecretKey）</span></template>
        <el-input
          v-model="form.kling_secret_key"
          type="password"
          show-password
          placeholder="可灵开放平台 SecretKey"
          autocomplete="off"
        />
        <el-checkbox v-model="form.kling_secret_key_base64" style="margin-top: 8px; display: block">
          SecretKey 为 Base64 字符串（解码后的二进制再用于签名；若仍报签名无效可切换此项重试）
        </el-checkbox>
        <p class="field-tip">
          官方域名：<code>POST {base}/v1/videos/omni-video</code>，轮询
          <code>GET {base}/v1/videos/omni-video/{taskId}</code>；飞儿等中转仍为
          <code>/kling/v1/videos/omni-video</code> 与
          <code>/kling/v1/images/omni-image/{taskId}</code>。详见
          <a href="https://klingai.com/document-api/apiReference/model/OmniVideo" target="_blank" rel="noopener noreferrer">OmniVideo</a>。
        </p>
      </el-form-item>
    </template>
    <!-- TTS 专属字段：声音 ID 和 MiniMax Group ID -->
    <template v-if="form.service_type === 'tts'">
      <el-form-item>
        <template #label>
          <span class="form-label-tip">声音 ID
            <el-tooltip placement="top" popper-class="cfg-tip-popper">
              <template #content>
                <div class="cfg-tip-content">
                  TTS 合成使用的音色 ID。<br>
                  <b>MiniMax 常用音色：</b><br>
                  female-shaonv（少女）、female-chengshu（成熟）<br>
                  male-qingxin（清新男）、male-zhicheng（知城男）<br>
                  audiobook_female_2（有声书女）、audiobook_male_1（有声书男）
                </div>
              </template>
              <el-icon class="tip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-select
          v-model="form.voice_id"
          filterable
          allow-create
          default-first-option
          aria-label="声音 ID"
          placeholder="选择或输入声音 ID"
          no-data-text="暂无预设声音，可直接输入"
          style="width: 100%"
        >
          <el-option-group label="MiniMax 女声">
            <el-option label="female-shaonv（少女）" value="female-shaonv" />
            <el-option label="female-chengshu（成熟）" value="female-chengshu" />
            <el-option label="female-tianmei（甜美）" value="female-tianmei" />
            <el-option label="audiobook_female_2（有声书）" value="audiobook_female_2" />
          </el-option-group>
          <el-option-group label="MiniMax 男声">
            <el-option label="male-qingxin（清新）" value="male-qingxin" />
            <el-option label="male-zhicheng（知城）" value="male-zhicheng" />
            <el-option label="audiobook_male_1（有声书）" value="audiobook_male_1" />
          </el-option-group>
        </el-select>
        <p class="field-tip">MiniMax 必填；不填默认 female-shaonv。</p>
      </el-form-item>
      <el-form-item>
        <template #label>
          <span class="form-label-tip">组 ID（GroupId）
            <el-tooltip placement="top" popper-class="cfg-tip-popper">
              <template #content>
                <div class="cfg-tip-content">
                  MiniMax 账号的 GroupId，调用 T2A v2 接口时附在 URL 参数里。<br>
                  登录 <b>platform.minimaxi.com</b> → 账户设置 → 即可查看 GroupId。
                </div>
              </template>
              <el-icon class="tip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <el-input v-model="form.group_id" placeholder="MiniMax GroupId，如 1234567890" />
        <p class="field-tip">仅 MiniMax T2A 需要此字段。</p>
      </el-form-item>
    </template>
  </section>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'

defineProps({
  form: { type: Object, required: true },
  availableProviderOptions: { type: Array, default: () => [] },
  jimeng2AssetsLoading: { type: Boolean, default: false },
  bindApiKeyInputRef: { type: Function, required: true },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
  onProviderChange: { type: Function, required: true },
  openJimeng2MaterialAssetsDialog: { type: Function, required: true },
})
</script>

<style>
.provider-custom-option {
  border-top: 1px solid var(--el-border-color-light, #e4e7ed);
  margin-top: 4px;
  padding-top: 4px;
  color: var(--el-color-primary, #409eff) !important;
  font-style: italic;
}
</style>

<style scoped>
.config-field-a11y-description {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.config-form-section {
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-blank, #fff);
}
.config-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.config-section-header h4 {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: 15px;
  line-height: 22px;
}
.config-section-header p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular, #606266);
  font-size: 12px;
  line-height: 1.5;
}
.config-section-index {
  flex: 0 0 auto;
  min-width: 34px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-size: 12px;
  font-weight: 600;
}
.jimeng2-assets-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  width: 100%;
}
.jimeng2-assets-tip {
  flex: 1;
  min-width: 200px;
  margin: 0;
  line-height: 1.5;
}
code {
  background: var(--ai-config-code-surface, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
}
.cfg-tip-content code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  font-family: monospace;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
.form-label-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.tip-icon {
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.tip-icon:hover {
  color: var(--el-color-primary, #409eff);
}
@media (max-width: 760px) {
  .config-section-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 520px) {
  .config-form-section {
    padding: 12px;
  }
}
</style>
