'use strict';

// 从 imageClient 拆出的协议请求拼装：协议推断、参考图标签注入、负面提示合并。
// 保持原语义，不是新增真实接入。

const {
  ANTI_SPLIT_NEGATIVE_PROMPT,
  mergeNegativePromptFragments,
  inferProtocol,
} = require('./runtime');

function resolveImageProtocol(config, model) {
  const provider = (config?.provider || '').toLowerCase();
  return (config?.api_protocol || '').toLowerCase() || inferProtocol(provider, model);
}

function injectNonGeminiReferencePrompt(protocol, prompt, systemPrompt, referenceUrls) {
  let effectivePrompt = prompt || '';
  if (
    protocol !== 'gemini' &&
    Array.isArray(referenceUrls) &&
    referenceUrls.length > 0 &&
    systemPrompt
  ) {
    const refLines = String(systemPrompt).split('\n').filter((line) => /^Image\s+\d+:/i.test(line));
    if (refLines.length > 0) {
      const refHeader = refLines
        .map((line) => `[${line} — FOR REFERENCE ONLY, DO NOT copy its layout or framing]`)
        .join('\n');
      effectivePrompt = `${refHeader}\n\n[GENERATE THIS SCENE — single continuous image, no grid, no split panels]:\n${effectivePrompt}`;
    }
  }
  return effectivePrompt;
}

function shouldApplyAntiSplitNegative(protocol, model, referenceCount) {
  const isVolcOrSeedream = protocol === 'volcengine' || /seedream|doubao/i.test(model);
  return referenceCount > 1 || isVolcOrSeedream;
}

function buildMergedImageNegativePrompt(protocol, model, referenceCount, userNegativePrompt) {
  const autoNegativePrompt = shouldApplyAntiSplitNegative(protocol, model, referenceCount)
    ? ANTI_SPLIT_NEGATIVE_PROMPT
    : '';
  const userNegFragment = (userNegativePrompt && String(userNegativePrompt).trim()) || '';
  return mergeNegativePromptFragments(autoNegativePrompt, userNegFragment);
}

function assembleImageProtocolRequest({
  config,
  model,
  prompt,
  systemPrompt,
  referenceUrls,
  userNegativePrompt,
} = {}) {
  const protocol = resolveImageProtocol(config, model);
  const safeReferenceImageUrls = Array.isArray(referenceUrls) ? referenceUrls : [];
  const effectivePrompt = injectNonGeminiReferencePrompt(
    protocol,
    prompt,
    systemPrompt,
    safeReferenceImageUrls
  );
  const mergedNegativePrompt = buildMergedImageNegativePrompt(
    protocol,
    model,
    safeReferenceImageUrls.length,
    userNegativePrompt
  );
  return {
    protocol,
    effectivePrompt,
    mergedNegativePrompt,
    refLabelInjected: effectivePrompt !== (prompt || ''),
  };
}

module.exports = {
  resolveImageProtocol,
  injectNonGeminiReferencePrompt,
  buildMergedImageNegativePrompt,
  assembleImageProtocolRequest,
};
