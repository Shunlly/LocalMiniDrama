const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeStoryboardShotNumber,
  dedupeStoryboardRowsByNumber,
} = require('../src/services/episodeStoryboardOrdering');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

test('镜号规范化把字符串和对象字段收成正整数，非法值一律为 0', () => {
  assert.equal(normalizeStoryboardShotNumber(1), 1);
  assert.equal(normalizeStoryboardShotNumber('2'), 2);
  assert.equal(normalizeStoryboardShotNumber('2.9'), 2);
  assert.equal(normalizeStoryboardShotNumber({ shot_number: '3' }), 3);
  assert.equal(normalizeStoryboardShotNumber({ storyboard_number: 4 }), 4);
  assert.equal(normalizeStoryboardShotNumber({ shot_number: 5, storyboard_number: 9 }), 5);
  assert.equal(normalizeStoryboardShotNumber(0), 0);
  assert.equal(normalizeStoryboardShotNumber(-2), 0);
  assert.equal(normalizeStoryboardShotNumber('x'), 0);
  assert.equal(normalizeStoryboardShotNumber(null), 0);
  assert.equal(normalizeStoryboardShotNumber(undefined), 0);
});

test('同镜号只保留 id 最大的一行，无镜号行按 id 参与最终排序', () => {
  const rows = [
    { id: 10, storyboard_number: 2 },
    { id: 30, storyboard_number: 2 },
    { id: 20, storyboard_number: 1 },
    { id: 5, storyboard_number: 0 },
    { id: 7, storyboard_number: null },
  ];
  assert.deepEqual(
    dedupeStoryboardRowsByNumber(rows).map((row) => row.id),
    [5, 7, 20, 30]
  );
  assert.deepEqual(dedupeStoryboardRowsByNumber(null), []);
  assert.deepEqual(dedupeStoryboardRowsByNumber([]), []);
});

test('缺少 storyboard_number 时回退到对象上的 shot_number', () => {
  const rows = [
    { id: 2, shot_number: 1 },
    { id: 8, shot_number: 1 },
    { id: 3, shot_number: 2 },
  ];
  assert.deepEqual(
    dedupeStoryboardRowsByNumber(rows).map((row) => row.id),
    [3, 8]
  );
});

test('公开导出仍指向排序模块的同一实现', () => {
  assert.equal(
    episodeStoryboardService.normalizeStoryboardShotNumber,
    normalizeStoryboardShotNumber
  );
  assert.equal(
    episodeStoryboardService.dedupeStoryboardRowsByNumber,
    dedupeStoryboardRowsByNumber
  );
});
