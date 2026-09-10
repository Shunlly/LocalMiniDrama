<template>
                    <div class="protocol-help">
            <p class="ph-disclaimer">选择预设只会自动填入公开 Base URL 和常见模型名，方便保存配置。以下说明用于对照填写，不代表本应用已真实接入或跑通对应厂商的图片、视频或语音生成。</p>
            <div class="ph-section-title">文本 / OpenAI 兼容</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-text">
                <template #title><span class="ph-tag ph-tag-text">文本</span> OpenAI 兼容网关</template>
                <div class="ph-body">
                  <b>适用：</b>OpenAI 官方、OpenAI 兼容网关、多数中转站。<br>
                  <b>Base URL：</b><code>https://api.openai.com/v1</code><br>
                  <b>常见模型：</b><code>gpt-5.5</code>、<code>gpt-4.1</code>、<code>gpt-4o-mini</code><br>
                  文本服务默认走 <code>/chat/completions</code>。自定义网关请改 Base URL，不要改服务类型。
                </div>
              </el-collapse-item>
              <el-collapse-item name="openrouter-text">
                <template #title><span class="ph-tag ph-tag-text">文本</span> OpenRouter 聚合网关</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://openrouter.ai/api/v1</code><br>
                  <b>常见模型：</b><code>openai/gpt-5.5</code>、<code>anthropic/claude-sonnet-4.5</code>、<code>google/gemini-3-pro-preview</code><br>
                  模型名通常带厂商前缀。选此预设只填表，实际能否对话取决于你的密钥和网关。
                </div>
              </el-collapse-item>
              <el-collapse-item name="siliconflow-text">
                <template #title><span class="ph-tag ph-tag-text">文本</span> 硅基流动 SiliconFlow</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://api.siliconflow.cn/v1</code><br>
                  <b>常见模型：</b><code>Qwen/Qwen3-235B-A22B-Instruct-2507</code>、<code>deepseek-ai/DeepSeek-V3.1</code>、<code>moonshotai/Kimi-K2-Instruct</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="cn-cloud-text">
                <template #title><span class="ph-tag ph-tag-text">文本</span> Moonshot / DeepSeek / 智谱 / MiniMax</template>
                <div class="ph-body">
                  <b>Moonshot：</b><code>https://api.moonshot.cn/v1</code>，模型如 <code>kimi-k2-0711-preview</code><br>
                  <b>DeepSeek：</b><code>https://api.deepseek.com</code>，模型如 <code>deepseek-chat</code>、<code>deepseek-reasoner</code><br>
                  <b>智谱 GLM：</b><code>https://open.bigmodel.cn/api/paas/v4</code>，模型如 <code>glm-4.5</code>、<code>glm-4.6</code><br>
                  <b>MiniMax：</b><code>https://api.minimaxi.com/v1</code>，文本模型如 <code>MiniMax-M1</code>。视频海螺请改选视频服务类型。
                </div>
              </el-collapse-item>
              <el-collapse-item name="ollama-text">
                <template #title><span class="ph-tag ph-tag-text">文本</span> Ollama / LM Studio / vLLM 本地</template>
                <div class="ph-body">
                  <b>Ollama：</b><code>http://127.0.0.1:11434/v1</code>，模型如 <code>qwen3:8b</code>。本地服务通常可不填 API Key。<br>
                  <b>LM Studio：</b><code>http://127.0.0.1:1234/v1</code><br>
                  <b>vLLM：</b><code>http://127.0.0.1:8000/v1</code><br>
                  请先在本机启动对应服务。保存时请使用本机地址，例如 127.0.0.1。
                </div>
              </el-collapse-item>
            </el-collapse>

            <div class="ph-section-title" style="margin-top:16px">🖼 图片 / 分镜图 协议</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> OpenAI 兼容 — 绝大多数中转站默认</template>
                <div class="ph-body">
                  <b>适用场景：</b>OpenAI 官方、各类中转/代理站（ChatFire、硅基流动等）<br>
                  <b>Endpoint：</b><code>POST /v1/images/generations</code><br>
                  <pre>{ "model": "dall-e-3", "prompt": "...", "n": 1, "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 火山引擎 — 豆包 Seedream</template>
                <div class="ph-body">
                  <b>Endpoint：</b><code>POST /api/v3/images/generations</code><br>
                  <b>Base URL：</b><code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedream-4-5-251128", "prompt": "...", "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 通义万象 DashScope</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint：</b><code>POST /api/v1/services/aigc/text2image/image-synthesis</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> Google Gemini</template>
                <div class="ph-body">
                  <b>认证：</b>URL 参数 <code>?key=API_KEY</code><br>
                  <b>Endpoint：</b><code>POST /v1beta/models/{model}:generateContent</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="siliconflow-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 硅基流动 / OpenRouter 图像</template>
                <div class="ph-body">
                  <b>硅基流动：</b><code>https://api.siliconflow.cn/v1</code>，模型如 <code>black-forest-labs/FLUX.1-dev</code>、<code>Qwen/Qwen-Image</code><br>
                  <b>OpenRouter：</b><code>https://openrouter.ai/api/v1</code>，模型如 <code>google/gemini-2.5-flash-image</code><br>
                  接口规范可选 OpenAI 兼容。这只是目录预设，不代表生图链路已官方跑通。
                </div>
              </el-collapse-item>
              <el-collapse-item name="kling-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 可灵 Kling 图像</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://api.klingai.com</code><br>
                  <b>常见模型：</b><code>kling-image</code>、<code>kling-omni-image</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="comfyui-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> ComfyUI 本地工作流</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>http://127.0.0.1:8188</code><br>
                  <b>默认路径：</b>提交 <code>/prompt</code>，查询 <code>/history/{promptId}</code><br>
                  本地工作流通常可不填 API Key。请先启动 ComfyUI。模型栏可保留 <code>custom-workflow</code>。
                </div>
              </el-collapse-item>
            </el-collapse>

            <div class="ph-section-title" style="margin-top:16px">🎬 视频 协议</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> OpenAI 兼容 — content 数组格式</template>
                <div class="ph-body">
                  <b>适用场景：</b>各类中转站视频接口（ChatFire 等）<br>
                  <b>Endpoint：</b>自定义，如 <code>POST /v1/video/create</code><br>
                  <pre>{ "model": "sora-2-pro",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 5, "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="sora-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Sora 中转站 — multipart/form-data</template>
                <div class="ph-body">
                  <b>适用场景：</b>Sora API 格式的中转站<br>
                  <b>默认 Endpoint：</b><code>POST /v1/videos</code>（创建），<code>GET /v1/videos/{taskId}</code>（查询）<br>
                  <b>请求格式：</b>multipart/form-data（非 JSON）<br>
                  <pre>model       = "sora-2"
prompt      = "..."
seconds     = "4" | "8" | "12"
size        = "720x1280" | "1280x720" | "1024x1792" | "1792x1024"
watermark   = "false"
private     = "false"
input_reference = (图片文件，可选)</pre>
                  <b>注意：</b>参考图会自动 resize 到与 size 一致后上传。
                </div>
              </el-collapse-item>
              <el-collapse-item name="veo3-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Veo3 兼容 — images + enhance_prompt</template>
                <div class="ph-body">
                  <b>适用场景：</b>Veo3 系列模型的 JSON 格式接口<br>
                  <b>默认 Endpoint：</b><code>POST /v1/video/create</code>（创建），<code>GET /v1/video/query?id={taskId}</code>（查询）<br>
                  <pre>{ "model": "veo3.1",
  "prompt": "...",
  "enhance_prompt": true,
  "images": ["data:image/jpeg;base64,..."]
}</pre>
                  <b>注意：</b><code>enhance_prompt: true</code> 会让接口自动将提示词翻译为英文。localhost 图片会自动转为 base64 内嵌。
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 火山引擎 — 豆包 Seedance</template>
                <div class="ph-body">
                  <b>Endpoint：</b><code>POST …/contents/generations/tasks</code>（与后端一致）<br>
                  <b>Base URL：</b><code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedance-1-5-pro-251215",
  "content": [{ "type": "text", "text": "..." }],
  "ratio": "9:16", "duration": 5,
  "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-omni-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 火山即梦 Seedance 全能（多图参考）</template>
                <div class="ph-body">
                  <b>适用：</b>方舟 Seedance 2.0 等支持多参考图的全能链路；与「全能模式」分镜、<code>@图片1</code>… 提示词配合使用。<br>
                  <b>Endpoint：</b><code>POST {base}/contents/generations/tasks</code>，轮询 <code>GET {base}/contents/generations/tasks/{taskId}</code><br>
                  <b>厂商：</b>仍选「火山引擎」，<b>接口规范</b>选本项；模型填控制台接入点（如 <code>doubao-seedance-2-0-260128</code>，以控制台为准）。<br>
                  <pre>{ "model": "doubao-seedance-2-0-260128",
  "task_type": "i2v",
  "content": [
    { "type": "text", "text": "… @图片1 … @图片2 …" },
    { "type": "image_url", "image_url": { "url": "https://..." } },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 8, "watermark": false }</pre>
                  <b>说明：</b>全能模式下列均为参考图（场景、角色…），每张均 <code>role: reference_image</code>；最多 9 张，时长 Seedance 2.x 按 4–15 秒吸附。
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 通义万象 DashScope</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint：</b><code>POST /api/v1/services/aigc/video-generation/video-synthesis</code><br>
                  <pre>{ "model": "wan2.2-kf2v-flash",
  "input": { "prompt": "...", "img_url": "https://..." },
  "parameters": { "size": "1280*720", "duration": 5 } }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Google Gemini — Veo 视频</template>
                <div class="ph-body">
                  <b>认证：</b>URL 参数 <code>?key=API_KEY</code><br>
                  <b>Endpoint：</b><code>POST /v1beta/models/{model}:generateVideo</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="vidu-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Vidu</template>
                <div class="ph-body">
                  <b>适用场景：</b>Vidu 官方及兼容接口<br>
                  <b>认证：</b><code>Authorization: Token {api_key}</code>（非 Bearer）<br>
                  <b>默认 Endpoint：</b><code>POST /ent/v2/img2video</code>（创建），<code>GET /ent/v2/tasks/{taskId}/creations</code>（查询）<br>
                  <pre>{ "model": "viduq3-pro",
  "images": ["https://..."],
  "prompt": "...",
  "duration": 5,
  "resolution": "720p",
  "movement_amplitude": "auto",
  "audio": false,
  "watermark": false
}</pre>
                  <b>注意：</b>官方 api.vidu.cn 用 <code>Token</code> 认证，中转站用 <code>Bearer</code>，系统自动识别。localhost 图片自动上传图床。
                </div>
              </el-collapse-item>
              <el-collapse-item name="jimeng-ai-api-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Jimeng AI API（自建服务）</template>
                <div class="ph-body">
                  <b>说明：</b>需自行部署 <code>jimeng-free-api-all</code> 等即梦 OpenAI 兼容服务并启动（如 <code>http://127.0.0.1:8000</code>）。本系统仅作为客户端转发请求。<br>
                  <b>Base URL：</b>填你的服务根地址，无尾斜杠。<br>
                  <b>API Key：</b>填即梦网页 <b>Session</b>；多个账号用<b>英文逗号</b>分隔，由对方服务轮询使用。<br>
                  <b>默认路径：</b><code>POST /v1/videos/generations</code>（可在「Endpoint」覆盖）。Seedance 多图需分镜参考图；响应为同步 <code>data[0].url</code>。
                </div>
              </el-collapse-item>
              <el-collapse-item name="minimax-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> MiniMax 海螺</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://api.minimaxi.com/v1</code><br>
                  <b>常见模型：</b><code>MiniMax-Hailuo-2.3</code>、<code>MiniMax-Hailuo-2.3-Fast</code><br>
                  预设会带入海螺视频端点。是否真正生成成功取决于密钥和后端适配，当前只提供配置目录。
                </div>
              </el-collapse-item>
              <el-collapse-item name="runway-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Runway</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://api.dev.runwayml.com/v1</code><br>
                  <b>常见模型：</b><code>gen4_turbo</code>、<code>gen4_aleph</code>、<code>gen3a_turbo</code><br>
                  接口规范可先选 OpenAI 兼容，再按 Runway 文档补端点。此条目只用于自动填表。
                </div>
              </el-collapse-item>
              <el-collapse-item name="luma-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Luma 梦境引擎</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://api.lumalabs.ai/dream-machine/v1</code><br>
                  <b>常见模型：</b><code>ray-2</code>、<code>ray-flash-2</code>、<code>ray-1-6</code><br>
                  预设不代表 Dream Machine 已在本应用中真实跑通。
                </div>
              </el-collapse-item>
              <el-collapse-item name="siliconflow-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 硅基流动 / OpenRouter 视频</template>
                <div class="ph-body">
                  <b>硅基流动：</b><code>https://api.siliconflow.cn/v1</code>，模型如 <code>Wan-AI/Wan2.1-T2V-14B</code><br>
                  <b>OpenRouter：</b><code>https://openrouter.ai/api/v1</code>，模型如 <code>openai/sora</code>
                </div>
              </el-collapse-item>
            </el-collapse>

            <div class="ph-section-title" style="margin-top:16px">语音 TTS</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-tts">
                <template #title><span class="ph-tag ph-tag-tts">语音</span> OpenAI 兼容 TTS</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://api.openai.com/v1</code><br>
                  <b>常见模型：</b><code>gpt-4o-mini-tts</code>、<code>tts-1-hd</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="minimax-tts">
                <template #title><span class="ph-tag ph-tag-tts">语音</span> MiniMax T2A</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://api.minimaxi.com/v1</code><br>
                  <b>常见模型：</b><code>speech-02-hd</code>、<code>speech-02-turbo</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="siliconflow-tts">
                <template #title><span class="ph-tag ph-tag-tts">语音</span> 硅基流动 / 通义 / 智谱 / ElevenLabs</template>
                <div class="ph-body">
                  <b>硅基流动：</b><code>https://api.siliconflow.cn/v1</code>，模型如 <code>FunAudioLLM/CosyVoice2-0.5B</code><br>
                  <b>通义：</b><code>https://dashscope.aliyuncs.com</code>，模型如 <code>qwen3-tts-flash</code><br>
                  <b>智谱：</b><code>https://open.bigmodel.cn/api/paas/v4</code>，模型如 <code>glm-tts</code><br>
                  <b>ElevenLabs：</b><code>https://api.elevenlabs.io/v1</code>，模型如 <code>eleven_multilingual_v2</code><br>
                  这些是配置目录，不代表语音合成已真实接入。
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
</template>

<style scoped>
.ph-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular, #606266);
  padding: 4px 0 6px;
  border-bottom: 1px solid var(--el-border-color-light, #ebeef5);
  margin-bottom: 4px;
}
.ph-tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
  font-weight: 600;
  vertical-align: middle;
}
.ph-tag-img {
  background: #ecf5ff;
  color: #409eff;
  border: 1px solid #b3d8ff;
}
.ph-tag-vid {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #b3e19d;
}
.ph-tag-text {
  background: #f4f4f5;
  color: #606266;
  border: 1px solid #d3d4d6;
}
.ph-tag-tts {
  background: #fdf6ec;
  color: #e6a23c;
  border: 1px solid #f5dab1;
}
.protocol-help .ph-disclaimer {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular, #606266);
  margin: 0 0 12px;
}
.protocol-help .ph-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-primary, #303133);
}
.protocol-help .ph-body pre {
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  margin: 6px 0 2px;
  white-space: pre-wrap;
  word-break: break-all;
}
.protocol-help .ph-body code {
  background: var(--ai-config-code-surface, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
