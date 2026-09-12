const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

test('videoMerge 远程下载与后处理错误为简体中文', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeService.js'), 'utf8');
  const executionSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeExecution.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeExecutionWorker.js'), 'utf8');
  const lifecycleSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeExecutionLifecycle.js'), 'utf8');
  const normalizeSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeExecutionNormalize.js'), 'utf8');
  const processSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeProcess.js'), 'utf8');
  const errorSource = fs.readFileSync(path.join(__dirname, '../src/services/videoMergeErrors.js'), 'utf8');
  const source = `${serviceSource}\n${executionSource}\n${workerSource}\n${lifecycleSource}\n${normalizeSource}\n${processSource}\n${errorSource}`;
  const userFacing = source
    .split('\n')
    .filter((line) => /throw new Error\(|throw strictMergeError\(/.test(line))
    .join('\n');
  assert.equal(userFacing.includes('remote video merge download budget exhausted'), false);
  assert.equal(userFacing.includes('empty response body'), false);
  assert.match(source, /远程视频下载配额已用完/);
  assert.match(source, /远程视频为空，无法合成/);
  assert.match(errorSource, /function describePostProcessFailure\(error\)/);
  assert.match(source, /当前没有可执行的成片后处理项/);
  assert.match(source, /当前没有可烧录的旁白/);
  assert.match(workerSource, /严格生产后处理失败：\$\{describePostProcessFailure\(post\.error\)\}/);
  assert.equal(source.includes('严格生产后处理失败：${post.error'), false);
});
