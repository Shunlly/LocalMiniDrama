export const CUSTOM_PROVIDER_SENTINEL = '__custom__'

// 预设仅用于填表，不代表已真实跑通该厂商生成。

const openAiCompatibleTextModels = [
  'gpt-6-astra',
  'gpt-5.6',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini',
]

const openAiCompatibleImageModels = [
  'gpt-image-1',
  'dall-e-3',
  'dall-e-2',
  'black-forest-labs/FLUX.1-dev',
  'black-forest-labs/FLUX.1-schnell',
  'stabilityai/stable-diffusion-3-5-large',
]

const recraftImageModels = ['recraftv4', 'recraftv4_pro', 'recraftv3', 'recraftv2']
const ideogramImageModels = ['V_3_1', 'V_3', 'V_2']
const stabilityImageModels = ['stable-image-ultra', 'sd3.5-large', 'sd3.5-large-turbo', 'stable-image-core']
const klingImageModels = ['kling-v3-omni', 'kling-v3', 'kling-image-o1', 'kling-omni-image', 'kling-image']
const falImageModels = ['fal-ai/flux/dev', 'fal-ai/flux/schnell', 'fal-ai/flux-pro', 'fal-ai/recraft-v3', 'fal-ai/nano-banana-2']
const replicateImageModels = ['black-forest-labs/flux-schnell', 'black-forest-labs/flux-dev', 'stability-ai/stable-diffusion-3.5-large']
const dashscopeImageModels = ['wan2.6-image', 'wanx2.1-t2i-plus', 'wanx2.1-t2i-turbo', 'qwen-image-edit-plus-2026-01-09', 'qwen-image-edit-plus', 'qwen-image-edit-max']
const geminiImageModels = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview']
const qwenImageModels = ['qwen-image-max', 'qwen-image-plus', 'qwen-image']
const volcengineImageModels = ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828', 'doubao-seedream-3-0-t2i-250415']
const siliconflowImageModels = ['black-forest-labs/FLUX.1-dev', 'black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-3-5-large', 'Qwen/Qwen-Image']
const openrouterImageModels = ['google/gemini-2.5-flash-image', 'black-forest-labs/flux.1-dev', 'openai/gpt-image-1']
const fireworksImageModels = ['accounts/fireworks/models/flux-1-dev-fp8', 'accounts/fireworks/models/playground-v2-5-1024px-aesthetic']
const localSdImageModels = ['flux.1-dev', 'flux.1-schnell', 'stable-diffusion-xl', 'stable-diffusion-3.5-large']
const openaiImageModels = ['gpt-image-1', 'dall-e-3', 'dall-e-2']
const nanoBananaImageModels = ['nano-banana-2', 'nano-banana-pro', 'nano-banana']
const zhipuImageModels = ['cogview-4', 'cogview-3-flash']
const agnesImageModels = ['agnes-image-2.1-flash', 'agnes-image-2.0-flash']

