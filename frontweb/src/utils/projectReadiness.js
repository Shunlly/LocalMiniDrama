import {
  hasRealMediaValue,
  hasStoryboardImage as storyboardHasImage,
  hasStoryboardVideo as storyboardHasVideo,
} from './storyboardMedia.js'
import { getServiceConfigReadiness } from './aiServiceReadiness.js'
import { getConfigTestStatus } from './aiConfigCoverage.js'

export const REQUIRED_AI_SERVICES = [
  { type: 'text', label: '文本模型' },
  { type: 'image', label: '素材图片' },
  { type: 'storyboard_image', label: '分镜图片' },
  { type: 'video', label: '视频模型' },
  { type: 'tts', label: '语音合成' },
]

const CORE_AI_SERVICE_TYPES = ['text', 'image', 'storyboard_image', 'video']

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function isActiveDefault(config) {
  return Boolean(config)
    && config.is_active !== false
    && config.is_active !== 0
    && config.is_active !== '0'
    && (config.is_default === true || Number(config.is_default) === 1)
}

function buildAiAction(serviceType, label) {
  return {
    id: 'configure_ai',
    label: `配置${label}`,
    title: `补齐${label}默认配置`,
    description: `后续自动化流程需要一个启用且设为默认的${label}服务。`,
    target: 'ai-config',
    serviceType,
  }
}

function buildFlowAction(id, label, title, description, extra = {}) {
  return {
    id,
    label,
    title,
    description,
    ...extra,
  }
}

function findEpisode(episodes, predicate) {
  return episodes.find(predicate) || episodes[0] || null
}

function buildStatus(ready, partial = false) {
  if (ready) return 'done'
  if (partial) return 'partial'
  return 'pending'
}

function buildMediaSummary(storyboardCount, imageCount, videoCount) {
  if (!storyboardCount) return '等待分镜'
  return `图片 ${imageCount}/${storyboardCount}，视频 ${videoCount}/${storyboardCount}`
}

export function buildEpisodeEmptyState(readiness) {
  const serviceByType = Object.fromEntries((readiness?.services || []).map((service) => [service.type, service]))
  const counts = readiness?.counts || {}
  let disabledReason = ''
  let unblockAction = null

  if (!serviceByType.text?.ready) {
    disabledReason = '需要先配置默认文本模型，才能从故事素材自动生成剧集。'
    unblockAction = buildAiAction('text', serviceByType.text?.label || '文本模型')
  } else if (!counts.sources) {
    disabledReason = '需要至少导入 1 份故事素材，才能自动拆分成剧集。'
    unblockAction = buildFlowAction(
      'import_source',
      '去导入素材',
      '先导入故事素材',
      '粘贴文本、网页地址或上传本地文件后，再启动处理生成剧集。',
      { target: 'source-workflow' },
    )
  }

  return {
    title: '还没有剧集',
    description: '可以从故事素材自动拆分剧集，也可以先批量导入现成剧本，或创建空白剧集再手动完善。',
    primaryAction: buildFlowAction(
      'start_episode_generation',
      '从素材生成剧集',
      '从故事素材生成剧集',
      '回到故事流程区导入素材并启动处理，系统会自动拆分剧集并写入脚本。',
      { target: 'source-workflow' },
    ),
    primaryDisabledReason: disabledReason,
    unblockAction,
  }
}

