import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateStoryboardStateSync } from '../src/composables/filmCreate/useFilmCreateStoryboardStateSync.js'
import {
  FILM_CREATE_STORYBOARD_FIELD_KEYS,
  applyFilmCreateStoryboardFieldsSnapshot,
  snapshotFilmCreateStoryboardFields,
  useFilmCreateStoryboardFields,
  writeFilmCreateStoryboardField,
} from '../src/composables/filmCreate/useFilmCreateStoryboardFields.js'

const DRAMA_ID = 11
const EPISODE_ID = 22
const STORYBOARD_ID = 77
const OTHER_STORYBOARD_ID = 88
const CHAR_ID = 5
const PROP_ID = 9
const SCENE_ID = 8

assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(DRAMA_ID, STORYBOARD_ID)
assert.notEqual(EPISODE_ID, STORYBOARD_ID)
assert.notEqual(STORYBOARD_ID, OTHER_STORYBOARD_ID)

const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

function assertNoProjectIdKeys(fields) {
  const forbidden = [DRAMA_ID, EPISODE_ID, String(DRAMA_ID), String(EPISODE_ID)]
  for (const key of FILM_CREATE_STORYBOARD_FIELD_KEYS) {
    const bag = fields[key].value
    for (const id of forbidden) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(bag, id),
        false,
        key + ' 不应出现 drama/episode key=' + id,
      )
    }
  }
}

test('分镜字段袋初始值全是空对象，且按 storyboard id 索引', () => {
  const fields = useFilmCreateStoryboardFields()
  assert.deepEqual(FILM_CREATE_STORYBOARD_FIELD_KEYS, [
    'sbCharacterIds',
    'sbPropIds',
    'sbSceneId',
    'sbDialogue',
    'sbNarration',
    'sbShotType',
    'sbTitle',
    'sbLocation',
    'sbTime',
    'sbDuration',
    'sbAction',
    'sbResult',
    'sbAtmosphere',
    'sbAngle',
    'sbAngleH',
    'sbAngleV',
    'sbAngleS',
    'sbMovement',
    'sbLighting',
    'sbDof',
    'sbLayoutDescription',
    'sbCreationMode',
    'sbUniversalSegmentText',
    'sbVideoReferenceImageId',
  ])
  for (const key of FILM_CREATE_STORYBOARD_FIELD_KEYS) {
    assert.ok(fields[key])
    assert.deepEqual(fields[key].value, {})
  }
})

test('dramaId 与 episodeId 不相等时不会串写到字段袋', () => {
  const fields = useFilmCreateStoryboardFields()
  writeFilmCreateStoryboardField(fields, 'sbTitle', STORYBOARD_ID, '推门')
  writeFilmCreateStoryboardField(fields, 'sbLocation', STORYBOARD_ID, '办公室')
  writeFilmCreateStoryboardField(fields, 'sbDialogue', STORYBOARD_ID, '你好')
  writeFilmCreateStoryboardField(fields, 'sbCharacterIds', STORYBOARD_ID, [CHAR_ID])
  writeFilmCreateStoryboardField(fields, 'sbTitle', OTHER_STORYBOARD_ID, '另一镜')

  assert.equal(fields.sbTitle.value[STORYBOARD_ID], '推门')
  assert.equal(fields.sbTitle.value[OTHER_STORYBOARD_ID], '另一镜')
  assert.equal(fields.sbLocation.value[STORYBOARD_ID], '办公室')
  assert.equal(fields.sbDialogue.value[STORYBOARD_ID], '你好')
  assert.deepEqual(fields.sbCharacterIds.value[STORYBOARD_ID], [CHAR_ID])
  assertNoProjectIdKeys(fields)
  assert.equal(fields.sbTitle.value[DRAMA_ID], undefined)
  assert.equal(fields.sbTitle.value[EPISODE_ID], undefined)
})

