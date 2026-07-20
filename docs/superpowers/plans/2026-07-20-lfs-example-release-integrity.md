# Git LFS Example Release Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the authoritative Git LFS example is present, unchanged, packaged in all three Windows applications, scanned, and functionally importable.

**Architecture:** A shared source contract owns the exact path, byte count, and SHA-256. Windows source jobs verify it immediately after LFS checkout, artifact extraction records and recomputes it for Setup/Portable/Unpacked, and the Unpacked smoke imports it through the embedded backend.

**Tech Stack:** Node.js 20, Git LFS, GitHub Actions, Electron Builder, Windows PowerShell, Node built-in tests.

## Global Constraints

- The authoritative path is `example_drama/衣服设计天才302.zip`.
- The authoritative byte count is `82156132`.
- The authoritative SHA-256 is `f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9`.
- CI `desktop` and release `build-windows` checkouts must set `lfs: true`.
- Setup, Portable, and Unpacked must each contain independently verified identical bytes.
- The Unpacked smoke must perform a real import without a Provider call.
- Artifact Gitleaks must use `--max-archive-depth 1 --max-target-megabytes 256`.
- The general root `check` gate runs verifier fixture tests but must not require the production LFS object.

---

### Task 1: Source Integrity And LFS Checkout Gate

**Files:**
- Create: `scripts/example-drama-contract.cjs`
- Create: `scripts/example-drama-contract.test.cjs`
- Modify: `scripts/release-contract.test.cjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Produces: `EXPECTED_EXAMPLE_DRAMA`, `sha256File(filePath)`, and `verifyExampleDrama(root, expected = EXPECTED_EXAMPLE_DRAMA)`.
- Produces: root scripts `test:example-drama-contract` and `verify:example-drama`.

- [ ] **Step 1: Write failing verifier tests**

Create `scripts/example-drama-contract.test.cjs` with fixture tests that require:

```js
const expected = {
  relativePath: 'example_drama/fixture.zip',
  fileName: 'fixture.zip',
  bytes: Buffer.byteLength('fixture bytes'),
  sha256: crypto.createHash('sha256').update('fixture bytes').digest('hex'),
}

assert.deepEqual(
  verifyExampleDrama(root, expected),
  { ...expected, absolutePath: path.join(root, 'example_drama', 'fixture.zip') }
)
```

Also require missing files, a Git LFS pointer, changed bytes, wrong size, a final symbolic link, and a symbolic-link parent to throw. Skip only symbolic-link creation when Windows denies that privilege.

- [ ] **Step 2: Write failing workflow and package contracts**

Add release-contract assertions for:

```js
assert.equal(rootPackage.scripts['test:example-drama-contract'], 'node --test scripts/example-drama-contract.test.cjs')
assert.equal(rootPackage.scripts['verify:example-drama'], 'node scripts/example-drama-contract.cjs')
assert.match(rootPackage.scripts.check, /npm run test:example-drama-contract/)
assert.doesNotMatch(rootPackage.scripts.check, /npm run verify:example-drama/)
```

For the `desktop` CI job and `build-windows` release job, require the checkout block to contain `lfs: true`. After each job's pinned Node.js 20 setup and before dependency installation or packaging, require both `git lfs fsck` and `npm run verify:example-drama`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
node --test scripts/example-drama-contract.test.cjs
node --test --test-name-pattern="LFS|example drama" scripts/release-contract.test.cjs
```

Expected: the module is missing and workflow/package assertions fail.

- [ ] **Step 4: Implement the shared verifier**

`verifyExampleDrama` must resolve the descriptor path below `root`, require `lstat().isFile()` and not `isSymbolicLink()`, require `realpath` to equal the resolved path using case-insensitive comparison only on Windows, compare exact bytes and SHA-256, and return the descriptor plus `absolutePath`. The CLI verifies the repository root and prints only the path, byte count, and digest.

The production descriptor must be exactly:

```js
const EXPECTED_EXAMPLE_DRAMA = Object.freeze({
  relativePath: 'example_drama/衣服设计天才302.zip',
  fileName: '衣服设计天才302.zip',
  bytes: 82156132,
  sha256: 'f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9',
})
```

- [ ] **Step 5: Wire package and workflow gates**

Add syntax checking and `test:example-drama-contract` to root `check`. Expose `verify:example-drama` as an independent script, but do not invoke it from root `check`. Add this checkout input to the two Windows build jobs:

```yaml
with:
  lfs: true
```

Immediately after each job's `actions/setup-node` step add:

