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
- Modify: `scripts/rollback-drill-evidence.cjs`
- Modify: `scripts/run-rollback-drill.cjs`
- Modify: `scripts/release-contract.test.cjs`

**Interfaces:**
- Produces: `parseDrillArguments(args)`, `fingerprintDataRoot(root)`, and `assertCheckpointInputPaths(options)`.
- Produces: `localminidrama.rollback-drill.v3` evidence in standalone and checkpoint-bound modes.

- [ ] **Step 1: Write failing strict-CLI tests**

Replace the `assertNoCliArguments` test coverage with exact parser cases:

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

Create a temporary tree with files added in different creation orders and require identical digests. Require content, relative path, file length, and entry-type changes to alter the digest. Require a final symlink or symlinked parent to throw; skip only when Windows denies symlink creation.

The digest must match `/^[a-f0-9]{64}$/` and the implementation must sort normalized `/`-separated relative paths before hashing framed type/path/length/content data.

- [ ] **Step 3: Write failing v3 source contracts**

Require:

```js
assert.equal(EVIDENCE_SCHEMA, 'localminidrama.rollback-drill.v3')
assert.match(rollbackDrillScript, /input_mode/)
assert.match(rollbackDrillScript, /archive_retained/)
assert.match(rollbackDrillScript, /data_root_sha256/)
assert.match(rollbackDrillScript, /source_data_root_unchanged/)
```

Keep the existing root `check` syntax entries for both changed scripts before the release tests.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```powershell
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
node --test --test-name-pattern="rollback drill evidence|strict rollback|data root fingerprint" scripts/release-contract.test.cjs
```

Expected: parser/fingerprint exports and v3 schema are missing.

- [ ] **Step 5: Implement strict inputs and path validation**

Parse CLI arguments before preparing evidence. For checkpoint-bound mode require resolved absolute inputs, a real regular archive, a real data-root directory, no symbolic path component, and the archive outside the data root. For standalone mode derive the data root containing `drama_generator.db`, `storage`, and `story_sources` and fail if configured paths do not describe that one root.

- [ ] **Step 6: Implement deterministic tree fingerprinting**

Walk without following links. Sort by normalized relative path. Feed the hash a framed representation for each directory and file so `a/bc` cannot collide with `ab/c`; stream file bytes and include exact byte length. Compute before the drill and after isolated restore cleanup, and require equality.

- [ ] **Step 7: Restore the selected archive and publish v3**

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

Do not remove the supplied archive. Continue archiving recognized prior v1/v2 evidence, but publish only v3.

- [ ] **Step 8: Verify GREEN and commit**

Run:

```powershell
node --test --test-name-pattern="rollback" scripts/release-contract.test.cjs
npm run test:release
```

Expected: all rollback and release contracts pass.

```powershell
git add -- scripts/rollback-drill-evidence.cjs scripts/run-rollback-drill.cjs scripts/release-contract.test.cjs
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

- [ ] **Step 1: Write failing checkpoint contracts**

Require the checkpoint script to invoke this paired command after computing `backup_sha256`:

```powershell
Invoke-Checked -FilePath 'npm' -ArgumentList @(
  'run', 'verify:rollback', '--',
  '--archive', $backupPath,
  '--data-root', $runtimeDataDirectory
) -Label 'Rollback drill'
```

Require v3, `checkpoint-bound`, `archive_retained = $true`, matching summary/backup hashes, a 64-character `source.data_root_sha256`, `source_data_root_unchanged = $true`, and `data_root_sha256` in v5 metadata.

- [ ] **Step 2: Run the checkpoint contract and verify RED**

Run:

```powershell
node --test --test-name-pattern="release rollback scripts|data bind source" scripts/release-contract.test.cjs
```

Expected: v4/v2 and no paired archive invocation fail the new assertions.

- [ ] **Step 3: Implement v3 validation and v5 metadata**

After the drill, independently re-hash `data.zip`. Reject unless:

```text
summary.schema == localminidrama.rollback-drill.v3
summary.input_mode == checkpoint-bound
summary.backup.archive_retained == true
summary.backup.archive_sha256 == backup_sha256 == current data.zip SHA-256
summary.source.data_root_sha256 is 64 lowercase hex
summary.operations.source_data_root_unchanged == true
```

Write `schema = 'localminidrama.release-rollback-checkpoint.v5'` and `data_root_sha256 = $summary.source.data_root_sha256` while preserving all v4 fields and sanitized-config guarantees.

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

- [ ] **Step 1: Write failing restore cross-binding tests**

Require v5/v3 and these exact relationships before `Push-Location $repoRoot` or any image/data mutation:

```text
summary.input_mode == checkpoint-bound
summary.backup.archive_retained == true
summary.backup.archive_sha256 == metadata.backup_sha256
summary.source.data_root_sha256 == metadata.data_root_sha256
summary.operations.source_data_root_unchanged == true
```

Require both hash fields to be lowercase 64-character hexadecimal strings. Keep existing file-hash, bind-source, image-ID, commit, version, config, and credential checks.

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

Accept v5 only. Validate metadata field types and hashes, then validate the retained summary relationships. Do not recompute `data_root_sha256` against current live bytes. Continue verifying that the current container bind source is the recorded path before shutdown and preserve all compensation behavior.

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

### Task 4: Real Checkpoint And Restore Acceptance

**Files:**
- Verify only: external Docker data root, generated checkpoint directory, and `artifacts/rollback-drill/summary.json`.

**Interfaces:**
- Consumes: clean final Git SHA and final Docker images.
- Produces: one v5 checkpoint, successful restore, and one independent v3 standalone offline drill.

- [ ] **Step 1: Run standalone v3 on a clean commit**

Run `npm run verify:rollback` with Node 20 and require `input_mode: standalone`, `archive_retained: false`, a valid data-root digest, and cleanup success.

- [ ] **Step 2: Create a real checkpoint**

With Docker using a repository-external `LOCALMINIDRAMA_DATA_DIR`, run `npm run checkpoint:rollback -- -CheckpointDirectory <external-checkpoint>`. Require metadata v5, summary v3 checkpoint-bound, and exact backup/root cross-hashes.

- [ ] **Step 3: Exercise restore and compensation**

Run `npm run restore:rollback -- -CheckpointDirectory <external-checkpoint>`. Require health/readiness success, preserved compensation evidence, and explicit Provider credential reconfiguration warning.

- [ ] **Step 4: Re-run release contracts**

Run:

```powershell
npm run test:release
npm run check
git diff --check
```

Expected: all commands exit zero and the worktree remains clean apart from ignored evidence.
