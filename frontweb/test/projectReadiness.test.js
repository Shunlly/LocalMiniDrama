import test from 'node:test'
import assert from 'node:assert/strict'

import { buildEpisodeEmptyState, buildProjectReadiness } from '../src/utils/projectReadiness.js'

test('project readiness exposes both summaryItems and contentItems for panel consumers', () => {
  const readiness = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [],
  })

  assert.ok(Array.isArray(readiness.summaryItems))
  assert.ok(Array.isArray(readiness.contentItems))
  assert.equal(readiness.contentItems, readiness.summaryItems)
  assert.equal(readiness.nextAction.id, 'configure_ai')
})

test('project readiness sequences nextAction through source, scripts, assets, storyboards and media', () => {
  const baseConfigs = [
    { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen', credential_set: true },
    { service_type: 'image', is_active: true, is_default: true, default_model: 'img', credential_set: true },
    { service_type: 'storyboard_image', is_active: true, is_default: true, default_model: 'sb-img', credential_set: true },
    { service_type: 'video', is_active: true, is_default: true, default_model: 'vid', credential_set: true },
  ]

  const sourceStage = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: baseConfigs,
  })
  assert.equal(sourceStage.nextAction.id, 'import_source')

  const scriptStage = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 1,
    aiConfigs: baseConfigs,
  })
  assert.equal(scriptStage.nextAction.id, 'create_episodes')

  const assetStage = buildProjectReadiness({
    drama: {
      episodes: [{ id: 1, script_content: 'scene 1' }],
      characters: [],
      scenes: [],
      props: [],
    },
    sourceCount: 1,
    aiConfigs: baseConfigs,
  })
  assert.equal(assetStage.nextAction.id, 'build_assets')

  const storyboardStage = buildProjectReadiness({
    drama: {
      episodes: [{ id: 1, script_content: 'scene 1', storyboards: [] }],
      characters: [{ id: 1 }],
      scenes: [{ id: 1 }],
      props: [{ id: 1 }],
    },
    sourceCount: 1,
    aiConfigs: baseConfigs,
  })
  assert.equal(storyboardStage.nextAction.id, 'create_storyboards')

  const mediaStage = buildProjectReadiness({
    drama: {
      episodes: [{
        id: 1,
        script_content: 'scene 1',
        storyboards: [{ id: 11, image_url: 'https://example.com/1.png', video_url: '' }],
      }],
      characters: [{ id: 1 }],
      scenes: [{ id: 1 }],
      props: [{ id: 1 }],
    },
    sourceCount: 1,
    aiConfigs: baseConfigs,
  })
  assert.equal(mediaStage.nextAction.id, 'generate_videos')
})

test('episode empty state exposes blocker CTA when text config or source is missing', () => {
  const noText = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [],
  })
  assert.equal(noText.episodeEmptyState.primaryAction.id, 'start_episode_generation')
  assert.match(noText.episodeEmptyState.primaryDisabledReason, /文本模型/)
  assert.equal(noText.episodeEmptyState.unblockAction.target, 'ai-config')

  const noSource = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [
      { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen', credential_set: true },
    ],
  })
  assert.match(noSource.episodeEmptyState.primaryDisabledReason, /故事素材/)
  assert.equal(noSource.episodeEmptyState.unblockAction.target, 'source-workflow')

  const explicit = buildEpisodeEmptyState(noSource)
  assert.equal(explicit.primaryAction.label, '从素材生成剧集')
})

