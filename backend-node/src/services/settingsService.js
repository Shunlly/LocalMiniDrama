const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const yaml = require('js-yaml');

let configPath = null;
let configCache = null;

function setConfigPath(cfg) {
  configPath = null;
  const explicitPath = String(process.env.LOCALMINIDRAMA_CONFIG_PATH || '').trim();
  const paths = [
    explicitPath ? path.resolve(explicitPath) : null,
    path.join(process.cwd(), 'configs', 'config.yaml'),
    path.join(process.cwd(), 'config.yaml'),
  ].filter(Boolean);
  for (const p of paths) {
    if (fs.existsSync(p)) {
      configPath = p;
      return p;
    }
  }
  return null;
}

function getLanguage(cfg) {
  return cfg?.app?.language || 'zh';
}

function syncDirectoryBestEffort(directoryPath) {
  let directoryFd;
  try {
    directoryFd = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(directoryFd);
  } catch (_) {
    // Directory fsync is unsupported on some platforms, including Windows filesystems.
  } finally {
    if (directoryFd !== undefined) {
      try { fs.closeSync(directoryFd); } catch (_) {}
    }
  }
}

function writeFileAtomicSync(targetPath, contents) {
  const directoryPath = path.dirname(targetPath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let fileFd;

  try {
    let mode = 0o600;
    try { mode = fs.statSync(targetPath).mode & 0o777; } catch (_) {}
    fileFd = fs.openSync(temporaryPath, 'wx', mode);
    fs.writeFileSync(fileFd, contents, 'utf8');
    fs.fsyncSync(fileFd);
    fs.closeSync(fileFd);
    fileFd = undefined;
    fs.renameSync(temporaryPath, targetPath);
  } catch (err) {
    if (fileFd !== undefined) {
      try { fs.closeSync(fileFd); } catch (_) {}
    }
    try { fs.unlinkSync(temporaryPath); } catch (_) {}
    throw err;
  }

  syncDirectoryBestEffort(directoryPath);
}

function updateLanguage(cfg, log, language) {
  if (language !== 'zh' && language !== 'en') {
    return { ok: false, error: '只支持 zh 或 en' };
  }
  const targetPath = setConfigPath(cfg);
  if (!targetPath) {
    const error = new Error('Config file not found; language setting was not persisted');
    error.code = 'CONFIG_FILE_NOT_FOUND';
    log.warnw('Failed to write config file', { error: error.message });
    throw error;
  }

  try {
    const current = yaml.load(fs.readFileSync(targetPath, 'utf8')) || {};
    if (!current.app) current.app = {};
    current.app.language = language;
    writeFileAtomicSync(targetPath, yaml.dump(current, { lineWidth: -1 }));
  } catch (err) {
    log.warnw('Failed to write config file', { error: err.message });
    throw err;
  }

  if (!cfg.app) cfg.app = {};
  cfg.app.language = language;
  log.infow('System language updated', { language });
  return { ok: true, language };
}

/**
 * 从 global_settings 表读取一个键值，返回解析后的值，不存在时返回 defaultValue。
 */
function getGlobalSetting(db, key, defaultValue = null) {
  try {
    const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch (_) { return row.value; }
  } catch (_) { return defaultValue; }
}

/**
 * 向 global_settings 表写入一个键值（value 会被 JSON.stringify）。
 */
function setGlobalSettings(db, values) {
  const entries = Object.entries(values || {}).map(([key, value]) => [key, JSON.stringify(value)]);
  if (entries.length === 0) return;

  const now = new Date().toISOString();
  const statement = db.prepare(
    `INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const persist = db.transaction((serializedEntries) => {
    for (const [key, value] of serializedEntries) {
      statement.run(key, value, now);
    }
  });
  persist(entries);
}

function setGlobalSetting(db, key, value) {
  setGlobalSettings(db, { [key]: value });
}

module.exports = {
  setConfigPath,
  getLanguage,
  updateLanguage,
  getGlobalSetting,
  setGlobalSettings,
  setGlobalSetting,
};
