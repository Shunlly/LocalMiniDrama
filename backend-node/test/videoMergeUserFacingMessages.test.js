const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('videoMergeService 远程下载错误为简体中文', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeService.js'), 'utf8');
  const userFacing = source
    .split('\n')
    .filter((line) => /throw new Error\(|throw strictMergeError\(/.test(line))
    .join('\n');
  assert.equal(userFacing.includes('remote video merge download budget exhausted'), false);
  assert.equal(userFacing.includes('empty response body'), false);
  assert.match(source, /远程视频下载配额已用完/);
  assert.match(source, /远程视频为空，无法合成/);
});
