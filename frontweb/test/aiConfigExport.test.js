import test from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizeConfigForExport,
  sanitizeUrlForExport,
  stripMaskedSecretsFromSettings,
} from '../src/utils/aiConfigExport.js'

test('AI config export removes custom header and credential fields but keeps token budgets', () => {
  const exported = sanitizeConfigForExport({
    id: 42,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    api_key: 'fixture-api-value',
    api_key_set: true,
    Authorization: 'Bearer fixture-top-auth',
    Cookie: 'session=fixture-top-cookie',
    proxyAuthorization: 'fixture-top-proxy',
    clientCredential: 'fixture-top-client',
    name: 'Safe config name',
    settings: JSON.stringify({
      headers: {
        Authorization: 'Bearer fixture-header-auth',
        'X-Auth': 'fixture-x-auth-value',
        Authentication: 'fixture-authentication-value',
        Cookie: 'session=fixture-header-cookie',
        'Proxy-Authorization': 'fixture-header-proxy',
        'X-Api-Key': 'fixture-header-key',
        'X-Client-Credential': 'fixture-header-client',
        Accept: 'application/json',
      },
      password: 'fixture-password',
      refreshToken: 'fixture-refresh-token',
      signingSecret: 'fixture-signing-secret',
      privateKey: 'fixture-private-key',
      apikey: 'fixture-compact-api-key',
      clientcredential: 'fixture-compact-client-credential',
      maxTokens: 4096,
      max_tokens: 2048,
      maxcompletiontokens: 3072,
      tokenBudget: 8192,
      keyframes: true,
      key_frame_mode: 'first-last',
      scene_key: 'image-polish',
      nested: [{ sessionToken: 'fixture-session-token', outputTokens: 512 }],
      header_list: [
        { name: 'X-Custom-Auth', value: 'fixture-header-list-secret' },
        { name: 'Accept', value: 'application/json' },
      ],
    }),
  })

  assert.equal('id' in exported, false)
  assert.equal(exported.api_key, '')
  assert.equal(exported.Authorization, '')
  assert.equal(exported.Cookie, '')
  assert.equal(exported.proxyAuthorization, '')
  assert.equal(exported.clientCredential, '')
  assert.equal(exported.name, 'Safe config name')
  const settings = JSON.parse(exported.settings)
  assert.equal(settings.headers.Authorization, '')
  assert.equal(settings.headers['X-Auth'], '')
  assert.equal(settings.headers.Authentication, '')
  assert.equal(settings.headers.Cookie, '')
  assert.equal(settings.headers['Proxy-Authorization'], '')
  assert.equal(settings.headers['X-Api-Key'], '')
  assert.equal(settings.headers['X-Client-Credential'], '')
  assert.equal(settings.headers.Accept, 'application/json')
  assert.equal(settings.password, '')
  assert.equal(settings.refreshToken, '')
  assert.equal(settings.signingSecret, '')
  assert.equal(settings.privateKey, '')
  assert.equal(settings.apikey, '')
  assert.equal(settings.clientcredential, '')
  assert.equal(settings.maxTokens, 4096)
  assert.equal(settings.max_tokens, 2048)
  assert.equal(settings.maxcompletiontokens, 3072)
  assert.equal(settings.tokenBudget, 8192)
  assert.equal(settings.keyframes, true)
  assert.equal(settings.key_frame_mode, 'first-last')
  assert.equal(settings.scene_key, 'image-polish')
  assert.equal(settings.nested[0].sessionToken, '')
  assert.equal(settings.nested[0].outputTokens, 512)
  assert.equal(settings.header_list[0].name, 'X-Custom-Auth')
  assert.equal(settings.header_list[0].value, '')
  assert.equal(settings.header_list[1].value, 'application/json')
  assert.equal(JSON.stringify(exported).includes('fixture-'), false)
})

test('AI config export sanitizes loose settings without removing safe values', () => {
  const cleaned = stripMaskedSecretsFromSettings(
    'Authorization=Bearer fixture-auth maxTokens=2048 safe=visible',
  )

  assert.equal(cleaned.includes('fixture-auth'), false)
  assert.equal(cleaned.includes('maxTokens=2048'), true)
  assert.equal(cleaned.includes('safe=visible'), true)
})

test('AI config export removes credentials and query signatures from every URL', () => {
  const exported = sanitizeConfigForExport({
    base_url: 'https://user:pass@provider.example/v1?token=private-value#fragment',
    endpoint: '/chat/completions?api_key=private-value&api-version=1',
    query_endpoint: '/tasks/{taskId}?sig=private-value&view=summary',
    callback_url: 'https://callback.example/result?signature=private-value',
    settings: JSON.stringify({
      webhook_url: 'https://hooks.example/event?api_key=private-value',
      relative_url: '/events?authorization=private-value&view=summary',
      protocol_relative_url: '//user:pass@hooks.example/event?sig=private-value#fragment',
      bare_relative_url: 'v1/events?sig=private-value&view=summary',
      embedded_url: 'callback=v1/events?sig=private-value&view=summary',
      bare_query_url: 'events?sig=private-value',
      assignment_url: 'callback=events?unknown=private-value',
      bracketed_protocol_url: 'note:[//user:pass@hooks.example/event?sig=private-value]',
      colon_prefixed_url: 'note:v1/events?sig=private-value',
      sig: 'private-value',
      safe: 'visible',
    }),
  })

  assert.equal(exported.base_url, 'https://provider.example/v1')
  assert.equal(exported.endpoint, '/chat/completions?api-version=1')
  assert.equal(exported.query_endpoint, '/tasks/{taskId}?view=summary')
  assert.equal(exported.callback_url, 'https://callback.example/result')
  assert.equal(JSON.parse(exported.settings).webhook_url, 'https://hooks.example/event')
  assert.equal(JSON.parse(exported.settings).relative_url, '/events?view=summary')
  assert.equal(JSON.parse(exported.settings).protocol_relative_url, '//hooks.example/event')
  assert.equal(JSON.parse(exported.settings).bare_relative_url, 'v1/events?view=summary')
  assert.equal(JSON.parse(exported.settings).embedded_url, 'callback=v1/events?view=summary')
  assert.equal(JSON.parse(exported.settings).bare_query_url, 'events')
  assert.equal(JSON.parse(exported.settings).assignment_url, 'callback=events')
  assert.equal(JSON.parse(exported.settings).bracketed_protocol_url, 'note:[//hooks.example/event]')
  assert.equal(JSON.parse(exported.settings).colon_prefixed_url, 'note:v1/events')
  assert.equal(JSON.parse(exported.settings).sig, '')
  assert.equal(JSON.stringify(exported).includes('private-value'), false)
  assert.equal(sanitizeUrlForExport('not-a-url'), 'not-a-url')
})
