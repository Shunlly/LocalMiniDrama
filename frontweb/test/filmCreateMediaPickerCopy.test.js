import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useFilmCreateMediaPickerCopy } from '../src/composables/filmCreate/useFilmCreateMediaPickerCopy.js'

test('素材选择器文案区分主参考图和追加自由参考图', () => {
  const mode = ref('reference-primary')
  const target = ref({ storyboard_number: 3 })
  const currentEpisode = ref({ episode_number: 2 })
  const store = { drama: { title: '示例项目' } }
  const copy = useFilmCreateMediaPickerCopy({
    globalMediaPickerMode: mode,
    globalMediaPickerTarget: target,
    currentEpisode,
    store,
  })
  assert.equal(copy.globalMediaPickerAccept.value, 'image')
  assert.equal(copy.globalMediaPickerTitle.value, '从素材中心选择视频主参考图')
  assert.equal(copy.globalMediaPickerContext.value.projectTitle, '示例项目')
  assert.equal(copy.globalMediaPickerContext.value.episodeLabel, '第2集')
  assert.equal(copy.globalMediaPickerContext.value.storyboardLabel, '分镜 #3')
  assert.match(copy.globalMediaPickerContext.value.usageLabel, /自由参考图首位/)

  mode.value = 'reference-append'
  assert.equal(copy.globalMediaPickerTitle.value, '从素材中心添加自由参考图')
  assert.match(copy.globalMediaPickerContext.value.usageLabel, /追加到当前分镜/)
})
