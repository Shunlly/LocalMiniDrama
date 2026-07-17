const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {
  writeMediaToolMetadata: writeTrustedMediaToolMetadata,
} = require('../desktop/scripts/media-tool-policy')

const root = path.resolve(__dirname, '..')
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker'
const macReleaseCommand = 'bash dist-mac.sh'
const macFailClosedCommandPattern = /^(?:builtin printf '%s\\n' '[^'$`\\]*' >&2|builtin exit 1)$/

function npmInvocation(args, runtime = {}) {
  const platform = runtime.platform || process.platform
  if (platform !== 'win32') return { command: 'npm', args }

  const execPath = runtime.execPath || process.execPath
  const environment = runtime.environment || process.env
  const npmCli = environment.npm_execpath
    || path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return {
    command: execPath,
    args: [npmCli, ...args],
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} exited with status ${result.status}`)
    error.exitCode = result.status || 1
    throw error
  }
}

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args)
  run(invocation.command, invocation.args, options)
}

function verifySourceAndContainers() {
  let composeAttempted = false
  let primaryError = null
  try {
    runNpm(['run', 'verify'])
    composeAttempted = true
    run(dockerCommand, ['compose', '--profile', 'e2e', 'up', '-d', '--build', '--wait'])
    runNpm(['run', 'verify:docker'])
    runNpm(['run', 'verify:e2e'])
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (composeAttempted) {
      try {
        run(dockerCommand, ['compose', '--profile', 'e2e', 'down', '--remove-orphans'])
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError
        console.error(`Release verification cleanup failed: ${cleanupError.message}`)
      }
    }
  }
}

function writeSbom(packageDirectory, outputNames) {
  const invocation = npmInvocation([
    '--prefix', packageDirectory,
    'sbom',
    '--package-lock-only',
    '--sbom-format', 'cyclonedx',
  ])
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`SBOM generation failed for ${packageDirectory}: ${String(result.stderr || '').trim()}`)
  }
  const sbom = JSON.parse(result.stdout)
  const outputDirectory = path.join(root, 'desktop', 'release')
  fs.mkdirSync(outputDirectory, { recursive: true })
  const serialized = `${JSON.stringify(sbom, null, 2)}\n`
  const names = Array.isArray(outputNames) ? outputNames : [outputNames]
  assert.ok(names.length > 0, 'SBOM output name is required')
  for (const outputName of names) {
    assert.equal(path.basename(outputName), outputName, `unsafe SBOM output name: ${outputName}`)
    fs.writeFileSync(path.join(outputDirectory, outputName), serialized, 'utf8')
  }
}

function writeReleaseSboms() {
  const desktopVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8')
  ).version
  writeSbom('backend-node', 'sbom-backend.cdx.json')
  writeSbom('frontweb', 'sbom-frontend.cdx.json')
  writeSbom('desktop', [
    `LocalMiniDrama-${desktopVersion}.cdx.json`,
    'sbom-desktop.cdx.json',
  ])
}

function writeMediaToolMetadata() {
  const mediaDirectory = path.join(root, 'desktop', 'release', '.media-tools')
  return writeTrustedMediaToolMetadata(
    mediaDirectory,
    path.join(root, 'desktop', 'release', 'media-tools.json'),
    'win32',
    'x64'
  )
}

function assertMacReleaseFailsClosed() {
  const desktopDirectory = path.join(root, 'desktop')
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'))
  assert.equal(desktopPackage.scripts?.['dist:mac'], macReleaseCommand, 'dist:mac must only invoke the fail-closed gate')
  assert.equal(desktopPackage.scripts?.['predist:mac'], undefined, 'dist:mac must not have a pre-script')
  assert.equal(desktopPackage.scripts?.['postdist:mac'], undefined, 'dist:mac must not have a post-script')
  assert.deepEqual(
    fs.readdirSync(desktopDirectory).filter((name) => /^electron-builder-mac.*\.json$/i.test(name)),
    [],
    'standalone macOS electron-builder configurations must not bypass the fail-closed script'
  )

  const source = fs.readFileSync(path.join(desktopDirectory, 'dist-mac.sh'), 'utf8')
  const commands = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  assert.ok(commands.length > 1, 'dist-mac.sh must explain why the release is blocked')
  assert.equal(commands.at(-1), 'builtin exit 1', 'dist-mac.sh must unconditionally fail')
  for (const command of commands) {
    assert.match(command, macFailClosedCommandPattern, `dist-mac.sh contains a build or upload-capable command: ${command}`)
  }
  assert.match(source, /trusted FFmpeg SHA-256 digests/)
  assert.match(source, /packaged-application smoke test/)
  assert.match(source, /independent verification of macOS artifacts before upload/)
}

function assertReleaseBuilderNeverPublishes() {
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'))
  for (const scriptName of ['pack', 'dist']) {
    const script = String(desktopPackage.scripts?.[scriptName] || '')
    assert.match(script, /\belectron-builder\b[^&]*\s--publish(?:=|\s+)never(?:\s|$)/, `${scriptName} must pass --publish never`)
  }
  assertMacReleaseFailsClosed()
}

function verifyWindowsArtifacts() {
  if (process.platform !== 'win32') {
    throw new Error('full release verification requires Windows; use npm run verify:release:source for source and Docker verification only')
  }
  assertReleaseBuilderNeverPublishes()
  runNpm(['--prefix', 'desktop', 'run', 'dist'])
  runNpm(['--prefix', 'desktop', 'run', 'smoke:windows'])
  runNpm(['--prefix', 'desktop', 'run', 'package:unpacked'])
  writeReleaseSboms()
  writeMediaToolMetadata()
  console.log('Windows release candidate built and smoke-tested; independent artifact scans are still required.')
}

function main(args = process.argv.slice(2)) {
  const sourceOnly = args.includes('--source-only')
  const windowsOnly = args.includes('--windows-only')
  const unknownArgs = args.filter((arg) => !['--source-only', '--windows-only'].includes(arg))
  if (unknownArgs.length) throw new Error(`unknown release verification option: ${unknownArgs.join(', ')}`)
  if (sourceOnly && windowsOnly) throw new Error('--source-only and --windows-only cannot be combined')
  if (!windowsOnly) verifySourceAndContainers()
  if (sourceOnly) {
    console.log('Source and Docker release checks passed; Windows artifacts were not built or verified.')
    return
  }
  verifyWindowsArtifacts()
}

module.exports = {
  assertMacReleaseFailsClosed,
  assertReleaseBuilderNeverPublishes,
  main,
  npmInvocation,
  run,
  verifySourceAndContainers,
  verifyWindowsArtifacts,
  writeMediaToolMetadata,
  writeReleaseSboms,
  writeSbom,
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = error.exitCode || 1
  }
}
