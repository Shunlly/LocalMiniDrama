/**
 * 批量导入剧集：按章节正则切分小说/剧本，并按每集章节数组装导入载荷。
 */

export const DEFAULT_CHAPTER_PATTERN = '^\\s*(第[0-9０-９零一二三四五六七八九十百千万]+[章回节][^\\n\\r]*)'

export function createChapterRegex(pattern) {
  const source = String(pattern || '').trim()
  if (!source) throw new Error('请输入章节正则')
  try {
    return new RegExp(source, 'gm')
  } catch {
    throw new Error('章节正则格式不正确')
  }
}

export function splitNovelChapters(text, pattern) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const regex = createChapterRegex(pattern)
  const matches = [...normalized.matchAll(regex)]
  if (!matches.length) throw new Error('未匹配到任何章节，请调整章节正则')
  return matches.map((match, index) => {
    const title = String(match[1] || match[0] || '').trim()
    const titleStart = match.index ?? 0
    const contentStart = titleStart + String(match[0] || '').length
    const nextTitleStart = index + 1 < matches.length
      ? (matches[index + 1].index ?? normalized.length)
      : normalized.length
    const content = normalized.slice(contentStart, nextTitleStart).trim()
    return {
      title: title || `第${index + 1}章`,
      content,
    }
  }).filter((chapter) => chapter.title || chapter.content)
}

export function buildEpisodesFromChapters(chapters, sizeValue, startEpisodeNumber = 1) {
  const size = Math.max(1, Number(sizeValue) || 1)
  const start = Number(startEpisodeNumber) || 1
  return chapters.reduce((list, chapter, index) => {
    const groupIndex = Math.floor(index / size)
    if (!list[groupIndex]) {
      list[groupIndex] = {
        title: '',
        script_content: '',
        chapter_titles: [],
      }
    }
    list[groupIndex].chapter_titles.push(chapter.title)
    list[groupIndex].script_content = [list[groupIndex].script_content, `${chapter.title}\n${chapter.content}`].filter(Boolean).join('\n\n')
    return list
  }, []).map((episode, index) => ({
    episode_number: start + index,
    title: episode.chapter_titles.length === 1
      ? episode.chapter_titles[0]
      : `${episode.chapter_titles[0]} - ${episode.chapter_titles[episode.chapter_titles.length - 1]}`,
    script_content: episode.script_content,
    chapter_titles: episode.chapter_titles,
  }))
}
