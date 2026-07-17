const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const fixtureId = `${process.pid}-${Date.now()}`
const fixtureConfigName = `ai-configs-artifact-boundary-${fixtureId}.json`
const fixtureDataName = `artifact-boundary-${fixtureId}.db`
const fixtureConfig = path.join(root, 'backend-node', 'configs', fixtureConfigName)
const fixtureData = path.join(root, 'backend-node', 'data', fixtureDataName)
const marker = 'LOCALMINIDRAMA_SYNTHETIC_ARTIFACT_BOUNDARY_MARKER'

function run(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${String(result.stderr || result.stdout || '').trim()}`)
  }
  return String(result.stdout || '').trim()
}

function resolveComposeImage(service) {
  const config = JSON.parse(run(['compose', 'config', '--format', 'json']))
  const image = config?.services?.[service]?.image
  if (!image) throw new Error(`Docker Compose service ${service} must declare an explicit image`)
  run(['image', 'inspect', image, '--format', '{{.Id}}'])
  return image
}

function main() {
  if (fs.existsSync(fixtureConfig) || fs.existsSync(fixtureData)) {
    throw new Error('refusing to overwrite an existing Docker artifact verification fixture')
  }
  fs.mkdirSync(path.dirname(fixtureConfig), { recursive: true })
  fs.mkdirSync(path.dirname(fixtureData), { recursive: true })
  let configCreated = false
  let dataCreated = false

  try {
    fs.writeFileSync(fixtureConfig, JSON.stringify({ api_key: marker }), { encoding: 'utf8', flag: 'wx' })
    configCreated = true
    fs.writeFileSync(fixtureData, marker, { encoding: 'utf8', flag: 'wx' })
    dataCreated = true
    run(['compose', 'build', 'backend'])
    const image = resolveComposeImage('backend')

    const inspection = [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "const configs=fs.readdirSync('/app/configs').sort();",
      "if(JSON.stringify(configs)!==JSON.stringify(['config.yaml'])) throw new Error('unexpected runtime config files: '+configs.join(','));",
      "const data=fs.readdirSync('/app/data');",
      "if(data.length) throw new Error('runtime image contains local data: '+data.join(','));",
      "const entrypoint=fs.readFileSync('/usr/local/bin/localminidrama-entrypoint','utf8');",
      "if(entrypoint.includes('\\r')) throw new Error('runtime entrypoint contains CRLF line endings');",
      "if(!entrypoint.startsWith('#!/bin/sh\\n')) throw new Error('runtime entrypoint has an invalid shebang');",
      `const forbidden=${JSON.stringify(marker)};`,
      `for(const file of ['/app/configs/${fixtureConfigName}','/app/data/${fixtureDataName}']) if(fs.existsSync(file)) throw new Error('forbidden fixture entered image: '+path.basename(file));`,
      "const defaultConfig=fs.readFileSync('/app/configs/config.yaml','utf8');",
      "if(defaultConfig.includes(forbidden)) throw new Error('artifact marker entered default config');",
      "const runtimeConfig=require('js-yaml').load(defaultConfig);",
      "if(runtimeConfig?.app?.debug!==false) throw new Error('runtime config debug mode was not disabled');",
      "if(runtimeConfig?.vendor_lock?.enabled!==false) throw new Error('runtime config retained vendor lock');",
      "if(runtimeConfig?.image_proxy?.upload_url!=='') throw new Error('runtime config retained an upload URL');",
      "process.stdout.write('Docker artifact boundary verified.\\n');",
    ].join('')
    process.stdout.write(run(['run', '--rm', '--entrypoint', 'node', image, '-e', inspection]) + '\n')
  } finally {
    if (configCreated) fs.rmSync(fixtureConfig, { force: true })
    if (dataCreated) fs.rmSync(fixtureData, { force: true })
  }
}

module.exports = { main, resolveComposeImage }

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
