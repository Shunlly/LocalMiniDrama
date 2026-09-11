const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateStoryboard,
  generateTextForStoryboard,
  processStoryboardGeneration,
} = require('../src/services/episodeStoryboardProcess');
const {
  generateTextForStoryboard: generateTextForStoryboardImpl,
  processStoryboardGeneration: processStoryboardGenerationImpl,
} = require('../src/services/episodeStoryboardProcessGenerate');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

test('公开 API 的 generateStoryboard 与生成编排模块是同一函数', () => {
  assert.equal(episodeStoryboardService.generateStoryboard, generateStoryboard);
});

test('处理主体从编排模块再导出，且与处理模块是同一函数', () => {
  assert.equal(generateTextForStoryboard, generateTextForStoryboardImpl);
  assert.equal(processStoryboardGeneration, processStoryboardGenerationImpl);
});
