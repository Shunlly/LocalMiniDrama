const aiConfigService = require('./aiConfigService');

const SERVICE_TYPES = Object.freeze({
  text: ['text'],
  asset_image: ['image'],
  image: ['storyboard_image', 'image'],
  video: ['video'],
  tts: ['tts'],
});

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function nonNegativeNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function configuredModels(config) {
  const models = Array.isArray(config?.model) ? config.model : [config?.model];
  return [...models, config?.default_model]
    .map((model) => String(model || '').trim())
    .filter(Boolean);
}

function configPricing(config) {
  const settings = parseObject(config?.settings);
  return parseObject(settings.pricing || settings.cost_estimate || settings.costs);
}

function findPricingConfig(db, params) {
  const serviceTypes = SERVICE_TYPES[params.provider_type] || [];
  const provider = String(params.provider_name || '').trim().toLowerCase();
  const model = String(params.model || '').trim();
  const candidates = serviceTypes.flatMap((serviceType) => (
    aiConfigService.listConfigs(db, serviceType).filter((config) => config.is_active)
  ));
  return candidates.find((config) => (
    String(config.provider || '').trim().toLowerCase() === provider &&
    (!model || configuredModels(config).includes(model)) &&
    Object.keys(configPricing(config)).length > 0
  )) || candidates.find((config) => (
    (!provider || String(config.provider || '').trim().toLowerCase() === provider) &&
    Object.keys(configPricing(config)).length > 0
  )) || null;
}

function estimateTextTokens(value) {
  if (!value) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(String(value), 'utf8') / 4));
}

function roundCost(value) {
  return Number(Math.max(0, value).toFixed(8));
}

function estimateCost(providerType, pricingValue, usageValue = {}) {
  const pricing = parseObject(pricingValue);
  const usage = parseObject(usageValue);
  if (!Object.keys(pricing).length) return null;

  if (providerType === 'text') {
    const inputRate = nonNegativeNumber(pricing.input_per_million_tokens);
    const outputRate = nonNegativeNumber(pricing.output_per_million_tokens);
    if (inputRate == null && outputRate == null) return null;
    const inputTokens = nonNegativeNumber(usage.input_tokens) ?? estimateTextTokens(usage.input_text);
    const outputTokens = nonNegativeNumber(usage.output_tokens) ?? estimateTextTokens(usage.output_text);
    return roundCost(
      (inputTokens * (inputRate || 0) + outputTokens * (outputRate || 0)) / 1_000_000
    );
  }

  if (providerType === 'image' || providerType === 'asset_image') {
    const rate = nonNegativeNumber(pricing.per_image);
    if (rate == null) return null;
    const count = nonNegativeNumber(usage.count) ?? 1;
    return roundCost(rate * count);
  }

  if (providerType === 'video') {
    const rate = nonNegativeNumber(pricing.per_second);
    const seconds = nonNegativeNumber(usage.duration_seconds);
    if (rate == null || seconds == null) return null;
    return roundCost(rate * seconds);
  }

  if (providerType === 'tts') {
    const rate = nonNegativeNumber(pricing.per_1000_characters);
    const characters = nonNegativeNumber(usage.characters);
    if (rate == null || characters == null) return null;
    return roundCost(rate * characters / 1000);
  }

  if (providerType === 'compositor') {
    const rate = nonNegativeNumber(pricing.per_minute);
    const seconds = nonNegativeNumber(usage.duration_seconds);
    if (rate == null || seconds == null) return null;
    return roundCost(rate * seconds / 60);
  }

  return null;
}

function resolveInvocationCost(db, params = {}) {
  if (params.cost_estimate !== undefined) return nonNegativeNumber(params.cost_estimate);
  if (params.mode === 'mock' || params.billable === false) return 0;
  if (params.status && params.status !== 'success') return null;

  let pricing = parseObject(params.pricing);
  if (!Object.keys(pricing).length && params.config) pricing = configPricing(params.config);
  if (!Object.keys(pricing).length && db && SERVICE_TYPES[params.provider_type]) {
    const config = findPricingConfig(db, params);
    pricing = configPricing(config);
  }
  return estimateCost(params.provider_type, pricing, params.usage);
}

function resolveInvocationCostAudit(db, params = {}) {
  const costEstimate = resolveInvocationCost(db, params);
  let costKind = String(params.cost_kind || '').trim().toLowerCase();
  if (!['estimated', 'non_billable', 'unknown'].includes(costKind)) {
    costKind = params.mode === 'mock' || params.billable === false
      ? 'non_billable'
      : costEstimate == null ? 'unknown' : 'estimated';
  }
  return { cost_estimate: costEstimate, cost_kind: costKind };
}

module.exports = {
  estimateTextTokens,
  estimateCost,
  resolveInvocationCost,
  resolveInvocationCostAudit,
};
