const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const fixtureId = `${process.pid}-${Date.now()}`
const fixtureConfigName = `ai-configs-artifact-boundary-${fixtureId}.json`
const fixtureDataName = `artifact-boundary-${fixtureId}.db`
const fixtureConfig = path.join(root, 'backend-node', 'configs', fixtureConfigName)
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

function resolveComposeImage(service, options = {}) {
  const config = JSON.parse(run(['compose', 'config', '--format', 'json'], options))
  const image = config?.services?.[service]?.image
  if (!image) throw new Error(`Docker Compose service ${service} must declare an explicit image`)
  run(['image', 'inspect', image, '--format', '{{.Id}}'], options)
  return image
}

function verifyBackendRuntime(image, dataDirectory, options = {}) {
  const containerName = 'localminidrama-runtime-audit-' + process.pid + '-' + Date.now()
  const runtimeProbe = [
    "const fs=require('node:fs');",
    "const status=fs.readFileSync('/proc/self/status','utf8');",
    "const field=(name)=>status.match(new RegExp('^'+name+':\\\\s+(.+)$','m'))?.[1]?.trim() || '';",
    "if(process.getuid()!==1000 || process.getgid()!==1000) throw new Error('backend runtime is not UID/GID 1000');",
    "if(process.ppid!==1) throw new Error('backend process is not supervised by PID 1');",
    "if(!/docker-init|tini/i.test(fs.readFileSync('/proc/1/comm','utf8'))) throw new Error('PID 1 is not an init process');",
    "for(const name of ['CapInh','CapPrm','CapEff','CapAmb']) if(!/^0+$/.test(field(name))) throw new Error(name+' is not empty');",
    "if(field('NoNewPrivs')!=='1') throw new Error('no-new-privileges is not active');",
    "const probe='/app/data/.localminidrama-runtime-probe';",
    "const payload=Buffer.from('runtime-probe');",
    "const fd=fs.openSync(probe,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR,0o600);",
    "fs.writeSync(fd,payload,0,payload.length,0);",
    "fs.fsyncSync(fd);",
    "fs.closeSync(fd);",
    "fs.unlinkSync(probe);",
    "let rootReadOnly=false;",
    "try{fs.writeFileSync('/app/.localminidrama-root-probe','probe')}catch(error){if(['EACCES','EPERM','EROFS'].includes(error.code))rootReadOnly=true;else throw error;}",
    "if(!rootReadOnly) throw new Error('runtime root filesystem is writable');",
    "process.stdout.write('LOCALMINIDRAMA_RUNTIME_SECURITY_OK\\n');",
  ].join('')
  const createArgs = [
    'create',
    '--name', containerName,
    '--init',
    '--read-only',
    '--security-opt', 'no-new-privileges:true',
    '--cap-drop', 'ALL',
    '--cap-add', 'CHOWN',
    '--cap-add', 'DAC_READ_SEARCH',
    '--cap-add', 'KILL',
    '--cap-add', 'SETGID',
    '--cap-add', 'SETUID',
    '--pids-limit', '512',
    '--cpus', '4.0',
    '--memory', '8g',
    '--log-driver', 'json-file',
    '--log-opt', 'max-size=10m',
    '--log-opt', 'max-file=3',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
    '--mount', 'type=bind,source=' + dataDirectory + ',target=/app/data',
    image,
    'node',
    '-e',
    runtimeProbe,
  ]
  let created = false
  try {
    run(createArgs, options)
    created = true
    const configured = JSON.parse(run(['inspect', containerName], options))[0]
    const hostConfig = configured?.HostConfig || {}
    if (hostConfig.Init !== true) throw new Error('runtime container init is not enabled')
    if (hostConfig.ReadonlyRootfs !== true) throw new Error('runtime root filesystem is not read-only')
    if (hostConfig.PidsLimit !== 512) throw new Error('runtime pids limit is not 512')
    if (hostConfig.NanoCpus !== 4000000000) throw new Error('runtime CPU limit is not 4.0')
    if (hostConfig.Memory !== 8 * 1024 * 1024 * 1024) throw new Error('runtime memory limit is not 8g')
    if (!hostConfig.SecurityOpt?.includes('no-new-privileges:true')) {
      throw new Error('runtime no-new-privileges option is missing')
    }
    if (hostConfig.LogConfig?.Type !== 'json-file' ||
        hostConfig.LogConfig?.Config?.['max-size'] !== '10m' ||
        hostConfig.LogConfig?.Config?.['max-file'] !== '3') {
      throw new Error('runtime log rotation is not bounded')
    }
    if (JSON.stringify(hostConfig.CapDrop || []) !== JSON.stringify(['ALL'])) {
      throw new Error('runtime capability drop policy is not ALL')
    }
    const capabilityTransition = (hostConfig.CapAdd || [])
      .map((capability) => capability.replace(/^CAP_/, ''))
      .slice()
      .sort()
    if (JSON.stringify(capabilityTransition) !== JSON.stringify([
      'CHOWN', 'DAC_READ_SEARCH', 'KILL', 'SETGID', 'SETUID',
    ])) {
      throw new Error('runtime capability transition policy changed')
    }
    const output = run(['start', '--attach', containerName], options)
    if (!output.includes('LOCALMINIDRAMA_RUNTIME_SECURITY_OK')) {
      throw new Error('runtime security probe did not complete')
    }
  } finally {
    if (created) {
      spawnSync('docker', ['rm', '-f', containerName], {
        cwd: root,
        stdio: 'ignore',
        env: options.env || process.env,
        windowsHide: true,
      })
    }
  }
}

