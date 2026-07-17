import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'

const apiSource = readFileSync(new URL('../src/api/scenes.js', import.meta.url), 'utf8')
const componentUrl = new URL('../src/components/dramaCanvas/CanvasAssetPanel.vue', import.meta.url)
const componentSource = readFileSync(componentUrl, 'utf8')

test('scene API exposes the dedicated panorama generation endpoint', () => {
  assert.match(apiSource, /generatePanorama\(sceneId, data = \{\}\)/)
  assert.match(apiSource, /`\/scenes\/\$\{sceneId\}\/generate-panorama`/)
})

test('canvas scene asset panel compiles with panorama command, task feedback, and 2:1 preview', () => {
  const { descriptor, errors } = parse(componentSource, { filename: componentUrl.pathname })
  assert.deepEqual(errors, [])
  assert.doesNotThrow(() => compileScript(descriptor, {
    id: 'scene-panorama-contract',
    inlineTemplate: true,
  }))

  assert.match(componentSource, /Picture, Refresh/)
  assert.match(componentSource, /sceneAPI\.generatePanorama\(props\.entity\.id\)/)
  assert.match(componentSource, /taskAPI\.get\(taskId\)/)
  assert.match(componentSource, /panoramaGenerating/)
  assert.match(componentSource, /class="panorama-error" role="alert"/)
  assert.match(componentSource, /aspect-ratio:\s*2 \/ 1/)
  assert.match(componentSource, /panorama_local_path/)
  assert.match(componentSource, /panorama_image_url/)
  assert.doesNotMatch(componentSource, /无缝|保证.*全景/)
})