export const providerConfigs = {
  text: [
    { id: 'openai', name: 'OpenAI（官方）', models: openAiCompatibleTextModels },
    { id: 'azure_openai', name: 'Azure OpenAI（微软）', models: ['gpt-5.5', 'gpt-5.4', 'gpt-4.1', 'gpt-4o'] },
    { id: 'openai_compatible', name: 'OpenAI 兼容网关', models: ['gpt-4o', 'claude-sonnet-4-5', 'gemini-2.5-pro', 'deepseek-v3.2', 'qwen3-max'] },
    { id: 'openrouter', name: 'OpenRouter（聚合网关）', models: ['openai/gpt-5.5', 'openai/gpt-6-astra', 'anthropic/claude-sonnet-4.5', 'google/gemini-3-pro-preview', 'deepseek/deepseek-v4-pro', 'qwen/qwen3.8-max'] },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', models: ['deepseek-ai/DeepSeek-V4-Flash', 'zai-org/GLM-5.3', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'deepseek-ai/DeepSeek-V3.1', 'moonshotai/Kimi-K2-Instruct', 'zai-org/GLM-4.5', 'Qwen/Qwen2.5-VL-72B-Instruct'] },
    { id: 'volcengine', name: '火山引擎', models: ['deepseek-v3-2-251201', 'doubao-1-5-pro-32k-250115', 'doubao-seed-1-6-250615', 'kimi-k2-thinking-251104'] },
    { id: 'gemini', name: '谷歌 Gemini', models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'] },
    { id: 'vertex', name: 'Google Vertex AI（谷歌云）', models: ['google/gemini-3-pro-preview', 'google/gemini-3-flash-preview', 'google/gemini-2.5-pro'] },
    { id: 'deepseek', name: 'DeepSeek 深度求索', models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-0731', 'deepseek-v4-pro-0813', 'deepseek-chat', 'deepseek-reasoner'] },
    { id: 'qwen', name: '通义千问 / 阿里云百炼', models: ['qwen3.8-max', 'qwen3.8-plus', 'qwen3.8-flash', 'qwen3-max', 'qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwen-vl-max'] },
    { id: 'qianfan', name: '百度千帆', models: ['ernie-5.1', 'ernie-5.0', 'ernie-4.5-turbo-128k', 'ernie-x1.1'] },
    { id: 'sensenova', name: '商汤日日新 SenseNova', models: ['sensenova-6.7-flash-lite', 'SenseNova-V6-5-Pro', 'SenseChat-5'] },
    { id: 'tiangong', name: '昆仑天工 Skywork', models: ['SkyClaw-v1.0', 'SkyClaw-v1.0-lite', 'Skywork-3.1', 'Tiangong-3.0'] },
    { id: 'moonshot', name: 'Moonshot Kimi（月之暗面）', models: ['kimi-k3', 'kimi-k2.5', 'kimi-k2-0711-preview', 'kimi-k2-turbo-preview', 'kimi-latest', 'moonshot-v1-128k', 'moonshot-v1-32k'] },
    { id: 'zhipu', name: '智谱 GLM', models: ['glm-5.3', 'glm-5.2', 'glm-5', 'glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash', 'glm-4-plus'] },
    { id: 'minimax', name: 'MiniMax 海螺', models: ['MiniMax-M2.5', 'MiniMax-M1', 'MiniMax-Text-01', 'MiniMax-M2', 'abab6.5s-chat'] },
    { id: 'anthropic', name: 'Anthropic Claude（对话）', models: ['claude-opus-4-6', 'claude-opus-4-5', 'claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'] },
    { id: 'baichuan', name: '百川智能', models: ['Baichuan4-Turbo', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k'] },
    { id: 'yi', name: '零一万物 Yi', models: ['yi-large', 'yi-medium', 'yi-lightning', 'yi-vision'] },
    { id: 'stepfun', name: '阶跃星辰 StepFun', models: ['step-2-mini', 'step-1.5-v-mini', 'step-1o-turbo-vision'] },
    { id: 'spark', name: '讯飞星火', models: ['spark-x-1.5', '4.0Ultra', 'generalv3.5'] },
    { id: 'hunyuan', name: '腾讯混元', models: ['hunyuan-turbos-latest', 'hunyuan-large', 'hunyuan-lite'] },
    { id: 'ai360', name: '360 智脑', models: ['360gpt2-pro', '360gpt-turbo'] },
    { id: 'xai', name: 'xAI Grok（对话）', models: ['grok-4.6', 'grok-4', 'grok-3', 'grok-3-mini', 'grok-2-vision-1212'] },
    { id: 'mistral', name: 'Mistral AI（欧洲）', models: ['mistral-large-latest', 'mistral-small-latest', 'pixtral-large-latest', 'codestral-latest'] },
    { id: 'cohere', name: 'Cohere（企业对话）', models: ['command-a-plus-05-2026', 'command-a-03-2025', 'command-r-plus'] },
    { id: 'cerebras', name: 'Cerebras（高速推理）', models: ['qwen-3.8-27b', 'llama3.3-70b', 'gpt-oss-120b'] },
    { id: 'groq', name: 'Groq（高速推理）', models: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-120b'] },
    { id: 'together', name: 'Together AI（推理云）', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct-Turbo'] },
    { id: 'fireworks', name: 'Fireworks AI（推理云）', models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-v3'] },
    { id: 'novita', name: 'Novita AI（推理云）', models: ['meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-v3.1', 'qwen/qwen3-235b-a22b-instruct'] },
    { id: 'deepinfra', name: 'DeepInfra（推理云）', models: ['deepseek-ai/DeepSeek-V4-Flash-0731', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'meta-llama/Meta-Llama-3.3-70B-Instruct'] },
    { id: 'bedrock', name: 'Amazon Bedrock（亚马逊）', models: ['anthropic.claude-sonnet-4-5', 'amazon.nova-pro-v1:0', 'openai.gpt-5.5'] },
    { id: 'github_models', name: 'GitHub Models（GitHub 模型）', models: ['openai/gpt-4.1', 'openai/gpt-4o', 'meta/Llama-3.3-70B-Instruct'] },
    { id: 'perplexity', name: 'Perplexity（搜索对话）', models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-deep-research'] },
    { id: 'huggingface', name: 'Hugging Face 路由', models: ['Qwen/Qwen3-32B', 'meta-llama/Llama-3.3-70B-Instruct'] },
    { id: 'ollama', name: 'Ollama 本地模型', models: ['qwen3:8b', 'qwen3:32b', 'llama3.3:70b', 'deepseek-r1:32b', 'gemma3:27b'] },
    { id: 'lmstudio', name: 'LM Studio 本地模型', models: ['local-model', 'qwen3-32b', 'llama-3.3-70b-instruct'] },
    { id: 'vllm', name: 'vLLM 本地服务', models: ['local-model', 'qwen3-32b', 'llama-3.3-70b-instruct'] },
    { id: 'agnes', name: 'Agnes AI（艾格妮丝）', models: ['agnes-2.0-flash'] },
  ],
  image: [
    { id: 'volcengine', name: '火山引擎', models: volcengineImageModels },
    { id: 'kling', name: '可灵 Kling', models: klingImageModels },
    { id: 'nano_banana', name: 'NanoBanana（图像）', models: nanoBananaImageModels },
    { id: 'gemini', name: '谷歌 Gemini', models: geminiImageModels },
    { id: 'openai', name: 'OpenAI（官方）', models: openaiImageModels },
    { id: 'openai_compatible', name: 'OpenAI 兼容图像网关', models: openAiCompatibleImageModels },
    { id: 'openrouter', name: 'OpenRouter（聚合网关）', models: openrouterImageModels },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', models: siliconflowImageModels },
    { id: 'zhipu', name: '智谱清言', models: zhipuImageModels },
    { id: 'fireworks', name: 'Fireworks AI（推理云）', models: fireworksImageModels },
    { id: 'stability', name: 'Stability AI（图像）', models: stabilityImageModels },
    { id: 'recraft', name: 'Recraft（设计图）', models: recraftImageModels },
    { id: 'ideogram', name: 'Ideogram（文字海报）', models: ideogramImageModels },
    { id: 'replicate', name: 'Replicate（图像推理）', models: replicateImageModels },
    { id: 'fal', name: 'Fal.ai（生成推理）', models: falImageModels },
    { id: 'local_sd', name: '本地 SD/Flux 网关', models: localSdImageModels },
    { id: 'comfyui', name: 'ComfyUI 本地工作流', models: ['custom-workflow'] },
    { id: 'dashscope', name: '通义万象 / 阿里云百炼', models: dashscopeImageModels },
    { id: 'qwen_image', name: '通义千问', models: qwenImageModels },
    { id: 'agnes', name: 'Agnes AI（艾格妮丝）', models: agnesImageModels },
  ],
  storyboard_image: [
    { id: 'dashscope', name: '通义万象 / 阿里云百炼', models: dashscopeImageModels },
    { id: 'volcengine', name: '火山引擎', models: volcengineImageModels },
    { id: 'kling', name: '可灵 Kling', models: klingImageModels },
    { id: 'nano_banana', name: 'NanoBanana（图像）', models: nanoBananaImageModels },
    { id: 'gemini', name: '谷歌 Gemini', models: geminiImageModels },
    { id: 'openai', name: 'OpenAI（官方）', models: openaiImageModels },
    { id: 'openai_compatible', name: 'OpenAI 兼容图像网关', models: openAiCompatibleImageModels },
    { id: 'openrouter', name: 'OpenRouter（聚合网关）', models: openrouterImageModels },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', models: siliconflowImageModels },
    { id: 'zhipu', name: '智谱清言', models: zhipuImageModels },
    { id: 'fireworks', name: 'Fireworks AI（推理云）', models: fireworksImageModels },
    { id: 'stability', name: 'Stability AI（图像）', models: stabilityImageModels },
    { id: 'recraft', name: 'Recraft（设计图）', models: recraftImageModels },
    { id: 'ideogram', name: 'Ideogram（文字海报）', models: ideogramImageModels },
    { id: 'replicate', name: 'Replicate（图像推理）', models: replicateImageModels },
    { id: 'fal', name: 'Fal.ai（生成推理）', models: falImageModels },
    { id: 'local_sd', name: '本地 SD/Flux 网关', models: localSdImageModels },
    { id: 'comfyui', name: 'ComfyUI 本地工作流', models: ['custom-workflow'] },
    { id: 'qwen_image', name: '通义千问', models: qwenImageModels },
    { id: 'agnes', name: 'Agnes AI（艾格妮丝）', models: agnesImageModels },
  ],
  video: [
    { id: 'klingai', name: '可灵官方 Omni (api-beijing.klingai.com)', models: ['kling-v3-omni', 'kling-v3', 'kling-3.0-turbo', 'kling-video-o1'] },
    { id: 'ffir', name: '飞儿API / 可灵 Omni-Video (ffir.cn)', models: ['kling-v3-omni', 'kling-v3', 'kling-3.0-turbo', 'kling-video-o1'] },
    { id: 'kling', name: '可灵 Kling', models: ['kling-v3-omni', 'kling-v3', 'kling-3.0-turbo', 'kling-omni-video', 'kling-video', 'kling-motion-control'] },
    { id: 'vidu', name: 'Vidu 生数', models: ['viduq3-pro', 'viduq3', 'viduq3-turbo', 'viduq2', 'viduq2-pro', 'viduq2-turbo'] },
    { id: 'volces', name: '火山引擎', models: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-0-lite-i2v-250428', 'doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-1-0-pro-250528', 'doubao-seedance-1-0-pro-fast-251015'] },
    { id: 'minimax', name: 'MiniMax 海螺', models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'] },
    { id: 'runway', name: 'Runway（视频）', models: ['gen4.5', 'gen4_turbo', 'gen4_aleph', 'gen3a_turbo'] },
    { id: 'luma', name: 'Luma 梦境引擎', models: ['ray-3.2', 'ray-3', 'ray-2', 'ray-flash-2', 'ray-1-6'] },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', models: ['Wan-AI/Wan2.1-T2V-14B', 'Wan-AI/Wan2.2-T2V-A14B'] },
    { id: 'openrouter', name: 'OpenRouter（聚合网关）', models: ['openai/sora', 'google/veo-3'] },
    { id: 'gemini', name: '谷歌 Gemini（Veo）', models: ['veo-3.1-generate-preview', 'veo-3.0-generate-preview', 'veo-3.0-fast-generate-preview'] },
    { id: 'dashscope', name: '通义万相 / 阿里云百炼', models: ['wan2.6-r2v-flash', 'wan2.6-t2v', 'wan2.2-kf2v-flash', 'wan2.6-i2v-flash', 'wanx2.1-vace-plus'] },
    {
      id: 'jimeng_ai_api',
      name: 'Jimeng AI API（自建即梦免费 API）',
      models: [
        'jimeng-video-seedance-2.0',
        'seedance-2.0',
        'jimeng-video-seedance-2.0-fast',
        'jimeng-video-3.0',
        'jimeng-video-3.0-pro',
        'jimeng-video-3.5-pro',
      ],
    },
    { id: 'openai', name: 'OpenAI Sora（视频）', models: ['sora-2', 'sora-2-pro', 'sora'] },
    { id: 'xai', name: 'xAI Grok Imagine（视频）', models: ['grok-imagine-video', 'grok-imagine'] },
    { id: 'agnes', name: 'Agnes AI（艾格妮丝）', models: ['agnes-video-v2.0'] },
  ],
  tts: [
    { id: 'openai', name: 'OpenAI TTS（官方）', models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'] },
    { id: 'openai_compatible', name: 'OpenAI 兼容 TTS 网关', models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'] },
    { id: 'minimax', name: 'MiniMax T2A（语音）', models: ['speech-02-hd', 'speech-02-turbo'] },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', models: ['FunAudioLLM/CosyVoice2-0.5B', 'IndexTeam/IndexTTS-2'] },
    { id: 'dashscope', name: '通义千问语音 / 阿里云百炼', models: ['qwen3-tts-flash', 'cosyvoice-v2'] },
    { id: 'volcengine', name: '火山引擎语音', models: ['seed-tts-1.0'] },
    { id: 'zhipu', name: '智谱 GLM 语音', models: ['glm-tts'] },
    { id: 'groq', name: 'Groq 语音', models: ['playai-tts'] },
    { id: 'elevenlabs', name: 'ElevenLabs 语音', models: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'] },
  ],
  ocr: [
    { id: 'openai', name: 'OpenAI 视觉（官方）', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1'] },
    { id: 'openai_compatible', name: 'OpenAI 兼容视觉网关', models: ['gpt-4o-mini', 'gpt-4o', 'qwen-vl-max', 'gemini-2.5-flash'] },
    { id: 'azure_openai', name: 'Azure OpenAI（微软）', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1'] },
    { id: 'openrouter', name: 'OpenRouter（聚合网关）', models: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'qwen/qwen-vl-max'] },
    { id: 'gemini', name: '谷歌 Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
    { id: 'qwen', name: '通义千问 / 阿里云百炼', models: ['qwen-vl-max', 'qwen-vl-plus'] },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', models: ['Qwen/Qwen2.5-VL-72B-Instruct'] },
    { id: 'zhipu', name: '智谱 GLM 视觉', models: ['glm-4.6v', 'glm-4.5v'] },
    { id: 'ollama', name: 'Ollama 本地视觉', models: ['qwen2.5vl', 'llava', 'llama3.2-vision', 'minicpm-v'] },
    { id: 'lmstudio', name: 'LM Studio 本地视觉', models: ['qwen2.5vl', 'llava', 'local-vl-model'] },
  ],
  transcription: [
    { id: 'openai', name: 'OpenAI 语音转写（官方）', models: ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'] },
    { id: 'openai_compatible', name: 'OpenAI 兼容转写网关', models: ['whisper-1', 'gpt-4o-mini-transcribe'] },
    { id: 'azure_openai', name: 'Azure OpenAI（微软）', models: ['whisper-1', 'gpt-4o-mini-transcribe'] },
    { id: 'groq', name: 'Groq 语音转写', models: ['whisper-large-v3', 'whisper-large-v3-turbo', 'distil-whisper-large-v3-en'] },
    { id: 'qwen', name: '通义千问 / 阿里云百炼', models: ['qwen3-asr-flash', 'paraformer-v2', 'fun-asr'] },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', models: ['FunAudioLLM/SenseVoiceSmall'] },
  ],
  jimeng2_character_auth: [
    { id: 'jimeng_material_api', name: '即梦业务素材 API（/api/business/v1）', models: ['-'] },
  ],
}

export const providerProtocolMap = {
  volcengine: 'volcengine',
  volces: 'volcengine',
  volc: 'volcengine',
  nano_banana: 'nano_banana',
  dashscope: 'dashscope',
  qwen_image: 'dashscope',
  gemini: 'gemini',
  google: 'gemini',
  kling: 'kling',
  ffir: 'kling_omni',
  klingai: 'kling_omni',
  vidu: 'vidu',
  xai: 'xai',
  grok: 'xai',
  jimeng_ai_api: 'jimeng_ai_api',
  jimeng_material_api: '',
  minimax: 'minimax',
  comfyui: 'comfyui',
  fal: 'fal',
  replicate: 'replicate',
}

const openAiCompatibleProviders = new Set([
  'openai',
  'openai_compatible',
  'azure_openai',
  'openrouter',
  'siliconflow',
  'moonshot',
  'zhipu',
  'baichuan',
  'yi',
  'mistral',
  'groq',
  'together',
  'perplexity',
  'ollama',
  'lmstudio',
  'qwen',
  'deepseek',
  'agnes',
  'local_sd',
  'anthropic',
  'fireworks',
  'stepfun',
  'spark',
  'hunyuan',
  'ai360',
  'novita',
  'huggingface',
  'vllm',
  'recraft',
  'ideogram',
  'stability',
  'runway',
  'luma',
  'elevenlabs',
  'bedrock',
  'vertex',
  'cohere',
  'cerebras',
  'deepinfra',
  'github_models',
  'qianfan',
  'sensenova',
  'tiangong',
])

export function getProviderProtocol(provider, serviceType = '') {
  if (!provider) return ''
  const p = String(provider).toLowerCase()
  const st = String(serviceType || '').toLowerCase()
  if (st === 'video' && p === 'openai') return 'sora'
  if (st === 'video' && (p === 'minimax' || p === 'hailuo')) return 'minimax'
  if (st === 'video' && (p === 'agnes')) return 'agnes'
  if (st === 'text' || st === 'ocr' || st === 'transcription') return 'openai'
  if ((st === 'image' || st === 'storyboard_image') && openAiCompatibleProviders.has(p)) return 'openai'
  if (st === 'tts' && (p === 'openai' || p === 'openai_compatible' || openAiCompatibleProviders.has(p))) return 'openai'
  if (openAiCompatibleProviders.has(p) && !providerProtocolMap[p]) return 'openai'
  return providerProtocolMap[p] || 'openai'
}

export function getBaseUrlForProvider(provider, serviceType = '') {
  if (!provider) return ''
  const p = String(provider).toLowerCase()
  const st = String(serviceType || '').toLowerCase()
  if ((p === 'gemini' || p === 'google') && (st === 'text' || st === 'ocr' || st === 'transcription')) return 'https://generativelanguage.googleapis.com/v1beta/openai'
  if (p === 'gemini' || p === 'google') return 'https://generativelanguage.googleapis.com'
  if (p === 'minimax' || p === 'hailuo') return 'https://api.minimaxi.com/v1'
  if (p === 'volces' || p === 'volcengine') return 'https://ark.cn-beijing.volces.com/api/v3'
  if (p === 'openai' || p === 'openai_compatible') return 'https://api.openai.com/v1'
  if (p === 'azure' || p === 'azure_openai') return 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1'
  if (p === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (p === 'siliconflow') return 'https://api.siliconflow.cn/v1'
  if (p === 'deepseek') return 'https://api.deepseek.com'
  if (p === 'moonshot') return 'https://api.moonshot.cn/v1'
  if (p === 'zhipu') return 'https://open.bigmodel.cn/api/paas/v4'
  if (p === 'baichuan') return 'https://api.baichuan-ai.com/v1'
  if (p === 'yi') return 'https://api.lingyiwanwu.com/v1'
  if (p === 'xai' || p === 'grok') return st === 'video' ? 'https://api.x.ai' : 'https://api.x.ai/v1'
  if (p === 'mistral') return 'https://api.mistral.ai/v1'
  if (p === 'groq') return 'https://api.groq.com/openai/v1'
  if (p === 'together') return 'https://api.together.xyz/v1'
  if (p === 'perplexity') return 'https://api.perplexity.ai'
  if (p === 'anthropic') return 'https://api.anthropic.com/v1'
  if (p === 'fireworks') return 'https://api.fireworks.ai/inference/v1'
  if (p === 'stepfun') return 'https://api.stepfun.com/v1'
  if (p === 'spark') return 'https://spark-api-open.xf-yun.com/v1'
  if (p === 'hunyuan') return 'https://api.hunyuan.cloud.tencent.com/v1'
  if (p === 'ai360') return 'https://api.360.cn/v1'
  if (p === 'novita') return 'https://api.novita.ai/v3/openai'
  if (p === 'huggingface') return 'https://router.huggingface.co/v1'
  if (p === 'vllm') return 'http://127.0.0.1:8000/v1'
  if (p === 'runway') return 'https://api.dev.runwayml.com/v1'
  if (p === 'luma') return 'https://api.lumalabs.ai/dream-machine/v1'
  if (p === 'recraft') return 'https://external.api.recraft.ai/v1'
  if (p === 'ideogram') return 'https://api.ideogram.ai'
  if (p === 'stability') return 'https://api.stability.ai'
  if (p === 'elevenlabs') return 'https://api.elevenlabs.io/v1'
  if (p === 'ollama') return 'http://127.0.0.1:11434/v1'
  if (p === 'lmstudio') return 'http://127.0.0.1:1234/v1'
  if (p === 'dashscope') return 'https://dashscope.aliyuncs.com'
  if (p === 'qwen_image') return 'https://dashscope.aliyuncs.com'
  if (p === 'qwen') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  if (p === 'local_sd') return 'http://127.0.0.1:7860/v1'
  if (p === 'comfyui') return 'http://127.0.0.1:8188'
  if (p === 'nano_banana') return 'https://api.nanobananaapi.ai'
  if (p === 'vidu') return 'https://api.vidu.cn'
  if (p === 'kling') return 'https://api.klingai.com'
  if (p === 'klingai') return 'https://api-beijing.klingai.com'
  if (p === 'ffir') return 'https://ffir.cn'
  if (p === 'jimeng_ai_api') return 'http://127.0.0.1:8000'
  if (p === 'jimeng_material_api') return 'https://silvamux.tingyutech.com'
  if (p === 'agnes') return 'https://apihub.agnes-ai.com/v1'
  if (p === 'bedrock' || p === 'amazon_bedrock') return 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1'
  if (p === 'vertex' || p === 'vertex_ai') return 'https://aiplatform.googleapis.com/v1/projects/YOUR-PROJECT/locations/global/endpoints/openapi'
  if (p === 'cohere') return 'https://api.cohere.ai/compatibility/v1'
  if (p === 'cerebras') return 'https://api.cerebras.ai/v1'
  if (p === 'deepinfra') return 'https://api.deepinfra.com/v1/openai'
  if (p === 'github_models') return 'https://models.github.ai/inference'
  if (p === 'qianfan') return 'https://qianfan.baidubce.com/v2'
  if (p === 'sensenova') return 'https://token.sensenova.cn/v1'
  if (p === 'tiangong' || p === 'skywork') return 'https://api-maas.singularity-ai.com/sky-work/api/v1'
  if (p === 'replicate') return 'https://api.replicate.com/v1'
  if (p === 'fal' || p === 'fal_ai') return 'https://queue.fal.run'
  return ''
}

export function getProviderEndpointDefaults(provider, serviceType = '', protocol = '') {
  const p = String(provider || '').toLowerCase()
  const st = String(serviceType || '').toLowerCase()
  const proto = String(protocol || getProviderProtocol(p, st) || '').toLowerCase()
  if (st === 'text' || st === 'ocr') return { endpoint: '/chat/completions', query_endpoint: '' }
  if (st === 'transcription') return { endpoint: '/audio/transcriptions', query_endpoint: '' }
  if ((st === 'image' || st === 'storyboard_image') && (p === 'comfyui' || proto === 'comfyui')) {
    return { endpoint: '/prompt', query_endpoint: '/history/{promptId}' }
  }
  if (st === 'video' && p === 'jimeng_ai_api') return { endpoint: '', query_endpoint: '' }
  if (st === 'video' && p === 'ffir') {
    return { endpoint: '/kling/v1/videos/omni-video', query_endpoint: '/kling/v1/images/omni-image/{taskId}' }
  }
  if (st === 'video' && p === 'klingai') {
    return { endpoint: '/v1/videos/omni-video', query_endpoint: '/v1/videos/omni-video/{taskId}' }
  }
  if (st === 'video' && p === 'agnes') {
    return { endpoint: '/videos', query_endpoint: '/videos/{taskId}' }
  }
  if (st === 'video' && (p === 'minimax' || proto === 'minimax')) {
    return { endpoint: '/video_generation', query_endpoint: '/query/video_generation/{taskId}' }
  }
  if (st === 'video' && proto === 'sora') {
    return { endpoint: '/v1/videos', query_endpoint: '/v1/videos/{taskId}' }
  }
  return { endpoint: '', query_endpoint: '' }
}

export function isApiKeyOptionalProvider(provider, protocol = '') {
  const p = String(provider || '').trim().toLowerCase()
  const proto = String(protocol || '').trim().toLowerCase()
  return p === 'ollama' || p === 'lmstudio' || p === 'vllm' || p === 'comfyui' || proto === 'comfyui'
}
