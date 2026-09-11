'use strict';


const fs = require('fs');
const path = require('path');
const { normalizeMaterialHubToken } = require('./jimengMaterialHubService');
const {
  normalizeWritableConfigModels,
  modelToDb,
} = require('./aiConfigModels');
const {
  normalizeProviderBaseUrl,
  normalizeProviderEndpoint,
} = require('./aiConfigProviderPrivacy');

function normalizeApiKeyForService(serviceType, apiKey) {
  if (serviceType === 'jimeng2_character_auth' && apiKey != null) {
    return normalizeMaterialHubToken(apiKey);
  }
  return apiKey;
}

function clearOtherDefault(db, serviceType, exceptId) {
  if (exceptId == null) {
    db.prepare(
      'UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = ?'
    ).run(serviceType);
    return;
  }
  db.prepare(
    'UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = ? AND id != ?'
  ).run(serviceType, exceptId);
}

/**
 * 返回 vendor_lock 状态
 */
function getVendorLockStatus(cfg) {
  const lock = cfg?.vendor_lock;
  return {
    enabled: !!(lock?.enabled),
    config_file: lock?.config_file || '',
  };
}

function normalizeVendorSettings(settings) {
  if (settings == null || settings === '') return null;
  return typeof settings === 'string' ? settings : JSON.stringify(settings);
}

function normalizeVendorConfig(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`第 ${Number(index) + 1} 项配置必须是对象`);
  }
  const serviceType = String(item.service_type || 'text').trim() || 'text';
  const normalizedModels = normalizeWritableConfigModels({
    model: item.model,
    default_model: item.default_model,
    is_active: true,
  });
  const config = {
    service_type: serviceType,
    provider: String(item.provider || '').trim(),
    api_protocol: String(item.api_protocol || ''),
    name: String(item.name || ''),
    base_url: String(item.base_url || ''),
    api_key: normalizeApiKeyForService(serviceType, String(item.api_key || '')),
    model: modelToDb(normalizedModels.model) || '[]',
    default_model: normalizedModels.default_model,
    endpoint: String(item.endpoint || ''),
    query_endpoint: String(item.query_endpoint || ''),
    priority: item.priority ?? 0,
    is_default: item.is_default ? 1 : 0,
    is_active: 1,
    settings: normalizeVendorSettings(item.settings),
  };
  config.base_url = normalizeProviderBaseUrl(config.base_url, config);
  config.endpoint = normalizeProviderEndpoint(config.endpoint, 'endpoint');
  config.query_endpoint = normalizeProviderEndpoint(config.query_endpoint, 'query_endpoint');
  return config;
}

function reconcileVendorConfigDefaults(configs) {
  const defaults = new Map();
  for (const config of configs) {
    if (!config.is_default) continue;
    const current = defaults.get(config.service_type);
    if (!current || Number(config.priority || 0) > Number(current.priority || 0)) {
      if (current) current.is_default = 0;
      defaults.set(config.service_type, config);
    } else {
      config.is_default = 0;
    }
  }
  return configs;
}

function vendorConfigIdentity(config) {
  return `${String(config.service_type || 'text').trim().toLowerCase()}\u0000${String(config.provider || '').trim().toLowerCase()}`;
}

function pickVendorConfigRow(rows, config, claimedIds) {
  const identity = vendorConfigIdentity(config);
  const available = rows.filter((row) => !claimedIds.has(row.id) && vendorConfigIdentity(row) === identity);
  const named = available.filter((row) => String(row.name || '') === config.name);
  return named.find((row) => row.deleted_at == null)
    || available.find((row) => row.deleted_at == null)
    || named[0]
    || available[0]
    || null;
}

function vendorRowMatches(row, config) {
  return row.deleted_at == null
    && String(row.service_type || '') === config.service_type
    && String(row.provider || '') === config.provider
    && String(row.api_protocol || '') === config.api_protocol
    && String(row.name || '') === config.name
    && String(row.base_url || '') === config.base_url
    && String(row.api_key || '') === String(config.api_key || '')
    && String(row.model || '') === config.model
    && (row.default_model == null ? null : String(row.default_model)) === config.default_model
    && String(row.endpoint || '') === config.endpoint
    && String(row.query_endpoint || '') === config.query_endpoint
    && Number(row.priority || 0) === Number(config.priority || 0)
    && Number(row.is_default || 0) === config.is_default
    && Number(row.is_active == null ? 1 : row.is_active) === config.is_active
    && (row.settings == null ? null : String(row.settings)) === config.settings;
}

