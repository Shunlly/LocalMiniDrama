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
    { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen' },
    { service_type: 'image', is_active: true, is_default: true, default_model: 'img' },
    { service_type: 'storyboard_image', is_active: true, is_default: true, default_model: 'sb-img' },
    { service_type: 'video', is_active: true, is_default: true, default_model: 'vid' },
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
      { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen' },
    ],
  })
  assert.match(noSource.episodeEmptyState.primaryDisabledReason, /故事素材/)
  assert.equal(noSource.episodeEmptyState.unblockAction.target, 'source-workflow')

  const explicit = buildEpisodeEmptyState(noSource)
  assert.equal(explicit.primaryAction.label, '从素材生成剧集')
})

test('project readiness completes once core categories are ready even without tts', () => {
  const readiness = buildProjectReadiness({
    drama: {
      episodes: [{
        id: 1,
        script_content: 'scene 1',
        storyboards: [{
          id: 11,
          image_url: 'https://example.com/1.png',
          video_url: 'https://example.com/1.mp4',
        }],
      }],
      characters: [{ id: 1 }],
      scenes: [{ id: 1 }],
      props: [{ id: 1 }],
    },
    sourceCount: 1,
    aiConfigs: [
      { service_type: 'text', is_active: true, is_default: true, default_model: 'qwen' },
      { service_type: 'image', is_active: true, is_default: true, default_model: 'img' },
      { service_type: 'storyboard_image', is_active: true, is_default: true, default_model: 'sb-img' },
      { service_type: 'video', is_active: true, is_default: true, default_model: 'vid' },
    ],
  })

  assert.equal(readiness.complete, true)
  assert.equal(readiness.nextAction.id, 'continue_production')
})
