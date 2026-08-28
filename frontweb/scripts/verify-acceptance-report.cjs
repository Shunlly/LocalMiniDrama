#!/usr/bin/env node

const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  formatFailures,
  verifyFinalEvidence,
  verifyTrackedReport,
} = require('./acceptance-report-contract.cjs')

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const equals = argument.match(/^--([a-z-]+)=(.*)$/)
    if (equals) {
      options[equals[1]] = equals[2]
      continue
    }
    const key = argument.match(/^--([a-z-]+)$/)?.[1]
    if (!key || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error('arguments must use --name=value or --name value')
    }
    options[key] = argv[index + 1]
    index += 1
  }
  return options
}

function resolveCommit(options, repoRoot) {
  if (options['expected-commit']?.trim()) return options['expected-commit'].trim()
  if (!options['repo-root']) {
    const configured = process.env.LOCALMINIDRAMA_BUILD_REVISION || process.env.GITHUB_SHA
    if (configured?.trim()) return configured.trim()
  }
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('unable to resolve expected commit from Git')
  return result.stdout.trim()
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const allowed = new Set(['mode', 'repo-root', 'evidence-root', 'expected-commit'])
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`unsupported option --${key}`)
  }

  const mode = options.mode
  const repoRoot = path.resolve(options['repo-root'] || path.resolve(__dirname, '..', '..'))
  if (mode === 'tracked') {
    const result = verifyTrackedReport({ repoRoot })
    process.stdout.write(`${JSON.stringify({ status: 'passed', mode, ...result })}\n`)
    return
  }
  if (mode === 'final') {
    const expectedCommit = resolveCommit(options, repoRoot)
    const evidenceRoot = path.resolve(options['evidence-root'] || path.join(repoRoot, 'artifacts', 'e2e-production'))
    const result = verifyFinalEvidence({ repoRoot, evidenceRoot, expectedCommit })
    process.stdout.write(`${JSON.stringify({ status: 'passed', mode, ...result })}\n`)
    return
  }
  throw new Error('mode must be tracked or final')
}

try {
  main()
} catch (error) {
  const failures = error instanceof AggregateError
    ? error.errors
    : [{ code: 'ARV_CLI', file: '<cli>', detail: error.message || 'verification failed' }]
  process.stderr.write(`${formatFailures(failures)}\n`)
  process.exitCode = 1
}
