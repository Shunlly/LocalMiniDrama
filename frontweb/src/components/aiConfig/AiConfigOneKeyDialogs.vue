<template>
  <div class="ai-config-one-key-dialogs">
    <!-- 一键配置通义 -->
    <AccessibleDialog
      v-model="oneKeyTongyiVisible"
      title="一键配置通义千问 / 万象（不推荐）"
      width="520px"
      class="ai-config-dialog ai-config-overlay"
      :close-on-click-modal="false"
      :before-close="confirmOneKeyTongyiClose"
      @closed="oneKeyTongyiKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：通义千问（qwen-plus）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：通义万象（wan2.6-image）— 角色/场景/道具图</li>
            <li><b>文本生成图片</b>：通义千问图像（qwen-image-max）— 角色/场景图备选</li>
            <li><b>分镜图片生成</b>：通义万象（wan2.6-image）— 支持角色参考图</li>
            <li><b>视频生成</b>：通义万相（wan2.2-kf2v-flash）— 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往阿里云百炼控制台：<a href="https://bailian.console.aliyun.com/" target="_blank" rel="noopener noreferrer" class="one-key-link">bailian.console.aliyun.com</a></li>
            <li>注册/登录阿里云账号，开通「百炼」服务（新用户有免费额度）</li>
            <li>左侧菜单点击「API Key」→「创建 API Key」</li>
            <li>复制生成的 Key（格式：<code>sk-xxxxxxxx</code>）填入下方</li>
          </ol>
          <p class="one-key-note">💡 通义一个 Key 同时支持文本、图片、视频等所有服务</p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyTongyiKey"
            type="password"
            aria-label="通义密钥"
            placeholder="请输入通义（DashScope）API Key，格式：sk-xxxxxxxx"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestOneKeyTongyiClose">取消</el-button>
        <el-button type="success" :loading="oneKeyTongyiSaving" :disabled="configWriteLocked || !oneKeyTongyiKey.trim()" :title="configWriteLocked ? configWriteLockReason : (!oneKeyTongyiKey.trim() ? '请先填写密钥' : undefined)" @click="submitOneKeyTongyi">
          确定，一键创建配置
        </el-button>
      </template>
    </AccessibleDialog>

    <!-- 一键配置火山 -->
    <AccessibleDialog
      v-model="oneKeyVolcVisible"
      title="一键配置火山引擎（方舟）"
      width="520px"
      class="ai-config-dialog ai-config-overlay"
      :close-on-click-modal="false"
      :before-close="confirmOneKeyVolcClose"
      @closed="oneKeyVolcKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：DeepSeek V3（deepseek-v3-2-251201）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：即梦 4.5（doubao-seedream-4-5-251128）— 角色/场景/道具图</li>
            <li><b>分镜图片生成</b>：即梦 4.5（doubao-seedream-4-5-251128）— 支持角色参考图</li>
            <li><b>视频生成</b>：即梦 Seedance 1.5 Pro — 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往火山引擎方舟控制台：<a href="https://console.volcengine.com/ark" target="_blank" rel="noopener noreferrer" class="one-key-link">console.volcengine.com/ark</a></li>
            <li>注册/登录字节跳动火山引擎账号（新用户有免费 token 额度）</li>
            <li>左侧菜单点击「API Key 管理」→「创建 API Key」</li>
            <li>复制生成的 Key 填入下方</li>
          </ol>
          <p class="one-key-note">💡 方舟平台一个 Key 同时支持豆包文本、即梦图片与视频等所有服务</p>
          <p class="one-key-note">⚠️ 视频生成需在控制台「开通」对应模型（即梦 Seedance）后方可使用</p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyVolcKey"
            type="password"
            aria-label="火山引擎密钥"
            placeholder="请输入火山引擎（方舟）API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestOneKeyVolcClose">取消</el-button>
        <el-button type="success" :loading="oneKeyVolcSaving" :disabled="configWriteLocked || !oneKeyVolcKey.trim()" :title="configWriteLocked ? configWriteLockReason : (!oneKeyVolcKey.trim() ? '请先填写密钥' : undefined)" @click="submitOneKeyVolc">
          确定，一键创建配置
        </el-button>
      </template>
    </AccessibleDialog>

    <!-- 一键配置 Agnes -->
    <AccessibleDialog
      v-model="oneKeyAgnesVisible"
      title="一键配置 Agnes AI"
      width="520px"
      class="ai-config-dialog ai-config-overlay"
      :close-on-click-modal="false"
      :before-close="confirmOneKeyAgnesClose"
      @closed="oneKeyAgnesKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：Agnes 2.0 Flash（agnes-2.0-flash）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：Agnes Image 2.1 Flash — 角色/场景/道具图</li>
            <li><b>分镜图片生成</b>：Agnes Image 2.1 Flash — 支持参考图编辑</li>
            <li><b>视频生成</b>：Agnes Video V2.0（agnes-video-v2.0）— 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往 Agnes 平台：<a href="https://platform.agnes-ai.com/settings/apiKeys" target="_blank" rel="noopener noreferrer" class="one-key-link">platform.agnes-ai.com/settings/apiKeys</a></li>
            <li>注册/登录账号，进入 Settings → API Keys</li>
            <li>点击「Create new secret key」创建密钥</li>
            <li>复制 Key 填入下方</li>
          </ol>
          <p class="one-key-note">💡 一个 Key 同时支持文本、图片、视频；接口文档见 <a href="https://agnes-ai.com/doc/agnes-20-flash" target="_blank" rel="noopener noreferrer" class="one-key-link">agnes-ai.com/doc</a></p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyAgnesKey"
            type="password"
            aria-label="Agnes 密钥"
            placeholder="请输入 Agnes API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestOneKeyAgnesClose">取消</el-button>
        <el-button type="success" :loading="oneKeyAgnesSaving" :disabled="configWriteLocked || !oneKeyAgnesKey.trim()" :title="configWriteLocked ? configWriteLockReason : (!oneKeyAgnesKey.trim() ? '请先填写密钥' : undefined)" @click="submitOneKeyAgnes">
          确定，一键创建配置
        </el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  configWriteLocked: { type: Boolean, default: false },
  configWriteLockReason: { type: String, default: '' },
  oneKeyTongyiSaving: { type: Boolean, default: false },
  oneKeyVolcSaving: { type: Boolean, default: false },
  oneKeyAgnesSaving: { type: Boolean, default: false },
  confirmOneKeyTongyiClose: { type: Function, required: true },
  confirmOneKeyVolcClose: { type: Function, required: true },
  confirmOneKeyAgnesClose: { type: Function, required: true },
  requestOneKeyTongyiClose: { type: Function, required: true },
  requestOneKeyVolcClose: { type: Function, required: true },
  requestOneKeyAgnesClose: { type: Function, required: true },
  submitOneKeyTongyi: { type: Function, required: true },
  submitOneKeyVolc: { type: Function, required: true },
  submitOneKeyAgnes: { type: Function, required: true },
})

const oneKeyTongyiVisible = defineModel('oneKeyTongyiVisible', { type: Boolean, default: false })
const oneKeyTongyiKey = defineModel('oneKeyTongyiKey', { type: String, default: '' })
const oneKeyVolcVisible = defineModel('oneKeyVolcVisible', { type: Boolean, default: false })
const oneKeyVolcKey = defineModel('oneKeyVolcKey', { type: String, default: '' })
const oneKeyAgnesVisible = defineModel('oneKeyAgnesVisible', { type: Boolean, default: false })
const oneKeyAgnesKey = defineModel('oneKeyAgnesKey', { type: String, default: '' })
</script>

<style scoped>
.one-key-help {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.one-key-section {
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 8px;
  padding: 12px 14px;
}
.one-key-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.one-key-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.8;
}
.one-key-list li {
  margin-bottom: 2px;
}
.one-key-link {
  color: var(--el-color-primary, #409eff);
  text-decoration: none;
}
.one-key-link:hover {
  text-decoration: underline;
}
.one-key-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
}
.one-key-note + .one-key-note {
  margin-top: 4px;
}
.one-key-help code {
  background: var(--ai-config-code-surface, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
}
</style>
