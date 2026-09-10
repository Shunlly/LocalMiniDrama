const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const indexSrc = fs.readFileSync(path.join(__dirname, '../src/routes/index.js'), 'utf8');
const sourceSrc = fs.readFileSync(path.join(__dirname, '../src/routes/storySources.js'), 'utf8');

const leftover = [
  'Insufficient temporary disk space for ZIP upload',
  'ZIP upload exceeds 256MB',
  'Source Intake uploads are limited to 20MB.',
  'Insufficient storage capacity for the source original.',
  'Story source not found',
  'Adaptation plan not found',
  'Source upload metadata is limited to 64KB.',
  'Save and enable the provider configuration before making provider network requests.',
  'Provider URL must match an enabled saved provider configuration.',
];

test('intake routes keep leftover English errors out of user-facing responses', () => {
  for (const phrase of leftover) {
    assert.equal(indexSrc.includes(phrase), false, phrase);
    assert.equal(sourceSrc.includes(phrase), false, phrase);
  }
  assert.match(indexSrc, /素材导入文件不能超过 20MB/);
  assert.match(indexSrc, /ZIP 上传超过 256MB 上限/);
  assert.match(indexSrc, /请先保存并启用该 Provider 配置/);
  assert.match(sourceSrc, /找不到该素材源/);
  assert.match(sourceSrc, /存储空间不足，无法保存原始素材/);
});

test('scene/prop extract empty-script errors stay Chinese and actionable', () => {
  const sceneSrc = fs.readFileSync(path.join(__dirname, '../src/services/backgroundExtractionService.js'), 'utf8');
  const propSrc = fs.readFileSync(path.join(__dirname, '../src/services/propExtractionService.js'), 'utf8');
  assert.match(sceneSrc, /当前集还没有剧本，无法提取场景/);
  assert.match(sceneSrc, /剧集不存在，无法提取场景/);
  assert.match(propSrc, /当前集还没有剧本，无法提取道具/);
  assert.match(propSrc, /剧集不存在，无法提取道具/);
});
