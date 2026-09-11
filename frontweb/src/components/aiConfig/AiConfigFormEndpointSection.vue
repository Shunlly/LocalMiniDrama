<template>
  <div>
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

    <AccessibleDialog v-model="showProtocolHelp" title="接口规范说明" width="700px" top="5vh" class="ai-config-overlay">
      <AiConfigPresetHelpCollapse />
      <template #footer>
        <el-button @click="showProtocolHelp = false">关闭</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'
import AiConfigPresetHelpCollapse from '@/components/aiConfig/AiConfigPresetHelpCollapse.vue'
import { hidesApiProtocolField } from '@/utils/aiConfigLabels.js'

defineProps({
  form: { type: Object, required: true },
  isComfyUiForm: { type: Boolean, default: false },
  endpointPreviewInfo: { default: null },
  canConfigureLocalHttp: { type: Boolean, default: false },
  bindWorkflowInputRef: { type: Function, required: true },
  isConfigFieldInvalid: { type: Function, required: true },
  configFieldDescriptionId: { type: Function, required: true },
  configFieldDescription: { type: Function, required: true },
})

const advancedFormSections = defineModel('advancedFormSections', { type: Array, default: () => [] })
const showProtocolHelp = defineModel('showProtocolHelp', { type: Boolean, default: false })
</script>

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
@media (max-width: 520px) {
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
