import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function listVueFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) listVueFiles(full, acc)
    else if (name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

function unlabeledButtons(source) {
  const start = source.indexOf('<template')
  const end = source.indexOf('<script', start)
  if (start < 0 || end < 0) return []
  const template = source.slice(start, end)
  const unlabeled = []
  const matcher = /<(el-button|button)\b/gi
  let match
  while ((match = matcher.exec(template))) {
    let quote = ''
    let index = matcher.lastIndex
    for (; index < template.length; index += 1) {
      const ch = template[index]
      if (quote) {
        if (ch === quote) quote = ''
      } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
    }
    const opening = template.slice(match.index, index + 1)
    if (!/\s(?::|v-bind:)?aria-(?:label|labelledby)\s*=/.test(opening)) {
      unlabeled.push(template.slice(0, match.index).split('\n').length)
    }
  }
  return unlabeled
}

test('前端 Vue 源码里的 button/el-button 都有 aria-label 或 aria-labelledby', () => {
  const root = new URL('../src', import.meta.url)
  const files = listVueFiles(root.pathname.replace(/^\//, ''))
  const missing = []
  for (const file of files) {
    const unlabeled = unlabeledButtons(readFileSync(file, 'utf8'))
    if (unlabeled.length) missing.push(`${file}:${unlabeled.join(',')}`)
  }
  assert.deepEqual(missing, [])
})

test('项目列表新建编辑、就绪度和画布空态保持中文操作名', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  assert.match(read('../src/views/FilmList.vue'), /aria-label="取消新建项目"/)
  assert.match(read('../src/views/FilmList.vue'), /'保存项目'/)
  assert.match(read('../src/components/ProjectReadinessPanel.vue'), /'查看详情'/)
  assert.match(read('../src/components/dramaCanvas/FreeCanvasEmptyStart.vue'), /aria-label="新建文本节点"/)
  assert.match(read('../src/components/dramaCanvas/CanvasLoadFailureCard.vue'), /aria-label="返回项目列表"/)
})
