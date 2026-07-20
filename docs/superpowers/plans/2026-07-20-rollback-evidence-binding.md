# Rollback Evidence Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a release checkpoint drilled the exact retained `data.zip` from the inspected external data root before rollback can mutate live state.

**Architecture:** Upgrade drill evidence to v3 with strict standalone/checkpoint-bound modes and a deterministic data-root digest. Upgrade checkpoint metadata to v5, cross-bind backup and root hashes, then make restore validate every v3/v5 relationship before image or data mutation.

**Tech Stack:** Node.js 20, PowerShell 5+, SQLite backup service, Docker Compose, Node built-in tests.

## Global Constraints

- CLI bound mode accepts only paired `--archive <absolute-file> --data-root <absolute-directory>` arguments.
- Standalone no-argument mode remains supported.
- Bound mode never deletes or modifies the supplied archive.
- Current live data is allowed to differ from checkpoint-time data during restore.
- Provider credentials remain excluded and require reconfiguration.
- Restore validation must finish before image load/tag, Docker shutdown, compensation backup, or data restore.

---

### Task 1: Rollback Drill V3 And Checkpoint-Bound Inputs

**Files:**
- Create: `scripts/rollback-drill-contract.test.cjs`
- Modify: `scripts/rollback-drill-evidence.cjs`
- Modify: `scripts/run-rollback-drill.cjs`
- Modify: `scripts/release-contract.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseDrillArguments(args)`, `fingerprintDataRoot(root)`, `assertCheckpointInputPaths(options)`, and `validateEvidenceV3(evidence, expectedVersion)`.
- Produces: `executeRollbackDrill(options, runtime) -> Promise<evidence>`, where `options` is the strict parsed mode object and `runtime` supplies backup, restore, fingerprint, publication, and optional test hooks. It throws before publication on any invalid or changed input.
- Produces: `localminidrama.rollback-drill.v3` evidence in standalone and checkpoint-bound modes.

- [ ] **Step 1: Write failing strict-CLI tests**

In `scripts/rollback-drill-contract.test.cjs`, replace the `assertNoCliArguments` behavior with exact parser cases:

```js
assert.deepEqual(parseDrillArguments([]), {
  inputMode: 'standalone',
  archivePath: null,
  dataRoot: null,
})

assert.deepEqual(
  parseDrillArguments(['--archive', archive, '--data-root', dataRoot]),
  { inputMode: 'checkpoint-bound', archivePath: archive, dataRoot }
)
```

Require reversed pair order to return the same object. Require unknown, duplicate, missing, unpaired, and relative arguments to throw.

- [ ] **Step 2: Write failing fingerprint tests**

Create a temporary tree with files added in different creation orders and require identical digests. Require content, relative path, file length, and entry-type changes to alter the digest. Require a final symlink, symlinked parent, junction/reparse final component, or junction/reparse parent to throw; skip only the fixture that Windows explicitly refuses to create.

The digest must match `/^[a-f0-9]{64}$/` and the implementation must sort normalized `/`-separated relative paths by UTF-8 bytes before hashing framed type/path/length/content data. Add empty-directory and non-ASCII-path cases. Replacing an entry while it is fingerprinted must fail closed rather than returning a digest for mixed identities.

- [ ] **Step 3: Write failing publisher lifecycle tests**

Require `validateEvidenceV3` and `publishEvidence` to reject missing or invalid mode, archive/root digest, typed boolean, retention relationship, version, or status. Require prior v1, v2, and different-version v3 PASS evidence to archive with `legacy-v1`, `v2`, and `v3` generation names. A same-version v2 PASS must be archived rather than silently deleted as current evidence.

Fix the continuity rule explicitly:

```js
assert.equal(boundEvidence.backup.excluded_values, null)
assert.equal(Number.isInteger(standaloneEvidence.backup.excluded_values), true)
```

- [ ] **Step 4: Write failing bound-execution behavior tests**

Exercise the runtime-injectable drill executor with a real temporary archive file and data-root tree. Inject spies for `createDataBackup`, `restoreDataBackup`, and evidence publication. Require bound mode to call `createDataBackup` zero times, pass the exact supplied archive path to restore, retain the same regular-file identity and bytes, and publish that archive hash. Mutating the archive or any root entry between pre/post checks must reject without publishing PASS. Standalone mode must create and remove only its workspace archive.

