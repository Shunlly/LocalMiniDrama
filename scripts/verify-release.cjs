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
const directDependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
const cycloneDx14ComponentTypes = [
  'application',
  'container',
  'device',
  'file',
  'firmware',
  'framework',
  'library',
  'operating-system',
]
const supportedCycloneDxComponentTypes = new Map([
  ['1.4', new Set(cycloneDx14ComponentTypes)],
  ['1.5', new Set([
    ...cycloneDx14ComponentTypes,
    'platform',
    'device-driver',
    'machine-learning-model',
    'data',
  ])],
  ['1.6', new Set([
    ...cycloneDx14ComponentTypes,
    'platform',
    'device-driver',
    'machine-learning-model',
    'data',
    'cryptographic-asset',
  ])],
])
const supportedCycloneDxSpecVersions = new Set(supportedCycloneDxComponentTypes.keys())

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
    runNpm(['run', 'verify:docker:artifact'])
    composeAttempted = true
    runNpm(['run', 'docker:e2e:up'])
    runNpm(['run', 'verify:docker:containers'])
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

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function dependencyRecord(value, label) {
  if (value === undefined) return {}
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value
}

function mergeUniqueJsonValues(left = [], right = []) {
  const merged = new Map()
  for (const value of [...left, ...right]) merged.set(JSON.stringify(value), value)
  return [...merged.values()]
}

function strictestComponentScope(left, right, packageDirectory, componentRef) {
  const rank = new Map([['excluded', 0], ['optional', 1], ['required', 2]])
  for (const scope of [left, right]) {
    if (scope !== undefined) {
      assert.ok(rank.has(scope), `${packageDirectory} SBOM component ${componentRef} has invalid scope ${scope}`)
    }
  }
  if (left === undefined) return right
  if (right === undefined) return left
  return rank.get(left) >= rank.get(right) ? left : right
}

function canonicalizeSbomDocument(packageDirectory, sbom) {
  if (Array.isArray(sbom?.components)) {
    const components = []
    const componentsByRef = new Map()
    for (const component of sbom.components) {
      const componentRef = String(component?.['bom-ref'] || '')
      const existing = componentRef ? componentsByRef.get(componentRef) : null
      if (!existing) {
        components.push(component)
        if (componentRef) componentsByRef.set(componentRef, component)
        continue
      }

      const existingIdentity = { ...existing }
      const duplicateIdentity = { ...component }
      delete existingIdentity.properties
      delete duplicateIdentity.properties
      delete existingIdentity.externalReferences
      delete duplicateIdentity.externalReferences
      delete existingIdentity.scope
      delete duplicateIdentity.scope
      assert.deepEqual(duplicateIdentity, existingIdentity,
        `${packageDirectory} SBOM duplicate component ref ${componentRef} has conflicting identity`)
      const existingProperties = existing.properties === undefined ? [] : existing.properties
      const duplicateProperties = component.properties === undefined ? [] : component.properties
      const existingReferences = existing.externalReferences === undefined ? [] : existing.externalReferences
      const duplicateReferences = component.externalReferences === undefined ? [] : component.externalReferences
      assert.ok(Array.isArray(existingProperties) && Array.isArray(duplicateProperties),
        `${packageDirectory} SBOM component ${componentRef} properties must be arrays`)
      assert.ok(Array.isArray(existingReferences) && Array.isArray(duplicateReferences),
        `${packageDirectory} SBOM component ${componentRef} externalReferences must be arrays`)
      const properties = mergeUniqueJsonValues(existingProperties, duplicateProperties)
      const externalReferences = mergeUniqueJsonValues(existingReferences, duplicateReferences)
      if (properties.length) existing.properties = properties
      if (externalReferences.length) existing.externalReferences = externalReferences
      const scope = strictestComponentScope(existing.scope, component.scope, packageDirectory, componentRef)
      if (scope !== undefined) existing.scope = scope
    }
    sbom.components = components
  }

  if (Array.isArray(sbom?.dependencies)) {
    const dependencies = []
    const dependenciesByRef = new Map()
    for (const dependency of sbom.dependencies) {
      const dependencyRef = String(dependency?.ref || '')
      const existing = dependencyRef ? dependenciesByRef.get(dependencyRef) : null
      if (!existing) {
        dependencies.push(dependency)
        if (dependencyRef) dependenciesByRef.set(dependencyRef, dependency)
        continue
      }

      const existingIdentity = { ...existing }
      const duplicateIdentity = { ...dependency }
      delete existingIdentity.dependsOn
      delete duplicateIdentity.dependsOn
      assert.deepEqual(duplicateIdentity, existingIdentity,
        `${packageDirectory} SBOM duplicate dependency ref ${dependencyRef} has conflicting identity`)
      assert.ok(Array.isArray(existing.dependsOn) && Array.isArray(dependency.dependsOn),
        `${packageDirectory} SBOM dependency ${dependencyRef} has no dependsOn array`)
      existing.dependsOn = [...new Set([...existing.dependsOn, ...dependency.dependsOn])]
    }
    sbom.dependencies = dependencies
  }
  return sbom
}

