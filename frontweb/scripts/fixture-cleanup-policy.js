import fs from 'node:fs'
import path from 'node:path'

import { parse } from 'acorn'

const SOURCE_ROOTS = Object.freeze(['scripts', 'test'])
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs'])

// These roots contain authored cleanup consumers. Browser profiles and app source
// are outside the policy; generated or vendored directories nested here are not.
const EXCLUDED_DIRECTORIES = new Set([
  '.cache',
  '.vite',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
])
const EXCLUDED_SOURCES = new Set(['scripts/fixture-cleanup.cjs'])
const FS_MODULES = new Map([
  ['fs', 'fs'],
  ['node:fs', 'fs'],
  ['fs/promises', 'fsPromises'],
  ['node:fs/promises', 'fsPromises'],
])
const REMOVE_METHODS = new Set(['rm', 'rmSync'])
const OPTION_ABSENT = Symbol('option-absent')
const STATIC_UNKNOWN = Symbol('static-unknown')

function compareText(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/')
}

function walkSourceDirectory(frontwebRoot, directory, files) {
  if (!fs.existsSync(directory)) return

  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        walkSourceDirectory(frontwebRoot, path.join(directory, entry.name), files)
      }
      continue
    }

    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
    const absolutePath = path.join(directory, entry.name)
    const relativePath = normalizePath(path.relative(frontwebRoot, absolutePath))
    if (!EXCLUDED_SOURCES.has(relativePath)) files.push(relativePath)
  }
}

export function discoverCleanupSources(frontwebRoot) {
  const files = []
  for (const sourceRoot of SOURCE_ROOTS) {
    walkSourceDirectory(frontwebRoot, path.join(frontwebRoot, sourceRoot), files)
  }
  return files.sort(compareText)
}

function childNodes(node) {
  const children = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') children.push(item)
      }
    } else if (value && typeof value.type === 'string') {
      children.push(value)
    }
  }
  return children
}

function walkAst(root, visitor) {
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()
    visitor(node)
    const children = childNodes(node)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index])
    }
  }
}

function moduleReference(node) {
  if (
    node?.type !== 'CallExpression'
    || node.callee.type !== 'Identifier'
    || node.callee.name !== 'require'
    || node.arguments.length !== 1
    || node.arguments[0].type !== 'Literal'
    || typeof node.arguments[0].value !== 'string'
  ) {
    return null
  }
  return FS_MODULES.get(node.arguments[0].value) || null
}

function addReference(bindings, name, references) {
  if (!name || references.size === 0) return false
  const current = bindings.get(name) || new Set()
  let changed = false
  for (const reference of references) {
    if (!current.has(reference)) {
      current.add(reference)
      changed = true
    }
  }
  if (changed) bindings.set(name, current)
  return changed
}

function literalValue(node, initializers, seen = new Set()) {
  if (!node) return undefined
  if (node.type === 'Literal') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  if (node.type === 'Identifier') {
    if (seen.has(node.name)) return undefined
    const candidates = initializers.get(node.name)
    if (!candidates || candidates.length !== 1) return undefined
    const nextSeen = new Set(seen)
    nextSeen.add(node.name)
    return literalValue(candidates[0], initializers, nextSeen)
  }
  if (node.type === 'UnaryExpression') {
    const argument = literalValue(node.argument, initializers, seen)
    if (node.operator === '!') return !argument
    if (node.operator === 'void') return undefined
  }
  return undefined
}

function propertyName(node, computed, initializers) {
  if (!computed && node.type === 'Identifier') return node.name
  const value = literalValue(node, initializers)
  return typeof value === 'string' ? value : null
}

function memberReferences(baseReferences, property) {
  const references = new Set()
  for (const baseReference of baseReferences) {
    if (baseReference === 'fs' && property === 'promises') references.add('fsPromises')
    if (baseReference === 'fs' && REMOVE_METHODS.has(property)) references.add(property)
    if (baseReference === 'fsPromises' && property === 'rm') references.add('rm')
  }
  return references
}