function removeHostPath(target, options = {}) {
  const resolved = path.resolve(target)
  if (options.image && fs.existsSync(resolved)) {
    spawnSync('docker', [
      'run',
      '--rm',
      '--user',
      '0',
      '--entrypoint',
      'sh',
      '-v',
      `${path.dirname(resolved)}:/parent`,
      options.image,
      '-c',
      `rm -rf -- /parent/${path.basename(resolved)}`,
    ], {
      cwd: root,
      stdio: 'ignore',
      env: options.env || process.env,
      windowsHide: true,
    })
  }
  try {
    fs.rmSync(resolved, { recursive: true, force: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
}

function main() {
  const isolatedDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-artifact-data-'))
  const fixtureData = path.join(isolatedDataDirectory, fixtureDataName)
  const dockerOptions = {
    env: { ...process.env, LOCALMINIDRAMA_DATA_DIR: isolatedDataDirectory },
  }
  if (fs.existsSync(fixtureConfig) || fs.existsSync(fixtureData)) {
    fs.rmSync(isolatedDataDirectory, { recursive: true, force: true })
    throw new Error('refusing to overwrite an existing Docker artifact verification fixture')
  }
  fs.mkdirSync(path.dirname(fixtureConfig), { recursive: true })
  fs.mkdirSync(path.dirname(fixtureData), { recursive: true })
  let configCreated = false
  let dataCreated = false
  let image

  try {
    fs.writeFileSync(fixtureConfig, JSON.stringify({ api_key: marker }), { encoding: 'utf8', flag: 'wx' })
    configCreated = true
    fs.writeFileSync(fixtureData, marker, { encoding: 'utf8', flag: 'wx' })
    dataCreated = true
    run(['compose', 'build', 'backend'], dockerOptions)
    image = resolveComposeImage('backend', dockerOptions)

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
    process.stdout.write(run(['run', '--rm', '--entrypoint', 'node', image, '-e', inspection], dockerOptions) + '\n')
    verifyBackendRuntime(image, isolatedDataDirectory, dockerOptions)
    process.stdout.write('Docker 运行时安全边界验证通过。\n')
  } finally {
    if (configCreated) fs.rmSync(fixtureConfig, { force: true })
    removeHostPath(isolatedDataDirectory, { image, env: dockerOptions.env })
  }
}

module.exports = { main, resolveComposeImage, verifyBackendRuntime }

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
