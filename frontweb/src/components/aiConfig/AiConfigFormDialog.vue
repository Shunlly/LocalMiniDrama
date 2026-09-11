<template>
    <!-- 添加/编辑 -->
    <AccessibleDialog
      v-model="dialogVisible"
      :title="vendorLock.enabled ? '修改 API 密钥 / 默认模型' : (editingId ? '编辑配置' : '添加配置')"
      width="720px"
      top="4vh"
      class="ai-config-dialog ai-config-form-dialog ai-config-overlay"
      append-to-body
      :close-on-click-modal="false"
      :before-close="confirmConfigDialogClose"
      @closed="handleConfigDialogClosed"
    >
      <div :ref="bindConfigDialogScrollRef" class="ai-config-dialog-scroll">
        <div
          v-if="configValidationSummary.length"
          class="ai-config-validation-summary"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <strong>无法保存，请检查以下字段：</strong>
          <ul>
            <li v-for="item in configValidationSummary" :key="item.prop">
              {{ configFieldDisplayLabel(item.label) }}：{{ item.message }}
            </li>
          </ul>
        </div>
      <!-- 锁定模式：只展示 api_key 和 default_model -->
      <template v-if="vendorLock.enabled">
        <el-descriptions :column="1" border style="margin-bottom: 16px">
          <el-descriptions-item label="名称">{{ form.name }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ serviceTypeLabel(form.service_type) }}</el-descriptions-item>
          <el-descriptions-item label="厂商">{{ form.provider }}</el-descriptions-item>
        </el-descriptions>
        <el-form :ref="bindFormRef" :model="form" label-width="100px" @validate="handleConfigFieldValidated">
          <el-form-item prop="api_key" :rules="[{ required: true, message: '请输入 API 密钥', trigger: 'blur' }]">
            <template #label><span class="form-label-tip">API 密钥</span></template>
            <el-input
              :ref="bindApiKeyInputRef"
              v-model="form.api_key"
              data-ai-config-field="api_key"
              type="password"
              :placeholder="form.provider === 'jimeng_ai_api' ? '即梦 Session，多个用英文逗号分隔' : '输入你的 API 密钥'"
              show-password
              :aria-invalid="isConfigFieldInvalid('api_key')"
              :aria-describedby="configFieldDescriptionId('api_key')"
            />
            <span :id="configFieldDescriptionId('api_key')" class="config-field-a11y-description">
              {{ configFieldDescription('api_key') }}
            </span>
          </el-form-item>
          <el-form-item prop="default_model" :rules="defaultModelRules">
            <template #label><span class="form-label-tip">默认模型</span></template>
            <el-select
              v-model="form.default_model"
              data-ai-config-field="default_model"
              clearable
              filterable
              default-first-option
              aria-label="默认模型"
              placeholder="搜索或选择已有模型"
              no-data-text="暂无可用模型"
              style="width: 100%"
              :aria-invalid="isConfigFieldInvalid('default_model') || isDefaultModelUnavailable"
              :aria-describedby="configFieldDescriptionId('default_model')"
            >
              <el-option
                v-if="isDefaultModelUnavailable"
                :label="`${form.default_model}（已失效）`"
                :value="form.default_model"
                disabled
              />
              <el-option v-for="m in formModelList" :key="m" :label="m" :value="m" />
            </el-select>
            <p v-if="isDefaultModelUnavailable" class="field-tip field-tip-warning" role="alert">
              当前默认模型已不在模型列表中，请显式选择有效模型后保存。
            </p>
            <p v-else class="field-tip">实际调用时使用的模型，可搜索已有模型名。锁定模式下不能新增模型列表。</p>
            <span :id="configFieldDescriptionId('default_model')" class="config-field-a11y-description">
              {{ configFieldDescription('default_model') }}
            </span>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">设为默认
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      每种服务类型只有一个「默认」配置。<br>
                      生成时系统会优先使用默认配置，建议每类至少设一个默认。
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-switch v-model="form.is_default" :disabled="configWriteLocked" />
          </el-form-item>
        </el-form>
      </template>

      <!-- 普通模式：完整表单 -->
      <el-form v-else :ref="bindFormRef" :model="form" :rules="rules" label-width="100px" @validate="handleConfigFieldValidated">
        <section class="config-form-section">
          <div class="config-section-header">
            <div>
              <h4>基础信息</h4>
              <p>先确定服务用途和便于识别的配置名称。</p>
            </div>
            <span class="config-section-index">01</span>
          </div>
        <el-form-item prop="service_type">
          <template #label>
            <span class="form-label-tip">服务类型
              <el-tooltip placement="top" :show-arrow="true" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    <b>文本/对话</b>：用于 AI 生成故事剧本<br>
                    <b>文本生成图片</b>：角色、场景、道具的图片生成（不支持参考图）<br>
                    <b>分镜图片生成</b>：生成分镜图片，支持传入角色参考图<br>
                    <b>视频生成</b>：根据分镜图生成视频片段<br>
                    <b>语音合成 TTS</b>：为分镜对白自动合成语音（点分镜配音按钮时使用）<br>
                    <b>图片识别 OCR</b>：用于 PDF、扫描件和图片抽文字。本机也可安装 Tesseract。预设只用于填表，不代表已跑通该厂商<br>
                    <b>语音转写</b>：用于音频、视频对白转成文字。预设只用于填表，不代表已跑通该厂商<br>
                    <b>即梦2角色认证</b>：将角色主图登记到即梦业务素材库（认证资产），仅填网关 URL 与 Token
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.service_type"
            data-ai-config-field="service_type"
            aria-label="服务类型"
            placeholder="选择类型"
            no-data-text="暂无可选服务类型"
            style="width: 100%"
            :disabled="Boolean(editingId)"
            :aria-invalid="isConfigFieldInvalid('service_type')"
            :aria-describedby="configFieldDescriptionId('service_type')"
            @change="onServiceTypeChange"
          >
            <el-option label="文本/对话" value="text" />
            <el-option label="文本生成图片" value="image" />
            <el-option label="分镜图片生成" value="storyboard_image" />
            <el-option label="视频生成" value="video" />
            <el-option label="语音合成 TTS" value="tts" />
            <el-option label="图片识别 OCR" value="ocr" />
            <el-option label="语音转写" value="transcription" />
            <el-option label="即梦2角色认证" value="jimeng2_character_auth" />
          </el-select>
          <span :id="configFieldDescriptionId('service_type')" class="config-field-a11y-description">
            {{ configFieldDescription('service_type') }}
          </span>
        </el-form-item>
        <el-form-item prop="name">
          <template #label>
            <span class="form-label-tip">名称
              <el-tooltip content="配置的显示名，用于在列表中区分不同配置，选择厂商后可自动生成。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.name"
            data-ai-config-field="name"
            placeholder="如：OpenAI 图文，可自动生成"
            :aria-invalid="isConfigFieldInvalid('name')"
            :aria-describedby="configFieldDescriptionId('name')"
          />
          <span :id="configFieldDescriptionId('name')" class="config-field-a11y-description">
            {{ configFieldDescription('name') }}
          </span>
        </el-form-item>
        </section>

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

        <!-- 接口规范帮助 Dialog -->
        <AccessibleDialog v-model="showProtocolHelp" title="接口规范说明" width="700px" top="5vh" class="ai-config-overlay">
          <AiConfigPresetHelpCollapse />
          <template #footer>
            <el-button @click="showProtocolHelp = false">关闭</el-button>
          </template>
        </AccessibleDialog>
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
            <el-button type="primary" plain :loading="jimeng2AssetsLoading" @click="openJimeng2MaterialAssetsDialog">
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

        <el-collapse v-model="advancedFormSections" class="advanced-config-collapse">
          <el-collapse-item name="endpoint">
            <template #title>
              <div class="advanced-config-title">
                <span>
                  <strong>高级接口设置</strong>
                  <small>Base URL、接口规范及自定义端点</small>
                </span>
                <el-tag size="small" type="info" effect="plain">一般无需修改</el-tag>
              </div>
            </template>
            <div class="advanced-config-content">
              <!-- 接口规范：仅图片/分镜/视频类型显示；文本、语音、图片识别、语音转写按 OpenAI 兼容处理 -->
              <el-form-item
                v-if="!hidesApiProtocolField(form.service_type)"
                prop="api_protocol"
              >
                <template #label>
                  <span class="form-label-tip">接口规范
                    <button type="button" class="tip-button" aria-label="查看接口规范说明" title="查看接口规范说明" @click.stop="showProtocolHelp = true">
                      <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                    </button>
                  </span>
                </template>
                <el-select
                  v-model="form.api_protocol"
                  data-ai-config-field="api_protocol"
                  aria-label="接口规范"
                  style="width: 100%"
                  placeholder="选择接口规范（自定义厂商必选）"
                  no-data-text="暂无匹配的接口规范"
                  clearable
                  :aria-invalid="isConfigFieldInvalid('api_protocol')"
                  :aria-describedby="configFieldDescriptionId('api_protocol')"
                >
                  <el-option label="OpenAI 兼容（大多数中转站默认）" value="openai" />
                  <el-option label="火山引擎（豆包 Seedream / Seedance）" value="volcengine" />
                  <el-option label="火山即梦 Seedance 全能（方舟多图参考，Seedance 2.0 等）" value="volcengine_omni" />
                  <el-option label="通义万象 DashScope" value="dashscope" />
                  <el-option label="Google Gemini（图片 / Veo 视频）" value="gemini" />
                  <el-option label="Sora 中转站（multipart/form-data，seconds+size）" value="sora" />
                  <el-option label="Veo3 兼容（JSON，images+enhance_prompt，自动翻译英文）" value="veo3" />
                  <el-option label="Vidu 视频" value="vidu" />
                  <el-option label="可灵 Omni-Video（官方 api-beijing / ffir 中转，O1 全能）" value="kling_omni" />
                  <el-option label="xAI Grok Imagine（官方 prompt + aspect_ratio，/v1/videos/generations）" value="xai" />
                  <el-option label="NanoBanana（图像）" value="nano_banana" />
                  <el-option label="Fal.ai" value="fal" />
                  <el-option label="Replicate" value="replicate" />
                  <el-option label="ComfyUI 本地工作流" value="comfyui" />
                </el-select>
                <span :id="configFieldDescriptionId('api_protocol')" class="config-field-a11y-description">
                  {{ configFieldDescription('api_protocol') }}
                </span>
              </el-form-item>
              <el-form-item prop="base_url">
                <template #label>
                  <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? '网关 URL' : '接口地址（Base URL）' }}
                    <el-tooltip placement="top" popper-class="cfg-tip-popper">
                      <template #content>
                        <div class="cfg-tip-content">
                          <template v-if="form.service_type === 'jimeng2_character_auth'">
                            即梦业务素材库网关的<b>根地址</b>（不含 <code>/api/business/v1</code> 路径）。须与素材库实际部署一致。
                          </template>
                          <template v-else>
                            API 接口地址，选择预设厂商后自动填入，一般无需修改。<br>
                            示例：https://dashscope.aliyuncs.com
                          </template>
                        </div>
                      </template>
                      <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </span>
                </template>
                <el-input
                  v-model="form.base_url"
                  data-ai-config-field="base_url"
                  :placeholder="form.service_type === 'jimeng2_character_auth' ? '如 https://your-gateway.com' : '选择预设厂商后自动填充，可修改'"
                  :aria-invalid="isConfigFieldInvalid('base_url')"
                  :aria-describedby="configFieldDescriptionId('base_url')"
                />
                <span :id="configFieldDescriptionId('base_url')" class="config-field-a11y-description">
                  {{ configFieldDescription('base_url') }}
                </span>
              </el-form-item>

              <el-form-item v-if="canConfigureLocalHttp" label="本地 HTTP">
                <el-switch v-model="form.allow_local_http" />
                <p class="field-tip">仅用于明确选择的本地或内网网关；公网服务仍需使用 HTTPS。</p>
              </el-form-item>

              <el-form-item v-if="isComfyUiForm" prop="comfy_workflow_json" label="工作流 JSON">
                <el-input
                  :ref="bindWorkflowInputRef"
                  v-model="form.comfy_workflow_json"
                  class="comfy-workflow-input"
                  data-ai-config-field="comfy_workflow_json"
                  type="textarea"
                  :rows="10"
                  resize="vertical"
                  spellcheck="false"
                  placeholder='{"1":{"class_type":"KSampler","inputs":{}}}'
                  :aria-invalid="isConfigFieldInvalid('comfy_workflow_json')"
                  :aria-describedby="configFieldDescriptionId('comfy_workflow_json')"
                />
                <span :id="configFieldDescriptionId('comfy_workflow_json')" class="config-field-a11y-description">
                  {{ configFieldDescription('comfy_workflow_json') }}
                </span>
              </el-form-item>

        <!-- 端点配置：视频必填（自定义厂商）；图片/分镜在使用代理或特殊厂商时填写 -->
        <template v-if="!hidesApiProtocolField(form.service_type)">
          <el-form-item prop="endpoint">
            <template #label>
              <span class="form-label-tip">提交端点
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      接口路径，追加在 Base URL 之后。<br>
                      <b>预设厂商</b>（火山 / 通义 / NanoBanana）留空，系统自动推断。<br>
                      <b>视频自定义厂商</b>必须填写，如 /v1/videos/generations<br>
                      <b>NanoBanana 代理</b>填写代理路径，如 /fal-ai/nano-banana
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input
              v-model="form.endpoint"
              data-ai-config-field="endpoint"
              :placeholder="form.service_type === 'video' ? '自定义视频厂商必填，如 /v1/videos/generations；预设厂商留空' : '代理或特殊厂商时填写，如 /fal-ai/nano-banana；预设厂商留空'"
              :aria-invalid="isConfigFieldInvalid('endpoint')"
              :aria-describedby="configFieldDescriptionId('endpoint')"
            />
            <span :id="configFieldDescriptionId('endpoint')" class="config-field-a11y-description">
              {{ configFieldDescription('endpoint') }}
            </span>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">查询端点
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      查询任务状态的接口路径，{taskId} 会被替换为实际任务 ID。<br>
                      <b>预设厂商</b>留空即可，由系统自动推断。<br>
                      <b>视频自定义厂商</b>必须填写，如 /v1/video/tasks/{taskId}<br>
                      <b>图片/NanoBanana</b> 代理若不支持轮询可留空
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.query_endpoint" placeholder="自定义视频厂商必填，如 /v1/video/tasks/{taskId}；预设厂商留空" />
          </el-form-item>
        </template>

        <!-- 接口地址预览：选择厂商/协议后自动展示，帮助用户核对 -->
        <div v-if="endpointPreviewInfo" class="endpoint-preview-box" :class="{ 'ep-box-gemini': endpointPreviewInfo.isGemini }">
          <div class="ep-preview-header">
            <span>📌 系统将使用以下接口地址</span>
            <span v-if="endpointPreviewInfo.isGemini" class="ep-auto-badge ep-badge-gemini">Gemini 固定模式</span>
            <span v-else-if="endpointPreviewInfo.isJimeng2Auth" class="ep-auto-badge">即梦2角色认证</span>
            <span v-else-if="endpointPreviewInfo.isAuto && form.service_type !== 'text'" class="ep-auto-badge">自动推断</span>
          </div>
          <div class="ep-row">
            <span class="ep-label">提交地址：</span>
            <code class="ep-url">{{ endpointPreviewInfo.submit }}</code>
          </div>
          <div v-if="endpointPreviewInfo.query" class="ep-row">
            <span class="ep-label">查询地址：</span>
            <code class="ep-url">{{ endpointPreviewInfo.query }}</code>
          </div>
          <p v-if="endpointPreviewInfo.isGemini" class="ep-tip ep-tip-warn">
            ⚠️ Gemini 端点由系统根据模型名固定生成，上方「提交端点」和「查询端点」字段对 Gemini 无效，填了也不生效。
          </p>
          <p v-else-if="endpointPreviewInfo.isJimeng2Auth" class="ep-tip">角色「认证资产」将调用上述地址注册素材（POST 创建、GET 查询状态）。</p>
          <p v-else class="ep-tip">以上为系统推断的实际调用地址（可手动填写上方端点字段来覆盖）</p>
        </div>
            </div>
          </el-collapse-item>
        </el-collapse>

        <section v-if="form.service_type !== 'jimeng2_character_auth'" class="config-form-section">
          <div class="config-section-header">
            <div>
              <h4>模型</h4>
              <p>维护该厂商可用模型，并指定生成任务实际使用的默认模型。</p>
            </div>
            <span class="config-section-index">03</span>
          </div>
        <template v-if="form.service_type !== 'jimeng2_character_auth'">
        <AiConfigModelListSection
          :form="form"
          v-model:preset-model-pick="presetModelPick"
          :available-models="availableModels"
          :discover-models-loading="discoverModelsLoading"
          :discover-models-disabled="discoverModelsDisabled"
          :discover-models-disabled-reason="discoverModelsDisabledReason"
          :provider-model-empty-hint="providerModelEmptyHint"
          :is-config-field-invalid="isConfigFieldInvalid"
          :config-field-description-id="configFieldDescriptionId"
          :config-field-description="configFieldDescription"
          :set-model-list-input-ref="setModelListInputRef"
          :discover-models-from-service="discoverModelsFromService"
          :on-preset-model-select="onPresetModelSelect"
        />
        <el-form-item prop="default_model">
          <template #label>
            <span class="form-label-tip">默认模型
              <el-tooltip content="有多个模型时，实际调用哪个进行生成。建议选响应快、效果好的那个。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.default_model"
            data-ai-config-field="default_model"
            aria-label="默认模型"
            placeholder="选择或输入默认模型名"
            no-data-text="暂无模型，可直接输入或先填写模型列表"
            clearable
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            :aria-invalid="isConfigFieldInvalid('default_model') || isDefaultModelUnavailable"
            :aria-describedby="configFieldDescriptionId('default_model')"
            @change="onDefaultModelChange"
          >
            <el-option
              v-if="isDefaultModelUnavailable"
              :label="`${form.default_model}（已失效）`"
              :value="form.default_model"
              disabled
            />
            <el-option v-for="m in formModelList" :key="m" :label="m" :value="m" />
          </el-select>
          <p v-if="isDefaultModelUnavailable" class="field-tip field-tip-warning" role="alert">
            当前默认模型已不在模型列表中，请显式选择有效模型后保存。
          </p>
          <p v-else class="field-tip">可搜索已有模型，也可直接输入自定义模型名；输入后会加入上方模型列表。</p>
          <span :id="configFieldDescriptionId('default_model')" class="config-field-a11y-description">
            {{ configFieldDescription('default_model') }}
          </span>
        </el-form-item>
        <el-form-item v-if="isDeepSeekOfficialForm">
          <template #label>
            <span class="form-label-tip">思考模式
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    DeepSeek V4 官方模型用 thinking 参数控制思考模式。<br>
                    关闭思考对应旧 deepseek-chat；开启思考对应旧 deepseek-reasoner。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="deepseek-settings">
            <el-radio-group v-model="form.deepseek_thinking">
              <el-radio-button label="disabled">关闭思考</el-radio-button>
              <el-radio-button label="enabled">开启思考</el-radio-button>
            </el-radio-group>
            <el-select
              v-if="form.deepseek_thinking === 'enabled'"
              v-model="form.deepseek_reasoning_effort"
              aria-label="思考强度"
              no-data-text="暂无可选思考强度"
              style="width: 140px"
            >
              <el-option label="高（high）" value="high" />
              <el-option label="最高（max）" value="max" />
            </el-select>
          </div>
          <p class="field-tip">官方旧模型名将在 2026-07-24 废弃；新配置建议使用 deepseek-v4-flash 或 deepseek-v4-pro。</p>
        </el-form-item>
        </template>
        </section>

        <section class="config-form-section config-policy-section">
          <div class="config-section-header">
            <div>
              <h4>调用策略</h4>
              <p>同类服务有多个配置时，默认项优先于普通配置，优先级用于后续排序。</p>
            </div>
            <span class="config-section-index">{{ form.service_type === 'jimeng2_character_auth' ? '03' : '04' }}</span>
          </div>
        <template v-if="['text', 'image', 'storyboard_image', 'video', 'tts'].includes(form.service_type)">
          <el-form-item v-if="form.service_type === 'text'" label="输入单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_input_per_million_tokens" :min="0" :precision="4" :step="0.1" controls-position="right" />
              <span>USD / 百万 tokens</span>
            </div>
          </el-form-item>
          <el-form-item v-if="form.service_type === 'text'" label="输出单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_output_per_million_tokens" :min="0" :precision="4" :step="0.1" controls-position="right" />
              <span>USD / 百万 tokens</span>
            </div>
          </el-form-item>
          <el-form-item v-else-if="form.service_type === 'image' || form.service_type === 'storyboard_image'" label="图片单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_per_image" :min="0" :precision="6" :step="0.01" controls-position="right" />
              <span>USD / 张</span>
            </div>
          </el-form-item>
          <el-form-item v-else-if="form.service_type === 'video'" label="视频单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_per_second" :min="0" :precision="6" :step="0.01" controls-position="right" />
              <span>USD / 秒</span>
            </div>
          </el-form-item>
          <el-form-item v-else-if="form.service_type === 'tts'" label="语音单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_per_1000_characters" :min="0" :precision="6" :step="0.01" controls-position="right" />
              <span>USD / 千字符</span>
            </div>
          </el-form-item>
          <p class="pricing-help">选填。用于 Production 工作流成本估算；留空会明确显示为“未配置价格”，不会误报为零成本。</p>
        </template>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">优先级
              <el-tooltip content="同一服务类型有多个配置时，数字越大越优先被调用。默认 0，一般设为 10 即可。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input-number v-model="form.priority" :min="0" :max="999" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">设为默认
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    每种服务类型只有一个「默认」配置。<br>
                    生成时系统会优先使用默认配置，建议每类至少设一个默认。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-switch v-model="form.is_default" :disabled="configWriteLocked" />
        </el-form-item>
        </section>
      </el-form>
      </div>
      <template #footer>
        <el-button @click="requestConfigDialogClose">取消</el-button>
        <el-button type="primary" aria-label="保存配置" :loading="saving" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="submit">保存</el-button>
      </template>
    </AccessibleDialog>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'