function resolveReferences(node, bindings, initializers) {
  if (!node) return new Set()
  if (node.type === 'ChainExpression') {
    return resolveReferences(node.expression, bindings, initializers)
  }
  if (node.type === 'Identifier') {
    return new Set(bindings.get(node.name) || [])
  }

  const requiredModule = moduleReference(node)
  if (requiredModule) return new Set([requiredModule])

  if (node.type === 'MemberExpression') {
    const property = propertyName(node.property, node.computed, initializers)
    if (!property) return new Set()
    return memberReferences(
      resolveReferences(node.object, bindings, initializers),
      property,
    )
  }

  if (
    node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && propertyName(node.callee.property, node.callee.computed, initializers) === 'bind'
  ) {
    return resolveReferences(node.callee.object, bindings, initializers)
  }

  return new Set()
}

function bindPattern(pattern, references, bindings, initializers) {
  if (!pattern || references.size === 0) return false
  if (pattern.type === 'Identifier') {
    return addReference(bindings, pattern.name, references)
  }
  if (pattern.type === 'AssignmentPattern') {
    return bindPattern(pattern.left, references, bindings, initializers)
  }
  if (pattern.type !== 'ObjectPattern') return false

  let changed = false
  for (const property of pattern.properties) {
    if (property.type !== 'Property') continue
    const key = propertyName(property.key, property.computed, initializers)
    if (!key) continue
    const propertyReferences = memberReferences(references, key)
    changed = bindPattern(
      property.value,
      propertyReferences,
      bindings,
      initializers,
    ) || changed
  }
  return changed
}

function collectBindings(ast) {
  const bindings = new Map()
  const initializers = new Map()
  const assignments = []

  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      const moduleKind = FS_MODULES.get(node.source.value)
      if (!moduleKind) return
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          const importedName = specifier.imported.name || specifier.imported.value
          const references = memberReferences(new Set([moduleKind]), importedName)
          addReference(bindings, specifier.local.name, references)
        } else {
          addReference(bindings, specifier.local.name, new Set([moduleKind]))
        }
      }
      return
    }

    if (node.type === 'VariableDeclarator' && node.init) {
      assignments.push({ pattern: node.id, value: node.init })
      if (node.id.type === 'Identifier') {
        const candidates = initializers.get(node.id.name) || []
        candidates.push(node.init)
        initializers.set(node.id.name, candidates)
      }
      return
    }

    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      assignments.push({ pattern: node.left, value: node.right })
    }
  })

  for (let pass = 0; pass <= assignments.length; pass += 1) {
    let changed = false
    for (const { pattern, value } of assignments) {
      const references = resolveReferences(value, bindings, initializers)
      changed = bindPattern(pattern, references, bindings, initializers) || changed
    }
    if (!changed) break
  }

  return { bindings, initializers }
}

function createOptionScope(parent, kind) {
  const scope = { parent, kind, bindings: new Map(), executionScope: null }
  scope.executionScope = kind === 'program' || kind === 'function'
    ? scope
    : parent.executionScope
  return scope
}

function getOrCreateOptionBinding(scope, name) {
  let binding = scope.bindings.get(name)
  if (!binding) {
    binding = { scope, writes: [] }
    scope.bindings.set(name, binding)
  }
  return binding
}

function findOptionBinding(scope, name) {
  for (let current = scope; current; current = current.parent) {
    const binding = current.bindings.get(name)
    if (binding) return binding
  }
  return null
}

function patternIdentifiers(pattern, identifiers = []) {
  if (!pattern) return identifiers
  if (pattern.type === 'Identifier') {
    identifiers.push(pattern.name)
  } else if (pattern.type === 'AssignmentPattern') {
    patternIdentifiers(pattern.left, identifiers)
  } else if (pattern.type === 'RestElement') {
    patternIdentifiers(pattern.argument, identifiers)
  } else if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      patternIdentifiers(
        property.type === 'RestElement' ? property.argument : property.value,
        identifiers,
      )
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) patternIdentifiers(element, identifiers)
  }
  return identifiers
}