function normalizeGeneratedSbomRoot(packageDirectory, sbom) {
  const packageRoot = path.resolve(root, packageDirectory)
  const packageJson = readJson(path.join(packageRoot, 'package.json'), `${packageDirectory}/package.json`)
  const rootComponent = sbom?.metadata?.component
  assert.ok(rootComponent && typeof rootComponent === 'object' && !Array.isArray(rootComponent),
    `${packageDirectory} generated SBOM has no metadata root component`)
  assert.ok(
    rootComponent.name === packageJson.name || rootComponent.name === path.basename(packageRoot),
    `${packageDirectory} generated SBOM root name is not the package name or package directory`,
  )
  assert.ok(rootComponent.type === 'library' || rootComponent.type === 'application',
    `${packageDirectory} generated SBOM root type is not library or application`)
  assert.equal(String(rootComponent.version || ''), String(packageJson.version || ''),
    `${packageDirectory} generated SBOM root version does not match package.json`)
  assert.equal(
    String(rootComponent['bom-ref'] || ''),
    `${packageJson.name}@${packageJson.version}`,
    `${packageDirectory} generated SBOM root bom-ref does not match package.json`,
  )
  rootComponent.name = packageJson.name
  rootComponent.type = 'application'
  return sbom
}

function validateSbomDocument(packageDirectory, sbom) {
  const packageRoot = path.resolve(root, packageDirectory)
  const packageJson = readJson(path.join(packageRoot, 'package.json'), `${packageDirectory}/package.json`)
  const packageLock = readJson(path.join(packageRoot, 'package-lock.json'), `${packageDirectory}/package-lock.json`)
  const lockRoot = packageLock.packages?.['']
  assert.ok(lockRoot && typeof lockRoot === 'object' && !Array.isArray(lockRoot),
    `${packageDirectory}/package-lock.json has no root package record`)
  assert.equal(String(lockRoot.name || ''), String(packageJson.name || ''),
    'package-lock root name does not match package.json')
  assert.equal(String(lockRoot.version || ''), String(packageJson.version || ''),
    'package-lock root version does not match package.json')

  const expectedDirectDependencies = {}
  for (const section of directDependencySections) {
    const declared = dependencyRecord(packageJson[section], `package.json ${section}`)
    const locked = dependencyRecord(lockRoot[section], `package-lock root ${section}`)
    assert.deepEqual(locked, declared, `package-lock root ${section} do not match package.json`)
    Object.assign(expectedDirectDependencies, declared)
  }

  assert.equal(sbom?.bomFormat, 'CycloneDX', `${packageDirectory} SBOM is not a CycloneDX document`)
  const rawSpecVersion = sbom?.specVersion
  if (rawSpecVersion === undefined || rawSpecVersion === '') {
    assert.fail(`${packageDirectory} SBOM has unsupported CycloneDX specVersion: <missing>`)
  }
  assert.equal(typeof rawSpecVersion, 'string',
    `${packageDirectory} SBOM CycloneDX specVersion must be a JSON string`)
  const specVersion = rawSpecVersion
  assert.ok(supportedCycloneDxSpecVersions.has(specVersion),
    `${packageDirectory} SBOM has unsupported CycloneDX specVersion: ${specVersion}`)
  const supportedComponentTypes = supportedCycloneDxComponentTypes.get(specVersion)
  const rootComponent = sbom?.metadata?.component
  assert.ok(rootComponent && typeof rootComponent === 'object' && !Array.isArray(rootComponent),
    `${packageDirectory} SBOM has no metadata root component`)
  const rootRef = String(rootComponent['bom-ref'] || '')
  assert.ok(rootRef, `${packageDirectory} SBOM metadata root component has no bom-ref`)
  assert.equal(String(rootComponent.name || ''), String(packageJson.name || ''),
    `${packageDirectory} SBOM root component name does not match package.json`)
  assert.equal(rootComponent.type, 'application',
    `${packageDirectory} SBOM root component type must be application`)
  assert.equal(String(rootComponent.version || ''), String(packageJson.version || ''),
    `${packageDirectory} SBOM root component version does not match package.json`)
  assert.ok(Array.isArray(sbom.components) && sbom.components.length > 0,
    `${packageDirectory} SBOM component inventory is empty`)
  assert.ok(Array.isArray(sbom.dependencies) && sbom.dependencies.length > 0,
    `${packageDirectory} SBOM dependency graph is empty`)

  const componentsByRef = new Map()
  for (const component of sbom.components) {
    assert.ok(component && typeof component === 'object' && !Array.isArray(component),
      `${packageDirectory} SBOM contains an invalid component`)
    const componentRef = String(component['bom-ref'] || '')
    assert.ok(componentRef, `${packageDirectory} SBOM component has no bom-ref`)
    assert.equal(componentsByRef.has(componentRef), false,
      `${packageDirectory} SBOM contains duplicate component ref ${componentRef}`)
    assert.ok(String(component.name || ''), `${packageDirectory} SBOM component ${componentRef} has no name`)
    assert.ok(String(component.version || ''), `${packageDirectory} SBOM component ${componentRef} has no version`)
    const componentType = String(component.type || '')
    assert.ok(componentType, `${packageDirectory} SBOM component ${componentRef} has no supported type`)
    assert.ok(supportedComponentTypes.has(componentType),
      `${packageDirectory} SBOM component ${componentRef} type ${componentType} is not supported by CycloneDX ${specVersion}`)
    componentsByRef.set(componentRef, component)
  }

  const knownRefs = new Set([rootRef, ...componentsByRef.keys()])
  const dependenciesByRef = new Map()
  for (const dependency of sbom.dependencies) {
    assert.ok(dependency && typeof dependency === 'object' && !Array.isArray(dependency),
      `${packageDirectory} SBOM contains an invalid dependency node`)
    const dependencyRef = String(dependency.ref || '')
    assert.ok(dependencyRef, `${packageDirectory} SBOM dependency node has no ref`)
    assert.ok(knownRefs.has(dependencyRef),
      `${packageDirectory} SBOM dependency node references unknown component ${dependencyRef}`)
    assert.equal(dependenciesByRef.has(dependencyRef), false,
      `${packageDirectory} SBOM contains duplicate dependency ref ${dependencyRef}`)
    assert.ok(Array.isArray(dependency.dependsOn),
      `${packageDirectory} SBOM dependency ${dependencyRef} has no dependsOn array`)
    for (const targetRef of dependency.dependsOn) {
      assert.ok(knownRefs.has(targetRef),
        `${packageDirectory} SBOM dependency ${dependencyRef} references unknown component ${targetRef}`)
    }
    dependenciesByRef.set(dependencyRef, dependency)
  }

  const rootDependency = dependenciesByRef.get(rootRef)
  assert.ok(rootDependency, `${packageDirectory} SBOM dependency graph has no root component`)
  const directComponentsByName = new Map()
  for (const dependencyRef of rootDependency.dependsOn) {
    const component = componentsByRef.get(dependencyRef)
    assert.ok(component, `${packageDirectory} SBOM root dependency ${dependencyRef} has no component`)
    assert.equal(directComponentsByName.has(component.name), false,
      `${packageDirectory} SBOM root dependency graph contains duplicate package ${component.name}`)
    assert.ok(dependenciesByRef.has(dependencyRef),
      `${packageDirectory} SBOM root dependency ${component.name} has no dependency node`)
    directComponentsByName.set(component.name, component)
  }

  const expectedNames = Object.keys(expectedDirectDependencies).sort((a, b) => a.localeCompare(b, 'en'))
  for (const dependencyName of expectedNames) {
    const component = directComponentsByName.get(dependencyName)
    assert.ok(component, `SBOM root dependency graph is missing direct dependency ${dependencyName}`)
    const lockPackage = packageLock.packages?.[`node_modules/${dependencyName}`]
    assert.ok(lockPackage && typeof lockPackage === 'object',
      `package-lock has no installed record for direct dependency ${dependencyName}`)
    assert.equal(String(component.version), String(lockPackage.version || ''),
      `SBOM direct dependency ${dependencyName} version does not match package-lock`)
  }
  assert.deepEqual(
    [...directComponentsByName.keys()].sort((a, b) => a.localeCompare(b, 'en')),
    expectedNames,
    'SBOM root dependency graph contains unexpected direct dependencies',
  )
  return sbom
}

