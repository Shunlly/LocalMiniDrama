const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const backendRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(backendRoot, '..');
const composePath = path.join(repositoryRoot, 'docker-compose.yml');
const entrypointPath = path.join(backendRoot, 'docker-entrypoint.sh');
const dockerfilePath = path.join(backendRoot, 'Dockerfile');
const dockerignorePath = path.join(repositoryRoot, '.dockerignore');
const artifactVerificationPath = path.join(repositoryRoot, 'scripts', 'verify-docker-artifact.cjs');
const repositoryAssetsAvailable = [
  composePath,
  entrypointPath,
  dockerfilePath,
  dockerignorePath,
  artifactVerificationPath,
].every(fs.existsSync);
const repositoryOnly = repositoryAssetsAvailable
  ? {}
  : { skip: 'repository Docker sources are not copied into the verification image' };

test('backend Compose outwaits synchronous startup and the maintenance lock TTL with bounded retries', repositoryOnly, () => {
  const compose = yaml.load(fs.readFileSync(composePath, 'utf8'));
  const backend = compose.services.backend;

  assert.equal(backend.restart, 'on-failure:10');
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
});

test('entrypoint makes persistent data writable before dropping privileges and keeps Node as PID 1', repositoryOnly, () => {
  const entrypoint = fs.readFileSync(entrypointPath, 'utf8');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  const ownershipChange = 'chown -R node:node /app/data';
  const configSanitization = 'node /usr/local/lib/localminidrama/runtime-config-policy.cjs "$config_source" "$config_target"';
  const dropPrivileges = 'exec setpriv --reuid=node --regid=node --init-groups -- "$@"';

  assert.match(entrypoint, /mkdir -p \/app\/data/);
  assert.doesNotMatch(entrypoint, /chown[^\n]*\/app\/config-source/);
  assert.ok(entrypoint.includes(ownershipChange));
  assert.ok(entrypoint.includes(configSanitization));
  assert.ok(entrypoint.includes(dropPrivileges));
  assert.ok(entrypoint.indexOf(configSanitization) < entrypoint.indexOf(dropPrivileges));
  assert.ok(entrypoint.indexOf(ownershipChange) < entrypoint.indexOf(dropPrivileges));
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
});

test('Docker artifact verification resolves an explicit image instead of a running container image', repositoryOnly, () => {
  const compose = fs.readFileSync(composePath, 'utf8');
  const artifactVerification = fs.readFileSync(artifactVerificationPath, 'utf8');

  assert.match(compose, /backend:\s*\n\s*image:\s*localminidrama-backend:/);
  assert.match(artifactVerification, /compose', 'config', '--format', 'json'/);
  assert.match(artifactVerification, /services\?\.\[service\]\?\.image/);
  assert.doesNotMatch(artifactVerification, /compose', 'images'/);
});