function addOptionWrite(binding, value, scope, position, evaluationPosition) {
  binding.writes.push({ value, scope, position, evaluationPosition })
}

function declareUnknownOptionPattern(pattern, scope, position) {
  for (const name of patternIdentifiers(pattern)) {
    addOptionWrite(getOrCreateOptionBinding(scope, name), null, scope, position, position)
  }
}

function scopeIsAncestor(ancestor, scope) {
  for (let current = scope; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function buildOptionModel(ast) {
  const rootScope = createOptionScope(null, 'program')
  const scopeByNode = new WeakMap()
  const pendingAssignments = []

  function visitFunction(node, parentScope) {
    const functionScope = createOptionScope(parentScope, 'function')
    scopeByNode.set(node, functionScope)
    if (node.type === 'FunctionExpression' && node.id) {
      declareUnknownOptionPattern(node.id, functionScope, node.start)
    }
    for (const parameter of node.params) {
      declareUnknownOptionPattern(parameter, functionScope, node.start)
      if (parameter.type === 'AssignmentPattern') visit(parameter.right, functionScope)
    }
    visit(node.body, functionScope)
  }

  function visit(node, scope) {
    if (!node) return
    scopeByNode.set(node, scope)

    if (node.type === 'Program') {
      for (const statement of node.body) visit(statement, scope)
      return
    }

    if (node.type === 'BlockStatement') {
      const blockScope = createOptionScope(scope, 'block')
      scopeByNode.set(node, blockScope)
      for (const statement of node.body) visit(statement, blockScope)
      return
    }

    if (node.type === 'FunctionDeclaration') {
      if (node.id) declareUnknownOptionPattern(node.id, scope, node.start)
      visitFunction(node, scope)
      return
    }
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      visitFunction(node, scope)
      return
    }

    if (node.type === 'CatchClause') {
      const catchScope = createOptionScope(scope, 'block')
      scopeByNode.set(node, catchScope)
      declareUnknownOptionPattern(node.param, catchScope, node.start)
      visit(node.body, catchScope)
      return
    }

    if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const loopScope = createOptionScope(scope, 'block')
      scopeByNode.set(node, loopScope)
      for (const child of childNodes(node)) visit(child, loopScope)
      return
    }

    if (node.type === 'SwitchStatement') {
      const switchScope = createOptionScope(scope, 'block')
      scopeByNode.set(node, switchScope)
      for (const child of childNodes(node)) visit(child, switchScope)
      return
    }

    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        declareUnknownOptionPattern(specifier.local, scope, node.end)
      }
      return
    }

    if (node.type === 'VariableDeclaration') {
      const declarationScope = node.kind === 'var' ? scope.executionScope : scope
      for (const declaration of node.declarations) {
        scopeByNode.set(declaration, scope)
        if (declaration.id.type === 'Identifier') {
          addOptionWrite(
            getOrCreateOptionBinding(declarationScope, declaration.id.name),
            declaration.init,
            scope,
            declaration.end,
            declaration.start,
          )
        } else {
          declareUnknownOptionPattern(declaration.id, declarationScope, declaration.end)
        }
        visit(declaration.init, scope)
      }
      return
    }

    if (node.type === 'AssignmentExpression') {
      pendingAssignments.push({ node, scope })
      for (const child of childNodes(node)) visit(child, scope)
      return
    }

    if (node.type === 'ClassDeclaration' && node.id) {
      declareUnknownOptionPattern(node.id, scope, node.start)
    }
    for (const child of childNodes(node)) visit(child, scope)
  }

  visit(ast, rootScope)

  for (const { node, scope } of pendingAssignments) {
    if (node.left.type === 'Identifier') {
      const binding = findOptionBinding(scope, node.left.name)
      if (binding) {
        addOptionWrite(
          binding,
          node.operator === '=' ? node.right : null,
          scope,
          node.end,
          node.start,
        )
      }
      continue
    }

    if (node.left.type === 'ObjectPattern' || node.left.type === 'ArrayPattern') {
      for (const name of patternIdentifiers(node.left)) {
        const binding = findOptionBinding(scope, name)
        if (binding) addOptionWrite(binding, null, scope, node.end, node.start)
      }
      continue
    }

    if (node.left.type === 'MemberExpression' && node.left.object.type === 'Identifier') {
      const binding = findOptionBinding(scope, node.left.object.name)
      if (binding) addOptionWrite(binding, null, scope, node.end, node.start)
    }
  }

  return { scopeByNode }
}

