const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const backendRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(backendRoot, '..');
const composePath = path.join(repositoryRoot, 'docker-compose.yml');
const entrypointPath = path.join(backendRoot, 'docker-entrypoint.sh');
const dockerfilePath = path.join(backendRoot, 'Dockerfile');
const frontendProdDockerfilePath = path.join(repositoryRoot, 'frontweb', 'Dockerfile.prod');
const frontendNginxConfigPath = path.join(repositoryRoot, 'frontweb', 'nginx.conf');
const dockerignorePath = path.join(repositoryRoot, '.dockerignore');
const artifactVerificationPath = path.join(repositoryRoot, 'scripts', 'verify-docker-artifact.cjs');
const repositoryAssetsAvailable = [
  composePath,
  entrypointPath,
  dockerfilePath,
  frontendProdDockerfilePath,
  frontendNginxConfigPath,
  dockerignorePath,
  artifactVerificationPath,
].every(fs.existsSync);
const repositoryOnly = repositoryAssetsAvailable
  ? {}
  : { skip: 'repository Docker sources are not copied into the verification image' };
const dockerProbe = repositoryAssetsAvailable
  ? spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    })
  : null;
const dockerBehavior = !repositoryAssetsAvailable
  ? repositoryOnly
  : dockerProbe?.status === 0
    ? { timeout: 120000 }
    : { skip: 'Docker daemon is unavailable for entrypoint behavior verification' };

test('backend Compose keeps both production services restartable and gates frontend health on backend readiness', repositoryOnly, () => {
  const compose = yaml.load(fs.readFileSync(composePath, 'utf8'));
  const backend = compose.services.backend;
  const frontend = compose.services.frontend;

  assert.equal(backend.restart, 'unless-stopped');
  assert.equal(frontend.restart, 'unless-stopped');
  assert.equal(backend.init, true);
  assert.equal(frontend.init, true);
  assert.equal(backend.pids_limit, 512);
  assert.equal(frontend.pids_limit, 128);
  assert.equal(backend.cpus, '4.0');
  assert.equal(frontend.cpus, '1.0');
  assert.equal(backend.mem_limit, '8g');
  assert.equal(frontend.mem_limit, '512m');
  assert.deepEqual(backend.logging, {
    driver: 'json-file',
    options: { 'max-size': '10m', 'max-file': '3' },
  });
  assert.deepEqual(frontend.logging, {
    driver: 'json-file',
    options: { 'max-size': '10m', 'max-file': '3' },
  });
  assert.deepEqual(backend.cap_drop, ['ALL']);
  assert.deepEqual(backend.cap_add, ['CHOWN', 'DAC_READ_SEARCH', 'KILL', 'SETGID', 'SETUID']);
  assert.deepEqual(frontend.cap_drop, ['ALL']);
  assert.equal(frontend.cap_add, undefined);
  assert.equal(backend.stop_grace_period, '60s');
  assert.deepEqual(
    backend.volumes.find((volume) => volume.target === '/app/data'),
    {
      type: 'bind',
      source: '${LOCALMINIDRAMA_DATA_DIR:-./backend-node/data}',
      target: '/app/data',
    },
  );
  assert.deepEqual(
    backend.volumes.find((volume) => volume.target === '/app/config-source'),
    {
      type: 'bind',
      source: '${LOCALMINIDRAMA_CONFIG_DIR:-./backend-node/configs}',
      target: '/app/config-source',
      read_only: true,
    },
  );
  assert.equal(backend.environment.LOCALMINIDRAMA_CONFIG_SOURCE, '/app/config-source/config.yaml');
  assert.equal(backend.environment.LOCALMINIDRAMA_CONFIG_PATH, '/tmp/localminidrama-config/config.yaml');
  assert.equal(frontend.depends_on.backend.condition, 'service_healthy');
  assert.match(frontend.healthcheck.test.join(' '), /\/healthz/);
});

