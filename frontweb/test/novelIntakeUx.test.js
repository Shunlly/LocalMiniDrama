import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MAX_NOVEL_FILE_BYTES,
  MAX_NOVEL_TEXT_BYTES,
  NOVEL_INTAKE_FILE_HELP,
  NOVEL_INTAKE_HINT,
  NOVEL_INTAKE_LEAVE_COPY,
  NOVEL_INTAKE_MESSAGES,
  NOVEL_INTAKE_PLACEHOLDER,
  buildNovelIntakeConfirmCopy,
  createNovelIntakeLeaveGuard,
  inspectNovelIntakeBytes,
  inspectNovelIntakeFile,
  inspectNovelIntakeSubmit,
  inspectNovelIntakeText,
  novelIntakeHasDraft,
  novelIntakeLeaveReason,
  utf8ByteLength,
} from '../src/components/filmCreate/novelIntakeUx.js'

const dialogSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateNovelImportDialog.vue', import.meta.url),
  'utf8',
)
const filmCreateSource = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

function utf8(text) {
  return new TextEncoder().encode(text)
}

test('小说 intake 文案明确当前没有 OCR，且错误为中文', () => {
  for (const copy of [
    NOVEL_INTAKE_HINT,
    NOVEL_INTAKE_PLACEHOLDER,
    NOVEL_INTAKE_FILE_HELP,
    ...Object.values(NOVEL_INTAKE_MESSAGES),
    NOVEL_INTAKE_LEAVE_COPY.message,
    NOVEL_INTAKE_LEAVE_COPY.busyMessage,
    buildNovelIntakeConfirmCopy({ maxChapters: 8, aiSummarize: false }).message,
  ]) {
    assert.match(copy, /[\u4e00-\u9fff]/)
    assert.doesNotMatch(copy, /OCR 完成|已支持 OCR|支持图片 OCR|自动 OCR/)
    assert.doesNotMatch(copy, /\bFailed\b|\bInvalid UTF-8\b|\bencoding error\b/i)
  }
  assert.match(NOVEL_INTAKE_HINT, /当前没有图片 OCR/)
  assert.match(NOVEL_INTAKE_FILE_HELP, /当前没有 OCR/)
})

test('空文本、空文件和空白文件都会给出中文错误', async () => {
  assert.equal(inspectNovelIntakeText('').error, NOVEL_INTAKE_MESSAGES.emptyText)
  assert.equal(inspectNovelIntakeText('   \n').error, NOVEL_INTAKE_MESSAGES.emptyText)
  assert.equal(inspectNovelIntakeText('', { allowEmpty: true }).error, '')
  assert.equal(inspectNovelIntakeBytes(new Uint8Array(), { filename: 'empty.txt' }).error, NOVEL_INTAKE_MESSAGES.emptyFile)
  assert.equal(inspectNovelIntakeBytes(utf8('   \n'), { filename: 'blank.txt' }).error, NOVEL_INTAKE_MESSAGES.emptyFile)
  assert.equal(
    (await inspectNovelIntakeFile(new File([], 'empty.txt', { type: 'text/plain' }))).error,
    NOVEL_INTAKE_MESSAGES.emptyFile,
  )
})

test('超大文本按 UTF-8 字节拒绝，超大文件按 20MB 拒绝', async () => {
  const oversizedText = '汉'.repeat(Math.floor(MAX_NOVEL_TEXT_BYTES / 3) + 1)
  assert.ok(utf8ByteLength(oversizedText) > MAX_NOVEL_TEXT_BYTES)
  assert.equal(inspectNovelIntakeText(oversizedText).error, NOVEL_INTAKE_MESSAGES.oversizedText)
  assert.equal(
    inspectNovelIntakeBytes(new Uint8Array(MAX_NOVEL_TEXT_BYTES + 1), { filename: 'big.txt' }).error,
    NOVEL_INTAKE_MESSAGES.oversizedText,
  )
  const hugeFile = {
    name: 'huge.txt',
    size: MAX_NOVEL_FILE_BYTES + 1,
    arrayBuffer: async () => {
      throw new Error('should not read oversized file')
    },
  }
  assert.equal((await inspectNovelIntakeFile(hugeFile)).error, NOVEL_INTAKE_MESSAGES.oversizedFile)
  const unreadFile = {
    name: 'too-big.txt',
    size: MAX_NOVEL_TEXT_BYTES + 8,
    arrayBuffer: async () => {
      throw new Error('should not read oversized text')
    },
  }
  assert.equal((await inspectNovelIntakeFile(unreadFile)).error, NOVEL_INTAKE_MESSAGES.oversizedText)
})

