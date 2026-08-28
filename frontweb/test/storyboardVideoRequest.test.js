import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildStoryboardVideoPrompt,
  buildStoryboardVideoRequest,
  collectStoryboardReferenceSlots,
  collectStoryboardReferenceUrls,
  createStoryboardReferenceFromAsset,
  normalizeStoryboardReferenceImages,
  upsertStoryboardReferenceImage,
  videoConfigSupportsOmni,
  videoConfigSupportsGridReference,
} from '../src/utils/storyboardVideoRequest.js'

test('video model capabilities only enable supported Omni protocols', () => {
  assert.equal(videoConfigSupportsOmni({ api_protocol: 'kling_omni' }), true)
  assert.equal(videoConfigSupportsOmni({ api_protocol: 'volcengine_omni', default_model: 'seedance-2-0-pro' }), true)
  assert.equal(videoConfigSupportsOmni({ api_protocol: 'volcengine_omni', default_model: 'seedance-1-5-pro' }), false)
  assert.equal(videoConfigSupportsOmni({ provider: 'agnes', default_model: 'agnes-video-v1' }), true)
  assert.equal(videoConfigSupportsOmni({ api_protocol: 'openai_video', default_model: 'video-model' }), false)
  assert.equal(videoConfigSupportsGridReference({ settings: '{"supports_grid_reference":true}' }), true)
  assert.equal(videoConfigSupportsGridReference({ api_protocol: 'openai_video', settings: '{"supports_grid_reference":false}' }), false)
})

test('storyboard references preserve scene, character, prop, and free image order', () => {
  const drama = {
    scenes: [{ id: 3, location: 'Studio', local_path: 'scenes/studio.png' }],
    characters: [{ id: 2, name: 'A', image_url: 'https://cdn.test/a.png' }],
    props: [{ id: 4, name: 'Cup', local_path: 'props/cup.png' }],
  }
  const storyboard = {
    scene_id: 3,
    characters: [2],
    prop_ids: [4],
    reference_images: JSON.stringify([{ name: 'Sketch', local_path: 'uploads/sketch.png' }]),
  }
  const slots = collectStoryboardReferenceSlots(drama, storyboard)
  assert.deepEqual(slots.map((slot) => slot.kind), ['scene', 'character', 'prop', 'free'])
  assert.deepEqual(slots.map((slot) => slot.index), [1, 2, 3, 4])
  assert.deepEqual(
    collectStoryboardReferenceUrls(drama, storyboard, { kinds: ['scene', 'free'], toAbsolute: (url) => `https://app.test${url}` }),
    ['https://app.test/static/scenes/studio.png', 'https://app.test/static/uploads/sketch.png']
  )
})

test('media-library image assets normalize into storyboard free references and dedupe safely', () => {
  const asset = {
    id: 18,
    drama_id: 4,
    source_drama_title: 'Shared Drama',
    name: 'Rain Plate',
    type: 'image',
    local_path: 'uploads/shared/rain-plate.png',
  }
  assert.deepEqual(createStoryboardReferenceFromAsset(asset), {
    asset_id: 18,
    source_drama_id: 4,
    source_drama_title: 'Shared Drama',
    name: 'Rain Plate',
    local_path: 'uploads/shared/rain-plate.png',
  })

  const storyboard = {
    reference_images: JSON.stringify([
      { name: 'Existing', local_path: 'uploads/existing.png' },
      { name: 'Duplicate old name', local_path: 'uploads/shared/rain-plate.png' },
    ]),
  }

  const duplicate = upsertStoryboardReferenceImage(storyboard, asset)
  assert.equal(duplicate.status, 'duplicate')
  assert.deepEqual(
    duplicate.items.map((item) => item.name),
    ['Existing', 'Rain Plate'],
  )

  const primary = upsertStoryboardReferenceImage(storyboard, asset, { prepend: true })
  assert.equal(primary.status, 'moved')
  assert.deepEqual(
    primary.items.map((item) => item.local_path),
    ['uploads/shared/rain-plate.png', 'uploads/existing.png'],
  )
})