export function buildProjectReadiness({ drama, sources, sourceCount, aiConfigs } = {}) {
  const episodes = asArray(drama?.episodes)
  const configs = asArray(aiConfigs)
  const storyboards = episodes.flatMap((episode) => asArray(episode?.storyboards))
  const storyboardEpisodeCount = episodes.filter((episode) => asArray(episode?.storyboards).length > 0).length
  const resolvedSourceCount = Number.isFinite(Number(sourceCount))
    ? Math.max(0, Number(sourceCount))
    : asArray(sources).length

  const scriptedEpisodes = episodes.filter((episode) => String(episode?.script_content || '').trim()).length
  const characters = asArray(drama?.characters).length
  const scenes = asArray(drama?.scenes).length
  const props = asArray(drama?.props).length
  const assetCount = characters + scenes + props
  const assetCategoryCount = [characters, scenes, props].filter((count) => count > 0).length
  const imageCount = storyboards.filter((storyboard) => storyboardHasImage(storyboard, {}, drama)).length
  const videoCount = storyboards.filter((storyboard) => storyboardHasVideo(storyboard, {})).length
  const speechStoryboards = storyboards.filter((storyboard) => (
    String(storyboard?.dialogue || '').trim() || String(storyboard?.narration || '').trim()
  ))
  const audioReadyCount = speechStoryboards.filter((storyboard) => (
    (!String(storyboard?.dialogue || '').trim() || hasRealMediaValue(storyboard?.audio_local_path))
      && (!String(storyboard?.narration || '').trim() || hasRealMediaValue(storyboard?.narration_audio_local_path))
  )).length
  const productionEpisodes = episodes.filter((episode) => asArray(episode?.storyboards).length > 0)
  const composedEpisodeCount = productionEpisodes.filter((episode) => (
    hasRealMediaValue(episode?.video_local_path) || hasRealMediaValue(episode?.video_url)
  )).length

  const services = REQUIRED_AI_SERVICES.map((definition) => {
    const config = configs.find((item) => item?.service_type === definition.type && isActiveDefault(item)) || null
    const configReadiness = getServiceConfigReadiness(config)
    const model = configReadiness.model
    const test = getConfigTestStatus(config)
    const configured = configReadiness.ready
    const verified = configured && test.status === 'passed'
    const connectionFailed = configured && test.status === 'failed'
    const selected = [config?.name || config?.provider, model].filter(Boolean).join(' / ') || '默认配置'
    let detail = '缺少启用的默认配置'
    if (config && configReadiness.issue === 'missing_workflow') detail = '默认配置缺少 ComfyUI 工作流模板，请补充后再启动正式制作'
    else if (config && configReadiness.issue === 'missing_credentials') detail = '默认配置缺少生产凭据，请补充 API Key 或有效的厂商认证'
    else if (config && !configured) detail = '默认配置存在，但未选择可用模型'
    else if (connectionFailed) detail = '最近一次连接测试失败，请检查配置后重试'
    else if (verified) detail = `连接已验证：${selected}`
    else if (configured && configReadiness.modelOptional) detail = '协议工作流已配置，连接尚未验证'
    else if (configured) detail = `已配置，连接尚未验证：${selected}`
    return {
      ...definition,
      ready: configured && !connectionFailed,
      configured,
      verified,
      test,
      name: config?.name || config?.provider || '',
      model,
      issue: connectionFailed ? 'connection_failed' : configReadiness.issue,
      detail,
    }
  })

  const serviceByType = Object.fromEntries(services.map((service) => [service.type, service]))
  const coreServices = services.filter((service) => CORE_AI_SERVICE_TYPES.includes(service.type))
  const coreAiReadyCount = coreServices.filter((service) => service.ready).length
  const missingCoreService = coreServices.find((service) => !service.ready) || null
  const productionAiReadyCount = services.filter((service) => service.ready).length
  const verifiedServiceCount = services.filter((service) => service.verified).length
  const missingProductionLabels = services.filter((service) => !service.ready).map((service) => service.label)

  const summaryItems = [
    {
      id: 'ai',
      label: 'AI 配置',
      ready: productionAiReadyCount === services.length,
      status: buildStatus(productionAiReadyCount === services.length, productionAiReadyCount > 0),
      detail: productionAiReadyCount === services.length
        ? `${productionAiReadyCount}/${services.length} 项生产服务已配置，${verifiedServiceCount}/${services.length} 项连接已验证`
        : `${productionAiReadyCount}/${services.length} 项生产服务可用，缺少或失败 ${missingProductionLabels.join(' / ')}；${verifiedServiceCount}/${services.length} 项连接已验证`,
    },
    {
      id: 'source',
      label: '故事素材',
      ready: resolvedSourceCount > 0,
      status: buildStatus(resolvedSourceCount > 0),
      detail: resolvedSourceCount > 0 ? `${resolvedSourceCount} 份素材已导入` : '尚未导入故事素材',
    },
    {
      id: 'scripts',
      label: '剧集 / 脚本',
      ready: episodes.length > 0 && scriptedEpisodes === episodes.length,
      status: buildStatus(episodes.length > 0 && scriptedEpisodes === episodes.length, episodes.length > 0 || scriptedEpisodes > 0),
      detail: episodes.length > 0 ? `${scriptedEpisodes}/${episodes.length} 集已有脚本` : '尚未生成剧集',
    },
    {
      id: 'assets',
      label: '角色 / 场景 / 道具',
      ready: assetCategoryCount === 3,
      status: buildStatus(assetCategoryCount === 3, assetCount > 0),
      detail: assetCount > 0
        ? `角色 ${characters} / 场景 ${scenes} / 道具 ${props}`
        : '尚未提取制作资产',
    },
    {
      id: 'storyboards',
      label: '分镜',
      ready: episodes.length > 0 && storyboardEpisodeCount === episodes.length,
      status: buildStatus(
        episodes.length > 0 && storyboardEpisodeCount === episodes.length,
        storyboardEpisodeCount > 0,
      ),
      detail: episodes.length > 0
        ? `${storyboardEpisodeCount}/${episodes.length} 集已有分镜，共 ${storyboards.length} 个镜头`
        : '尚未生成分镜',
    },
    {
      id: 'media',
      label: '图片 / 视频',
      ready: storyboards.length > 0
        && imageCount === storyboards.length
        && videoCount === storyboards.length,
      status: buildStatus(
        storyboards.length > 0
          && imageCount === storyboards.length
          && videoCount === storyboards.length,
        imageCount > 0 || videoCount > 0,
      ),
      detail: buildMediaSummary(storyboards.length, imageCount, videoCount),
    },
    {
      id: 'audio',
      label: '对白 / 旁白音频',
      ready: storyboards.length > 0 && audioReadyCount === speechStoryboards.length,
      status: buildStatus(
        storyboards.length > 0 && audioReadyCount === speechStoryboards.length,
        audioReadyCount > 0,
      ),
      detail: speechStoryboards.length > 0
        ? `${audioReadyCount}/${speechStoryboards.length} 个有台词镜头音频齐备`
        : storyboards.length > 0 ? '当前分镜无需语音合成' : '等待分镜与台词',
    },
    {
      id: 'delivery',
      label: '合成 / 成片交付',
      ready: productionEpisodes.length > 0 && composedEpisodeCount === productionEpisodes.length,
      status: buildStatus(
        productionEpisodes.length > 0 && composedEpisodeCount === productionEpisodes.length,
        composedEpisodeCount > 0,
      ),
      detail: productionEpisodes.length > 0
        ? `${composedEpisodeCount}/${productionEpisodes.length} 集已有可下载成片`
        : '等待剧集进入合成流程',
    },
  ]

  const summaryById = Object.fromEntries(summaryItems.map((item) => [item.id, item]))
  let nextAction = null

  if (missingCoreService) {
    nextAction = buildAiAction(missingCoreService.type, missingCoreService.label)
  } else if (!summaryById.source.ready) {
    nextAction = buildFlowAction(
      'import_source',
      '导入故事素材',
      '先导入故事素材',
      '粘贴文本、网页地址或上传本地文件，然后启动处理。',
      { target: 'source-workflow' },
    )
  } else if (!summaryById.scripts.ready) {
    const episode = findEpisode(episodes, (item) => !String(item?.script_content || '').trim())
    nextAction = episodes.length === 0
      ? buildFlowAction(
          'create_episodes',
          '生成剧集',
          '把素材转换为剧集',
          '回到故事流程区启动处理，系统会自动拆分剧集并写入脚本。',
          { target: 'source-workflow' },
        )
      : buildFlowAction(
          'edit_script',
          '完善脚本',
          '补齐剧集脚本',
          `还有 ${episodes.length - scriptedEpisodes} 集缺少脚本内容。`,
          { target: 'film', episodeId: episode?.id },
        )
  } else if (!summaryById.assets.ready) {
    nextAction = buildFlowAction(
      'build_assets',
      '提取制作资产',
      '建立角色、场景和道具',
      '进入制作页，从脚本中提取并确认本剧的角色、场景和道具。',
      { target: 'film', episodeId: episodes[0]?.id },
    )
  } else if (!summaryById.storyboards.ready) {
    nextAction = buildFlowAction(
      'create_storyboards',
      '生成分镜',
      '为剧集生成分镜',
      '进入首个尚未生成分镜的剧集，确认镜头拆分。',
      {
        target: 'film',
        episodeId: findEpisode(episodes, (item) => !asArray(item?.storyboards).length)?.id,
      },
    )
  } else if (!serviceByType.image.ready) {
    nextAction = buildAiAction('image', serviceByType.image.label)
  } else if (!serviceByType.storyboard_image.ready) {
    nextAction = buildAiAction('storyboard_image', serviceByType.storyboard_image.label)
  } else if (imageCount < storyboards.length) {
    const episode = findEpisode(episodes, (item) => (
      asArray(item?.storyboards).some((storyboard) => !storyboardHasImage(storyboard, {}, drama))
    ))
    nextAction = buildFlowAction(
      'generate_images',
      '生成分镜图片',
      '补齐分镜图片',
      `还有 ${storyboards.length - imageCount} 个分镜没有可用图片。`,
      { target: 'film', episodeId: episode?.id },
    )
  } else if (!serviceByType.video.ready) {
    nextAction = buildAiAction('video', serviceByType.video.label)
  } else if (videoCount < storyboards.length) {
    const episode = findEpisode(episodes, (item) => (
      asArray(item?.storyboards).some((storyboard) => !storyboardHasVideo(storyboard, {}))
    ))
    nextAction = buildFlowAction(
      'generate_videos',
      '生成分镜视频',
      '补齐分镜视频',
      `还有 ${storyboards.length - videoCount} 个分镜没有可用视频。`,
      { target: 'film', episodeId: episode?.id },
    )
  } else if (!serviceByType.tts.ready) {
    nextAction = buildAiAction('tts', serviceByType.tts.label)
  } else if (audioReadyCount < speechStoryboards.length) {
    const episode = findEpisode(episodes, (item) => (
      asArray(item?.storyboards).some((storyboard) => (
        (String(storyboard?.dialogue || '').trim() && !hasRealMediaValue(storyboard?.audio_local_path))
          || (String(storyboard?.narration || '').trim() && !hasRealMediaValue(storyboard?.narration_audio_local_path))
      ))
    ))
    nextAction = buildFlowAction(
      'generate_audio',
      '生成对白与旁白音频',
      '补齐语音素材',
      `还有 ${speechStoryboards.length - audioReadyCount} 个有台词镜头缺少可用音频。`,
      { target: 'film', episodeId: episode?.id },
    )
  } else if (composedEpisodeCount < productionEpisodes.length) {
    const episode = findEpisode(productionEpisodes, (item) => (
      !hasRealMediaValue(item?.video_local_path) && !hasRealMediaValue(item?.video_url)
    ))
    nextAction = buildFlowAction(
      'compose_episode',
      '合成整集成片',
      '完成时间线合成',
      `还有 ${productionEpisodes.length - composedEpisodeCount} 集没有可交付的合成视频。`,
      { target: 'film', episodeId: episode?.id },
    )
  } else {
    nextAction = buildFlowAction(
      'review_delivery',
      '检查并下载成片',
      '项目已达到成片交付条件',
      '五类 AI 服务、分镜媒体、语音和逐集合成视频均已就绪，请进入制作页复核并下载成片。',
      { target: 'film', episodeId: episodes[0]?.id },
    )
  }

  if (!nextAction) {
    nextAction = buildFlowAction(
      'review_project',
      '查看项目概览',
      '检查当前项目状态',
      '当前项目状态已同步，可以继续查看详情或进入制作。',
      { target: 'episode-list' },
    )
  }

  const readyCount = summaryItems.filter((item) => item.ready).length
  const totalCount = summaryItems.length

  const readiness = {
    services,
    summaryItems,
    contentItems: summaryItems,
    nextAction,
    readyCount,
    totalCount,
    percent: totalCount ? Math.round((readyCount / totalCount) * 100) : 0,
    complete: readyCount === totalCount,
    counts: {
      sources: resolvedSourceCount,
      episodes: episodes.length,
      scriptedEpisodes,
      characters,
      scenes,
      props,
      assets: assetCount,
      storyboards: storyboards.length,
      storyboardEpisodes: storyboardEpisodeCount,
      images: imageCount,
      videos: videoCount,
      speechStoryboards: speechStoryboards.length,
      audioReady: audioReadyCount,
      productionEpisodes: productionEpisodes.length,
      composedEpisodes: composedEpisodeCount,
      coreAiReadyCount,
      coreAiTotalCount: coreServices.length,
      productionAiReadyCount,
      productionAiTotalCount: services.length,
    },
  }

  readiness.episodeEmptyState = buildEpisodeEmptyState(readiness)
  return readiness
}
