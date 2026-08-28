'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

const skill = read('openclaw-skill', 'SKILL.md')
const readme = read('openclaw-skill', 'README.md')
const manifest = JSON.parse(read('openclaw-skill', 'skill.json'))
const tools = JSON.parse(read('openclaw-skill', 'tools.json'))
const httpTool = tools.tools.find((tool) => tool.name === 'http')

const characterGeneration = read('backend-node', 'src', 'services', 'characterGenerationService.js')
const promptOverrides = read('backend-node', 'src', 'routes', 'promptOverrides.js')
const taskService = read('backend-node', 'src', 'services', 'taskService.js')
const aiConfigRoutes = read('backend-node', 'src', 'routes', 'aiConfig.js')
const dramaRoutes = read('backend-node', 'src', 'routes', 'drama.js')
const dramaService = read('backend-node', 'src', 'services', 'dramaService.js')
const responseHelpers = read('backend-node', 'src', 'response.js')
const storyboardService = read('backend-node', 'src', 'services', 'episodeStoryboardService.js')
const imageService = read('backend-node', 'src', 'services', 'imageService.js')

test('backend sources expose the authoritative OpenClaw field contract', () => {
  assert.match(characterGeneration, /let outlineText = req\.outline \|\| ''/)
  assert.match(characterGeneration, /if \(!outlineText\)[\s\S]*dramaRow\.title[\s\S]*dramaRow\.description[\s\S]*dramaRow\.genre/)
  assert.match(characterGeneration, /if \(req\.episode_id\)[\s\S]*DELETE FROM episode_characters/)
  assert.match(characterGeneration, /SELECT drama_id FROM episodes WHERE id = \? AND deleted_at IS NULL/)
  assert.match(characterGeneration, /episode_id must belong to drama_id/)
  assert.doesNotMatch(characterGeneration, /req\.count/)

  assert.match(promptOverrides, /const \{ content \} = req\.body \|\| \{\}/)
  assert.match(taskService, /id: row\.id[\s\S]*result: row\.result/)
  assert.match(aiConfigRoutes, /function bulkUpdateKey[\s\S]*if \(!aiConfigService\.getVendorLockStatus\(cfg\)\.enabled\)/)

  assert.match(dramaRoutes, /response\.created\(res, drama\)/)
  assert.match(dramaService, /return getDramaById\(db, id\)/)
  assert.match(dramaService, /function rowToDrama[\s\S]*id: r\.id/)
  assert.match(responseHelpers, /function created\(res, data\)[\s\S]*\{ success: true, data \}/)
  assert.match(storyboardService, /meta\.video_clip_duration/)
  assert.match(imageService, /JOIN episodes e ON e\.id = s\.episode_id AND e\.deleted_at IS NULL/)
  assert.match(imageService, /storyboard_id must belong to drama_id/)
})

test('character extraction documentation matches outline, episode_id and count behavior', () => {
  assert.match(skill, /`outline`[^\n]*提取输入/)
  assert.match(skill, /项目标题[^\n]*简介[^\n]*类型/)
  assert.match(skill, /`episode_id`[^\n]*角色关联/)
  assert.match(skill, /不会自动读取[^\n]*分集剧本/)
  assert.match(skill, /`count`[^\n]*不支持/)
  assert.doesNotMatch(skill, /"count"\s*:\s*10/)
})

test('task polling and drama creation identifiers are documented without conflation', () => {
  assert.match(skill, /任务创建响应[^\n]*`data\.task_id`/)
  assert.match(skill, /任务查询响应[^\n]*`data\.id`/)
  assert.match(skill, /`result`[^\n]*JSON 字符串/)
  assert.match(skill, /POST \/api\/v1\/dramas[\s\S]{0,180}data\.id/)
  assert.doesNotMatch(skill, /POST \/api\/v1\/dramas[\s\S]{0,180}返回[^\n]*drama_id/)
})

test('prompt override and vendor-lock-only key rotation are documented exactly', () => {
  assert.match(skill, /settings\/prompts\/\{key\}[^\n]*\{ "content": "\.\.\." \}/)
  assert.doesNotMatch(skill, /settings\/prompts\/\{key\}[^\n]*\{ "value":/)
  assert.match(skill, /bulk-update-key[^\n]*仅[^\n]*厂商锁定模式|厂商锁定模式[^\n]*专用[^\n]*bulk-update-key/)
  assert.match(skill, /ai-configs\/vendor-lock/)
})

test('all OpenClaw artifacts agree on project clip duration and response semantics', () => {
  assert.ok(httpTool, 'tools.json must define the http tool')
  assert.ok(manifest.config.default_video_clip_duration)
  assert.ok(manifest.config.default_video_duration, 'legacy duration config must remain as a compatibility alias')
  assert.match(manifest.config.default_video_duration.description, /兼容|弃用/)
  assert.match(skill, /^  default_video_clip_duration:$/m)
  assert.match(skill, /^  default_video_duration:$/m)
  assert.match(skill, /default_video_duration[^\n]*兼容|兼容[^\n]*default_video_duration/)
  assert.match(skill, /"video_clip_duration"\s*:\s*5/)
  assert.match(skill, /`video_duration`[^\n]*总时长/)

  for (const source of [readme, httpTool.description]) {
    assert.match(source, /data\.id/)
    assert.match(source, /task_id/)
    assert.match(source, /JSON 字符串/)
    assert.match(source, /video_clip_duration/)
    assert.match(source, /content/)
    assert.match(source, /厂商锁定/)
  }
})

test('examples use actual drama fields and wrapped asynchronous response paths', () => {
  assert.match(skill, /"genre"\s*:\s*"[^"]+"/)
  assert.doesNotMatch(skill, /"type"\s*:\s*"short_drama"/)
  assert.doesNotMatch(skill, /(?:→\s*)?返回\s*`?\{\s*"task_id"/)
  assert.match(skill, /data\.task_id/)
  assert.match(skill, /data\.id/)
  assert.match(skill, /data\.merge_id/)
})

test('new-project workflows do not require pre-existing project context', () => {
  assert.doesNotMatch(skill, /^requiredContext:/m)
})