test('storyboard free references parse strings, drop invalid entries, and cap duplicates', () => {
  const items = normalizeStoryboardReferenceImages({
    reference_images: JSON.stringify([
      'https://cdn.test/one.png',
      { name: 'Two', image_url: 'https://cdn.test/two.png' },
      { name: 'Duplicate Two', url: 'https://cdn.test/two.png' },
      { bad: true },
    ]),
  })
  assert.deepEqual(items, [
    { name: '自由参考图', image_url: 'https://cdn.test/one.png' },
    { name: 'Two', image_url: 'https://cdn.test/two.png' },
  ])
})

test('video request uses universal text for Omni and omits classic frame fields', () => {
  const storyboard = {
    id: 9,
    creation_mode: 'universal',
    universal_segment_text: '@Image1 walks through the door',
    video_prompt: 'classic fallback',
  }
  assert.equal(buildStoryboardVideoPrompt(storyboard), '@Image1 walks through the door')
  assert.equal(buildStoryboardVideoPrompt(storyboard, { preferClassicPrompt: true }), 'classic fallback')

  const body = buildStoryboardVideoRequest({
    dramaId: 5,
    storyboard,
    universalOmni: true,
    firstFrameUrl: 'https://app.test/first.png',
    lastFrameUrl: 'https://app.test/last.png',
    referenceImageUrls: ['https://app.test/ref.png', 'https://app.test/ref.png'],
    style: 'cinematic',
    aspectRatio: '16:9',
    resolution: '1080p',
    duration: 6,
    videoReferenceImageId: 23,
  })
  assert.equal(body.prompt, '@Image1 walks through the door')
  assert.equal('image_url' in body, false)
  assert.equal('first_frame_url' in body, false)
  assert.equal('last_frame_url' in body, false)
  assert.deepEqual(body.reference_image_urls, ['https://app.test/ref.png'])
  assert.equal(body.duration, 6)
  assert.equal(body.video_reference_image_id, 23)
})

test('classic video request carries first and last frames consistently', () => {
  const body = buildStoryboardVideoRequest({
    dramaId: 5,
    storyboard: { id: 10, video_prompt: 'pan left' },
    firstFrameUrl: 'https://app.test/first.png',
    lastFrameUrl: 'https://app.test/last.png',
    referenceImageUrls: ['https://app.test/first.png', 'https://app.test/last.png'],
  })
  assert.equal(body.image_url, 'https://app.test/first.png')
  assert.equal(body.first_frame_url, 'https://app.test/first.png')
  assert.equal(body.last_frame_url, 'https://app.test/last.png')
  assert.deepEqual(body.reference_image_urls, ['https://app.test/first.png', 'https://app.test/last.png'])
})


test('自由参考图不会把本地条目 id 当成素材库 asset_id', () => {
  const items = normalizeStoryboardReferenceImages({
    reference_images: [
      { id: 99, name: 'Sketch', local_path: 'uploads/sketch.png' },
      { asset_id: 18, id: 7, name: 'Rain', local_path: 'uploads/rain.png', drama_id: 99, source_drama_id: 4 },
    ],
  })
  assert.equal(items[0].asset_id, undefined)
  assert.equal(items[0].id, undefined)
  assert.equal(items[1].asset_id, 18)
  assert.equal(items[1].source_drama_id, 4)
  assert.notEqual(items[1].asset_id, items[1].source_drama_id)
})

test('参考槽空名回落到中文，同名角色与自由参考图不会共用展示前缀', () => {
  const drama = {
    characters: [{ id: 2, name: '阿明', image_url: 'https://cdn.test/a.png' }],
    scenes: [],
    props: [],
  }
  const storyboard = {
    characters: ['2'],
    reference_images: [{ name: '阿明', local_path: 'uploads/ming.png' }],
  }
  const slots = collectStoryboardReferenceSlots(drama, storyboard)
  assert.deepEqual(slots.map((slot) => slot.kind), ['character', 'free'])
  assert.equal(slots[0].name, '阿明')
  assert.equal(slots[1].name, '阿明')
  assert.equal(slots[0].index, 1)
  assert.equal(slots[1].index, 2)
})
