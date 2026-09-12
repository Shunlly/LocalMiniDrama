const assert = require('node:assert/strict');
const test = require('node:test');

const sourceIntakeService = require('../src/services/sourceIntakeService');
const status = require('../src/services/sourceIntakeServiceStatus');

const {
  SOURCE_TYPES,
  normalizeSourceType,
  splitSourceItems,
  buildEventEdges,
  buildStoryEvents,
  buildAdaptationPlan,
  estimateTension,
  extractCharacters,
  extractLocation,
} = status;

const DRAMA_ID = 11;
const SOURCE_ID = 101;
const EPISODE_ID = 7007;

test('跨模块 ID 在状态计算反例中互不相等', () => {
  assert.notEqual(DRAMA_ID, SOURCE_ID);
  assert.notEqual(SOURCE_ID, EPISODE_ID);
  assert.notEqual(DRAMA_ID, EPISODE_ID);
});

test('sourceIntakeService 公开状态计算 API 仍指向状态模块的同一函数', () => {
  assert.equal(sourceIntakeService.SOURCE_TYPES, SOURCE_TYPES);
  assert.equal(sourceIntakeService.normalizeSourceType, normalizeSourceType);
  assert.equal(sourceIntakeService.splitSourceItems, splitSourceItems);
  assert.equal(sourceIntakeService.buildEventEdges, buildEventEdges);
});

test('来源类型识别保留用户指定值，否则按文本规则分类', () => {
  assert.equal(normalizeSourceType('script', 'anything'), 'script');
  assert.equal(normalizeSourceType('STORYBOARD', ''), 'storyboard');
  assert.equal(normalizeSourceType('', 'shot 1 wide gate'), 'storyboard');
  assert.equal(normalizeSourceType('', 'Episode 1\nINT. Tea House\n对白：离开。'), 'script');
  assert.equal(normalizeSourceType('', '[00:00] Aria: Hello'), 'transcript');
  assert.equal(normalizeSourceType('', '漫画格子 panel 1'), 'comic');
  assert.equal(normalizeSourceType('', '一段很短的大纲'), 'outline');
});

test('条目拆分会保留标题行正文，并把条目状态设为 ready', () => {
  const storyboardItems = splitSourceItems(
    'storyboard',
    'shot 1 wide exterior gate action\nshot 2 close letter on stone',
    'Storyboard'
  );
  assert.equal(storyboardItems.length, 2);
  assert.equal(storyboardItems[0].status, 'ready');
  assert.equal(storyboardItems[0].raw_text.includes('exterior gate'), true);
  assert.equal(storyboardItems[1].item_no, 2);

  const transcriptItems = splitSourceItems(
    'transcript',
    '[00:00] Aria: Did you hear it?\n[00:03] Bo: Someone is outside the gate.',
    'Transcript'
  );
  assert.equal(transcriptItems.length, 2);
  assert.equal(transcriptItems.every((item) => item.status === 'ready'), true);
  assert.equal(transcriptItems[1].raw_text.includes('outside the gate'), true);
});

test('事件张力、角色和地点状态从正文计算，不读取剧集编号', () => {
  const text = '角色：林夏、顾言。地点：旧码头。林夏发现一封秘密警告信！';
  assert.equal(extractLocation(text), '旧码头');
  assert.equal(extractCharacters(text).includes('林夏'), true);
  assert.equal(extractCharacters(text).includes('顾言'), true);
  assert.equal(estimateTension(text) >= 3, true);
  assert.equal(estimateTension('平淡叙述'), 1);
});

test('事件边和改编方案分别写入 drama_id 与 source_id，不用 episode_id 顶替', () => {
  const items = splitSourceItems(
    'storyboard',
    [
      '镜头一 角色：林夏、顾言。地点：旧码头。林夏发现一封秘密警告信。',
      '镜头二 因此顾言与守卫发生冲突，二人逃亡。',
      '镜头三 突然地图被偷走，最后留下悬念。',
    ].join('\n'),
    '中文分镜'
  ).map((item, index) => ({ ...item, id: 1001 + index }));
  const events = buildStoryEvents(DRAMA_ID, 'storyboard', items).map((event, index) => ({
    ...event,
    id: 3003 + index,
    source_item_id: items[index].id,
  }));

  assert.equal(events.every((event) => event.drama_id === DRAMA_ID), true);
  assert.equal(events.some((event) => event.drama_id === SOURCE_ID), false);
  assert.equal(events.some((event) => event.drama_id === EPISODE_ID), false);

  const edges = buildEventEdges(DRAMA_ID, SOURCE_ID, events);
  assert.equal(edges.length >= 2, true);
  assert.equal(edges.every((edge) => edge.drama_id === DRAMA_ID), true);
  assert.equal(edges.every((edge) => edge.source_id === SOURCE_ID), true);
  assert.equal(edges.some((edge) => edge.source_id === EPISODE_ID), false);
  assert.equal(edges.some((edge) => edge.drama_id === SOURCE_ID), false);
  const relationTypes = new Set(edges.map((edge) => edge.relation_type));
  assert.equal(relationTypes.has('next'), true);
  assert.equal(relationTypes.has('conflict'), true);
  assert.equal(relationTypes.has('reveal'), true);
  assert.equal(relationTypes.has('hook'), true);

  const plan = buildAdaptationPlan({
    dramaId: DRAMA_ID,
    sourceId: SOURCE_ID,
    sourceType: 'storyboard',
    title: '中文分镜',
    items,
    events,
    targetEpisodeCount: 1,
    style: 'realistic',
  });
  assert.equal(plan.drama_id, DRAMA_ID);
  assert.equal(plan.source_id, SOURCE_ID);
  assert.notEqual(plan.drama_id, plan.source_id);
  assert.notEqual(plan.source_id, EPISODE_ID);
  assert.equal(plan.episodes[0].beats.length >= 1, true);
  assert.equal(plan.episodes[0].continuity_notes.characters.includes('林夏'), true);
});