import AiConfigModelListSection from '@/components/aiConfig/AiConfigModelListSection.vue'
import AiConfigPresetHelpCollapse from '@/components/aiConfig/AiConfigPresetHelpCollapse.vue'
import {
  hidesApiProtocolField,
  serviceTypeLabel,
  configFieldDisplayLabel,
} from '@/utils/aiConfigLabels.js'

defineOptions({ inheritAttrs: false })

defineProps({
  vendorLock: { type: Object, required: true },
  editingId: { default: null },
  configValidationSummary: { type: Array, default: () => [] },
  configWriteLocked: { type: Boolean, default: false },
  configWriteLockReason: { type: String, default: '' },
  saving: { type: Boolean, default: false },
  defaultModelRules: { type: Array, default: () => [] },
  rules: { type: Object, default: () => ({}) },
  formModelList: { type: Array, default: () => [] },
  isDefaultModelUnavailable: { type: Boolean, default: false },
  isComfyUiForm: { type: Boolean, default: false },
  isDeepSeekOfficialForm: { type: Boolean, default: false },
  availableProviderOptions: { type: Array, default: () => [] },
  endpointPreviewInfo: { default: null },
  jimeng2AssetsLoading: { type: Boolean, default: false },
  availableModels: { type: Array, default: () => [] },
  discoverModelsLoading: { type: Boolean, default: false },
  discoverModelsDisabled: { type: Boolean, default: false },
  discoverModelsDisabledReason: { type: String, default: '' },
  providerModelEmptyHint: { type: String, default: '' },
  canConfigureLocalHttp: { type: Boolean, default: false },
  confirmConfigDialogClose: { type: Function, required: true },
  handleConfigDialogClosed: { type: Function, required: true },
  requestConfigDialogClose: { type: Function, required: true },
  submit: { type: Function, required: true },
  handleConfigFieldValidated: { type: Function, required: true },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
  onServiceTypeChange: { type: Function, required: true },
  onProviderChange: { type: Function, required: true },
  onDefaultModelChange: { type: Function, required: true },
  openJimeng2MaterialAssetsDialog: { type: Function, required: true },
  setModelListInputRef: { type: Function, required: true },
  discoverModelsFromService: { type: Function, required: true },
  onPresetModelSelect: { type: Function, required: true },
})

