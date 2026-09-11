/**
 * AI 配置预设帮助的文案数据。主折叠组件只负责容器，厂商段落从这里读取。
 */

function b(bold) {
  return { bold }
}

function c(code) {
  return { code }
}

function line(...parts) {
  return {
    type: 'line',
    parts: parts.map((part) => (typeof part === 'string' ? { text: part } : part)),
  }
}

function pre(text) {
  return { type: 'pre', text }
}

export const PRESET_HELP_TAG = Object.freeze({
  text: Object.freeze({ label: '文本', className: 'ph-tag-text' }),
  img: Object.freeze({ label: '图片', className: 'ph-tag-img' }),
  vid: Object.freeze({ label: '视频', className: 'ph-tag-vid' }),
  tts: Object.freeze({ label: '语音', className: 'ph-tag-tts' }),
  ocr: Object.freeze({ label: '识别', className: 'ph-tag-ocr' }),
  asr: Object.freeze({ label: '转写', className: 'ph-tag-asr' }),
})

export const PRESET_HELP_DISCLAIMER = "选择预设只会自动填入公开 Base URL 和常见模型名，方便保存配置。以下说明用于对照填写，不代表本应用已真实接入或跑通对应厂商的图片、视频、语音、识别或转写。"

export const PRESET_HELP_SECTIONS = Object.freeze([
    {
      id: "text",
      title: "文本 / OpenAI 兼容",
      items: [
      {
        name: "openai-text",
        tag: "text",
        title: "OpenAI 兼容网关",
        body: [
          line(b("适用："), "OpenAI 官方、OpenAI 兼容网关、多数中转站。"),
          line(b("Base URL："), c("https://api.openai.com/v1")),
          line(b("常见模型："), c("gpt-5.5"), "、", c("gpt-4.1"), "、", c("gpt-4o-mini")),
          line("文本服务默认走 ", c("/chat/completions"), "。自定义网关请改 Base URL，不要改服务类型。"),
        ],
      },
      {
        name: "openrouter-text",
        tag: "text",
        title: "OpenRouter 聚合网关",
        body: [
          line(b("Base URL："), c("https://openrouter.ai/api/v1")),
          line(b("常见模型："), c("openai/gpt-5.5"), "、", c("anthropic/claude-sonnet-4.5"), "、", c("google/gemini-3-pro-preview")),
          line("模型名通常带厂商前缀。选此预设只填表，实际能否对话取决于你的密钥和网关。"),
        ],
      },
      {
        name: "siliconflow-text",
        tag: "text",
        title: "硅基流动 SiliconFlow",
        body: [
          line(b("Base URL："), c("https://api.siliconflow.cn/v1")),
          line(b("常见模型："), c("Qwen/Qwen3-235B-A22B-Instruct-2507"), "、", c("deepseek-ai/DeepSeek-V3.1"), "、", c("moonshotai/Kimi-K2-Instruct")),
        ],
      },
      {
        name: "qwen-text",
        tag: "text",
        title: "通义千问 / 阿里云百炼",
        body: [
          line(b("Base URL："), c("https://dashscope.aliyuncs.com/compatible-mode/v1")),
          line(b("常见模型："), c("qwen3.8-max"), "、", c("qwen-plus"), "、", c("qwen-flash")),
          line("国内访问较稳。选此预设只填表，实际对话取决于密钥和已开通的模型。"),
        ],
      },
      {
        name: "volcengine-text",
        tag: "text",
        title: "火山引擎方舟",
        body: [
          line(b("Base URL："), c("https://ark.cn-beijing.volces.com/api/v3")),
          line(b("常见模型："), "填方舟控制台的接入点 ID，例如 ", c("deepseek-v3-2-251201"), "，不要填展示名。"),
          line("推荐用于国内文本生成。预设不代表已真实接入。"),
        ],
      },
      {
        name: "cn-cloud-text",
        tag: "text",
        title: "Moonshot / DeepSeek / 智谱 / MiniMax",
        body: [
          line(b("Moonshot："), c("https://api.moonshot.cn/v1"), "，模型如 ", c("kimi-k2-0711-preview")),
          line(b("DeepSeek："), c("https://api.deepseek.com"), "，模型如 ", c("deepseek-chat"), "、", c("deepseek-reasoner")),
          line(b("智谱 GLM："), c("https://open.bigmodel.cn/api/paas/v4"), "，模型如 ", c("glm-4.5"), "、", c("glm-4.6")),
          line(b("MiniMax："), c("https://api.minimaxi.com/v1"), "，文本模型如 ", c("MiniMax-M1"), "。视频海螺请改选视频服务类型。"),
        ],
      },
      {
        name: "ollama-text",
        tag: "text",
        title: "Ollama / LM Studio / vLLM 本地",
        body: [
          line(b("Ollama："), c("http://127.0.0.1:11434/v1"), "，模型如 ", c("qwen3:8b"), "。本地服务通常可不填 API Key。"),
          line(b("LM Studio："), c("http://127.0.0.1:1234/v1")),
          line(b("vLLM："), c("http://127.0.0.1:8000/v1")),
          line("请先在本机启动对应服务。保存时请使用本机地址，例如 127.0.0.1。"),
        ],
      },
      {
        name: "agnes-suite",
        tag: "text",
        title: "Agnes AI（一键配置）",
        body: [
          line(b("Base URL："), c("https://apihub.agnes-ai.com/v1")),
          line(b("常见模型："), "文本 ", c("agnes-2.0-flash"), "，图片 ", c("agnes-image-2.1-flash"), "，视频 ", c("agnes-video-v2.0"), "。"),
          line("可用页面「一键配置 Agnes」同时创建文本、图片、视频三类配置。只填表，不代表已真实跑通生成。"),
        ],
      },
      ],
    },
    {
      id: "image",
      title: "🖼 图片 / 分镜图 协议",
      items: [
      {
        name: "openai-img",
        tag: "img",
        title: "OpenAI 兼容 — 绝大多数中转站默认",
        body: [
          line(b("适用场景："), "OpenAI 官方、各类中转/代理站（ChatFire、硅基流动等）"),
          line(b("Endpoint："), c("POST /v1/images/generations")),
          pre("{ \"model\": \"dall-e-3\", \"prompt\": \"...\", \"n\": 1, \"size\": \"1024x1024\" }"),
        ],
      },
      {
        name: "volcengine-img",
        tag: "img",
        title: "火山引擎 — 豆包 Seedream",
        body: [
          line(b("Endpoint："), c("POST /api/v3/images/generations")),
          line(b("Base URL："), c("https://ark.cn-beijing.volces.com/api/v3")),
          pre("{ \"model\": \"doubao-seedream-4-5-251128\", \"prompt\": \"...\", \"size\": \"1024x1024\" }"),
        ],
      },
      {
        name: "dashscope-img",
        tag: "img",
        title: "通义万象 DashScope",
        body: [
          line(b("Base URL："), c("https://dashscope.aliyuncs.com")),
          line(b("Endpoint："), c("POST /api/v1/services/aigc/text2image/image-synthesis")),
        ],
      },
      {
        name: "gemini-img",
        tag: "img",
        title: "Google Gemini",
        body: [
          line(b("认证："), "URL 参数 ", c("?key=API_KEY")),
          line(b("Endpoint："), c("POST /v1beta/models/{model}:generateContent")),
        ],
      },
      {
        name: "siliconflow-img",
        tag: "img",
        title: "硅基流动 / OpenRouter 图像",
        body: [
          line(b("硅基流动："), c("https://api.siliconflow.cn/v1"), "，模型如 ", c("black-forest-labs/FLUX.1-dev"), "、", c("Qwen/Qwen-Image")),
          line(b("OpenRouter："), c("https://openrouter.ai/api/v1"), "，模型如 ", c("google/gemini-2.5-flash-image")),
          line("接口规范可选 OpenAI 兼容。这只是目录预设，不代表生图链路已官方跑通。"),
        ],
      },
      {
        name: "kling-img",
        tag: "img",
        title: "可灵 Kling 图像",
        body: [
          line(b("Base URL："), c("https://api.klingai.com")),
          line(b("常见模型："), c("kling-image"), "、", c("kling-omni-image")),
        ],
      },
      {
        name: "comfyui-img",
        tag: "img",
        title: "ComfyUI 本地工作流",
        body: [
          line(b("Base URL："), c("http://127.0.0.1:8188")),
          line(b("默认路径："), "提交 ", c("/prompt"), "，查询 ", c("/history/{promptId}")),
          line("本地工作流通常可不填 API Key。请先启动 ComfyUI。模型栏可保留 ", c("custom-workflow"), "。"),
        ],
      },
      ],
    },
    {
      id: "video",
      title: "🎬 视频 协议",
      items: [
      {
        name: "openai-vid",
        tag: "vid",
        title: "OpenAI 兼容 — content 数组格式",
        body: [
          line(b("适用场景："), "各类中转站视频接口（ChatFire 等）"),
          line(b("Endpoint："), "自定义，如 ", c("POST /v1/video/create")),
          pre("{ \"model\": \"sora-2-pro\",\n  \"content\": [\n    { \"type\": \"text\", \"text\": \"...\" },\n    { \"type\": \"image_url\", \"image_url\": { \"url\": \"https://...\" }, \"role\": \"reference_image\" }\n  ],\n  \"ratio\": \"9:16\", \"duration\": 5, \"watermark\": false, \"resolution\": \"720p\" }"),
        ],
      },
      {
        name: "sora-vid",
        tag: "vid",
        title: "Sora 中转站 — multipart/form-data",
        body: [
          line(b("适用场景："), "Sora API 格式的中转站"),
          line(b("默认 Endpoint："), c("POST /v1/videos"), "（创建），", c("GET /v1/videos/{taskId}"), "（查询）"),
          line(b("请求格式："), "multipart/form-data（非 JSON）"),
          pre("model       = \"sora-2\"\nprompt      = \"...\"\nseconds     = \"4\" | \"8\" | \"12\"\nsize        = \"720x1280\" | \"1280x720\" | \"1024x1792\" | \"1792x1024\"\nwatermark   = \"false\"\nprivate     = \"false\"\ninput_reference = (图片文件，可选)"),
          line(b("注意："), "参考图会自动 resize 到与 size 一致后上传。"),
        ],
      },
      {
        name: "veo3-vid",
        tag: "vid",
        title: "Veo3 兼容 — images + enhance_prompt",
        body: [
          line(b("适用场景："), "Veo3 系列模型的 JSON 格式接口"),
          line(b("默认 Endpoint："), c("POST /v1/video/create"), "（创建），", c("GET /v1/video/query?id={taskId}"), "（查询）"),
          pre("{ \"model\": \"veo3.1\",\n  \"prompt\": \"...\",\n  \"enhance_prompt\": true,\n  \"images\": [\"data:image/jpeg;base64,...\"]\n}"),
          line(b("注意："), c("enhance_prompt: true"), " 会让接口自动将提示词翻译为英文。localhost 图片会自动转为 base64 内嵌。"),
        ],
      },
      {
        name: "volcengine-vid",
        tag: "vid",
        title: "火山引擎 — 豆包 Seedance",
        body: [
          line(b("Endpoint："), c("POST …/contents/generations/tasks"), "（与后端一致）"),
          line(b("Base URL："), c("https://ark.cn-beijing.volces.com/api/v3")),
          pre("{ \"model\": \"doubao-seedance-1-5-pro-251215\",\n  \"content\": [{ \"type\": \"text\", \"text\": \"...\" }],\n  \"ratio\": \"9:16\", \"duration\": 5,\n  \"watermark\": false, \"resolution\": \"720p\" }"),
        ],
      },
      {
        name: "volcengine-omni-vid",
        tag: "vid",
        title: "火山即梦 Seedance 全能（多图参考）",
        body: [
          line(b("适用："), "方舟 Seedance 2.0 等支持多参考图的全能链路；与「全能模式」分镜、", c("@图片1"), "… 提示词配合使用。"),
          line(b("Endpoint："), c("POST {base}/contents/generations/tasks"), "，轮询 ", c("GET {base}/contents/generations/tasks/{taskId}")),
          line(b("厂商："), "仍选「火山引擎」，", b("接口规范"), "选本项；模型填控制台接入点（如 ", c("doubao-seedance-2-0-260128"), "，以控制台为准）。"),
          pre("{ \"model\": \"doubao-seedance-2-0-260128\",\n  \"task_type\": \"i2v\",\n  \"content\": [\n    { \"type\": \"text\", \"text\": \"… @图片1 … @图片2 …\" },\n    { \"type\": \"image_url\", \"image_url\": { \"url\": \"https://...\" } },\n    { \"type\": \"image_url\", \"image_url\": { \"url\": \"https://...\" }, \"role\": \"reference_image\" }\n  ],\n  \"ratio\": \"9:16\", \"duration\": 8, \"watermark\": false }"),
          line(b("说明："), "全能模式下列均为参考图（场景、角色…），每张均 ", c("role: reference_image"), "；最多 9 张，时长 Seedance 2.x 按 4–15 秒吸附。"),
        ],
      },
      {
        name: "dashscope-vid",
        tag: "vid",
        title: "通义万象 DashScope",
        body: [
          line(b("Base URL："), c("https://dashscope.aliyuncs.com")),
          line(b("Endpoint："), c("POST /api/v1/services/aigc/video-generation/video-synthesis")),
          pre("{ \"model\": \"wan2.2-kf2v-flash\",\n  \"input\": { \"prompt\": \"...\", \"img_url\": \"https://...\" },\n  \"parameters\": { \"size\": \"1280*720\", \"duration\": 5 } }"),
        ],
      },
      {
        name: "gemini-vid",
        tag: "vid",
        title: "Google Gemini — Veo 视频",
        body: [
          line(b("认证："), "URL 参数 ", c("?key=API_KEY")),
          line(b("Endpoint："), c("POST /v1beta/models/{model}:generateVideo")),
        ],
      },
      {
        name: "kling-vid",
        tag: "vid",
        title: "可灵 Kling 视频",
        body: [
          line(b("Base URL："), c("https://api.klingai.com"), " 或区域地址 ", c("api-beijing.klingai.com"), " / ", c("api-singapore.klingai.com"), "，须与密钥所属区域一致。"),
          line(b("常见模型："), c("kling-v3-omni"), "、", c("kling-video"), "、", c("kling-omni-video")),
          line("可灵图片和视频是不同服务类型。选此预设只填表，不代表视频生成已真实跑通。"),
        ],
      },
      {
        name: "vidu-vid",
        tag: "vid",
        title: "Vidu",
        body: [
          line(b("适用场景："), "Vidu 官方及兼容接口"),
          line(b("认证："), c("Authorization: Token {api_key}"), "（非 Bearer）"),
          line(b("默认 Endpoint："), c("POST /ent/v2/img2video"), "（创建），", c("GET /ent/v2/tasks/{taskId}/creations"), "（查询）"),
          pre("{ \"model\": \"viduq3-pro\",\n  \"images\": [\"https://...\"],\n  \"prompt\": \"...\",\n  \"duration\": 5,\n  \"resolution\": \"720p\",\n  \"movement_amplitude\": \"auto\",\n  \"audio\": false,\n  \"watermark\": false\n}"),
          line(b("注意："), "官方 api.vidu.cn 用 ", c("Token"), " 认证，中转站用 ", c("Bearer"), "，系统自动识别。localhost 图片自动上传图床。"),
        ],
      },
      {
        name: "jimeng-ai-api-vid",
        tag: "vid",
        title: "Jimeng AI API（自建服务）",
        body: [
          line(b("说明："), "需自行部署 ", c("jimeng-free-api-all"), " 等即梦 OpenAI 兼容服务并启动（如 ", c("http://127.0.0.1:8000"), "）。本系统仅作为客户端转发请求。"),
          line(b("Base URL："), "填你的服务根地址，无尾斜杠。"),
          line(b("API Key："), "填即梦网页 ", b("Session"), "；多个账号用", b("英文逗号"), "分隔，由对方服务轮询使用。"),
          line(b("默认路径："), c("POST /v1/videos/generations"), "（可在「Endpoint」覆盖）。Seedance 多图需分镜参考图；响应为同步 ", c("data[0].url"), "。"),
        ],
      },
      {
        name: "minimax-vid",
        tag: "vid",
        title: "MiniMax 海螺",
        body: [
          line(b("Base URL："), c("https://api.minimaxi.com/v1")),
          line(b("常见模型："), c("MiniMax-Hailuo-2.3"), "、", c("MiniMax-Hailuo-2.3-Fast")),
          line("预设会带入海螺视频端点。是否真正生成成功取决于密钥和后端适配，当前只提供配置目录。"),
        ],
      },
      {
        name: "runway-vid",
        tag: "vid",
        title: "Runway",
        body: [
          line(b("Base URL："), c("https://api.dev.runwayml.com/v1")),
          line(b("常见模型："), c("gen4_turbo"), "、", c("gen4_aleph"), "、", c("gen3a_turbo")),
          line("接口规范可先选 OpenAI 兼容，再按 Runway 文档补端点。此条目只用于自动填表。"),
        ],
      },
      {
        name: "luma-vid",
        tag: "vid",
        title: "Luma 梦境引擎",
        body: [
          line(b("Base URL："), c("https://api.lumalabs.ai/dream-machine/v1")),
          line(b("常见模型："), c("ray-2"), "、", c("ray-flash-2"), "、", c("ray-1-6")),
          line("预设不代表 Dream Machine 已在本应用中真实跑通。"),
        ],
      },
      {
        name: "siliconflow-vid",
        tag: "vid",
        title: "硅基流动 / OpenRouter 视频",
        body: [
          line(b("硅基流动："), c("https://api.siliconflow.cn/v1"), "，模型如 ", c("Wan-AI/Wan2.1-T2V-14B")),
          line(b("OpenRouter："), c("https://openrouter.ai/api/v1"), "，模型如 ", c("openai/sora")),
        ],
      },
      ],
    },
    {
      id: "tts",
      title: "语音 TTS",
      items: [
      {
        name: "openai-tts",
        tag: "tts",
        title: "OpenAI 兼容 TTS",
        body: [
          line(b("Base URL："), c("https://api.openai.com/v1")),
          line(b("常见模型："), c("gpt-4o-mini-tts"), "、", c("tts-1-hd")),
        ],
      },
      {
        name: "minimax-tts",
        tag: "tts",
        title: "MiniMax T2A",
        body: [
          line(b("Base URL："), c("https://api.minimaxi.com/v1")),
          line(b("常见模型："), c("speech-02-hd"), "、", c("speech-02-turbo")),
        ],
      },
      {
        name: "siliconflow-tts",
        tag: "tts",
        title: "硅基流动 / 通义 / 智谱 / ElevenLabs",
        body: [
          line(b("硅基流动："), c("https://api.siliconflow.cn/v1"), "，模型如 ", c("FunAudioLLM/CosyVoice2-0.5B")),
          line(b("通义："), c("https://dashscope.aliyuncs.com"), "，模型如 ", c("qwen3-tts-flash")),
          line(b("智谱："), c("https://open.bigmodel.cn/api/paas/v4"), "，模型如 ", c("glm-tts")),
          line(b("ElevenLabs："), c("https://api.elevenlabs.io/v1"), "，模型如 ", c("eleven_multilingual_v2")),
          line("这些是配置目录，不代表语音合成已真实接入。"),
        ],
      },
      ],
    },
    {
      id: "ocr",
      title: "图片识别 OCR",
      items: [
      {
        name: "openai-ocr",
        tag: "ocr",
        title: "OpenAI 兼容视觉",
        body: [
          line(b("适用："), "PDF/图片抽文字。通常走视觉对话接口 ", c("/chat/completions"), "，而不是单独的 OCR 接口。"),
          line(b("Base URL："), "与文本配置相同，例如 ", c("https://api.openai.com/v1"), " 或兼容网关。"),
          line(b("常见模型："), c("gpt-4o-mini"), "、", c("gpt-4o"), "、", c("qwen-vl-max")),
          line("下一步：添加一个配置并设为默认，即可用于素材抽取。预设不代表识别已真实跑通。"),
        ],
      },
      {
        name: "qwen-ocr",
        tag: "ocr",
        title: "通义千问视觉 / 本地视觉",
        body: [
          line(b("通义："), c("https://dashscope.aliyuncs.com/compatible-mode/v1"), "，模型如 ", c("qwen-vl-max"), "、", c("qwen-vl-plus")),
          line(b("Ollama："), c("http://127.0.0.1:11434/v1"), "，模型如 ", c("qwen2.5vl"), "、", c("llava"), "。请先在本机启动服务。"),
          line("没有模型目录时，可直接输入视觉模型名。"),
        ],
      },
      ],
    },
    {
      id: "transcription",
      title: "语音转写",
      items: [
      {
        name: "openai-transcription",
        tag: "asr",
        title: "OpenAI 兼容转写",
        body: [
          line(b("适用："), "音频/视频转写。通常走 ", c("/audio/transcriptions"), "，而不是对话接口。"),
          line(b("Base URL："), "与文本配置相同，例如 ", c("https://api.openai.com/v1"), " 或兼容网关。"),
          line(b("常见模型："), c("whisper-1"), "、", c("gpt-4o-mini-transcribe")),
          line("下一步：添加一个配置并设为默认，即可用于音视频素材抽取。预设不代表转写已真实跑通。"),
        ],
      },
      {
        name: "qwen-transcription",
        tag: "asr",
        title: "通义千问 / Groq 转写",
        body: [
          line(b("通义："), c("https://dashscope.aliyuncs.com/compatible-mode/v1"), "，模型如 ", c("qwen3-asr-flash"), "、", c("paraformer-v2")),
          line(b("Groq："), c("https://api.groq.com/openai/v1"), "，模型如 ", c("whisper-large-v3")),
          line("没有模型目录时，可直接输入转写模型名。"),
        ],
      },
      ],
    },

])

export function listPresetHelpItems() {
  return PRESET_HELP_SECTIONS.flatMap((section) => section.items)
}

export function getPresetHelpItem(name) {
  return listPresetHelpItems().find((item) => item.name === name) || null
}
