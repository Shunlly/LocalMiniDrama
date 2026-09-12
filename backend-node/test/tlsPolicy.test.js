const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assertTlsVerificationRequired,
  secureHttpsRequestOptions,
} = require('../src/services/tlsPolicy');
const { assertSafeConfigDataPath, loadConfig } = require('../src/config');

test('TLS 策略拒绝环境变量和配置里的证书校验关闭开关', () => {
  assert.throws(
    () => assertTlsVerificationRequired({ env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, applyGlobalPin: false }),
    (error) => error?.code === 'INSECURE_TLS_FORBIDDEN'
  );
  assert.throws(
    () => assertTlsVerificationRequired({
      env: {},
      config: { server: { insecure_tls: true } },
      applyGlobalPin: false,
    }),
    (error) => error?.code === 'INSECURE_TLS_FORBIDDEN'
  );
  assert.doesNotThrow(() => assertTlsVerificationRequired({
    env: {},
    config: { server: { insecure_tls: false } },
    applyGlobalPin: false,
  }));
});

test('出站 HTTPS 选项钉死证书校验并丢弃自定义 Agent', () => {
  const options = secureHttpsRequestOptions({
    rejectUnauthorized: false,
    agent: { options: { rejectUnauthorized: false } },
    hostname: 'provider.example',
  });
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(Object.hasOwn(options, 'agent'), false);
  assert.equal(options.hostname, 'provider.example');
});

test('配置加载拒绝 NODE_TLS_REJECT_UNAUTHORIZED=0', () => {
  const result = spawnSync(process.execPath, ['-e', `
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      require('./src/config').loadConfig();
      process.exit(0);
    } catch (error) {
      process.stderr.write(String(error && error.code || error && error.message || error));
      process.exit(1);
    }
  `], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  });
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), /INSECURE_TLS_FORBIDDEN/);
});

test('配置加载拒绝相对数据路径中的上级目录片段', (t) => {
  assert.throws(
    () => assertSafeConfigDataPath('../../outside.db', 'database.path'),
    (error) => error?.code === 'UNSAFE_CONFIG_PATH'
  );
  assert.doesNotThrow(() => assertSafeConfigDataPath('./data/drama_generator.db', 'database.path'));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-unsafe-config-'));
  const configPath = path.join(tempRoot, 'config.yaml');
  fs.writeFileSync(configPath, [
    'app:',
    '  name: Unsafe Path Fixture',
    '  version: 1.3.3',
    'database:',
    '  path: ../outside.db',
  ].join('\n'), 'utf8');
  const previousPath = process.env.LOCALMINIDRAMA_CONFIG_PATH;
  process.env.LOCALMINIDRAMA_CONFIG_PATH = configPath;
  t.after(() => {
    if (previousPath === undefined) delete process.env.LOCALMINIDRAMA_CONFIG_PATH;
    else process.env.LOCALMINIDRAMA_CONFIG_PATH = previousPath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  assert.throws(
    () => loadConfig(),
    (error) => error?.code === 'UNSAFE_CONFIG_PATH'
  );
});
