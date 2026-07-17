const EMPTY_PRICING_FORM = Object.freeze({
  pricing_input_per_million_tokens: null,
  pricing_output_per_million_tokens: null,
  pricing_per_image: null,
  pricing_per_second: null,
  pricing_per_1000_characters: null,
});

export function parseSettingsObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function optionalRate(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function readProviderPricingForm(settings) {
  const pricing = parseSettingsObject(parseSettingsObject(settings).pricing);
  return {
    ...EMPTY_PRICING_FORM,
    pricing_input_per_million_tokens: optionalRate(pricing.input_per_million_tokens),
    pricing_output_per_million_tokens: optionalRate(pricing.output_per_million_tokens),
    pricing_per_image: optionalRate(pricing.per_image),
    pricing_per_second: optionalRate(pricing.per_second),
    pricing_per_1000_characters: optionalRate(pricing.per_1000_characters),
  };
}

export function buildProviderPricing(serviceType, values = {}) {
  const pricing = {};
  if (serviceType === 'text') {
    const input = optionalRate(values.pricing_input_per_million_tokens);
    const output = optionalRate(values.pricing_output_per_million_tokens);
    if (input != null) pricing.input_per_million_tokens = input;
    if (output != null) pricing.output_per_million_tokens = output;
  } else if (serviceType === 'image' || serviceType === 'storyboard_image') {
    const rate = optionalRate(values.pricing_per_image);
    if (rate != null) pricing.per_image = rate;
  } else if (serviceType === 'video') {
    const rate = optionalRate(values.pricing_per_second);
    if (rate != null) pricing.per_second = rate;
  } else if (serviceType === 'tts') {
    const rate = optionalRate(values.pricing_per_1000_characters);
    if (rate != null) pricing.per_1000_characters = rate;
  }
  return Object.keys(pricing).length ? pricing : null;
}

export function summarizeProviderCosts(invocations) {
  const successfulProduction = (Array.isArray(invocations) ? invocations : []).filter((item) => (
    item?.mode === 'production' && item?.status === 'success'
  ));
  const known = successfulProduction.filter((item) => (
    item.cost_estimate != null && Number.isFinite(Number(item.cost_estimate))
  ));
  const amount = Number(known.reduce((sum, item) => sum + Number(item.cost_estimate), 0).toFixed(8));
  return {
    currency: 'USD',
    amount,
    knownCount: known.length,
    unknownCount: successfulProduction.length - known.length,
    totalCount: successfulProduction.length,
  };
}

export { EMPTY_PRICING_FORM };