function prepareSbomOutput(packageDirectory, outputNames, rawOutput, options = {}) {
  const raw = String(rawOutput || '')
  assert.ok(raw.trim(), `SBOM generation returned empty output for ${packageDirectory}`)
  let sbom
  try {
    sbom = JSON.parse(raw)
  } catch (error) {
    throw new Error(`SBOM generation returned invalid JSON for ${packageDirectory}: ${error.message}`)
  }
  if (options.normalizeGeneratedRoot) normalizeGeneratedSbomRoot(packageDirectory, sbom)
  canonicalizeSbomDocument(packageDirectory, sbom)
  validateSbomDocument(packageDirectory, sbom)

  const names = Array.isArray(outputNames) ? [...outputNames] : [outputNames]
  assert.ok(names.length > 0, 'SBOM output name is required')
  assert.equal(new Set(names).size, names.length, 'SBOM output names must be unique')
  for (const outputName of names) {
    assert.equal(typeof outputName, 'string', 'SBOM output name must be a string')
    assert.equal(path.basename(outputName), outputName, `unsafe SBOM output name: ${outputName}`)
  }
  return { names, packageDirectory, sbom }
}

function publishSbomOutputs(preparedOutputs, outputDirectory) {
  const allNames = preparedOutputs.flatMap(({ names }) => names)
  assert.equal(new Set(allNames).size, allNames.length, 'SBOM output names must be unique across packages')
  fs.mkdirSync(outputDirectory, { recursive: true })
  for (const { names, sbom } of preparedOutputs) {
    const serialized = `${JSON.stringify(sbom, null, 2)}\n`
    for (const outputName of names) {
      fs.writeFileSync(path.join(outputDirectory, outputName), serialized, 'utf8')
    }
  }
}

