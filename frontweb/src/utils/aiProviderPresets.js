export const CUSTOM_PROVIDER_SENTINEL = '__custom__'

// 预设仅用于填表，不代表已真实跑通该厂商生成。

import {
  providerConfigs,
  providerProtocolMap,
  openAiCompatibleProviders,
} from './aiProviderPresetsCatalog.js'

export { providerConfigs, providerProtocolMap }

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