test('Compose 生产探针走 /ready，默认端口 3013/5679，并保留备份恢复环境变量', repositoryOnly, () => {
  const composeSource = fs.readFileSync(composePath, 'utf8');
  const compose = yaml.load(composeSource);
  const backend = compose.services.backend;
  const frontend = compose.services.frontend;
  const backendHealth = backend.healthcheck.test.join(' ');
  const frontendHealth = frontend.healthcheck.test.join(' ');
  const frontendProdDockerfile = fs.readFileSync(frontendProdDockerfilePath, 'utf8');
  const backendDockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  const verificationStage = backendDockerfile.slice(
    backendDockerfile.indexOf('FROM runtime AS verification'),
    backendDockerfile.indexOf('FROM runtime AS production'),
  );
  const productionStage = backendDockerfile.slice(backendDockerfile.indexOf('FROM runtime AS production'));

  assert.match(composeSource, /docker compose up -d --build --wait/);
  assert.match(composeSource, /23013\/25679 只属于旧 candidate/);
  assert.doesNotMatch(JSON.stringify({ ports: [backend.ports, frontend.ports], env: backend.environment }), /23013|25679/);
  assert.doesNotMatch(composeSource, /NODE_TLS_REJECT_UNAUTHORIZED|insecure_tls|REJECT_UNAUTHORIZED=0/);
  assert.deepEqual(backend.ports, ['127.0.0.1:${LOCALMINIDRAMA_BACKEND_HOST_PORT:-5679}:5679']);
  assert.deepEqual(frontend.ports, ['127.0.0.1:${LOCALMINIDRAMA_FRONTEND_HOST_PORT:-3013}:3013']);
  assert.equal(backend.environment.NODE_ENV, 'production');
  assert.equal(backend.environment.PORT, '5679');
  assert.equal(backend.environment.LOCALMINIDRAMA_MAINTENANCE_SCOPE, 'localminidrama-docker-backend');
  assert.match(backend.environment.LOCALMINIDRAMA_CORS_ORIGINS, /FRONTEND_HOST_PORT:-3013/);
  assert.doesNotMatch(backend.environment.LOCALMINIDRAMA_CORS_ORIGINS, /23013|25679/);
  assert.equal(backend.volumes.length, 2);
  assert.equal(frontend.volumes, undefined);
  assert.match(backendHealth, /127\.0\.0\.1:5679\/ready/);
  assert.doesNotMatch(backendHealth, /5679\/health(?:z|\b)/);
  assert.equal(backend.healthcheck.interval, '10s');
  assert.equal(backend.healthcheck.timeout, '5s');
  assert.equal(backend.healthcheck.retries, 12);
  assert.equal(backend.healthcheck.start_period, '20s');
  assert.match(frontendHealth, /127\.0\.0\.1:3013\/healthz/);
  assert.equal(frontend.healthcheck.interval, '10s');
  assert.equal(frontend.healthcheck.timeout, '3s');
  assert.equal(frontend.healthcheck.retries, 12);
  assert.equal(frontend.healthcheck.start_period, '10s');
  assert.equal(compose.services['backend-verify'].environment.NODE_ENV, 'test');
  assert.equal(compose.services['frontend-verify'].environment.NODE_ENV, 'production');
  assert.match(verificationStage, /COPY --chown=node:node backend-node\/Dockerfile \.\/Dockerfile/);
  assert.match(verificationStage, /cp \/usr\/local\/bin\/localminidrama-entrypoint \.\/docker-entrypoint\.sh/);
  assert.match(verificationStage, /COPY --chown=node:node frontweb\/Dockerfile\.prod \/frontweb\/Dockerfile\.prod/);
  assert.doesNotMatch(verificationStage, /HEALTHCHECK/);
  assert.match(productionStage, /HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12/);
  assert.match(productionStage, /127\.0\.0\.1:5679\/ready/);
  assert.doesNotMatch(productionStage, /5679\/health(?:z|\b)/);
  assert.match(frontendProdDockerfile, /HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=12/);
  assert.match(frontendProdDockerfile, /127\.0\.0\.1:3013\/healthz/);
  assert.match(frontendProdDockerfile, /COPY frontweb\/nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/);
  assert.doesNotMatch(frontendProdDockerfile, /NODE_TLS_REJECT_UNAUTHORIZED|insecure_tls/);

  const nginxSource = fs.readFileSync(frontendNginxConfigPath, 'utf8');
  const healthzStart = nginxSource.indexOf('location = /healthz {');
  const readyStart = nginxSource.indexOf('location = /ready {');
  const spaStart = nginxSource.indexOf('location / {');
  assert.ok(healthzStart >= 0, '缺少 location = /healthz');
  assert.ok(readyStart >= 0, '缺少 location = /ready');
  assert.ok(spaStart > healthzStart, '/healthz 必须写在 SPA 回退之前');
  assert.ok(spaStart > readyStart, '/ready 必须写在 SPA 回退之前');
  const healthzBlock = nginxSource.slice(healthzStart, nginxSource.indexOf('}', healthzStart) + 1);
  const readyBlock = nginxSource.slice(readyStart, nginxSource.indexOf('}', readyStart) + 1);
  assert.match(healthzBlock, /proxy_pass http:\/\/backend:5679\/ready/);
  assert.match(readyBlock, /proxy_pass http:\/\/backend:5679\/ready/);
  assert.doesNotMatch(healthzBlock, /try_files|index\.html/);
  assert.doesNotMatch(readyBlock, /try_files|index\.html/);
  assert.match(verificationStage, /COPY --chown=node:node frontweb\/nginx\.conf \/frontweb\/nginx\.conf/);
});

