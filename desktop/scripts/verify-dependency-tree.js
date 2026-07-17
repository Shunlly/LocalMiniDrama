'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const desktopRoot = path.join(__dirname, '..');
const npmCli = process.env.npm_execpath;

function runNpm(args) {
  if (!npmCli) {
    throw new Error('npm_execpath is unavailable; run this check through npm run verify:deps');
  }
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: desktopRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function main() {
  const dependencyTree = JSON.parse(runNpm(['ls', '--all', '--json']));
  if (dependencyTree.problems && dependencyTree.problems.length) {
    throw new Error(`npm dependency tree has problems:\n${dependencyTree.problems.join('\n')}`);
  }

  const sbom = JSON.parse(runNpm([
    'sbom',
    '--package-lock-only',
    '--sbom-format',
    'cyclonedx',
  ]));
  if (sbom.bomFormat !== 'CycloneDX') throw new Error('npm sbom did not return a CycloneDX document');
  if (sbom.metadata?.component?.version !== dependencyTree.version) {
    throw new Error('SBOM root component version does not match the installed package');
  }

  process.stdout.write(
    `[deps] OK npm-ls=${dependencyTree.name}@${dependencyTree.version} ` +
    `sbom=${sbom.specVersion} components=${Array.isArray(sbom.components) ? sbom.components.length : 0}\n`
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`[deps] FAILED ${err && err.stack ? err.stack : err}\n`);
  process.exitCode = 1;
}