/**
 * Synchronize vendor-lock configs atomically while retaining matching row IDs.
 * Existing API keys remain user-managed; all other fields come from the lock file.
 */
function applyVendorLock(db, log, cfg) {
  const status = getVendorLockStatus(cfg);
  if (!status.enabled) return;

  const configFile = status.config_file;
  if (!configFile) {
    log.warn && log.warn('vendor_lock enabled but config_file is empty');
    return;
  }

  const candidates = [
    path.join(process.cwd(), 'configs', configFile),
    path.join(__dirname, '..', '..', 'configs', configFile),
  ];
  let raw = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { raw = fs.readFileSync(p, 'utf8'); break; }
  }
  if (!raw) {
    log?.warn?.('[vendor_lock] config file not found', { config_file: configFile });
    return;
  }

  let configs;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('配置文件必须是 JSON 数组');
    configs = reconcileVendorConfigDefaults(parsed.map(normalizeVendorConfig));
  } catch (e) {
    log?.error?.('[vendor_lock] failed to parse config file', { error: e.message });
    return;
  }

  const synchronize = db.transaction(() => {
    const now = new Date().toISOString();
    const existing = db.prepare(
      'SELECT * FROM ai_service_configs ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, id ASC'
    ).all();
    const claimedIds = new Set();
    const synchronized = [];
    let inserted = 0;
    let updated = 0;

    const update = db.prepare(
      `UPDATE ai_service_configs
          SET service_type = ?, provider = ?, api_protocol = ?, name = ?, base_url = ?, api_key = ?,
              model = ?, default_model = ?, endpoint = ?, query_endpoint = ?, priority = ?, is_default = ?,
              is_active = ?, settings = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?`
    );
    const insert = db.prepare(
      `INSERT INTO ai_service_configs
        (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const serviceType of new Set(configs.map((config) => config.service_type))) {
      clearOtherDefault(db, serviceType, null);
    }

    for (const config of configs) {
      const row = pickVendorConfigRow(existing, config, claimedIds);
      const values = {
        ...config,
        api_key: row ? row.api_key : config.api_key,
      };
      let id;
      if (row) {
        id = row.id;
        claimedIds.add(id);
        if (!vendorRowMatches(row, values)) {
          update.run(
            values.service_type, values.provider, values.api_protocol, values.name, values.base_url,
            values.api_key, values.model, values.default_model, values.endpoint, values.query_endpoint,
            values.priority, values.is_default, values.is_active, values.settings, now, id
          );
          updated += 1;
        }
      } else {
        const info = insert.run(
          values.service_type, values.provider, values.api_protocol, values.name, values.base_url,
          values.api_key, values.model, values.default_model, values.endpoint, values.query_endpoint,
          values.priority, values.is_default, values.is_active, values.settings, now, now
        );
        id = Number(info.lastInsertRowid);
        claimedIds.add(id);
        inserted += 1;
      }
      synchronized.push({ id, name: values.name, identity: vendorConfigIdentity(values) });
    }

    const softDelete = db.prepare(
      'UPDATE ai_service_configs SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    );
    for (const row of existing) {
      if (!claimedIds.has(row.id) && row.deleted_at == null) softDelete.run(now, now, row.id);
    }

    const remap = db.prepare('UPDATE ai_model_map SET config_id = ?, updated_at = ? WHERE config_id = ?');
    for (const row of existing) {
      if (claimedIds.has(row.id)) continue;
      const sameIdentity = synchronized.filter((item) => item.identity === vendorConfigIdentity(row));
      const replacement = sameIdentity.find((item) => item.name === String(row.name || '')) || sameIdentity[0];
      if (replacement) remap.run(replacement.id, now, row.id);
    }
    db.prepare(
      `UPDATE ai_model_map
          SET config_id = NULL, updated_at = ?
        WHERE config_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ai_service_configs config
             WHERE config.id = ai_model_map.config_id AND config.deleted_at IS NULL
          )`
    ).run(now);

    return { count: configs.length, inserted, updated };
  });

  const result = synchronize.immediate();
  for (const item of configs) {
    log?.info?.('[vendor_lock] config loaded', {
      service_type: item.service_type,
      provider: item.provider,
      api_protocol: item.api_protocol || '(auto)',
      endpoint: item.endpoint || '(auto)',
    });
  }
  log?.info?.('[vendor_lock] configs synchronized', { ...result, config_file: configFile });
  return result;
}

module.exports = {
  normalizeApiKeyForService,
  clearOtherDefault,
  getVendorLockStatus,
  applyVendorLock,
};
