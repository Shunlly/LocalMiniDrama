import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CHAPTER_PATTERN,
  splitNovelChapters,
  buildEpisodesFromChapters,
} from '../src/components/episodeBatchImport/episodeBatchImportChapters.js'

test('空文本不生成章节，非法正则给出中文错误', () => {
  assert.deepEqual(splitNovelChapters('   \n', DEFAULT_CHAPTER_PATTERN), [])
  assert.throws(() => splitNovelChapters('第一章\n正文', '('), /章节正则格式不正确/)
  assert.throws(() => splitNovelChapters('没有章节标题的正文', DEFAULT_CHAPTER_PATTERN), /未匹配到任何章节/)
})

test('按默认正则切分章节，并按每集章节数组装集数', () => {
  const chapters = splitNovelChapters('第一章 开场\n甲出场。\n第二章 转折\n乙登场。', DEFAULT_CHAPTER_PATTERN)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, '第一章 开场')
  assert.match(chapters[0].content, /甲出场/)
  const episodes = buildEpisodesFromChapters(chapters, 2, 3)
  assert.equal(episodes.length, 1)
  assert.equal(episodes[0].episode_number, 3)
  assert.equal(episodes[0].title, '第一章 开场 - 第二章 转折')
  assert.deepEqual(episodes[0].chapter_titles, ['第一章 开场', '第二章 转折'])
})