test('字段袋能 round-trip，同步剧集后仍只按分镜 id 读写', () => {
  const fields = useFilmCreateStoryboardFields()
  const { syncStoryboardStateFromEpisode } = useFilmCreateStoryboardStateSync(fields)
  syncStoryboardStateFromEpisode({
    id: EPISODE_ID,
    drama_id: DRAMA_ID,
    storyboards: [
      {
        id: STORYBOARD_ID,
        scene_id: SCENE_ID,
        dialogue: '对白',
        narration: '旁白',
        shot_type: 'close',
        title: '推门',
        location: '办公室',
        time: '日',
        duration: 6,
        action: '推门',
        result: '进入',
        atmosphere: '紧张',
        angle: 'eye',
        angle_h: 'front',
        angle_v: 'level',
        angle_s: 'close',
        movement: 'push',
        lighting_style: 'soft',
        depth_of_field: 'shallow',
        layout_description: '左角色',
        characters: [{ id: CHAR_ID }],
        prop_ids: [PROP_ID],
        creation_mode: 'universal',
        universal_segment_text: '片段描述',
        video_reference_image_id: 101,
      },
      {
        id: OTHER_STORYBOARD_ID,
        title: '切镜',
        characters: [],
        prop_ids: [],
      },
    ],
  })

  assert.equal(fields.sbTitle.value[STORYBOARD_ID], '推门')
  assert.equal(fields.sbTitle.value[OTHER_STORYBOARD_ID], '切镜')
  assert.equal(fields.sbDialogue.value[STORYBOARD_ID], '对白')
  assert.equal(fields.sbCreationMode.value[STORYBOARD_ID], 'universal')
  assert.deepEqual(fields.sbCharacterIds.value[STORYBOARD_ID], [CHAR_ID])
  assert.deepEqual(fields.sbPropIds.value[STORYBOARD_ID], [PROP_ID])
  assert.equal(fields.sbSceneId.value[STORYBOARD_ID], SCENE_ID)
  assertNoProjectIdKeys(fields)

  const snapshot = snapshotFilmCreateStoryboardFields(fields)
  fields.sbTitle.value = { [DRAMA_ID]: '误写项目', [EPISODE_ID]: '误写剧集' }
  fields.sbDialogue.value = {}
  applyFilmCreateStoryboardFieldsSnapshot(fields, snapshot)

  assert.equal(fields.sbTitle.value[STORYBOARD_ID], '推门')
  assert.equal(fields.sbTitle.value[OTHER_STORYBOARD_ID], '切镜')
  assert.equal(fields.sbDialogue.value[STORYBOARD_ID], '对白')
  assert.equal(fields.sbUniversalSegmentText.value[STORYBOARD_ID], '片段描述')
  assertNoProjectIdKeys(fields)
  assert.deepEqual(snapshotFilmCreateStoryboardFields(fields).sbTitle, snapshot.sbTitle)
})

test('制作页只解构字段袋并继续传给既有 composable', () => {
  assert.match(filmCreateSource, /useFilmCreateStoryboardFields\(\)/)
  assert.doesNotMatch(filmCreateSource, /const sbTitle = ref\(\{\}\)/)
  assert.doesNotMatch(filmCreateSource, /const sbCharacterIds = ref\(\{\}\)/)
  assert.match(
    filmCreateSource,
    /useFilmCreateUniversalSegment\(\{[\s\S]*sbTitle,[\s\S]*sbLocation,[\s\S]*sbTime,[\s\S]*sbAction,[\s\S]*sbDialogue,[\s\S]*sbNarration,[\s\S]*sbResult,[\s\S]*sbAtmosphere,[\s\S]*sbShotType,[\s\S]*sbMovement,[\s\S]*sbLayoutDescription/,
  )
  assert.match(
    filmCreateSource,
    /useFilmCreateStoryboardStateSync\(\{[\s\S]*sbCharacterIds,[\s\S]*sbTitle,[\s\S]*sbUniversalSegmentText,[\s\S]*sbVideoReferenceImageId/,
  )
  assert.match(
    filmCreateSource,
    /useFilmCreateStoryboardVideoFields\(\{[\s\S]*sbNarration,[\s\S]*sbCreationMode,[\s\S]*sbUniversalSegmentText,[\s\S]*sbDuration/,
  )
  assert.match(
    filmCreateSource,
    /useFilmCreateStoryboardPrompts\(\{[\s\S]*sbTitle,[\s\S]*sbLocation,[\s\S]*sbTime,[\s\S]*sbDuration,[\s\S]*sbAction,[\s\S]*sbDialogue,[\s\S]*sbNarration,[\s\S]*sbAtmosphere,[\s\S]*sbResult,[\s\S]*sbAngle,[\s\S]*sbAngleH,[\s\S]*sbAngleV,[\s\S]*sbAngleS,[\s\S]*sbMovement,[\s\S]*sbLighting,[\s\S]*sbDof,[\s\S]*sbShotType,[\s\S]*sbLayoutDescription,[\s\S]*sbCreationMode,[\s\S]*sbUniversalSegmentText,[\s\S]*sbVideoReferenceImageId/,
  )
})
