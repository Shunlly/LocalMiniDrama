export const CUSTOM_PROVIDER_SENTINEL = '__custom__'

const openAiCompatibleTextModels = [
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

export const providerConfigs = {
  text: [
    { id: 'openai', name: 'OpenAI', models: openAiCompatibleTextModels },
    { id: 'openai_compatible', name: 'OpenAI 兼容网关', models: ['gpt-4o', 'claude-sonnet-4-5', 'gemini-2.5-pro', 'deepseek-v3.2', 'qwen3-max'] },
    { id: 'openrouter', name: 'OpenRouter', models: ['openai/gpt-5.5', 'anthropic/claude-sonnet-4.5', 'google/gemini-3-pro-preview', 'deepseek/deepseek-v3.2', 'qwen/qwen3-max'] },
    { id: 'siliconflow', name: 'SiliconFlow', models: ['Qwen/Qwen3-235B-A22B-Instruct-2507', 'deepseek-ai/DeepSeek-V3.1', 'moonshotai/Kimi-K2-Instruct', 'zai-org/GLM-4.5', 'Qwen/Qwen2.5-VL-72B-Instruct'] },
    { id: 'volcengine', name: '火山引擎', models: ['deepseek-v3-2-251201', 'doubao-1-5-pro-32k-250115', 'doubao-seed-1-6-250615', 'kimi-k2-thinking-251104'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'] },
    { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'] },
    { id: 'qwen', name: '通义千问', models: ['qwen3-max', 'qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwen-vl-max'] },
    { id: 'moonshot', name: 'Moonshot Kimi', models: ['kimi-k2-0711-preview', 'kimi-latest', 'moonshot-v1-128k', 'moonshot-v1-32k'] },
    { id: 'zhipu', name: '智谱 GLM', models: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus', 'glm-4-flash'] },
    { id: 'baichuan', name: '百川智能', models: ['Baichuan4-Turbo', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k'] },
    { id: 'yi', name: '零一万物 Yi', models: ['yi-large', 'yi-medium', 'yi-lightning', 'yi-vision'] },
    { id: 'xai', name: 'xAI Grok', models: ['grok-4', 'grok-3', 'grok-3-mini', 'grok-2-vision-1212'] },
    { id: 'mistral', name: 'Mistral AI', models: ['mistral-large-latest', 'mistral-small-latest', 'pixtral-large-latest', 'codestral-latest'] },
    { id: 'groq', name: 'Groq', models: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-120b'] },
    { id: 'together', name: 'Together AI', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct-Turbo'] },
    { id: 'perplexity', name: 'Perplexity', models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-deep-research'] },
    { id: 'ollama', name: 'Ollama 本地模型', models: ['qwen3:8b', 'qwen3:32b', 'llama3.3:70b', 'deepseek-r1:32b', 'gemma3:27b'] },
    { id: 'lmstudio', name: 'LM Studio 本地模型', models: ['local-model', 'qwen3-32b', 'llama-3.3-70b-instruct'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-2.0-flash'] },
  ],
  image: [
    { id: 'volcengine', name: '火山引擎', models: ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828', 'doubao-seedream-3-0-t2i-250415'] },
    { id: 'kling', name: '可灵 Kling', models: ['kling-image', 'kling-omni-image'] },
    { id: 'nano_banana', name: 'NanoBanana', models: ['nano-banana-2', 'nano-banana-pro', 'nano-banana'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
    { id: 'openai', name: 'OpenAI', models: ['gpt-image-1', 'dall-e-3', 'dall-e-2'] },
    { id: 'openai_compatible', name: 'OpenAI 兼容图像网关', models: openAiCompatibleImageModels },
    { id: 'siliconflow', name: 'SiliconFlow 图像', models: ['black-forest-labs/FLUX.1-dev', 'black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-3-5-large', 'Qwen/Qwen-Image'] },
    { id: 'local_sd', name: '本地 SD/Flux 网关', models: ['flux.1-dev', 'flux.1-schnell', 'stable-diffusion-xl', 'stable-diffusion-3.5-large'] },
    { id: 'comfyui', name: 'ComfyUI 本地工作流', models: ['custom-workflow'] },
    { id: 'dashscope', name: '通义万象', models: ['wan2.6-image', 'wanx2.1-t2i-plus', 'wanx2.1-t2i-turbo', 'qwen-image-edit-plus-2026-01-09', 'qwen-image-edit-plus', 'qwen-image-edit-max'] },
    { id: 'qwen_image', name: '通义千问', models: ['qwen-image-max', 'qwen-image-plus', 'qwen-image'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'] },
  ],
  storyboard_image: [
    { id: 'dashscope', name: '通义万象', models: ['wan2.6-image', 'wanx2.1-t2i-plus', 'wanx2.1-t2i-turbo', 'qwen-image-edit-plus-2026-01-09', 'qwen-image-edit-plus', 'qwen-image-edit-max'] },
    { id: 'volcengine', name: '火山引擎', models: ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828', 'doubao-seedream-3-0-t2i-250415'] },
    { id: 'kling', name: '可灵 Kling', models: ['kling-image', 'kling-omni-image'] },
    { id: 'nano_banana', name: 'NanoBanana', models: ['nano-banana-2', 'nano-banana-pro', 'nano-banana'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
    { id: 'openai', name: 'OpenAI', models: ['gpt-image-1', 'dall-e-3', 'dall-e-2'] },
    { id: 'openai_compatible', name: 'OpenAI 兼容图像网关', models: openAiCompatibleImageModels },
    { id: 'siliconflow', name: 'SiliconFlow 图像', models: ['black-forest-labs/FLUX.1-dev', 'black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-3-5-large', 'Qwen/Qwen-Image'] },
    { id: 'local_sd', name: '本地 SD/Flux 网关', models: ['flux.1-dev', 'flux.1-schnell', 'stable-diffusion-xl', 'stable-diffusion-3.5-large'] },
    { id: 'comfyui', name: 'ComfyUI 本地工作流', models: ['custom-workflow'] },
    { id: 'qwen_image', name: '通义千问', models: ['qwen-image-max', 'qwen-image-plus', 'qwen-image'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'] },
  ],
  video: [
    { id: 'klingai', name: '可灵官方 Omni (api-beijing.klingai.com)', models: ['kling-video-o1', 'kling-v3-omni'] },
    { id: 'ffir', name: '飞儿API / 可灵 Omni-Video (ffir.cn)', models: ['kling-video-o1', 'kling-v3-omni'] },
    { id: 'kling', name: '可灵 Kling', models: ['kling-omni-video', 'kling-video', 'kling-motion-control'] },
    { id: 'vidu', name: 'Vidu', models: ['viduq2', 'viduq2-pro', 'viduq2-turbo', 'viduq3-pro'] },
    { id: 'volces', name: '火山引擎', models: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-0-lite-i2v-250428', 'doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-1-0-pro-250528', 'doubao-seedance-1-0-pro-fast-251015'] },
    { id: 'minimax', name: 'MiniMax 海螺', models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'] },
    { id: 'gemini', name: 'Google Gemini (Veo)', models: ['veo-3.1-generate-preview', 'veo-3.0-generate-preview', 'veo-3.0-fast-generate-preview'] },
    { id: 'dashscope', name: '通义万相', models: ['wan2.6-r2v-flash', 'wan2.6-t2v', 'wan2.2-kf2v-flash', 'wan2.6-i2v-flash', 'wanx2.1-vace-plus'] },
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
    { id: 'openai', name: 'OpenAI Sora', models: ['sora-2', 'sora-2-pro', 'sora'] },
    { id: 'xai', name: 'xAI Grok Imagine', models: ['grok-imagine-video', 'grok-imagine'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-video-v2.0'] },
  ],
  tts: [
    { id: 'openai', name: 'OpenAI TTS', models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'] },
    { id: 'openai_compatible', name: 'OpenAI 兼容 TTS 网关', models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'] },
    { id: 'minimax', name: 'MiniMax T2A', models: ['speech-02-hd', 'speech-02-turbo'] },
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
}

const openAiCompatibleProviders = new Set([
  'openai',
  'openai_compatible',
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
])

export function getProviderProtocol(provider, serviceType = '') {
  if (!provider) return ''
  const p = String(provider).toLowerCase()
  const st = String(serviceType || '').toLowerCase()
  if (st === 'video' && p === 'openai') return 'sora'
  if (st === 'video' && (p === 'minimax' || p === 'hailuo')) return 'minimax'
  if (st === 'video' && (p === 'agnes')) return 'agnes'
  if (st === 'text') return 'openai'
  if ((st === 'image' || st === 'storyboard_image') && openAiCompatibleProviders.has(p)) return 'openai'
  if (st === 'tts' && (p === 'openai' || p === 'openai_compatible')) return 'openai'
  if (openAiCompatibleProviders.has(p) && !providerProtocolMap[p]) return 'openai'
  return providerProtocolMap[p] || 'openai'
}

export function getBaseUrlForProvider(provider, serviceType = '') {
  if (!provider) return ''
  const p = String(provider).toLowerCase()
  const st = String(serviceType || '').toLowerCase()
  if ((p === 'gemini' || p === 'google') && st === 'text') return 'https://generativelanguage.googleapis.com/v1beta/openai'
  if (p === 'gemini' || p === 'google') return 'https://generativelanguage.googleapis.com'
  if (p === 'minimax') return 'https://api.minimaxi.com/v1'
  if (p === 'volces' || p === 'volcengine') return 'https://ark.cn-beijing.volces.com/api/v3'
  if (p === 'openai' || p === 'openai_compatible') return 'https://api.openai.com/v1'
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
  return ''
}

export function getProviderEndpointDefaults(provider, serviceType = '', protocol = '') {
  const p = String(provider || '').toLowerCase()
  const st = String(serviceType || '').toLowerCase()
  const proto = String(protocol || getProviderProtocol(p, st) || '').toLowerCase()
  if (st === 'text') return { endpoint: '/chat/completions', query_endpoint: '' }
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
  return p === 'ollama' || p === 'comfyui' || proto === 'comfyui'
}
