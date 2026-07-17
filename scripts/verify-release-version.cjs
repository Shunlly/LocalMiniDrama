'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function assertReleaseVersion(version, label) {
  assert.match(String(version || ''), VERSION_PATTERN, `${label} is not a valid release version: ${version}`)
  return version
}

function packageVersion(relativePath, rootDirectory = root) {
  return JSON.parse(fs.readFileSync(path.join(rootDirectory, relativePath), 'utf8')).version
}

function lockVersion(relativePath, rootDirectory = root) {
  const lock = JSON.parse(fs.readFileSync(path.join(rootDirectory, relativePath), 'utf8'))
  return lock.packages?.['']?.version || lock.version
}

function configVersion(rootDirectory = root) {
  const source = fs.readFileSync(path.join(rootDirectory, 'backend-node', 'configs', 'config.yaml'), 'utf8')
  const appBlock = source.match(/^app:\s*\r?\n((?:^[ \t]+.*(?:\r?\n|$))*)/m)?.[1] || ''
  const version = appBlock.match(/^\s+version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1]
  assert.ok(version, 'backend-node/configs/config.yaml must define app.version')
  return version
}

function releaseTagVersion(environment = process.env) {
  const refType = String(environment.GITHUB_REF_TYPE || '').trim()
  const fullRef = String(environment.GITHUB_REF || '').trim()
  const refName = String(environment.GITHUB_REF_NAME || '').trim()
  const isTagContext = refType === 'tag' || fullRef.startsWith('refs/tags/')

  if (!isTagContext) {
    return /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(refName) ? refName.slice(1) : ''
  }

  const tagName = refName || fullRef.slice('refs/tags/'.length)
  assert.ok(tagName, 'GitHub tag context is missing GITHUB_REF_NAME')
  assert.match(tagName, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `invalid release tag: ${tagName}`)
  const version = tagName.slice(1)
  assertReleaseVersion(version, 'release tag version')
  return version
}

function expectedVersion(environment = process.env, desktopVersion = packageVersion('desktop/package.json')) {
  const explicit = String(environment.RELEASE_VERSION || '').trim()
  const tagVersion = releaseTagVersion(environment)
  if (explicit) assertReleaseVersion(explicit, 'RELEASE_VERSION')
  if (explicit && tagVersion) {
    assert.equal(explicit, tagVersion, `RELEASE_VERSION ${explicit} does not match tag version ${tagVersion}`)
  }
  return assertReleaseVersion(explicit || tagVersion || desktopVersion, 'release version')
}

function readVersions(rootDirectory = root) {
  return {
    backend: packageVersion('backend-node/package.json', rootDirectory),
    backend_lock: lockVersion('backend-node/package-lock.json', rootDirectory),
    frontend: packageVersion('frontweb/package.json', rootDirectory),
    frontend_lock: lockVersion('frontweb/package-lock.json', rootDirectory),
    desktop: packageVersion('desktop/package.json', rootDirectory),
    desktop_lock: lockVersion('desktop/package-lock.json', rootDirectory),
    config: configVersion(rootDirectory),
  }
}

function verifyReleaseVersion({ environment = process.env, rootDirectory = root } = {}) {
  const versions = readVersions(rootDirectory)
  const expected = expectedVersion(environment, versions.desktop)
  for (const [name, version] of Object.entries(versions)) {
    assertReleaseVersion(version, `${name} version`)
    assert.equal(version, expected, `${name} version ${version} does not match release version ${expected}`)
  }
  return { release_version: expected, versions, verified: true }
}

module.exports = {
  VERSION_PATTERN,
  assertReleaseVersion,
  configVersion,
  expectedVersion,
  lockVersion,
  packageVersion,
  readVersions,
  releaseTagVersion,
  verifyReleaseVersion,
}

if (require.main === module) {
  console.log(JSON.stringify(verifyReleaseVersion()))
}
