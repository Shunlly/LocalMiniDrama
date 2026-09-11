'use strict';

// 从 videoClient 拆出的创建请求装配：配置、网络策略、SD2 素材/音色注入。
// 保持原语义，不是新增真实接入。

const uploadService = require('../uploadService');
const { createSafeVideoLogger, videoRequestContext, resolveVideoProtocol, getModelFromConfig } = require('./helpers');
const {
  validateVideoMediaReferences,
  validateProviderDispatch,
  createProviderNetworkOptions,
} = require('./mediaRefs');
const {
  VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME,
  applySeedance2CertifiedAssetUrlsToVideoOpts,
  collectActiveCharacterVoiceRefs,
} = require('./seedanceCertifiedAssets');
const { getDefaultVideoConfig } = require('./config');

function isSeedance2Model(model) {
  return /seedance[-_]?2|seedance2|2[-_]0[-_]/.test(String(model || ''));
}

function pickSeedance2VoiceFromStoryboard(db, opts, voiceMap) {
  if (!opts.storyboard_id) return null;
  try {
    const sbRow = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(opts.storyboard_id);
    if (!sbRow || !sbRow.characters) return null;
    const charList = typeof sbRow.characters === 'string' ? JSON.parse(sbRow.characters) : sbRow.characters;
    const ids = Array.isArray(charList) ? charList.map((c) => Number(c?.id || c)).filter(Boolean) : [];
    for (const cid of ids) {
      if (voiceMap.has(cid)) return voiceMap.get(cid);
    }
  } catch (_) {}
  return null;
}

async function applySeedance2VoiceReferenceToVideoOpts(db, log, opts, model) {
  if (!isSeedance2Model(model) || !db || !opts.drama_id || opts.voice_reference_url) return opts;
  const voiceMap = collectActiveCharacterVoiceRefs(db, opts.drama_id);
  const video_gen_id = opts.video_gen_id;
  if (voiceMap.size === 0) {
    log.info('[视频][SD2][全能] Seedance 2.0 模型但本剧暂无 active 音色参考', { video_gen_id, drama_id: opts.drama_id });
    return opts;
  }
  let chosen = pickSeedance2VoiceFromStoryboard(db, opts, voiceMap);
  if (!chosen) chosen = voiceMap.values().next().value;
  if (!chosen) {
    log.info('[视频][SD2][全能] 检测到活跃音色参考但未匹配到当前分镜角色', {
      video_gen_id,
      storyboard_id: opts.storyboard_id,
      available_voice_char_ids: Array.from(voiceMap.keys()),
    });
    return opts;
  }
  const validatedVoice = await uploadService.validateMediaReference(chosen, {
    storagePath: opts.storage_local_path,
    lookup: opts.media_dns_lookup,
  });
  const next = { ...opts, voice_reference_url: validatedVoice.canonical };
  log.info('[视频][SD2][全能] 自动为 Seedance 2.0 注入角色音色参考（来自角色 seedance2_voice_asset）', {
    video_gen_id,
    storyboard_id: opts.storyboard_id,
    voice_ref_url: String(chosen).slice(0, 100),
  });
  return next;
}

async function assembleVideoApiCall(db, log, opts) {
  log = createSafeVideoLogger(log);
  opts = await validateVideoMediaReferences(opts);
  const {
    prompt,
    model: preferredModel,
    duration,
    aspect_ratio,
    resolution,
    seed,
    camera_fixed,
    watermark,
    image_url,
    first_frame_url,
    last_frame_url,
    first_frame_local_path,
    last_frame_local_path,
    files_base_url,
    storage_local_path,
    video_gen_id,
  } = opts;
  const config = getDefaultVideoConfig(
    db,
    preferredModel,
    opts.preferred_provider || opts.preferredProvider || opts.provider
  );
  if (!config) {
    throw new Error('请先在 AI 配置中添加并启用视频服务');
  }
  const providerNetworkOptions = createProviderNetworkOptions(config, {
    fetch_impl: opts.fetch_impl,
    provider_dns_lookup: opts.provider_dns_lookup,
    signal: opts.signal,
  });
  const requestContext = videoRequestContext.getStore();
  if (requestContext) {
    requestContext.networkOptions = providerNetworkOptions;
  }
  await validateProviderDispatch(config, { provider_network_policy: providerNetworkOptions });
  const model = getModelFromConfig(config, preferredModel);
  const provider = (config.provider || '').toLowerCase();
  const protocol = resolveVideoProtocol(config, preferredModel);
  if (db && opts.drama_id && VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME.has(protocol)) {
    opts = applySeedance2CertifiedAssetUrlsToVideoOpts(db, log, opts);
  }
  opts = await applySeedance2VoiceReferenceToVideoOpts(db, log, opts, model);

  return {
    log,
    opts,
    config,
    protocol,
    model,
    preferredModel,
    provider,
    prompt,
    duration,
    aspect_ratio,
    resolution,
    seed,
    camera_fixed,
    watermark,
    image_url: opts.image_url,
    first_frame_url: opts.first_frame_url,
    last_frame_url: opts.last_frame_url,
    first_frame_local_path,
    last_frame_local_path,
    files_base_url,
    storage_local_path,
    video_gen_id,
    providerNetworkOptions,
    routeLog: {
      video_gen_id,
      provider,
      api_protocol_raw: config.api_protocol || '(empty→auto)',
      protocol_used: protocol,
      model,
      endpoint: config.endpoint || '(auto)',
    },
  };
}

function toVideoProtocolDispatchArgs(assembled) {
  return {
    db: assembled.db,
    log: assembled.log,
    opts: assembled.opts,
    config: assembled.config,
    protocol: assembled.protocol,
    model: assembled.model,
    preferredModel: assembled.preferredModel,
    prompt: assembled.prompt,
    duration: assembled.duration,
    aspect_ratio: assembled.aspect_ratio,
    resolution: assembled.resolution,
    seed: assembled.seed,
    camera_fixed: assembled.camera_fixed,
    watermark: assembled.watermark,
    image_url: assembled.image_url,
    first_frame_url: assembled.first_frame_url,
    last_frame_url: assembled.last_frame_url,
    first_frame_local_path: assembled.first_frame_local_path,
    last_frame_local_path: assembled.last_frame_local_path,
    files_base_url: assembled.files_base_url,
    storage_local_path: assembled.storage_local_path,
    video_gen_id: assembled.video_gen_id,
    providerNetworkOptions: assembled.providerNetworkOptions,
  };
}

module.exports = {
  isSeedance2Model,
  applySeedance2VoiceReferenceToVideoOpts,
  assembleVideoApiCall,
  toVideoProtocolDispatchArgs,
};