- [ ] **Step 5: Write failing v3 source contracts**

Require:

```js
assert.equal(EVIDENCE_SCHEMA, 'localminidrama.rollback-drill.v3')
assert.match(rollbackDrillScript, /input_mode/)
assert.match(rollbackDrillScript, /archive_retained/)
assert.match(rollbackDrillScript, /data_root_sha256/)
assert.match(rollbackDrillScript, /source_data_root_unchanged/)
```

Add `test:rollback-contract = node --test scripts/rollback-drill-contract.test.cjs`. Root `check` must syntax-check the new test and execute it only after syntax validation while preserving the existing release/local/OpenClaw gates.

- [ ] **Step 6: Run focused tests and verify RED**

Run:

```powershell
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
node --test scripts/rollback-drill-contract.test.cjs
node --test --test-name-pattern="rollback drill evidence|strict rollback|data root fingerprint" scripts/release-contract.test.cjs
```

Expected: parser, fingerprint, v3 validator, and bound executor are missing or fail the new relationships.

- [ ] **Step 7: Implement strict inputs and path validation**

Parse CLI arguments before preparing evidence. For checkpoint-bound mode require resolved absolute inputs, a real regular archive, a real data-root directory, no symbolic-link, junction, mount-point, or other reparse path component, and the archive outside the data root. For standalone mode derive the data root containing `drama_generator.db`, `storage`, and `story_sources` and fail if configured paths do not describe that one root.

- [ ] **Step 8: Implement deterministic tree fingerprinting**

Walk without following links. Sort by normalized relative path. Feed the hash a framed representation for each directory and file so `a/bc` cannot collide with `ab/c`; stream file bytes and include exact byte length. Compute before the drill and after isolated restore cleanup, and require equality.

- [ ] **Step 9: Restore the selected archive and publish v3**

Standalone mode keeps creating `workspace/current-data.zip`; checkpoint-bound mode uses the supplied archive directly. Both restore into the isolated workspace and validate SQLite, storage, story sources, credentials, and rollback copies. Publish these exact relationships:

```js
input_mode: options.inputMode,
source: {
  // existing fields
  data_root_sha256: beforeDataRootSha256,
},
backup: {
  // existing fields
  archive_sha256: archiveSha256,
  archive_retained: options.inputMode === 'checkpoint-bound',
},
operations: {
  // existing fields
  source_data_root_unchanged: afterDataRootSha256 === beforeDataRootSha256,
},
```

Do not remove the supplied archive. Re-hash and re-stat it after restore before setting `archive_retained: true`. Continue archiving recognized prior v1/v2 evidence, but publish only fully validated v3. Checkpoint-bound `backup.excluded_values` is `null`; standalone keeps the actual integer returned by `createDataBackup`.

- [ ] **Step 10: Verify GREEN and commit**

Run:

```powershell
node --test scripts/rollback-drill-contract.test.cjs
node --test --test-name-pattern="rollback" scripts/release-contract.test.cjs
npm run test:release
```

Expected: all rollback and release contracts pass.

```powershell
git add -- scripts/rollback-drill-contract.test.cjs scripts/rollback-drill-evidence.cjs scripts/run-rollback-drill.cjs scripts/release-contract.test.cjs package.json
git commit -m "feat: bind rollback drill to retained inputs"
```

---

### Task 2: Release Checkpoint Metadata V5

**Files:**
- Modify: `scripts/create-release-rollback-checkpoint.ps1`
- Modify: `scripts/release-contract.test.cjs`

**Interfaces:**
- Consumes: v3 checkpoint-bound summary, `data.zip`, and the inspected `/app/data` bind source.
- Produces: `localminidrama.release-rollback-checkpoint.v5` with `data_root_sha256`.
- Produces: side-effect-free `Assert-CheckpointDrillEvidence -Summary -ExpectedCommit -ExpectedVersion -ExpectedBackupHash -ActualBackupHash`, returning the validated data-root digest or throwing. Tests invoke only the function definitions before the script's `$repoRoot =` main boundary.

- [ ] **Step 1: Write failing checkpoint contracts**

Require the checkpoint script to invoke this paired command after computing `backup_sha256`:

```powershell
Invoke-Checked -FilePath 'npm' -ArgumentList @(
  'run', 'verify:rollback', '--',
  '--archive', $backupPath,
  '--data-root', $runtimeDataDirectory
) -Label 'Rollback drill'
```