function latestVisibleOptionWrite(binding, scope, position) {
  let latest = null
  for (const write of binding.writes) {
    if (write.position > position || !scopeIsAncestor(write.scope, scope)) continue
    if (!latest || write.position > latest.position) latest = write
  }
  return latest
}

function resolveOptionBinding(name, scope, position, model, seen, resolver) {
  const binding = findOptionBinding(scope, name)
  if (!binding) return STATIC_UNKNOWN
  const write = latestVisibleOptionWrite(binding, scope, position)
  if (!write?.value || seen.has(write)) return STATIC_UNKNOWN

  const nextSeen = new Set(seen)
  nextSeen.add(write)
  return resolver(
    write.value,
    write.scope,
    write.evaluationPosition,
    model,
    nextSeen,
  )
}

function resolveStaticValue(node, scope, position, model, seen = new Set()) {
  if (!node) return STATIC_UNKNOWN
  if (node.type === 'Literal') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  if (node.type === 'Identifier') {
    return resolveOptionBinding(node.name, scope, position, model, seen, resolveStaticValue)
  }
  if (node.type === 'ChainExpression') {
    return resolveStaticValue(node.expression, scope, position, model, seen)
  }
  if (node.type === 'AssignmentExpression' && node.operator === '=') {
    return resolveStaticValue(node.right, scope, position, model, seen)
  }
  if (node.type === 'SequenceExpression') {
    return resolveStaticValue(node.expressions.at(-1), scope, position, model, seen)
  }
  if (node.type === 'UnaryExpression') {
    const value = resolveStaticValue(node.argument, scope, position, model, seen)
    if (value === STATIC_UNKNOWN) return STATIC_UNKNOWN
    if (node.operator === '!') return !value
    if (node.operator === 'void') return undefined
  }
  if (node.type === 'ConditionalExpression') {
    const testValue = resolveStaticValue(node.test, scope, position, model, seen)
    if (testValue !== STATIC_UNKNOWN) {
      return resolveStaticValue(
        testValue ? node.consequent : node.alternate,
        scope,
        position,
        model,
        seen,
      )
    }
    const consequent = resolveStaticValue(node.consequent, scope, position, model, seen)
    const alternate = resolveStaticValue(node.alternate, scope, position, model, seen)
    return consequent === alternate ? consequent : STATIC_UNKNOWN
  }
  return STATIC_UNKNOWN
}

function optionPropertyName(node, computed, scope, position, model, seen) {
  if (!computed && node.type === 'Identifier') return node.name
  const value = resolveStaticValue(node, scope, position, model, seen)
  return typeof value === 'string' ? value : null
}