test('Compose E2E provider has the same init, resource, and log boundaries', repositoryOnly, () => {
  const compose = yaml.load(fs.readFileSync(composePath, 'utf8'));
  const provider = compose.services['e2e-provider'];
  assert.equal(provider.init, true);
  assert.equal(provider.user, 'node');
  assert.equal(provider.pids_limit, 128);
  assert.equal(provider.cpus, '1.0');
  assert.equal(provider.mem_limit, '512m');
  assert.deepEqual(provider.logging, {
    driver: 'json-file',
    options: { 'max-size': '5m', 'max-file': '2' },
  });
  assert.deepEqual(provider.cap_drop, ['ALL']);
  assert.equal(provider.cap_add, undefined);
});

test('entrypoint performs one bounded ownership migration and rejects unsafe marker types', repositoryOnly, () => {
  const entrypoint = fs.readFileSync(entrypointPath, 'utf8');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  const configSanitization = 'node /usr/local/lib/localminidrama/runtime-config-policy.cjs "$config_source" "$config_target"';
  const dropPrivileges = 'exec setpriv --reuid=node --regid=node --init-groups -- "$@"';

  assert.match(entrypoint, /mkdir -p \/app\/data/);
  assert.doesNotMatch(entrypoint, /chown[^\n]*\/app\/config-source/);
  assert.doesNotMatch(entrypoint, /chown\s+-R[^\n]*\/app\/data/);
  assert.match(entrypoint, /ownership_marker="\/app\/data\/\.localminidrama-owner-v1"/);
  assert.match(entrypoint, /\[ -L "\$ownership_marker" \]/);
  assert.match(entrypoint, /\[ -e "\$ownership_marker" \][\s\S]*\[ ! -f "\$ownership_marker" \]/);
  assert.match(entrypoint, /if \[ ! -f "\$ownership_marker" \]; then/);
  assert.ok(entrypoint.includes(String.raw`find /app/data -xdev \( ! -user node -o ! -group node \) -exec chown -h node:node {} +`));
  assert.match(entrypoint, /umask 077; set -C; : > "\$ownership_marker"/);
  assert.match(entrypoint, /chown node:node "\$ownership_marker"/);
  assert.ok(entrypoint.includes(configSanitization));
  assert.ok(entrypoint.includes(dropPrivileges));
  assert.ok(entrypoint.indexOf(configSanitization) < entrypoint.indexOf(dropPrivileges));
  assert.ok(entrypoint.indexOf('find /app/data -xdev') < entrypoint.indexOf(dropPrivileges));
  assert.match(entrypoint, /\nexec "\$@"\s*$/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/localminidrama-entrypoint"\]/);
  assert.match(
    dockerfile,
    /FROM runtime AS production[\s\S]*RUN rm -rf \/usr\/local\/lib\/node_modules\/npm[\s\S]*CMD \["node", "src\/server\.js"\]/,
  );
  assert.doesNotMatch(dockerfile, /CMD \["npm", "start"\]/);
  assert.match(dockerfile, /COPY --chown=node:node docker-compose\.yml \/docker-compose\.yml/);
  assert.match(dockerfile, /COPY --chown=node:node \.dockerignore \/\.dockerignore/);
  assert.match(dockerfile, /COPY --chown=node:node scripts\/verify-docker-artifact\.cjs \/scripts\/verify-docker-artifact\.cjs/);
  assert.match(dockerfile, /COPY --chown=node:node scripts\/runtime-config-policy\.cjs \/scripts\/runtime-config-policy\.cjs/);
});

test('entrypoint migrates once, skips later ownership drift, and fails closed on unsafe markers', dockerBehavior, () => {
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  const runtimeImage = dockerfile.match(/^FROM (node:20-bookworm-slim@sha256:[a-f0-9]{64}) AS dependencies$/m)?.[1];
  assert.ok(runtimeImage, 'Dockerfile must pin the Node 20 runtime image');

  const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const migrationVolume = `localminidrama-entrypoint-migration-${suffix}`;
  const symlinkMarkerVolume = `localminidrama-entrypoint-symlink-${suffix}`;
  const nonRegularMarkerVolume = `localminidrama-entrypoint-non-regular-${suffix}`;
  const volumes = [migrationVolume, symlinkMarkerVolume, nonRegularMarkerVolume];
  const policyPath = path.join(repositoryRoot, 'scripts', 'runtime-config-policy.cjs');
  const configPath = path.join(backendRoot, 'configs', 'config.yaml');

  const run = (args, expectedStatus = 0) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 90000,
      windowsHide: true,
    });
    assert.equal(
      result.status,
      expectedStatus,
      `docker ${args.join(' ')}\nstdout: ${result.stdout || ''}\nstderr: ${result.stderr || ''}`,
    );
    return result;
  };

  const entrypointRunArgs = (volume, command) => [
    'run', '--rm', '--user', '0:0',
    '--mount', `type=volume,source=${volume},target=/app/data`,
    '--mount', `type=bind,source=${entrypointPath},target=/entrypoint.sh,readonly`,
    '--mount', `type=bind,source=${policyPath},target=/usr/local/lib/localminidrama/runtime-config-policy.cjs,readonly`,
    '--mount', `type=bind,source=${configPath},target=/config.yaml,readonly`,
    '--mount', `type=bind,source=${path.join(backendRoot, 'node_modules')},target=/app/node_modules,readonly`,
    '--mount', `type=bind,source=${path.join(backendRoot, 'package.json')},target=/app/package.json,readonly`,
    '--workdir', '/app',
    '--env', 'LOCALMINIDRAMA_CONFIG_SOURCE=/config.yaml',
    '--env', 'LOCALMINIDRAMA_CONFIG_PATH=/tmp/localminidrama-config/config.yaml',
    '--entrypoint', 'sh', runtimeImage, '/entrypoint.sh', 'sh', '-c', command,
  ];

  try {
    for (const volume of volumes) run(['volume', 'create', volume]);

    run([
      'run', '--rm', '--user', '0:0',
      '--mount', `type=volume,source=${migrationVolume},target=/app/data`,
      '--entrypoint', 'sh', runtimeImage, '-c',
      'mkdir -p /app/data/storage && printf legacy > /app/data/storage/legacy.txt && chown -R 0:0 /app/data',
    ]);
    run(entrypointRunArgs(
      migrationVolume,
      'test "$(id -u)" = 1000 && test "$(stat -c %u /app/data/storage/legacy.txt)" = 1000 && test -f /app/data/.localminidrama-owner-v1 && test ! -L /app/data/.localminidrama-owner-v1 && test "$(stat -c %a /app/data/.localminidrama-owner-v1)" = 600 && touch /app/data/storage/first-run-writable',
    ));

    run([
      'run', '--rm', '--user', '0:0',
      '--mount', `type=volume,source=${migrationVolume},target=/app/data`,
      '--entrypoint', 'sh', runtimeImage, '-c',
      'printf late > /app/data/storage/late-root-owned.txt && chown 0:0 /app/data/storage/late-root-owned.txt',
    ]);
    run(entrypointRunArgs(
      migrationVolume,
      'test "$(id -u)" = 1000 && test "$(stat -c %u /app/data/storage/late-root-owned.txt)" = 0 && touch /app/data/storage/restart-writable',
    ));

    run([
      'run', '--rm', '--user', '0:0',
      '--mount', `type=volume,source=${symlinkMarkerVolume},target=/app/data`,
      '--entrypoint', 'sh', runtimeImage, '-c',
      'touch /app/data/marker-target && ln -s marker-target /app/data/.localminidrama-owner-v1',
    ]);
    const symlinkMarker = run(entrypointRunArgs(symlinkMarkerVolume, 'exit 0'), 1);
    assert.match(symlinkMarker.stderr, /Data ownership marker must be a regular file/);

    run([
      'run', '--rm', '--user', '0:0',
      '--mount', `type=volume,source=${nonRegularMarkerVolume},target=/app/data`,
      '--entrypoint', 'sh', runtimeImage, '-c',
      'mkdir /app/data/.localminidrama-owner-v1',
    ]);
    const nonRegularMarker = run(entrypointRunArgs(nonRegularMarkerVolume, 'exit 0'), 1);
    assert.match(nonRegularMarker.stderr, /Data ownership marker must be a regular file/);
  } finally {
    for (const volume of volumes) {
      spawnSync('docker', ['volume', 'rm', '-f', volume], {
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
      });
    }
  }
});

