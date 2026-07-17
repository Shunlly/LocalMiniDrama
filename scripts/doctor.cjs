const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const checks = []

function add(name, ok, detail) {
  checks.push({ name, ok, detail })
}

function hasPath(rel) {
  return fs.existsSync(path.join(repoRoot, rel))
}

function commandOk(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' })
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0])
add('Node.js major', nodeMajor === 20, `current=${process.versions.node}; recommended=20.x for better-sqlite3 native modules`)

for (const rel of [
  'backend-node/node_modules/better-sqlite3',
  'backend-node/node_modules/uuid',
  'backend-node/node_modules/@volcengine/openapi',
  'frontweb/node_modules/vite',
]) {
  add(`dependency ${rel}`, hasPath(rel), hasPath(rel) ? 'installed' : 'missing; run npm install in the matching package or use Docker verification')
}

const docker = commandOk('docker', ['--version'])
add('Docker CLI', docker.ok, docker.output || 'docker command failed')

const compose = commandOk('docker', ['compose', 'version'])
add('Docker Compose', compose.ok, compose.output || 'docker compose command failed')

for (const check of checks) {
  const mark = check.ok ? 'OK' : 'WARN'
  console.log(`[${mark}] ${check.name}: ${check.detail}`)
}

console.log('')
console.log('Recommended verification path:')
console.log('- Docker: npm run docker:up && npm run verify:docker')
console.log('- Host: use Node 20.x, then npm --prefix backend-node install && npm --prefix frontweb install')

process.exit(0)
