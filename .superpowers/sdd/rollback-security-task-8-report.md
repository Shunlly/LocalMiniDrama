# Rollback Security Task 8 Report

Requirements: `.superpowers/sdd/rollback-security-task-8-brief.md`
Baseline: `9d7a291`
Commit A: `38ac41d` (`fix: restore rollback caller environment`)
Commit B: this commit (`fix: preserve rollback primary failures`)
Status: implementation and controller verification complete; independent review pending.

## Commit A: Exact Caller State

### Changed files

- `scripts/rollback-powershell-support.ps1`
- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/restore-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`

### Implemented behavior

- Both entry points snapshot exactly the five required process variables before
  their first assignment and restore entries in reverse order.
- Snapshot entries preserve name, existence, and exact value. Windows process
  environment restoration distinguishes absent values from present empty
  strings under Windows PowerShell 5.1 through the lazy in-memory Win32 setter.
- Windows rejects case-variant duplicate snapshot names. Nested snapshots retain
  independent LIFO state.
- Dot-sourcing definitions changes neither process environment nor current and
  stacked provider locations.
- Every invoked success, primary-failure, recovery-failure, cleanup-only, and
  primary-plus-cleanup branch restores environment and location before releasing
  the live data-root authority.

### RED and GREEN evidence

- Reconstructed RED from the Task 7 baseline with only Commit A tests applied:
  `17 passed`, `40 failed`, `119 skipped`, exit 1. The failing groups were exact
  environment snapshots, cleanup order, Checkpoint caller state, and Restore
  caller state.
- Commit A GREEN focused matrix: `85 passed`, `0 failed` across Windows
  PowerShell 5.1 and PowerShell 7.
- Deterministic caller rows total at least 72: Checkpoint `3 states x 5 outcomes
  x 2 hosts = 30`, Restore `30`, and dot-source `2 scripts x 3 states x 2 hosts
  = 12`. Additional nested, duplicate-name, direct-primary, and injected cleanup
  rows run outside that minimum.

## Commit B: Exact Primary Error Precedence

### Changed files

- `scripts/rollback-powershell-support.ps1`
- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/restore-release-rollback-checkpoint.ps1`
- `scripts/run-rollback-drill.cjs`
- `scripts/rollback-drill-contract.test.cjs`
- `scripts/release-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-8-report.md`

### PowerShell behavior

- Primary failures are captured as their original ErrorRecord and rethrown with
  bare `throw` from the original catch. Exception identity, FQID, category,
  target object, and script stack are retained.
- Cleanup remains exhaustive. Existing and new cleanup ErrorRecords are retained
  in execution order under `RollbackCleanupErrors`, capped at eight, with
  `RollbackCleanupErrorsTruncated = true` when details are dropped.
- Attachment failures are contained and cannot replace the primary failure.
- Cleanup-only failure throws the first exact cleanup ErrorRecord and attaches
  only later cleanup records. No aggregate exception or unbounded concatenated
  diagnostic is created.
- The first full Release run exposed a delayed `$proofError` path that depended
  on the removed wrapper rethrow. It incorrectly let 28 captured-container bind
  rejection rows return success. The retry loop now bare-rethrows every
  non-retryable or final failure in its original catch. The dual-host bind-proof
  matrix then passed `57 passed`, `0 failed`.

### Node behavior

- Exported `attachCleanupError(primaryError, cleanupError)` returns the exact
  primary value for `undefined`, `null`, `false`, `0`, `NaN`, empty string,
  frozen objects, and Proxies.
- A non-enumerable singular `cleanupError` is attached when possible. Existing
  bounded non-enumerable `cleanupErrors` data entries are preserved and nested
  details are capped at eight.
- Proxy detection occurs before descriptor operations. Accessors are never read;
  non-array and Proxy containers are ignored; a ten-million-slot sparse array is
  inspected only at the bounded own-data indices.
- Explicit `hasPrimaryError` booleans select operation, cleanup-only, and
  publication failures without truthiness. Workspace cleanup, standalone archive
  removal, archive closure, and later retained-handle closure all remain
  exhaustive, and no failure branch publishes PASS.

### RED and GREEN evidence

- Node focused RED: `27 passed`, `6 failed`, `88 skipped`. Failures were the
  missing exported helper and missing singular attachment across workspace and
  archive-close combinations.
- Node focused GREEN: `33 passed`, `0 failed`, `88 skipped`.
- Complete rollback contract: `144 passed`, `0 failed`, `6 Linux-only skipped`.
- Initial complete Release diagnostic run: `293 passed`, `30 failed`, `1
  Ubuntu-only skipped`. This found the delayed bind-proof error described above
  plus assertions that still required the prohibited aggregate cleanup message.
- Final complete Release contract: `323 passed`, `0 failed`, `1 Ubuntu-only
  skipped`.

## Exhaustive Cleanup Order

Create releases authorities in this order:

1. metadata publication
2. drill summary
3. backup hash publication
4. archive publication
5. data-bind-source publication
6. checkpoint config-directory lock
7. checkpoint writable-directory authority
8. caller environment snapshot
9. caller location stack
10. live data-root lock last

Restore releases authorities in this order:

1. compensation ready marker, metadata, hash, bind source, and archive
2. compensation writable-directory authority
3. retained checkpoint summary, image archive, bind source, config, Compose,
   hash, backup, and metadata authorities in reverse open order
4. checkpoint config-directory lock and writable checkpoint authority
5. caller environment snapshot
6. caller location stack
7. live data-root lock last

Each item is isolated in its own cleanup boundary so one disposal failure cannot
skip any later item.

## Final Verification

- Node runtime: `v20.20.2`.
- Windows PowerShell: `5.1.26100.8655`; PowerShell: `7.6.4`.
- Checkpoint caller-state matrix: `33 passed`, `0 failed`.
- Restore caller-state matrix: `35 passed`, `0 failed`.
- Captured-container bind-proof matrix: `57 passed`, `0 failed`.
- Complete rollback contract: `144 passed`, `0 failed`, `6 skipped`.
- Complete Release contract: `323 passed`, `0 failed`, `1 skipped`.
- Node 20 syntax checks: all changed JavaScript files parsed successfully.
- Windows PowerShell 5.1 and PowerShell 7.6.4 parsers: three changed scripts,
  zero parse errors on each host.
- `git diff --check`: exit 0; only checkout line-ending conversion warnings.
- Static audit found no direct removal of the five caller variables, no
  `ThrowTerminatingError`, no explicit primary ErrorRecord rethrow, no embedded
  real Provider credential, and no unbounded cleanup-message aggregation.

## Residual Boundaries

- The guarantees cover local invocation-time identity, cleanup precedence, and
  process state. They do not provide checkpoint signatures, creator
  authenticity, malicious-at-rest resistance, or freshness proof; Task 9 owns
  the operator-facing trust-boundary statement.
- Six rollback tests are Linux-only and one Release workflow test is Ubuntu-only;
  both are exercised by their Linux CI jobs rather than this Windows host.
- Same-permission process injection, administrator/SYSTEM compromise, compromised
  runtimes, remote filesystems, hardware failure, and denial of service remain
  outside the local rollback guarantee.
- Independent spec, code-quality, and security review must be recorded before
  Task 8 is marked complete.