const dialogVisible = defineModel('dialogVisible', { type: Boolean, default: false })
const showProtocolHelp = defineModel('showProtocolHelp', { type: Boolean, default: false })
const form = defineModel('form', { type: Object })
const advancedFormSections = defineModel('advancedFormSections', { type: Array, default: () => [] })
const presetModelPick = defineModel('presetModelPick', { type: String, default: '' })
const formRef = defineModel('formRef')
const apiKeyInputRef = defineModel('apiKeyInputRef')
const configDialogScrollRef = defineModel('configDialogScrollRef')
const workflowInputRef = defineModel('workflowInputRef')

// 把内部表单节点回写给父组件，提交校验、修复聚焦和滚动仍由页面持有
function bindFormRef(el) {
  formRef.value = el
}
function bindApiKeyInputRef(el) {
  apiKeyInputRef.value = el
}
function bindConfigDialogScrollRef(el) {
  configDialogScrollRef.value = el
}
function bindWorkflowInputRef(el) {
  workflowInputRef.value = el
}
</script>

<style>
.provider-custom-option {
  border-top: 1px solid var(--el-border-color-light, #e4e7ed);
  margin-top: 4px;
  padding-top: 4px;
  color: var(--el-color-primary, #409eff) !important;
  font-style: italic;
}

.ai-config-form-dialog {
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-config-form-dialog > .el-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>

<style scoped>
.ai-config-dialog-scroll {
  max-height: calc(92vh - 150px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 4px;
  scrollbar-gutter: stable;
}
.ai-config-validation-summary {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-danger-border, #fbc4c4);
  border-radius: 6px;
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.ai-config-validation-summary strong {
  display: block;
  font-size: 13px;
  line-height: 20px;
}
.ai-config-validation-summary ul {
  margin: 4px 0 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.6;
}
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
.config-policy-section {
  margin-bottom: 0;
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
.advanced-config-collapse {
  margin-bottom: 18px;
}
.advanced-config-title {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-right: 12px;
}
.advanced-config-title span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.advanced-config-title strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 14px;
  line-height: 20px;
}
.advanced-config-title small {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 18px;
}
.advanced-config-content {
  padding-top: 8px;
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
.deepseek-settings {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
.field-tip-warning {
  color: var(--el-color-warning-dark-2, #b88230);
  font-weight: 500;
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
.pricing-field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pricing-field-row span {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  white-space: nowrap;
}
.pricing-help {
  margin: -4px 0 14px 100px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
}
.tip-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tip-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.endpoint-preview-box {
  background: var(--ai-config-info-surface, #f0f7ff);
  border: 1px solid var(--ai-config-info-border, #c6e0ff);
  border-radius: 6px;
  padding: 10px 14px;
  margin: -4px 0 14px;
  font-size: 12px;
}
.ep-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--ai-config-info-text, #409eff);
  margin-bottom: 8px;
  font-size: 12px;
}
.ep-auto-badge {
  background: var(--ai-config-info-surface, #e6f1ff);
  color: var(--ai-config-info-text, #409eff);
  border: 1px solid var(--ai-config-info-border, #b3d8ff);
  border-radius: 3px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 400;
}
.ep-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 5px;
  gap: 6px;
  line-height: 1.5;
}
.ep-row:last-of-type {
  margin-bottom: 0;
}
.ep-label {
  flex-shrink: 0;
  color: var(--el-text-color-regular, #606266);
  min-width: 68px;
}
.ep-url {
  word-break: break-all;
  color: var(--el-text-color-primary, #303133);
  background: var(--el-fill-color-blank, rgba(255,255,255,0.7));
  border: 1px solid var(--ai-config-info-border, #dce8fa);
  border-radius: 3px;
  padding: 1px 6px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 11.5px;
  line-height: 1.6;
}
.ep-tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
.ep-tip-warn {
  color: var(--ai-config-warning-text, #e6a23c);
}
.ep-box-gemini {
  background: var(--ai-config-warning-surface, #fffbf0);
  border-color: var(--ai-config-warning-border, #f5dfa0);
}
.ep-box-gemini .ep-preview-header {
  color: var(--ai-config-warning-text, #b8860b);
}
.ep-badge-gemini {
  background: var(--ai-config-warning-surface, #fef6e0);
  color: var(--ai-config-warning-text, #b8860b);
  border-color: var(--ai-config-warning-border, #f0d080);
}
@media (max-width: 760px) {
  .config-section-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .pricing-help {
    margin-left: 0;
  }
  :deep(.el-form-item__content),
  :deep(.el-input),
  :deep(.el-select) {
    min-width: 0;
    max-width: 100%;
  }
  .pricing-field-row {
    flex-wrap: wrap;
  }
}
@media (max-width: 520px) {
  .config-form-section {
    padding: 12px;
  }
  .advanced-config-title {
    align-items: flex-start;
    flex-direction: column;
  }
  .ep-row {
    flex-direction: column;
  }
  .ep-label {
    min-width: 0;
  }
}
</style>
