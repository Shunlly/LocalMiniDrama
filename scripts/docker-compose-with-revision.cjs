'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: options.encoding,
    stdio: options.stdio,
    env: options.env || process.env,
    windowsHide: true,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`)
  return String(result.stdout || '').trim()
}

function parseArguments(argv) {
  const profiles = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== '--profile') throw new Error(`unknown Docker startup argument: ${arg}`)
    const profile = argv[index + 1]
    if (!profile || !/^[a-z0-9][a-z0-9_-]*$/i.test(profile)) {
      throw new Error('--profile requires a safe profile name')
    }
    profiles.push(profile)
    index += 1
  }
  return profiles
}

function revisionServices(profiles) {
  const services = ['backend', 'frontend']
  if (profiles.includes('e2e')) services.push('e2e-provider')
  return services
}

function main() {
  const profiles = parseArguments(process.argv.slice(2))
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' })
  assert.equal(dirty, '', 'verified Docker startup requires a clean Git working tree')
  const revision = run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).toLowerCase()
  assert.match(revision, /^[a-f0-9]{40}$/, 'verified Docker startup requires a full Git commit')
  const imageTag = process.env.LOCALMINIDRAMA_IMAGE_TAG || revision
  assert.match(imageTag, /^[a-z0-9][a-z0-9_.-]{0,127}$/i, 'Docker image tag must be a safe value')

  const composePrefix = ['compose']
  for (const profile of profiles) composePrefix.push('--profile', profile)
  const composeArgs = [...composePrefix, 'up', '-d', '--build', '--wait']
  const result = spawnSync('docker', composeArgs, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      LOCALMINIDRAMA_BUILD_REVISION: revision,
      LOCALMINIDRAMA_IMAGE_TAG: imageTag,
    },
    windowsHide: true,
  })
  if (result.error) throw result.error
  if ((result.status ?? 1) !== 0) {
    process.exitCode = result.status ?? 1
    return
  }

  const imageEnv = {
    ...process.env,
    LOCALMINIDRAMA_BUILD_REVISION: revision,
    LOCALMINIDRAMA_IMAGE_TAG: imageTag,
  }
  for (const service of revisionServices(profiles)) {
    const image = `localminidrama-${service}:${imageTag}`
    const imageRevision = run(
      'docker',
      ['image', 'inspect', image, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}'],
      { encoding: 'utf8', env: imageEnv },
    ).toLowerCase()
    assert.equal(imageRevision, revision, `${service} image revision must match the verified Git commit`)

    const containerId = run(
      'docker',
      [...composePrefix, 'ps', '-q', service],
      { encoding: 'utf8', env: imageEnv },
    )
    assert.match(containerId, /^[a-f0-9]{12,64}$/i, `${service} must have exactly one running container`)
    const targetImageId = run(
      'docker',
      ['image', 'inspect', image, '--format', '{{.Id}}'],
      { encoding: 'utf8', env: imageEnv },
    )
    const runningImageId = run(
      'docker',
      ['container', 'inspect', containerId, '--format', '{{.Image}}'],
      { encoding: 'utf8', env: imageEnv },
    )
    assert.equal(runningImageId, targetImageId, `${service} container must run the verified tagged image`)
  }
  process.exitCode = 0
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`)
    process.exitCode = 1
  }
}

module.exports = { parseArguments, revisionServices }