test('project readiness requires tts, spoken audio and a composed episode before delivery', () => {
  const productionConfigs = [
    { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen', credential_set: true },
    { service_type: 'image', is_active: true, is_default: true, default_model: 'img', credential_set: true },
    { service_type: 'storyboard_image', is_active: true, is_default: true, default_model: 'sb-img', credential_set: true },
    { service_type: 'video', is_active: true, is_default: true, default_model: 'vid', credential_set: true },
    { service_type: 'tts', is_active: true, is_default: true, default_model: 'voice', credential_set: true },
  ]
  const productionDrama = {
    episodes: [{
      id: 1,
      script_content: 'scene 1',
      video_url: 'videos/final-episode.mp4',
      storyboards: [{
        id: 11,
        dialogue: 'hello',
        audio_local_path: 'audio/dialogue.mp3',
        image_url: 'https://example.com/1.png',
        video_url: 'https://example.com/1.mp4',
      }],
    }],
    characters: [{ id: 1 }],
    scenes: [{ id: 1 }],
    props: [{ id: 1 }],
  }

  const readiness = buildProjectReadiness({
    drama: productionDrama,
    sourceCount: 1,
    aiConfigs: productionConfigs,
  })

  assert.equal(readiness.complete, true)
  assert.equal(readiness.nextAction.id, 'review_delivery')
  assert.equal(readiness.counts.audioReady, 1)
  assert.equal(readiness.counts.composedEpisodes, 1)

  const withoutTts = buildProjectReadiness({
    drama: productionDrama,
    sourceCount: 1,
    aiConfigs: productionConfigs.filter((config) => config.service_type !== 'tts'),
  })
  assert.equal(withoutTts.complete, false)
  assert.equal(withoutTts.nextAction.id, 'configure_ai')
  assert.equal(withoutTts.nextAction.serviceType, 'tts')

  const withoutComposition = buildProjectReadiness({
    drama: {
      ...productionDrama,
      episodes: productionDrama.episodes.map(({ video_url, ...episode }) => episode),
    },
    sourceCount: 1,
    aiConfigs: productionConfigs,
  })
  assert.equal(withoutComposition.complete, false)
  assert.equal(withoutComposition.nextAction.id, 'compose_episode')
})

test('project readiness does not treat an enabled default with no model as ready', () => {
  const readiness = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [{
      service_type: 'video',
      is_active: true,
      is_default: true,
      model: [],
      default_model: '',
    }],
  })
  const video = readiness.services.find((service) => service.type === 'video')
  assert.equal(video.ready, false)
  assert.equal(video.issue, 'missing_model')
})

test('project readiness does not treat a remote model without credentials as production-ready', () => {
  const readiness = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [{
      service_type: 'text',
      provider: 'openai',
      is_active: true,
      is_default: true,
      default_model: 'text-model',
      api_key_set: false,
    }],
  })
  const text = readiness.services.find((service) => service.type === 'text')
  assert.equal(text.ready, false)
  assert.equal(text.issue, 'missing_credentials')
  assert.match(text.detail, /生产凭据/)
})

test('project readiness distinguishes configured, verified, and failed connections', () => {
  const unknown = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [{
      service_type: 'text',
      is_active: true,
      is_default: true,
      default_model: 'text-model',
      credential_set: true,
    }],
  }).services.find((service) => service.type === 'text')
  assert.equal(unknown.ready, true)
  assert.equal(unknown.verified, false)
  assert.match(unknown.detail, /连接尚未验证/)

  const failed = buildProjectReadiness({
    drama: { episodes: [] },
    sourceCount: 0,
    aiConfigs: [{
      service_type: 'text',
      is_active: true,
      is_default: true,
      default_model: 'text-model',
      credential_set: true,
      last_test_status: 'failed',
    }],
  }).services.find((service) => service.type === 'text')
  assert.equal(failed.ready, false)
  assert.equal(failed.issue, 'connection_failed')
  assert.match(failed.detail, /连接测试失败/)
})

test('project media readiness ignores draft placeholder URLs', () => {
  const readiness = buildProjectReadiness({
    drama: {
      episodes: [{
        id: 1,
        script_content: 'scene',
        storyboards: [{
          id: 11,
          status: 'media_ready',
          image_url: 'mock://storyboard/11/image',
          video_url: 'placeholder://storyboard/11/video',
        }],
      }],
    },
    sourceCount: 1,
    aiConfigs: [],
  })
  assert.equal(readiness.counts.images, 0)
  assert.equal(readiness.counts.videos, 0)
  assert.equal(readiness.summaryItems.find((item) => item.id === 'media').ready, false)
})

test('project readiness requires storyboard coverage for every episode', () => {
  const readiness = buildProjectReadiness({
    drama: {
      episodes: [
        { id: 1, script_content: 'scene one', storyboards: [{ id: 11 }] },
        { id: 2, script_content: 'scene two', storyboards: [] },
      ],
      characters: [{ id: 1 }],
      scenes: [{ id: 1 }],
      props: [{ id: 1 }],
    },
    sourceCount: 1,
    aiConfigs: [
      { service_type: 'text', is_active: true, is_default: true, default_model: 'text', credential_set: true },
      { service_type: 'image', is_active: true, is_default: true, default_model: 'image', credential_set: true },
      { service_type: 'storyboard_image', is_active: true, is_default: true, default_model: 'storyboard', credential_set: true },
      { service_type: 'video', is_active: true, is_default: true, default_model: 'video', credential_set: true },
    ],
  })

  assert.equal(readiness.summaryItems.find((item) => item.id === 'storyboards').ready, false)
  assert.equal(readiness.counts.storyboardEpisodes, 1)
  assert.equal(readiness.nextAction.id, 'create_storyboards')
  assert.equal(readiness.nextAction.episodeId, 2)
})
