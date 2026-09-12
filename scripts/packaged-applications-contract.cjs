'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { FUSE_POLICY } = require('../desktop/scripts/electron-fuses')
const { EXPECTED_EXAMPLE_DRAMA } = require('./example-drama-contract.cjs')

const EXPECTED_PACKAGED_APPLICATION_ROOTS = Object.freeze(['portable', 'setup', 'unpacked'])
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|(?:com|lpt)(?:[1-9]|[\u00b9\u00b2\u00b3]))(?:\..*)?$/i

function expectedFuseStates() {
  return Object.fromEntries(
    Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
  )
}

function assertRelativeInventoryPath(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  assert.ok(value.length > 0, `${label} is invalid`)
  const normalized = value.replace(/\\/g, '/')
  assert.doesNotMatch(normalized, /[\u0000-\u001f\u007f]/, `${label} contains a control character`)
  assert.doesNotMatch(normalized, /[?*<>"|]/, `${label} contains an invalid Windows filename character`)
  assert.equal(path.posix.isAbsolute(normalized), false, `${label} must be relative`)
  assert.doesNotMatch(normalized, /^[A-Za-z]:/, `${label} must not contain a drive prefix`)
  assert.doesNotMatch(normalized, /:/, `${label} contains a Windows alternate-stream separator`)
  assert.equal(normalized.split('/').includes('..'), false, `${label} must not escape the scan root`)
  assert.equal(path.posix.normalize(normalized), normalized, `${label} must be normalized`)
  for (const segment of normalized.split('/')) {
    assert.doesNotMatch(segment, /[. ]$/, `${label} contains a Windows-ambiguous path segment`)
    assert.doesNotMatch(segment, WINDOWS_DEVICE_NAME, `${label} contains a Windows device name`)
  }
  return normalized
}

function validatePackagedApplications(applications, expectedExampleDrama = EXPECTED_EXAMPLE_DRAMA) {
  assert.ok(Array.isArray(applications), 'Packaged application inventory is invalid')
  assert.equal(
    applications.length,
    EXPECTED_PACKAGED_APPLICATION_ROOTS.length,
    'Artifact scan inventory must contain exactly one application from Setup, Portable, and Unpacked'
  )

  const executables = new Set()
  const asars = new Set()
  const roots = []
  const requiredFuses = expectedFuseStates()
  for (const [index, application] of applications.entries()) {
    const executable = assertRelativeInventoryPath(application?.executable, `packaged application ${index} executable`)
    const asarPath = assertRelativeInventoryPath(application?.asar, `packaged application ${index} asar`)
    assert.equal(typeof application?.example_drama, 'object', 'example drama descriptor is invalid')
    assert.notEqual(application.example_drama, null, 'example drama descriptor is invalid')
    const exampleDramaPath = assertRelativeInventoryPath(
      application.example_drama.path,
      `packaged application ${index} example drama path`
    )
    assert.match(executable, /(?:^|\/)[^/]+\.exe$/i, `${executable} is not an application executable`)
    assert.match(asarPath, /(?:^|\/)resources\/app\.asar$/i, `${asarPath} is not an application ASAR`)
    assert.notEqual(executable, asarPath, 'Packaged executable and ASAR paths must differ')
    const executableKey = executable.toLowerCase()
    const asarKey = asarPath.toLowerCase()
    assert.equal(executables.has(executableKey), false, `Duplicate packaged executable: ${executable}`)
    assert.equal(asars.has(asarKey), false, `Duplicate packaged ASAR: ${asarPath}`)
    executables.add(executableKey)
    asars.add(asarKey)

    const executableRoot = executable.split('/')[0]
    const asarRoot = asarPath.split('/')[0]
    assert.equal(asarRoot, executableRoot, `${executable} and ${asarPath} belong to different release artifacts`)
    assert.ok(
      EXPECTED_PACKAGED_APPLICATION_ROOTS.includes(executableRoot),
      `${executable} does not belong to Setup, Portable, or Unpacked`
    )
    assert.equal(
      path.posix.dirname(executable),
      path.posix.dirname(path.posix.dirname(asarPath)),
      `${executable} and ${asarPath} do not describe the same packaged application`
    )
    assert.equal(
      exampleDramaPath,
      path.posix.join(path.posix.dirname(asarPath), expectedExampleDrama.relativePath),
      'example drama does not belong to the packaged application'
    )
    assert.equal(application.example_drama.bytes, expectedExampleDrama.bytes, 'example drama bytes are invalid')
    assert.equal(application.example_drama.sha256, expectedExampleDrama.sha256, 'example drama digest is invalid')
    roots.push(executableRoot)
    assert.deepEqual(application.fuses, requiredFuses, `${executable} fuse evidence is invalid`)
  }

  assert.deepEqual(
    roots.sort((a, b) => a.localeCompare(b, 'en')),
    [...EXPECTED_PACKAGED_APPLICATION_ROOTS],
    'Artifact scan inventory must cover Setup, Portable, and Unpacked exactly once'
  )
  return applications
}

module.exports = {
  EXPECTED_PACKAGED_APPLICATION_ROOTS,
  validatePackagedApplications,
}
