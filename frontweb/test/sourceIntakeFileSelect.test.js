import test from 'node:test'
import assert from 'node:assert/strict'

import { SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE } from '../src/utils/sourceWorkflowState.js'
import {
  MAX_SOURCE_FILE_BYTES,
  SOURCE_FILE_ACCEPT,
  SOURCE_FILE_EXTENSIONS,
  createSourceIntakeFileSelectController,
} from '../src/components/sourceIntake/sourceIntakeFileSelect.js'

function ref(value) {
  return { value }
}

function createController(form = { title: '', source_type: '', text: '旧文本' }) {
  const messages = []
  const sourceFileInput = { value: { value: 'keep-me' } }
  const controller = createSourceIntakeFileSelectController({
    form,
    sourceFile: ref(null),
    selectedFilename: ref(''),
    sourceFileReading: ref(false),
    sourceOperationMessage: ref(''),
    sourceOperationError: ref(''),
    sourceFileInput,
    showWorkflowMessage: (type, message) => messages.push([type, message]),
  })
  return { ...controller, form, messages, sourceFileInput }
}

function fakeFile(name, { size = 12, type = 'text/plain', text = '正文' } = {}) {
  return {
    name,
    size,
    type,
    text: async () => text,
  }
}

test('素材文件选择拒绝不支持格式、空文件和超大文件', async () => {
  const { handleSourceFile, messages } = createController()
  await handleSourceFile({ target: { files: [fakeFile('story.exe')] } })
  assert.equal(messages[0][0], 'warning')
  assert.equal(messages[0][1], SOURCE_FILE_FORMAT_UNSUPPORTED_MESSAGE)

  const empty = createController()
  await empty.handleSourceFile({ target: { files: [fakeFile('a.txt', { size: 0 })] } })
  assert.match(empty.messages[0][1], /素材文件为空/)

  const huge = createController()
  await huge.handleSourceFile({ target: { files: [fakeFile('a.txt', { size: MAX_SOURCE_FILE_BYTES + 1 })] } })
  assert.match(huge.messages[0][1], /20MB/)
})

test('文本文件会读入 form.text，二进制媒体只保留上传文件', async () => {
  const textCase = createController({ title: '', source_type: '', text: '' })
  await textCase.handleSourceFile({ target: { files: [fakeFile('雨巷.txt', { text: '撑着油纸伞' })] } })
  assert.equal(textCase.form.text, '撑着油纸伞')
  assert.equal(textCase.form.title, '雨巷')
  assert.match(textCase.messages.at(-1)[1], /已选择 雨巷.txt/)

  const pdf = createController({ title: '已有标题', source_type: 'novel', text: '旧文本' })
  await pdf.handleSourceFile({
    target: { files: [fakeFile('scan.pdf', { type: 'application/pdf', size: 2048, text: 'should-not-read' })] },
  })
  assert.equal(pdf.form.text, '')
  assert.equal(pdf.form.title, '已有标题')
  assert.equal(pdf.form.source_type, 'novel')
})

test('接受列表覆盖文本与媒体扩展名', () => {
  assert.match(SOURCE_FILE_ACCEPT, /\.txt/)
  assert.match(SOURCE_FILE_ACCEPT, /\.pdf/)
  assert.match(SOURCE_FILE_ACCEPT, /\.mp4/)
  assert.ok(SOURCE_FILE_EXTENSIONS.includes('.webp'))
})
