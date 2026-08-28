import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const requestSource = readFileSync(new URL('../src/utils/request.js', import.meta.url), 'utf8')
const feedbackSource = readFileSync(new URL('../src/utils/elementPlusFeedback.js', import.meta.url), 'utf8')

test('entry loads Element Plus config provider and dialog on demand', () => {
  assert.match(mainSource, /defineAsyncComponent/)
  assert.match(
    mainSource,
    /const AccessibleDialog = defineAsyncComponent\(\(\) => import\('\.\/components\/AccessibleDialog\.vue'\)\)/,
  )
  assert.match(
    mainSource,
    /import \{ ElConfigProvider \} from 'element-plus\/es\/components\/config-provider\/index\.mjs'/,
  )
  assert.doesNotMatch(mainSource, /element-plus\/es\/components\/message\/style\/css/)
  assert.doesNotMatch(mainSource, /import AccessibleDialog from '\.\/components\/AccessibleDialog\.vue'/)
})

test('request feedback loads Element Plus message modules outside the entry', () => {
  assert.match(feedbackSource, /element-plus\/es\/components\/message\/index\.mjs/)
  assert.match(feedbackSource, /element-plus\/es\/components\/message-box\/index\.mjs/)
  assert.match(requestSource, /from '\.\/elementPlusFeedback\.js'/)
  assert.match(requestSource, /describeServiceLoadError/)
  assert.match(requestSource, /isRequestCanceled/)
})
