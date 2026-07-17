import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildProviderPricing,
  readProviderPricingForm,
  summarizeProviderCosts,
} from '../src/utils/providerPricing.js'

test('provider pricing round-trips each supported service unit', () => {
  assert.deepEqual(buildProviderPricing('text', {
    pricing_input_per_million_tokens: 2,
    pricing_output_per_million_tokens: 8,
  }), {
    input_per_million_tokens: 2,
    output_per_million_tokens: 8,
  })
  assert.deepEqual(buildProviderPricing('image', { pricing_per_image: 0.04 }), { per_image: 0.04 })
  assert.deepEqual(buildProviderPricing('storyboard_image', { pricing_per_image: 0.05 }), { per_image: 0.05 })
  assert.deepEqual(buildProviderPricing('video', { pricing_per_second: 0.15 }), { per_second: 0.15 })
  assert.deepEqual(buildProviderPricing('tts', { pricing_per_1000_characters: 0.02 }), { per_1000_characters: 0.02 })
  assert.equal(buildProviderPricing('video', { pricing_per_second: null }), null)

  assert.deepEqual(readProviderPricingForm(JSON.stringify({ pricing: { per_second: 0.15 } })), {
    pricing_input_per_million_tokens: null,
    pricing_output_per_million_tokens: null,
    pricing_per_image: null,
    pricing_per_second: 0.15,
    pricing_per_1000_characters: null,
  })
})

test('workflow cost summary does not confuse unknown prices with zero-cost reuse', () => {
  const summary = summarizeProviderCosts([
    { mode: 'production', status: 'success', cost_estimate: 0.5 },
    { mode: 'production', status: 'success', cost_estimate: 0 },
    { mode: 'production', status: 'success', cost_estimate: null },
    { mode: 'mock', status: 'success', cost_estimate: 0 },
    { mode: 'production', status: 'failed', cost_estimate: null },
  ])
  assert.deepEqual(summary, {
    currency: 'USD',
    amount: 0.5,
    knownCount: 2,
    unknownCount: 1,
    totalCount: 3,
  })
})
