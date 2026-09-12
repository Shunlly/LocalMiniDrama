const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ANTI_SPLIT_NEGATIVE_PROMPT,
} = require('../src/services/imageGateway/runtime');
const {
  resolveImageProtocol,
  injectNonGeminiReferencePrompt,
  buildMergedImageNegativePrompt,
  assembleImageProtocolRequest,
} = require('../src/services/imageGateway/requestAssembly');

describe('imageGateway 协议请求拼装', () => {
  it('显式 api_protocol 优先，未设置时按 provider/model 推断', () => {
    assert.equal(resolveImageProtocol({ provider: 'openai', api_protocol: 'Gemini' }, 'dall-e-3'), 'gemini');
    assert.equal(resolveImageProtocol({ provider: 'dashscope' }, 'qwen-image'), 'dashscope');
    assert.equal(resolveImageProtocol({ provider: 'openai' }, 'seedream-4.0'), 'volcengine');
    assert.equal(resolveImageProtocol({ provider: 'kling' }, 'kling-v1'), 'kling');
    assert.equal(resolveImageProtocol({ provider: 'openai' }, 'dall-e-3'), 'openai');
  });

  it('非 Gemini 才把 Image N 标签注入 prompt，Gemini 保持原文', () => {
    const systemPrompt = 'Image 1: character sheet\nImage 2: scene layout\n其他说明';
    const refs = ['https://cdn.example/a.png', 'https://cdn.example/b.png'];
    const injected = injectNonGeminiReferencePrompt('openai', '夜雨巷口', systemPrompt, refs);
    assert.match(injected, /FOR REFERENCE ONLY/);
    assert.match(injected, /GENERATE THIS SCENE/);
    assert.match(injected, /夜雨巷口/);
    assert.equal(
      injectNonGeminiReferencePrompt('gemini', '夜雨巷口', systemPrompt, refs),
      '夜雨巷口'
    );
    assert.equal(
      injectNonGeminiReferencePrompt('openai', '夜雨巷口', systemPrompt, []),
      '夜雨巷口'
    );
    assert.equal(
      injectNonGeminiReferencePrompt('openai', '夜雨巷口', '没有标签', refs),
      '夜雨巷口'
    );
  });

  it('Seedream/Volcengine 或超过 1 张参考图才自动拼分割抑制负面词', () => {
    assert.equal(buildMergedImageNegativePrompt('openai', 'dall-e-3', 1, ''), '');
    assert.equal(
      buildMergedImageNegativePrompt('openai', 'dall-e-3', 1, ' blurry '),
      'blurry'
    );
    assert.equal(
      buildMergedImageNegativePrompt('openai', 'dall-e-3', 2, ''),
      ANTI_SPLIT_NEGATIVE_PROMPT
    );
    assert.equal(
      buildMergedImageNegativePrompt('volcengine', 'generic', 0, 'blurry'),
      `${ANTI_SPLIT_NEGATIVE_PROMPT}, blurry`
    );
    assert.equal(
      buildMergedImageNegativePrompt('openai', 'seedream-4.0', 0, ''),
      ANTI_SPLIT_NEGATIVE_PROMPT
    );
    assert.equal(
      buildMergedImageNegativePrompt('openai', 'doubao-seedream', 1, 'lowres'),
      `${ANTI_SPLIT_NEGATIVE_PROMPT}, lowres`
    );
  });

  it('assembleImageProtocolRequest 汇总协议、有效提示词和负面提示', () => {
    const assembled = assembleImageProtocolRequest({
      config: { provider: 'openai' },
      model: 'dall-e-3',
      prompt: '夜雨巷口',
      systemPrompt: 'Image 1: character sheet',
      referenceUrls: ['https://cdn.example/a.png'],
      userNegativePrompt: 'blurry',
    });
    assert.equal(assembled.protocol, 'openai');
    assert.equal(assembled.refLabelInjected, true);
    assert.match(assembled.effectivePrompt, /Image 1: character sheet/);
    assert.equal(assembled.mergedNegativePrompt, 'blurry');

    const gemini = assembleImageProtocolRequest({
      config: { provider: 'google', api_protocol: 'gemini' },
      model: 'gemini-2.5-flash-image',
      prompt: '夜雨巷口',
      systemPrompt: 'Image 1: character sheet',
      referenceUrls: ['https://cdn.example/a.png'],
      userNegativePrompt: '',
    });
    assert.equal(gemini.protocol, 'gemini');
    assert.equal(gemini.effectivePrompt, '夜雨巷口');
    assert.equal(gemini.refLabelInjected, false);
    assert.equal(gemini.mergedNegativePrompt, '');
  });
});