Require case-sensitive `status = 'passed'`, v3, `checkpoint-bound`, `archive_retained = $true`, matching summary/backup hashes, a 64-character lowercase `source.data_root_sha256`, `source_data_root_unchanged = $true`, and `data_root_sha256` in v5 metadata. Add executable tests for the pure validator; `failed`, `PASSED`, swapped hashes, uppercase hashes, string booleans, wrong commit/version, v2 schema, and standalone mode must all throw.

- [ ] **Step 2: Run the checkpoint contract and verify RED**

Run:

```powershell
node --test --test-name-pattern="release rollback scripts|data bind source" scripts/release-contract.test.cjs
```

Expected: v4/v2 and no paired archive invocation fail the new assertions.

- [ ] **Step 3: Implement v3 validation and v5 metadata**

Capture the application version before validating the summary. After the drill, independently require `data.zip` to remain the same regular-file identity and re-hash it. Reject unless:

```text
summary.schema == localminidrama.rollback-drill.v3
summary.status == passed
summary.input_mode == checkpoint-bound
summary.backup.archive_retained == true
summary.backup.archive_sha256 == backup_sha256 == current data.zip SHA-256
summary.source.data_root_sha256 is 64 lowercase hex
summary.operations.source_data_root_unchanged == true
summary.source.commit == captured commit
summary.source.version == captured version
summary.source.working_tree_dirty is boolean false
```

Use case-sensitive `-cne` and `-cmatch` for schema, mode, and lowercase digests, and require JSON booleans to be `[bool]`. Write `schema = 'localminidrama.release-rollback-checkpoint.v5'` and `data_root_sha256 = $summary.source.data_root_sha256` while preserving all v4 fields and sanitized-config guarantees.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```powershell
node --test --test-name-pattern="release rollback|data bind source" scripts/release-contract.test.cjs
```

Expected: all checkpoint contracts pass.

```powershell
git add -- scripts/create-release-rollback-checkpoint.ps1 scripts/release-contract.test.cjs
git commit -m "feat: bind rollback checkpoint metadata to drill"
```

---

### Task 3: Restore V5 Fail-Closed Cross-Binding

**Files:**
- Modify: `scripts/restore-release-rollback-checkpoint.ps1`
- Modify: `scripts/release-contract.test.cjs`

**Interfaces:**
- Consumes: checkpoint v5 metadata, v3 summary, retained `data.zip`, bind-source evidence, images, compose, and sanitized config.
- Produces: a restore path that cannot perform a destructive operation with stale or unrelated drill evidence.
- Produces: side-effect-free `Assert-RollbackEvidenceBinding -Metadata -Summary -ActualBackupHash`, returning no value on success and throwing on any mismatch. Tests invoke only definitions before the `$repoRoot =` main boundary.

- [ ] **Step 1: Write failing restore cross-binding tests**

Require v5/v3 and these exact relationships before `Push-Location $repoRoot` or any image/data mutation:

```text
summary.input_mode == checkpoint-bound
summary.status == passed
summary.backup.archive_retained == true
summary.backup.archive_sha256 == metadata.backup_sha256
summary.source.data_root_sha256 == metadata.data_root_sha256
summary.operations.source_data_root_unchanged == true
```

Require both hash fields to be lowercase 64-character hexadecimal strings. Keep existing file-hash, bind-source, image-ID, commit, version, config, and credential checks.

Add executable tests for the pure PowerShell function. It must reject `failed` or `PASSED` status, v4 metadata, v2 evidence, standalone mode, swapped otherwise-valid summary/archive evidence, uppercase or malformed hashes, string booleans, and a root digest changed on either side. A current live data tree that differs from the old digest must not be an input to this function and must not be rejected solely for content drift.

- [ ] **Step 2: Assert destructive ordering and verify RED**

Extend the existing order test so the end of v3/v5 cross-validation occurs before the earliest of:

```text
Rollback image archive load
Current Docker shutdown
Pre-rollback compensation backup
Rollback data restore
```

Run:

```powershell
node --test --test-name-pattern="restore|release rollback scripts" scripts/release-contract.test.cjs
```

Expected: v4/v2 restore validation fails the new assertions.

- [ ] **Step 3: Implement v5/v3 fail-closed validation**