test('非 UTF-8 编码和二进制文件失败，UTF-8 BOM 可以导入', async () => {
  assert.equal(
    inspectNovelIntakeBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), { filename: 'gbk.txt' }).error,
    NOVEL_INTAKE_MESSAGES.encoding,
  )
  assert.equal(
    inspectNovelIntakeBytes(new Uint8Array([0xff, 0xfe, 0x41, 0x00]), { filename: 'utf16.txt' }).error,
    NOVEL_INTAKE_MESSAGES.encoding,
  )
  assert.equal(
    inspectNovelIntakeBytes(new Uint8Array([0x41, 0x00, 0x42]), { filename: 'bin.txt' }).error,
    NOVEL_INTAKE_MESSAGES.binary,
  )
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('第一章 开场')])
  const decoded = inspectNovelIntakeBytes(bom, { filename: 'story.txt' })
  assert.equal(decoded.error, '')
  assert.equal(decoded.text, '第一章 开场')
  const gbkFile = new File([new Uint8Array([0xd6, 0xd0])], 'novel.txt', { type: 'text/plain' })
  assert.equal((await inspectNovelIntakeFile(gbkFile)).error, NOVEL_INTAKE_MESSAGES.encoding)
})

test('图片和 PDF 被拒绝，并说明当前没有 OCR', async () => {
  assert.equal(
    inspectNovelIntakeBytes(utf8('scan'), { filename: 'scan.png' }).error,
    NOVEL_INTAKE_MESSAGES.unsupportedType,
  )
  assert.match(NOVEL_INTAKE_MESSAGES.unsupportedType, /当前没有图片 OCR/)
  assert.equal(
    (await inspectNovelIntakeFile(new File([utf8('x')], 'scan.pdf', { type: 'application/pdf' }))).error,
    NOVEL_INTAKE_MESSAGES.unsupportedType,
  )
})

test('有效 UTF-8 文本和文件可以通过校验', async () => {
  assert.equal(inspectNovelIntakeText('第一章\n正文').error, '')
  const file = new File([utf8('第二章 相遇')], 'chapter.md', { type: 'text/markdown' })
  const result = await inspectNovelIntakeFile({ raw: file, name: 'chapter.md' })
  assert.equal(result.error, '')
  assert.equal(result.text, '第二章 相遇')
})

test('开始导入前校验空内容和确认文案', () => {
  assert.equal(inspectNovelIntakeSubmit({ mode: 'text', text: '' }).error, NOVEL_INTAKE_MESSAGES.emptyText)
  assert.equal(
    inspectNovelIntakeSubmit({ mode: 'file', fileName: '', fileAccepted: false }).error,
    NOVEL_INTAKE_MESSAGES.emptyFileSubmit,
  )
  assert.equal(
    inspectNovelIntakeSubmit({ mode: 'file', fileName: 'a.txt', fileAccepted: true }).error,
    '',
  )
  const copy = buildNovelIntakeConfirmCopy({ maxChapters: 6, aiSummarize: true })
  assert.equal(copy.title, '确认导入文本')
  assert.equal(copy.confirmButtonText, '开始导入')
  assert.match(copy.message, /最多 6 集/)
  assert.match(copy.message, /会消耗 Token/)
  assert.match(copy.message, /当前没有图片 OCR/)
  const plain = buildNovelIntakeConfirmCopy({ maxChapters: 3, aiSummarize: false })
  assert.match(plain.message, /不会把图片或扫描件识别成文字/)
})