function writeSbomOutput(packageDirectory, outputNames, rawOutput, options = {}) {
  const prepared = prepareSbomOutput(packageDirectory, outputNames, rawOutput, options)
  const outputDirectory = path.resolve(options.outputDirectory || path.join(root, 'desktop', 'release'))
  publishSbomOutputs([prepared], outputDirectory)
  return { outputDirectory, outputNames: prepared.names }
}

function generateSbom(packageDirectory, runtime = {}) {
  const invocation = npmInvocation([
    '--prefix', packageDirectory,
    'sbom',
    '--package-lock-only',
    '--sbom-format', 'cyclonedx',
  ])
  const spawn = runtime.spawnSync || spawnSync
  const result = spawn(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`SBOM generation failed for ${packageDirectory}: ${String(result.stderr || '').trim()}`)
  }
  return String(result.stdout || '')
}

function writeSbom(packageDirectory, outputNames, runtime = {}) {
  return writeSbomOutput(packageDirectory, outputNames, generateSbom(packageDirectory, runtime), {
    ...runtime,
    normalizeGeneratedRoot: true,
  })
}

function writeReleaseSboms(runtime = {}) {
  const desktopVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8')
  ).version
  const specifications = [
    { packageDirectory: 'backend-node', outputNames: ['sbom-backend.cdx.json'] },
    { packageDirectory: 'frontweb', outputNames: ['sbom-frontend.cdx.json'] },
    {
      packageDirectory: 'desktop',
      outputNames: [`LocalMiniDrama-${desktopVersion}.cdx.json`, 'sbom-desktop.cdx.json'],
    },
  ]
  const preparedOutputs = specifications.map(({ packageDirectory, outputNames }) => prepareSbomOutput(
    packageDirectory,
    outputNames,
    generateSbom(packageDirectory, runtime),
    { normalizeGeneratedRoot: true },
  ))
  const outputDirectory = path.resolve(runtime.outputDirectory || path.join(root, 'desktop', 'release'))
  publishSbomOutputs(preparedOutputs, outputDirectory)
  return { outputDirectory, outputNames: preparedOutputs.flatMap(({ names }) => names) }
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