function resolveRecursiveOption(node, scope, position, model, seen = new Set()) {
  if (!node) return STATIC_UNKNOWN
  if (node.type === 'Identifier') {
    return resolveOptionBinding(node.name, scope, position, model, seen, resolveRecursiveOption)
  }
  if (node.type === 'ChainExpression') {
    return resolveRecursiveOption(node.expression, scope, position, model, seen)
  }
  if (node.type === 'AssignmentExpression' && node.operator === '=') {
    return resolveRecursiveOption(node.right, scope, position, model, seen)
  }
  if (node.type === 'SequenceExpression') {
    return resolveRecursiveOption(node.expressions.at(-1), scope, position, model, seen)
  }
  if (node.type === 'ObjectExpression') {
    let state = OPTION_ABSENT
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        const spreadState = resolveRecursiveOption(property.argument, scope, position, model, seen)
        if (spreadState !== OPTION_ABSENT) state = spreadState
        continue
      }
      const key = optionPropertyName(
        property.key,
        property.computed,
        scope,
        position,
        model,
        seen,
      )
      if (key !== 'recursive') continue
      const value = resolveStaticValue(property.value, scope, position, model, seen)
      state = typeof value === 'boolean' ? value : STATIC_UNKNOWN
    }
    return state
  }
  if (
    node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && node.callee.object.type === 'Identifier'
    && node.callee.object.name === 'Object'
  ) {
    const method = optionPropertyName(
      node.callee.property,
      node.callee.computed,
      scope,
      position,
      model,
      seen,
    )
    if (method === 'freeze') {
      return resolveRecursiveOption(node.arguments[0], scope, position, model, seen)
    }
    if (method === 'assign') {
      let state = OPTION_ABSENT
      for (const argument of node.arguments) {
        const argumentState = resolveRecursiveOption(argument, scope, position, model, seen)
        if (argumentState !== OPTION_ABSENT) state = argumentState
      }
      return state
    }
  }
  if (node.type === 'ConditionalExpression') {
    const testValue = resolveStaticValue(node.test, scope, position, model, seen)
    if (testValue !== STATIC_UNKNOWN) {
      return resolveRecursiveOption(
        testValue ? node.consequent : node.alternate,
        scope,
        position,
        model,
        seen,
      )
    }
    const consequent = resolveRecursiveOption(node.consequent, scope, position, model, seen)
    const alternate = resolveRecursiveOption(node.alternate, scope, position, model, seen)
    return consequent === alternate ? consequent : STATIC_UNKNOWN
  }
  if (node.type === 'Literal' || node.type === 'ArrayExpression') return OPTION_ABSENT
  return STATIC_UNKNOWN
}

function parseSource(source, relativePath) {
  const extension = path.extname(relativePath)
  return parse(source, {
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    allowReturnOutsideFunction: extension === '.cjs',
    ecmaVersion: 'latest',
    locations: true,
    sourceType: extension === '.cjs' ? 'script' : 'module',
  })
}

function findDirectRecursiveRemovals(source, relativePath) {
  const ast = parseSource(source, relativePath)
  const { bindings, initializers } = collectBindings(ast)
  const optionModel = buildOptionModel(ast)
  const violations = []

  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression' || node.arguments.length < 2) return
    const methods = resolveReferences(node.callee, bindings, initializers)
    const method = [...methods].find((reference) => REMOVE_METHODS.has(reference))
    if (!method) return
    const optionScope = optionModel.scopeByNode.get(node)
    const recursiveState = resolveRecursiveOption(
      node.arguments[1],
      optionScope,
      node.start,
      optionModel,
    )
    if (recursiveState === false || recursiveState === OPTION_ABSENT) return
    // Direct removal with dynamic options cannot prove that recursive deletion
    // is disabled, so the authored-source policy fails closed.
    violations.push({
      file: relativePath,
      line: node.loc.start.line,
      column: node.loc.start.column + 1,
      method,
    })
  })

  return violations
}

export function auditCleanupSources(frontwebRoot) {
  const files = discoverCleanupSources(frontwebRoot)
  const violations = files.flatMap((relativePath) => {
    const absolutePath = path.join(frontwebRoot, ...relativePath.split('/'))
    return findDirectRecursiveRemovals(
      fs.readFileSync(absolutePath, 'utf8'),
      relativePath,
    )
  })
  violations.sort((left, right) => (
    compareText(left.file, right.file)
    || left.line - right.line
    || left.column - right.column
    || compareText(left.method, right.method)
  ))
  return { files, violations }
}