```yaml
- name: Verify Git LFS example source
  run: |
    git lfs fsck
    npm run verify:example-drama
```

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
node --test scripts/example-drama-contract.test.cjs
node --test --test-name-pattern="LFS|example drama" scripts/release-contract.test.cjs
npm run verify:example-drama
git lfs fsck
```

Expected: all focused tests and both source integrity commands pass.

```powershell
git add -- scripts/example-drama-contract.cjs scripts/example-drama-contract.test.cjs scripts/release-contract.test.cjs package.json .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "test: verify LFS example source in release jobs"
```

---

### Task 2: Verify The Example In All Windows Artifacts

**Files:**
- Modify: `scripts/packaged-applications-contract.cjs`
- Modify: `desktop/scripts/verify-windows-artifacts.js`
- Modify: `desktop/test/artifact-security.test.js`
- Modify: `scripts/release-contract.test.cjs`

**Interfaces:**
- Consumes: `verifyExampleDrama(resourcesDirectory)` and `EXPECTED_EXAMPLE_DRAMA`.
- Produces: `application.example_drama = { path, bytes, sha256 }` for each Setup, Portable, and Unpacked inventory entry.

- [ ] **Step 1: Write failing artifact inventory tests**

Update the artifact fixture so every application includes:

```js
example_drama: {
  path: `${kind}/resources/example_drama/衣服设计天才302.zip`,
  bytes: 82156132,
  sha256: 'f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9',
}
```

Add tests that reject a missing descriptor, wrong bytes, wrong digest, traversal path, a path under another application root, and bytes changed under `options.scanRoot` after inventory creation.

- [ ] **Step 2: Run artifact tests and verify RED**

Run:

```powershell
node --test desktop/test/artifact-security.test.js
```

Expected: missing production validation makes the negative fixtures pass incorrectly.

- [ ] **Step 3: Enforce descriptor structure in the shared packaged-app contract**

For each application, derive the exact expected inventory path from `path.posix.dirname(asarPath)` plus `EXPECTED_EXAMPLE_DRAMA.relativePath`. Require normalized relative path equality, exact bytes, and exact digest. Keep the existing executable, ASAR, root, and fuse validation unchanged.

- [ ] **Step 4: Recompute extracted bytes during artifact preparation**

In `prepareArtifactScan`, for every discovered application:

1. use the directory containing `app.asar` as the resources root;
2. call `verifyExampleDrama(resourcesRoot)`;
3. record the path relative to `.artifact-scan`, bytes, and digest;
4. call `validateArtifactScanInventory` with both `sourceDirectory` and `scanRoot` so recorded evidence is compared with extracted bytes.

The inventory validator must repeat extracted-byte verification when `scanRoot` is provided.

- [ ] **Step 5: Update release evidence fixtures**

Update `passedArtifactSecurity()` in `scripts/release-contract.test.cjs` with the exact three descriptors because artifact security and release manifest validation consume the same packaged application contract.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
node --test desktop/test/artifact-security.test.js scripts/release-contract.test.cjs
npm --prefix desktop run test
```

Expected: all artifact and release contracts pass.

```powershell
git add -- scripts/packaged-applications-contract.cjs desktop/scripts/verify-windows-artifacts.js desktop/test/artifact-security.test.js scripts/release-contract.test.cjs
git commit -m "test: attest bundled example in Windows artifacts"
```

---

### Task 3: Functional Import Smoke And Archive Secret Scan

**Files:**
- Modify: `desktop/scripts/smoke-windows.js`
- Modify: `desktop/test/smoke-windows.test.js`
- Modify: `.github/workflows/windows-release-security.yml`
- Modify: `scripts/release-contract.test.cjs`

**Interfaces:**
- Produces: `verifyBundledExampleImport({ label, port })` and request-specific `timeoutMs` support.
- Consumes: `/api/v1/dramas/examples`, `/api/v1/dramas/import-example`, and `/api/v1/dramas/:id`.

- [ ] **Step 1: Write failing smoke contracts**

Add response validators and tests requiring:

```js
assertExampleListResponse({
  statusCode: 200,
  body: { success: true, data: [{ filename: '衣服设计天才302.zip' }] },
})

assertExampleImportResponse({
  statusCode: 201,
  body: { success: true, data: { drama_id: 42, title: 'fixture' } },
})
```

Negative tests must reject missing filename, non-201 import, non-positive `drama_id`, blank title, and a read-back with a different ID or title. Add source-order assertions proving `unpacked-example-import` calls the list endpoint, import endpoint with `sameOriginWriteHeaders(port)`, and read-back before the other Unpacked migration fixtures.

- [ ] **Step 2: Write failing Gitleaks workflow contract**

Require the artifact command to contain this exact option sequence before redaction/banner options:

```text
gitleaks dir desktop/release --config .gitleaks-artifacts.toml --max-archive-depth 1 --max-target-megabytes 256 --redact --no-banner
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test desktop/test/smoke-windows.test.js
node --test --test-name-pattern="artifact secret|example import" scripts/release-contract.test.cjs
```

Expected: smoke helpers and archive options are missing.

- [ ] **Step 4: Implement the actual Unpacked import**

Allow `requestHttp` to use `options.timeoutMs || 2000`. `verifyBundledExampleImport` must list examples, import the authoritative filename with the dynamic same-origin headers and `timeoutMs: timeoutMs`, then read `/api/v1/dramas/<id>` and compare identifier and title. Add a dedicated isolated launch:

```js
await launchAndProbe(
  'unpacked-example-import',
  executable,
  path.join(smokeRoot, 'unpacked-example-import'),
  { onReady: verifyBundledExampleImport }
)
```

Do not copy this large fixture into the legacy migration smoke root.

- [ ] **Step 5: Add bounded archive scanning**

Update the pinned Gitleaks invocation with the exact depth and target-size options. Keep the pinned binary checksum, artifact config, redaction, and fail-closed exit handling unchanged.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
node --test desktop/test/smoke-windows.test.js scripts/release-contract.test.cjs
npm --prefix desktop run test
```

Expected: all contract tests pass. The actual `npm --prefix desktop run smoke:windows` remains a final Windows artifact gate after rebuilding.

```powershell
git add -- desktop/scripts/smoke-windows.js desktop/test/smoke-windows.test.js .github/workflows/windows-release-security.yml scripts/release-contract.test.cjs
git commit -m "test: import bundled example in desktop smoke"
```