test('production image copies only the checked-in default config and verifies malicious fixtures are absent', repositoryOnly, () => {
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  const dockerignore = fs.readFileSync(dockerignorePath, 'utf8');
  const artifactVerification = fs.readFileSync(artifactVerificationPath, 'utf8');

  assert.match(dockerfile, /COPY scripts\/runtime-config-policy\.cjs \/policy\/runtime-config-policy\.cjs/);
  assert.match(dockerfile, /RUN node \/policy\/runtime-config-policy\.cjs \/policy\/config\.yaml \/app\/config\.runtime\.yaml/);
  assert.match(dockerfile, /COPY --from=dependencies --chown=node:node \/app\/config\.runtime\.yaml \.\/configs\/config\.yaml/);
  assert.match(dockerfile, /COPY --from=dependencies --chown=root:root \/policy\/runtime-config-policy\.cjs \/usr\/local\/lib\/localminidrama\/runtime-config-policy\.cjs/);
  assert.doesNotMatch(dockerfile, /COPY[^\n]*backend-node\/configs(?:\s|\/\s)/);
  assert.match(dockerignore, /\*\*\/configs\/\*\*/);
  assert.match(dockerignore, /!backend-node\/configs\/config\.yaml/);
  assert.match(dockerignore, /\*\*\/data/);
  assert.match(artifactVerification, /ai-configs-artifact-boundary-/);
  assert.match(artifactVerification, /flag: 'wx'/);
  assert.match(artifactVerification, /if \(configCreated\)/);
  assert.match(artifactVerification, /unexpected runtime config files/);
  assert.match(artifactVerification, /runtime image contains local data/);
  assert.match(artifactVerification, /function verifyBackendRuntime\(/);
  assert.match(artifactVerification, /'--init'/);
  assert.match(artifactVerification, /process\.getuid\(\)!==1000/);
  assert.match(artifactVerification, /process\.ppid!==1/);
  assert.match(artifactVerification, /\['CapInh','CapPrm','CapEff','CapAmb'\]/);
  assert.match(artifactVerification, /NoNewPrivs/);
  assert.match(artifactVerification, /hostConfig\.PidsLimit !== 512/);
  assert.match(artifactVerification, /hostConfig\.LogConfig/);
});

test('Docker artifact verification resolves an explicit image instead of a running container image', repositoryOnly, () => {
  const compose = fs.readFileSync(composePath, 'utf8');
  const artifactVerification = fs.readFileSync(artifactVerificationPath, 'utf8');

  assert.match(compose, /backend:\s*\n\s*image:\s*localminidrama-backend:/);
  assert.match(artifactVerification, /compose', 'config', '--format', 'json'/);
  assert.match(artifactVerification, /services\?\.\[service\]\?\.image/);
  assert.doesNotMatch(artifactVerification, /compose', 'images'/);
});