function verifyRemoteReleaseTag(environment = process.env, runtime = {}) {
  const refType = String(environment.GITHUB_REF_TYPE || '').trim()
  const tag = String(environment.GITHUB_REF_NAME || '').trim()
  const fullRef = String(environment.GITHUB_REF || '').trim()
  const expectedCommit = String(environment.GITHUB_SHA || '').trim().toLowerCase()
  assert.equal(refType, 'tag', 'remote release tag verification requires a tag event')
  assert.match(tag, /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'remote release tag name is invalid')
  const tagRef = `refs/tags/${tag}`
  assert.equal(fullRef, tagRef, 'GITHUB_REF does not match GITHUB_REF_NAME')
  assert.match(expectedCommit, /^[a-f0-9]{40,64}$/, 'GITHUB_SHA is not a full commit digest')

  const spawn = runtime.spawnSync || spawnSync
  const result = spawn('git', [
    'ls-remote',
    '--exit-code',
    'origin',
    tagRef,
    `${tagRef}^{}`,
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status === 2 || (result.status === 0 && !String(result.stdout || '').trim())) {
    assert.fail(`remote release tag is missing: ${tagRef}`)
  }
  assert.equal(result.status, 0, `unable to resolve remote release tag ${tagRef}`)

  const records = new Map()
  for (const line of String(result.stdout || '').split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{40,64})\t(.+)$/i)
    assert.ok(match, `remote release tag returned an invalid ref record: ${line}`)
    const commit = match[1].toLowerCase()
    const ref = match[2]
    assert.ok(ref === tagRef || ref === `${tagRef}^{}`, `remote release tag returned an unexpected ref: ${ref}`)
    assert.equal(records.has(ref), false, `remote release tag returned duplicate ref: ${ref}`)
    records.set(ref, commit)
  }
  assert.ok(records.has(tagRef), `remote release tag is missing: ${tagRef}`)
  const peeledRef = `${tagRef}^{}`
  const commit = records.get(peeledRef) || records.get(tagRef)
  assert.equal(commit, expectedCommit, `remote release tag ${tagRef} does not match GITHUB_SHA`)
  return { annotated: records.has(peeledRef), commit, tag }
}

function main(args = process.argv.slice(2)) {
  if (args.includes('--verify-remote-tag')) {
    assert.deepEqual(args, ['--verify-remote-tag'], '--verify-remote-tag cannot be combined with other options')
    verifyRemoteReleaseTag()
    console.log('Remote release tag still resolves to the release commit.')
    return
  }
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
  validateSbomDocument,
  verifyRemoteReleaseTag,
  verifySourceAndContainers,
  verifyWindowsArtifacts,
  writeMediaToolMetadata,
  writeReleaseSboms,
  writeSbom,
  writeSbomOutput,
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = error.exitCode || 1
  }
}
