const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { assertTlsVerificationRequired } = require('../services/tlsPolicy');

function getConfigPaths() {
  const explicitPath = String(process.env.LOCALMINIDRAMA_CONFIG_PATH || '').trim();
  return [
    explicitPath ? path.resolve(explicitPath) : null,
    path.join(process.cwd(), 'configs', 'config.yaml'),
    path.join(process.cwd(), 'config.yaml'),
    path.join(__dirname, '..', '..', 'configs', 'config.yaml'),
  ].filter(Boolean);
}

function assertSafeConfigDataPath(value, fieldName) {
  if (value == null || value === '') return;
  const text = String(value);
  if (path.isAbsolute(text) || path.win32.isAbsolute(text)) return;
  const segments = text.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => segment === '..')) {
    const error = new Error(`${fieldName} 不能包含上级目录片段`);
    error.code = 'UNSAFE_CONFIG_PATH';
    throw error;
  }
}

function loadConfig() {
  let raw = null;
  for (const p of getConfigPaths()) {
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, 'utf8');
      break;
    }
  }
  if (!raw) {
    throw new Error('Config file not found: configs/config.yaml');
  }
  const parsed = yaml.load(raw);
  if (!parsed?.app?.name) {
    throw new Error('Invalid config: missing app section');
  }
  assertTlsVerificationRequired({ config: parsed });
  assertSafeConfigDataPath(parsed.database?.path, 'database.path');
  assertSafeConfigDataPath(parsed.storage?.local_path, 'storage.local_path');
  return parsed;
}

module.exports = { assertSafeConfigDataPath, loadConfig };
