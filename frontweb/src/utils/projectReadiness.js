import { isPlaceholderMediaUrl } from './mediaUrl.js'

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

function hasRealMedia(value) {
  const normalized = String(value || '').trim()
  return Boolean(normalized) && !isPlaceholderMediaUrl(normalized)
}

function hasStoryboardImage(storyboard) {
  return [storyboard?.image_url, storyboard?.local_path, storyboard?.composed_image]
    .some(hasRealMedia)
}

function hasStoryboardVideo(storyboard) {
  return hasRealMedia(storyboard?.video_url)
}

function isActiveDefault(config) {
  return Boolean(config)
    && config.is_active !== false
    && (config.is_default === true || Number(config.is_default) === 1)
}

function configModel(config) {
  if (!config) return ''
  if (String(config.default_model || '').trim()) return String(config.default_model).trim()
  if (Array.isArray(config.model)) return String(config.model[0] || '').trim()
  try {
    const parsed = JSON.parse(config.model || '[]')
    return Array.isArray(parsed) ? String(parsed[0] || '').trim() : ''
  } catch (_) {
    return String(config.model || '').trim()
  }
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
  const resolvedSourceCount = Number.isFinite(Number(sourceCount))
    ? Math.max(0, Number(sourceCount))
    : asArray(sources).length

  const scriptedEpisodes = episodes.filter((episode) => String(episode?.script_content || '').trim()).length
  const characters = asArray(drama?.characters).length
  const scenes = asArray(drama?.scenes).length
  const props = asArray(drama?.props).length
  const assetCount = characters + scenes + props
  const assetCategoryCount = [characters, scenes, props].filter((count) => count > 0).length
  const imageCount = storyboards.filter(hasStoryboardImage).length
  const videoCount = storyboards.filter(hasStoryboardVideo).length

  const services = REQUIRED_AI_SERVICES.map((definition) => {
    const config = configs.find((item) => item?.service_type === definition.type && isActiveDefault(item)) || null
    const model = configModel(config)
    return {
      ...definition,
      ready: Boolean(config),
      name: config?.name || config?.provider || '',
      model,
      detail: config
        ? [config.name || config.provider, model].filter(Boolean).join(' / ') || '默认配置可用'
        : '缺少启用的默认配置',
    }
  })

  const serviceByType = Object.fromEntries(services.map((service) => [service.type, service]))
  const coreServices = services.filter((service) => CORE_AI_SERVICE_TYPES.includes(service.type))
  const coreAiReadyCount = coreServices.filter((service) => service.ready).length
  const missingCoreService = coreServices.find((service) => !service.ready) || null
  const missingCoreLabels = coreServices.filter((service) => !service.ready).map((service) => service.label)

  const summaryItems = [
    {
      id: 'ai',
      label: 'AI 配置',
      ready: coreAiReadyCount === coreServices.length,
      status: buildStatus(coreAiReadyCount === coreServices.length, coreAiReadyCount > 0),
      detail: coreAiReadyCount === coreServices.length
        ? `${coreAiReadyCount}/${coreServices.length} 项核心服务已就绪`
        : `${coreAiReadyCount}/${coreServices.length} 项核心服务已就绪，缺少 ${missingCoreLabels.join(' / ')}`,
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
      ready: storyboards.length > 0,
      status: buildStatus(storyboards.length > 0),
      detail: storyboards.length > 0 ? `${storyboards.length} 个分镜已生成` : '尚未生成分镜',
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
  ]

  const summaryById = Object.fromEntries(summaryItems.map((item) => [item.id, item]))
  let nextAction = null

  if (!summaryById.ai.ready) {
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
      asArray(item?.storyboards).some((storyboard) => !hasStoryboardImage(storyboard))
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
      asArray(item?.storyboards).some((storyboard) => !hasStoryboardVideo(storyboard))
    ))
    nextAction = buildFlowAction(
      'generate_videos',
      '生成分镜视频',
      '补齐分镜视频',
      `还有 ${storyboards.length - videoCount} 个分镜没有可用视频。`,
      { target: 'film', episodeId: episode?.id },
    )
  } else {
    nextAction = buildFlowAction(
      'continue_production',
      '进入制作页',
      '项目已具备完整制作条件',
      '核心 AI 配置和关键制作产物均已就绪，可以继续精修或导出。',
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
      images: imageCount,
      videos: videoCount,
      coreAiReadyCount,
      coreAiTotalCount: coreServices.length,
    },
  }

  readiness.episodeEmptyState = buildEpisodeEmptyState(readiness)
  return readiness
}
