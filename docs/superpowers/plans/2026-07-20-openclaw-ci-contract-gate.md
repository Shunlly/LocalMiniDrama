# OpenClaw CI Contract Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing seven-test OpenClaw compatibility suite a mandatory root source gate.

**Architecture:** Keep `scripts/openclaw-contract.test.cjs` as the single compatibility contract. Wire it into the root package scripts so all existing CI and release paths that call `npm run check` fail closed without adding another workflow job.

**Tech Stack:** Node.js 20 built-in test runner, npm scripts, existing root release contracts.

## Global Constraints

- Do not change OpenClaw skill artifacts or backend behavior.
- Do not add a network request, Provider dependency, or platform skip.
- `npm run test:openclaw-contract` must remain independently runnable.
- The root `check` script must syntax-check and execute the OpenClaw contract.

---

### Task 1: Wire The Existing Contract Into The Root Gate

**Files:**
- Modify: `scripts/release-contract.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/openclaw-contract.test.cjs` and the existing root `check` script.
- Produces: `test:openclaw-contract` and a mandatory invocation from `check`.

- [ ] **Step 1: Write the failing package-contract test**

Add this focused test to `scripts/release-contract.test.cjs`:

```js
test('root source gate syntax-checks and executes the OpenClaw contract', () => {
  assert.equal(
    rootPackage.scripts['test:openclaw-contract'],
    'node --test scripts/openclaw-contract.test.cjs'
  )
  const syntaxGate = rootPackage.scripts.check.indexOf(
    'node --check scripts/openclaw-contract.test.cjs'
  )
  const executionGate = rootPackage.scripts.check.indexOf('npm run test:openclaw-contract')
  assert.ok(syntaxGate >= 0, 'root check must syntax-check the OpenClaw contract')
  assert.ok(executionGate > syntaxGate, 'root check must execute it after syntax validation')
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
node --test --test-name-pattern="OpenClaw contract" scripts/release-contract.test.cjs
```

Expected: one failure because the root package has no `test:openclaw-contract` script.

- [ ] **Step 3: Add the minimal root scripts**

In `package.json`:

```json
"test:openclaw-contract": "node --test scripts/openclaw-contract.test.cjs"
```

Add both of these exact commands to `check` while preserving every existing command:

```text
node --check scripts/openclaw-contract.test.cjs
npm run test:openclaw-contract
```

- [ ] **Step 4: Verify GREEN and the complete root gate**

Run:

```powershell
node --test --test-name-pattern="OpenClaw contract" scripts/release-contract.test.cjs
npm run test:openclaw-contract
npm run check
```

Expected: the focused contract passes, OpenClaw reports 7 passed and 0 failed, and the complete root gate exits zero.

- [ ] **Step 5: Review and commit**

Review requirements: no behavior change, no duplicated workflow step, and no omission of an existing `check` command.

```powershell
git add -- package.json scripts/release-contract.test.cjs
git commit -m "test: gate OpenClaw compatibility in CI"
```
