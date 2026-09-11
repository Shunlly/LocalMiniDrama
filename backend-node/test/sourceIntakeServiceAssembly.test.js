const assert = require('node:assert/strict');
const test = require('node:test');

const sourceIntakeService = require('../src/services/sourceIntakeService');
const assembly = require('../src/services/sourceIntakeServiceAssembly');

const {
  parseJson,
  toJson,
  normalizeMetadata,
  trimText,
  rowToSource,
  rowToItem,
  rowToEvent,
  rowToPlan,
} = assembly;

test('sourceIntakeService 公开装配 API 仍指向装配模块的同一函数', () => {
  assert.equal(sourceIntakeService.normalizeMetadata, normalizeMetadata);
  assert.equal(sourceIntakeService.rowToSource, rowToSource);
  assert.equal(sourceIntakeService.rowToItem, rowToItem);
  assert.equal(sourceIntakeService.rowToEvent, rowToEvent);
  assert.equal(sourceIntakeService.rowToPlan, rowToPlan);
});

test('JSON 解析与序列化兼容对象、空值和损坏字符串', () => {
  assert.equal(parseJson(null, { fallback: true }).fallback, true);
  assert.equal(parseJson('', 3), 3);
  assert.deepEqual(parseJson({ keep: 1 }), { keep: 1 });
  assert.deepEqual(parseJson('[1,2]'), [1, 2]);
  assert.equal(parseJson('{bad', null), null);
  assert.equal(toJson(null), '{}');
  assert.equal(toJson({ a: 1 }), '{"a":1}');
  assert.equal(toJson(['林夏']), '["林夏"]');
});

test('元数据只接受普通对象，数组和非法 JSON 回退为空对象', () => {
  assert.deepEqual(normalizeMetadata(null), {});
  assert.deepEqual(normalizeMetadata('{"source_language":"zh"}'), { source_language: 'zh' });
  assert.deepEqual(normalizeMetadata({ keep: true }), { keep: true });
  assert.deepEqual(normalizeMetadata('["not-object"]'), {});
  assert.deepEqual(normalizeMetadata('{bad'), {});
  assert.deepEqual(normalizeMetadata('[]'), {});
});

test('行装配原样保留 drama_id / source_id，不把编号互相顶替', () => {
  const dramaId = 11;
  const sourceId = 101;
  const episodeId = 7007;
  const itemId = 1001;
  const eventId = 3003;
  const planId = 5005;
  assert.notEqual(dramaId, sourceId);
  assert.notEqual(sourceId, episodeId);
  assert.notEqual(dramaId, episodeId);

  const source = rowToSource({
    id: sourceId,
    drama_id: dramaId,
    source_type: 'outline',
    title: '码头来源',
    raw_text_path: 'data/story_sources/11/abc.txt',
    content_hash: 'hash',
    metadata: '{"source_language":"zh"}',
    created_at: '2026-01-01',
  });
  assert.equal(source.id, sourceId);
  assert.equal(source.drama_id, dramaId);
  assert.deepEqual(source.metadata, { source_language: 'zh' });

  const item = rowToItem({
    id: itemId,
    source_id: sourceId,
    item_type: 'outline',
    item_no: 1,
    title: '条目',
    raw_text: '林夏发现一封信',
    summary: '林夏发现一封信',
    status: 'ready',
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
  });
  assert.equal(item.id, itemId);
  assert.equal(item.source_id, sourceId);
  assert.equal(item.status, 'ready');
  assert.notEqual(item.source_id, episodeId);

  const event = rowToEvent({
    id: eventId,
    drama_id: dramaId,
    source_item_id: itemId,
    event_no: 1,
    title: '发现信件',
    detail: '林夏发现一封信',
    characters: '["林夏"]',
    location: '旧码头',
    tension: 3,
    hook_score: 4,
    created_at: '2026-01-01',
  });
  assert.equal(event.id, eventId);
  assert.equal(event.drama_id, dramaId);
  assert.equal(event.source_item_id, itemId);
  assert.deepEqual(event.characters, ['林夏']);
  assert.deepEqual(rowToEvent({ ...event, characters: '{bad}' }).characters, []);

  const plan = rowToPlan({
    id: planId,
    drama_id: dramaId,
    source_id: sourceId,
    target_episode_count: 2,
    style: 'realistic',
    plan_json: '{"episodes":[]}',
    status: 'draft',
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
  });
  assert.equal(plan.id, planId);
  assert.equal(plan.drama_id, dramaId);
  assert.equal(plan.source_id, sourceId);
  assert.notEqual(plan.id, plan.drama_id);
  assert.notEqual(plan.source_id, episodeId);
  assert.deepEqual(plan.plan_json, { episodes: [] });
  assert.equal(plan.status, 'draft');
});

test('文本截断会去掉多余空白并在超长时追加省略号', () => {
  assert.equal(trimText('  林夏  发现信件  '), '林夏 发现信件');
  assert.equal(trimText('abcdefghij', 7), 'abcd...');
  assert.equal(trimText('短文本', 20), '短文本');
});