Accept v5 only. Validate metadata field types and hashes, then call the executable retained-summary binding validator. Use case-sensitive schema/mode/hash comparisons and typed booleans. Do not recompute `data_root_sha256` against current live bytes. Continue verifying that the current container bind source is the recorded path before shutdown and preserve all compensation behavior.

- [ ] **Step 4: Verify GREEN and the complete release contract**

Run:

```powershell
node --test --test-name-pattern="rollback" scripts/release-contract.test.cjs
npm run test:release
```

Expected: all rollback and release tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/restore-release-rollback-checkpoint.ps1 scripts/release-contract.test.cjs
git commit -m "fix: fail closed on unbound rollback evidence"
```

---

### Task 4: Workflow And Operator Documentation V3/V5

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/quickstart.md`
- Modify: `scripts/release-contract.test.cjs`

**Interfaces:**
- Consumes: standalone v3 summary and checkpoint/restore v5 commands.
- Produces: CI, release, and operator contracts that reject old or checkpoint-bound evidence in standalone jobs.

- [ ] **Step 1: Write failing workflow contracts**

For both rollback jobs, require the existing status, commit, version, and clean-tree checks plus:

```js
assert.equal(summary.schema, 'localminidrama.rollback-drill.v3')
assert.equal(summary.input_mode, 'standalone')
assert.equal(summary.backup.archive_retained, false)
assert.match(summary.backup.archive_sha256, /^[a-f0-9]{64}$/)
assert.match(summary.source.data_root_sha256, /^[a-f0-9]{64}$/)
assert.equal(summary.operations.source_data_root_unchanged, true)
```

The no-argument `npm run verify:rollback` invocation remains unchanged.

- [ ] **Step 2: Run workflow contracts and verify RED**

Run:

```powershell
node --test --test-name-pattern="rollback drill before|isolated rollback" scripts/release-contract.test.cjs
```

Expected: both workflows validate only the old fields.

- [ ] **Step 3: Upgrade workflow validation**

Add the exact v3 standalone checks to CI and release before evidence upload. Do not allow a v2 or checkpoint-bound summary to satisfy either job.

- [ ] **Step 4: Update operator documentation**

Update `docs/quickstart.md` from checkpoint v4 to v5 and evidence v3. Document the exact paired checkpoint drill, the single-root standalone layout (`drama_generator.db`, `storage`, `story_sources`), the fact that v4 checkpoints are not release-authoritative, and the rule that restore does not compare current live bytes with the old root digest.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
node --test --test-name-pattern="rollback" scripts/release-contract.test.cjs
npm run test:release
```

Expected: workflow and release contracts pass.

```powershell
git add -- .github/workflows/ci.yml .github/workflows/release.yml docs/quickstart.md scripts/release-contract.test.cjs
git commit -m "docs: enforce rollback v3 in release workflows"
```

---

### Task 5: Real Checkpoint And Restore Acceptance

**Files:**
- Verify only: external Docker data root, generated checkpoint directory, and `artifacts/rollback-drill/summary.json`.

**Interfaces:**
- Consumes: clean final Git SHA and final Docker images.
- Produces: one v5 checkpoint, successful restore, and one independent v3 standalone offline drill.

- [ ] **Step 1: Create a real checkpoint**

With Docker using a repository-external `LOCALMINIDRAMA_DATA_DIR`, run `npm run checkpoint:rollback -- -CheckpointDirectory <external-checkpoint>`. Require metadata v5, summary v3 checkpoint-bound, exact three-way archive hashes, exact two-way root digests, retained archive identity, and unchanged source root.

- [ ] **Step 2: Exercise restore and compensation**

Run `npm run restore:rollback -- -CheckpointDirectory <external-checkpoint>`. Require health/readiness success, preserved compensation evidence, and explicit Provider credential reconfiguration warning.

- [ ] **Step 3: Stop Docker and run the offline standalone drill**

Run `docker compose --profile e2e down --remove-orphans` without deleting the external data root, confirm the backend port is closed, then run no-argument `npm run verify:rollback` with Node 20. Require `input_mode: standalone`, `archive_retained: false`, valid archive/data-root digests, `source_data_root_unchanged: true`, workspace cleanup success, and no live service dependency.

- [ ] **Step 4: Re-run release contracts**

Run:

```powershell
npm run test:release
npm run check
git diff --check
```

Expected: all commands exit zero and the worktree remains clean apart from ignored evidence.