test('离开保护区分导入中、草稿和干净状态', async () => {
  assert.equal(novelIntakeHasDraft({ text: '  ' }), false)
  assert.equal(novelIntakeHasDraft({ fileName: 'a.txt' }), true)
  assert.equal(novelIntakeLeaveReason({ importing: true, hasDraft: true }), 'busy')
  assert.equal(novelIntakeLeaveReason({ importing: false, hasDraft: true }), 'draft')
  assert.equal(novelIntakeLeaveReason({ importing: false, hasDraft: false }), '')

  const calls = []
  const guard = createNovelIntakeLeaveGuard({
    getVisible: () => true,
    getImporting: () => calls.importing === true,
    getHasDraft: () => calls.draft === true,
    warnBusy: () => { calls.busy = (calls.busy || 0) + 1 },
    confirmDraft: async () => {
      calls.confirm = (calls.confirm || 0) + 1
      if (calls.reject) throw new Error('cancel')
    },
  })

  calls.importing = true
  assert.equal(await guard.confirmLeave(), false)
  assert.equal(calls.busy, 1)

  calls.importing = false
  calls.draft = false
  assert.equal(await guard.confirmLeave(), true)
  assert.equal(calls.confirm, undefined)

  calls.draft = true
  assert.equal(await guard.confirmLeave(), true)
  assert.equal(calls.confirm, 1)

  calls.reject = true
  assert.equal(await guard.confirmLeave(), false)

  const event = { preventDefault() { calls.prevented = true }, returnValue: undefined }
  guard.handleBeforeUnload(event)
  assert.equal(calls.prevented, true)
  assert.equal(event.returnValue, '')
})

test('并发离开确认不会叠两个对话框', async () => {
  let release
  const pending = new Promise((resolve, reject) => { release = { resolve, reject } })
  const guard = createNovelIntakeLeaveGuard({
    getVisible: () => true,
    getImporting: () => false,
    getHasDraft: () => true,
    confirmDraft: () => pending,
  })
  const first = guard.confirmLeave()
  assert.equal(await guard.confirmLeave(), false)
  release.resolve()
  assert.equal(await first, true)
})

test('小说导入弹窗接入校验、确认文案和离开保护，且不宣称 OCR 完成', () => {
  assert.match(dialogSource, /from '@\/components\/filmCreate\/novelIntakeUx\.js'/)
  assert.match(dialogSource, /NOVEL_INTAKE_HINT/)
  assert.match(dialogSource, /inspectNovelIntakeFile/)
  assert.match(dialogSource, /inspectNovelIntakeSubmit/)
  assert.match(dialogSource, /buildNovelIntakeConfirmCopy/)
  assert.match(dialogSource, /createNovelIntakeLeaveGuard/)
  assert.match(dialogSource, /waitForParentFileReader/)
  assert.match(dialogSource, /fileReadToken/)
  assert.match(dialogSource, /:before-close="handleBeforeClose"/)
  assert.match(dialogSource, /window\.addEventListener\('beforeunload', leaveGuard\.handleBeforeUnload\)/)
  assert.match(dialogSource, /window\.removeEventListener\('beforeunload', leaveGuard\.handleBeforeUnload\)/)
  assert.match(dialogSource, /onBeforeRouteLeave/)
  assert.match(dialogSource, /@click="requestClose"/)
  assert.match(dialogSource, /ElMessageBox\.confirm\(copy\.message, copy\.title/)
  assert.match(dialogSource, /role="alert"/)
  assert.doesNotMatch(dialogSource, /@click="visible = false"/)
  assert.doesNotMatch(dialogSource, /OCR 完成|已支持 OCR|支持图片 OCR/)
  assert.match(dialogSource, /aria-label="最多导入集数"/)
  assert.match(dialogSource, /aria-label="小说导入方式"/)
  assert.match(dialogSource, /aria-label="小说正文"/)
  assert.match(filmCreateSource, /<FilmCreateNovelImportDialog/)
  assert.match(filmCreateSource, /@file-change="onNovelFileChange"/)
  assert.match(filmCreateSource, /@import="onImportNovel"/)
})
