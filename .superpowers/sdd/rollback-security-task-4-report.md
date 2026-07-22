# Rollback Security Remediation Task 4 Report

Date: 2026-07-22

Base commit: `25c869dfb39e87251c76bcd9fb849926cd7c98dd`

Required commit subject: `fix: bound rollback evidence hashing`

## Initial State

The task started from the exact controller-provided baseline with a clean
working tree:

```powershell
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
```

Exit codes: `0`, `0`. HEAD was
`25c869dfb39e87251c76bcd9fb849926cd7c98dd`; status output was empty.

## Pinned Environment

All authoritative Node runs used the repository's pinned Node 20 major through
`npx --yes node@20`. The resolved version was Node.js 20.20.2. The complete
release contract also used Windows PowerShell 5.1 and portable PowerShell 7.6.4
from the system temporary directory. No runtime was added to the repository.

The production backup defaults were read directly from `dataBackupService` and
verified unchanged:

```text
maxFiles=25000
maxTotalBytes=34359738368 (32 GiB)
maxFileBytes=8589934592 (8 GiB)
maxArchiveBytes=38654705664 (36 GiB)
maxPathBytes=1024
maxPathDepth=64
```

## RED Evidence

The limit, archive-handle, growth, propagation, 36 GiB plus one, and maximum
format-2 tests were added before the production implementation.

An initial RED run found 11 expected implementation failures but also exposed a
test defect: `Object.isFrozen(undefined)` is true, so the limits propagation
test did not prove that an object was passed. The assertion was tightened before
production edits. The corrected retained RED command was:

```powershell
npx --yes node@20 --test --test-name-pattern="limit|oversized|archive size|fingerprint" scripts/rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 45 total, 14 passed, 12 failed, 19 skipped by the
pattern. The expected failures were seven tree/archive plus-one leaves and their
parent, the immutable shared-limits test, stat-before-read oversized hashing,
growing-file length protection, and 36 GiB plus one evidence validation.

During implementation self-review, direct evidence count-cap coverage was found
to be incomplete. The count checks were removed, exact/plus-one validator and
publisher tests were added, and the same focused command was rerun before the
checks were restored.

Exit code: `1`. Tests: 49 total, 26 passed, 4 failed, 19 skipped. The three
expected failing leaves were storage count, story-source count, and combined
directory count above the injected `maxFiles`; their parent was the fourth
failure. Exact `maxFiles + 1` total arithmetic passed.

## Implementation

- `run-rollback-drill.cjs` destructures `DEFAULT_LIMITS`, normalizes overrides
  once into a new frozen object, and passes that exact reference to both root
  fingerprints, backup, restore, and evidence publication. Retained archive
  hashing receives its `maxArchiveBytes` and expected descriptor length from the
  same object and retained identity.
- `sha256FileHandle(handle, { expectedBytes, maxBytes })` performs descriptor
  `stat({ bigint: true })`, regular-file, expected-length, and maximum-size
  checks before hash/buffer allocation and before the first read. Streaming uses
  `BigInt` arithmetic to reject growth or cap overflow before hashing bytes, then
  rechecks descriptor device, inode, size, and ctime identity.
- `fingerprintDataRoot(root, hooks = {}, limits = DEFAULT_LIMITS)` streams
  directory enumeration. It validates discovered-entry, UTF-8 path-byte, depth,
  regular-file, per-file, and aggregate-byte limits before retaining an entry or
  reading file content. The exact sentinels are `maxFiles + 1` regular files and
  `(maxFiles * maxPathDepth) + 1` discovered entries.
- Post-read directory snapshots are also enumerated into a bounded collection.
  Existing unsupported-entry, symbolic-link/reparse, real-path, descriptor,
  directory-name, and root-identity checks remain in force.
- `validateEvidenceV3` and `publishEvidence` accept optional limits, reject
  archives above `maxArchiveBytes`, reject individual or combined directory
  counts above `maxFiles`, and reject totals above `maxFiles + 1`. Count and
  archive arithmetic use `BigInt` after safe-integer type validation.

## GREEN Verification

Final focused limit/hash gate:

```powershell
npx --yes node@20 --test --test-name-pattern="limit|oversized|archive size|fingerprint" scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 49 total, 30 passed, 0 failed, 19 skipped by the
pattern.

Complete rollback drill contract:

```powershell
npx --yes node@20 --test scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 53 passed, 0 failed, 0 skipped.

The first complete release-contract attempt had no `pwsh` executable on PATH.
It exited `1` with 91 passed, 12 failed, and 1 skipped; all 12 failures required
PowerShell 7 and were unrelated to the changed code. Portable PowerShell 7.6.4
was then placed in the system temporary directory and added to PATH.

Final complete release contract on the final source state:

```powershell
$env:PATH = (Join-Path $env:TEMP 'codex-pwsh-7.6.4') + [IO.Path]::PathSeparator + $env:PATH
npx --yes node@20 --test scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 196 passed, 0 failed, 0 skipped. Duration was 523.4
seconds.

Pinned Node syntax checks:

```powershell
npx --yes node@20 --check scripts/run-rollback-drill.cjs
npx --yes node@20 --check scripts/rollback-drill-evidence.cjs
npx --yes node@20 --check scripts/rollback-drill-contract.test.cjs
```

Exit codes: `0`, `0`, `0`.

```powershell
git diff --check
```

Exit code: `0`. Git emitted only the checkout's existing LF-to-CRLF warnings.

## Changed Files

- `scripts/run-rollback-drill.cjs`
- `scripts/rollback-drill-evidence.cjs`
- `scripts/rollback-drill-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-4-report.md`

## Self-Review

- The retained archive's first byte cannot be read until descriptor type,
  expected length, and maximum size pass. The hash buffer is also allocated only
  after those checks.
- File and entry sentinel calculations, aggregate bytes, evidence archive size,
  and evidence count relationships use `BigInt`; conversions to `Number` occur
  only after the production archive cap guarantees a safe value.
- Exact tiny boundaries pass. Every plus-one tree, archive, and evidence count
  case fails before PASS publication.
- File-size and aggregate checks happen during discovery, before the global hash
  loop reads any content. Entry/path/depth checks happen before entry retention.
- Raw directory entry names are retained for post-check snapshots; symlink,
  reparse, unsupported type, real-path, open-handle, and name-set semantics were
  not weakened.
- One normalized frozen limits object is observed by both fingerprints, backup,
  restore, and publisher. Both retained hash calls derive their cap from it.
- Production defaults remain exactly 25,000 files, 32 GiB payload, 8 GiB per
  file, 36 GiB archive, 1024 UTF-8 path bytes, and depth 64.
- The actual diff contains only the four allowed paths.

## Residual Risks

The production limits intentionally permit long-running work: up to 32 GiB of
content and 1,600,001 discovered entries. Enumeration and retained metadata are
bounded, but a maximum-valid tree can still consume substantial time and memory.
As specified, trees with more than the derived cap of empty directories are
unsupported even though empty directories are not backup payload. Filesystem
identity guarantees continue to depend on the platform's device/inode/ctime and
sharing semantics already covered by the retained-handle contracts.

The immutable resulting commit SHA is reported in the final handoff. Embedding
that SHA in this tracked report would change the commit object and produce a
different SHA.

## Review Fix: Bounded Standalone Hashing

Review-fix date: 2026-07-22

Review-fix base: `d81662fc01ebfb4d5f02842f0c48ed6b3fcd22ea`

Required follow-up subject: `fix: bound standalone rollback hashing`

### Findings Addressed

The initial Task 4 commit bounded retained checkpoint hashing but left three
standalone path reopen/read flows in `run-rollback-drill.cjs`: the source
database pre/post hashes and the newly produced archive hash. It also passed
only a copied `maxBytes` scalar into retained hashing, and its propagation test
recorded stub options without invoking the real hasher.

The follow-up removes the path-based hash helper entirely. Standalone execution
now retains:

- one regular-file handle for the source database from its initial bounded hash
  through post-backup verification, post-cleanup final verification, evidence
  publication, and exhaustive closure; and
- one regular-file handle for the generated archive from immediate post-backup
  open/identity/`backup.archiveBytes` validation through bounded hashing,
  restore, post-cleanup final verification, publication, closure, and archive
  deletion.

`sha256FileHandle(handle, { expectedBytes, maxBytes, limits, limitKey, label })`
preserves the required `expectedBytes`/`maxBytes` contract and additionally
requires the exact immutable limits object. It rejects a mutable limits object
or a `maxBytes` value that does not equal the selected property on that object
before descriptor stat, allocation, or read.

The produced standalone archive uses a random sibling path derived from the
random `mkdtemp` workspace name. This is necessary on Windows: an open archive
inside the workspace made recursive workspace removal fail with `ENOTEMPTY`.
The sibling arrangement permits verified workspace cleanup before final source,
database, and archive verification and PASS publication while the archive
handle remains open. The archive is removed after publication and exhaustive
handle closure.

### RED Evidence

Tests were added before the production follow-up:

```powershell
npx --yes node@20 --test --test-name-pattern="limit|oversized|archive size|fingerprint|standalone archive|standalone database|hashing" scripts/rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 55 total, 29 passed, 7 failed, 19 skipped by the
pattern. Expected failures covered:

- no real retained-hasher calls in the shared-limits propagation test;
- no immutable/matching limits assertion in `sha256FileHandle`;
- no standalone retained archive handle at the exact boundary;
- no standalone archive growth or replacement rejection before restore;
- no retained database authority for same-byte replacement; and
- no observable stat-before-read database growth rejection.

The first implementation run exposed a Windows lifecycle issue rather than a
contract success: 55 total, 30 passed, 6 failed, and 19 skipped. Every
standalone failure was `ENOTEMPTY` while removing a workspace containing the
open retained archive. The archive was moved to its random sibling path before
the retained-handle tests were considered GREEN.

### GREEN Verification

Final focused limit/hash/standalone gate:

```powershell
npx --yes node@20 --test --test-name-pattern="limit|oversized|archive size|fingerprint|standalone archive|standalone database|hashing" scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 56 total, 37 passed, 0 failed, 19 skipped by the
pattern.

Complete rollback contract:

```powershell
npx --yes node@20 --test scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 60 passed, 0 failed, 0 skipped.

Complete release contract with both Windows PowerShell hosts:

```powershell
$env:PATH = (Join-Path $env:TEMP 'codex-pwsh-7.6.4') + [IO.Path]::PathSeparator + $env:PATH
npx --yes node@20 --test scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 196 passed, 0 failed, 0 skipped. Duration was 529.1
seconds.

Pinned Node syntax checks:

```powershell
npx --yes node@20 --check scripts/run-rollback-drill.cjs
npx --yes node@20 --check scripts/rollback-drill-evidence.cjs
npx --yes node@20 --check scripts/rollback-drill-contract.test.cjs
```

Exit codes: `0`, `0`, `0`.

```powershell
git diff --check
```

Exit code: `0`. Git emitted only the checkout's existing LF-to-CRLF warnings.

### Review-Fix Changed Files

- `scripts/run-rollback-drill.cjs`
- `scripts/rollback-drill-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-4-report.md`

`scripts/rollback-drill-evidence.cjs` required no follow-up change.

### Review-Fix Self-Review

- No `sha256(path)`, synchronous open/read hash helper, or unbounded standalone
  hash path remains in `run-rollback-drill.cjs`.
- The generated archive is opened before any post-backup database hash. Its
  descriptor size must equal safe-integer `backup.archiveBytes`, and its first
  byte is read only after descriptor identity, expected size, archive cap,
  immutable limits identity, and selected limit-key checks pass.
- Restore receives the same archive `FileHandle` observed by initial and final
  real hashes in both checkpoint and standalone modes.
- Source database pre-backup, post-backup, and final checks use the same retained
  regular-file handle, `maxFileBytes`, expected length, stream cap, digest, and
  descriptor/path identity checks.
- The exact normalized frozen limits object is observed by both fingerprints,
  all five standalone real hash calls, backup, restore, and publisher. The
  publisher wrapper forwards the limits argument.
- Exact standalone archive size passes. One-byte archive/database growth is
  rejected by stat before a post-backup read, and same-byte archive/database
  replacement is rejected before restore. No failure case publishes PASS, and
  every observed handle is closed.
- Workspace cleanup retains baseline ordering and error precedence: operation
  work is captured, workspace cleanup is attempted once, cleanup errors take
  precedence, and only then do final source fingerprint/database/archive checks
  run immediately before publication. A cleanup-window mutation test proves the
  final fingerprint remains after cleanup.
- Production defaults remain exactly 25,000 files, 32 GiB payload, 8 GiB per
  file, 36 GiB archive, 1024 UTF-8 path bytes, and depth 64.
- The follow-up diff contains only the three stated allowed paths.

### Review-Fix Residual Risks

The backup service returns a path and byte count rather than an already-open
handle, so a minimal pathname-to-open interval necessarily remains immediately
after `createDataBackup` returns. The code performs no intervening asynchronous
operation before opening the random archive path, then retains and validates
that descriptor through publication. Eliminating that final interval would
require a backup-service interface change outside Task 4's allowed files.

Maximum-valid hashing remains intentionally expensive at the unchanged 32 GiB
payload, 8 GiB file, 36 GiB archive, and 1,600,001-entry tree limits. A process
termination before final cleanup can leave a random sibling archive in the
system temporary directory, as the prior in-workspace layout could leave its
workspace; normal success and handled failures verify deletion.

The immutable resulting follow-up commit SHA is reported in the final handoff.
Embedding it in this tracked report would change the commit object and produce
a different SHA.

## Architecture Fix: Trusted Rollback Result

Architecture-fix date: 2026-07-22

Architecture-fix base: `943d6a23e5d1ac3024b4bf888571cddce24c4a39`

Required follow-up subject: `fix: bind rollback evidence to trusted result`

This section supersedes the pathname-authority and hard-link publication model
described by the earlier review-fix sections. Files under
`artifacts/rollback-drill/` are now append-only diagnostics only. They cannot
authorize a drill, checkpoint, CI run, or release.

### Architecture Findings Addressed

- `executeRollbackDrill` retains the canonical v3 evidence object and exact
  serialized UTF-8 bytes in process. Workspace cleanup, retained archive and
  database closure, and standalone archive deletion all complete before any
  diagnostic is written or a result is returned. A checkpoint close failure
  therefore produces neither a diagnostic PASS nor an authoritative result.
- Success emits exactly one bounded
  `LOCALMINIDRAMA_ROLLBACK_RESULT_V1=<canonical-base64url-envelope>` line. The
  exact envelope schema binds the evidence bytes, their lowercase SHA-256, and
  the generation-specific diagnostic relative path. Node stream validation is
  strict for UTF-8, base64url canonicality, JSON shape/order, evidence schema,
  types, version, commit, input mode, digest, and all size limits.
- Diagnostics use unpredictable `summary-v3-<commit>-<random>.json` names and
  `wx+` creation. Each file is written, synced, and proved through its retained
  descriptor and pathname without rename, link, unlink, overwrite, ownership
  claims, or contested cleanup. Existing fixed, v1, v2, and v3 files remain
  byte-for-byte untouched. A raced or partial diagnostic fails the operation
  and is left non-authoritative.
- The in-memory staging hook receives only a copied evidence buffer and mode,
  with no mutable publication path. Exact evidence bytes are rebound after the
  diagnostic publisher returns, so publisher-side object mutation is rejected.
  Same-size mutation at the former `afterCommit` boundary can only affect an
  unrelated legacy diagnostic and cannot affect result authority.
- Executor catches use explicit `hasOperationError`, `hasPrimaryError`, and
  cleanup sentinels. Exact `undefined`, `null`, `0`, and `''` failures win over
  every later cleanup failure. A close callback consumes its handle before it
  runs and directly closes on callback failure, preventing a closed handle from
  being retried as a spurious `EBADF` cleanup failure.
- Cleanup details use `util.types.isProxy` before descriptor inspection.
  Existing details are read only from an own data descriptor; Proxy containers,
  accessors, non-arrays, holes, and entries after index 7 are never evaluated.
  The exact primary value is never replaced.
- CI and release pipe the live anonymous drill stream through the bounded Node
  validator while `tee` retains diagnostic logs. Neither workflow reopens
  `summary.json` or any generation diagnostic to establish success.
- Windows checkpoint creation captures the drill output in memory, requires one
  bounded canonical marker under both Windows PowerShell 5.1 and PowerShell 7,
  verifies strict UTF-8 and SHA-256, parses the exact captured evidence, and
  runs `Assert-CheckpointDrillEvidence`. It atomically publishes those exact
  bytes to `checkpoint/rollback-drill-summary.json`, immediately opens a
  `RollbackFileAuthority`, proves exact bytes, hashes through the retained
  authority, and holds it through v5 metadata publication. The summary
  authority is disposed before the checkpoint directory lock.

### Architecture RED Evidence

The initial Node architecture tests were added before Node production changes:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback result|diagnostic publication is append-only|executor closes every|checkpoint close failure occurs|executor preserves every falsey|executor cleanup attachment|stderr rendering' scripts\rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 84 total, 0 passed, 26 failed, 58 skipped. The
failures were the intended missing result-marker API/CLI, destructive fixed
publication behavior, pre-close publication, falsey error swallowing, and
hostile cleanup-detail reads.

The checkpoint parser and live workflow tests were then added before changing
the PowerShell consumer or workflows:

```powershell
$env:LMD_PWSH_EXE='C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint result marker parser|CI isolated rollback workflow|release rollback workflow' scripts\release-contract.test.cjs
```

Exit code: `1`. Tests: 103 total, 0 passed, 3 failed, 100 skipped. Windows
PowerShell rejected the missing marker parser, and both workflows still used a
heredoc that reopened `artifacts/rollback-drill/summary.json`.

Final self-review found a publisher-side in-memory mutation edge. Its focused
test failed before the rebind was added:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='diagnostic publisher that mutates|former afterCommit boundary' scripts\rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 58 total, 1 passed, 1 failed, 56 skipped. The former
`afterCommit` same-size mutation control already passed; the injected publisher
could still mutate the returned evidence object without rejection.

### Architecture GREEN Verification

The final complete rollback contract:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts\rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 96 passed, 0 failed, 0 skipped, including the hostile
container extension covering primary Proxies, Proxy cleanup containers,
non-array accessor containers, and a ten-million-slot sparse array without
reading beyond index 7.

Checkpoint parser and workflow focus after implementation:

```powershell
$env:LMD_PWSH_EXE='C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint result marker parser|CI isolated rollback workflow|release rollback workflow' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 103 total, 3 passed, 0 failed, 100 skipped.

The two-host checkpoint fake toolchain, including a malicious repo diagnostic
and missing, duplicate, malformed, and oversized marker cases:

```powershell
$env:LMD_PWSH_EXE='C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 105 total, 3 passed, 0 failed, 102 skipped. The
checkpoint summary and metadata derived only from stdout bytes, the summary
authority blocked write/delete/rename through metadata publication and failure
recovery, and all invalid markers failed before metadata.

The existing bind-identity checkpoint harness, converted to stdout authority:

```powershell
$env:LMD_PWSH_EXE='C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint proves the captured container sees exact locked-root bytes' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 159 total, 57 passed, 0 failed, 102 skipped.

The full release suite was run once after every focused gate was green:

```powershell
$env:LMD_PWSH_EXE='C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
npm run test:release
```

Exit code: `0`. Tests: 197 passed, 0 failed, 0 skipped. TAP duration was
576.6 seconds and command wall time was 578.8 seconds.

Pinned Node.js 20 syntax checks passed for both implementation files and both
contract files. The checkpoint script parsed successfully under Windows
PowerShell 5.1 and PowerShell 7.6.4. `git diff --check` returned exit code `0`;
Git emitted only the checkout's LF-to-CRLF notices.

### Architecture-Fix Changed Files

- `scripts/rollback-drill-evidence.cjs`
- `scripts/run-rollback-drill.cjs`
- `scripts/rollback-drill-contract.test.cjs`
- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `docs/quickstart.md`
- `.superpowers/sdd/rollback-security-task-4-report.md`

### Architecture-Fix Self-Review

- Production publication contains no `link`, `rename`, `unlink`, ownership
  claim, temporary-path callback, or fixed-path replacement logic.
- The authoritative bytes cross Node consumers only through the live stdout
  marker and cross into the checkpoint only through the captured byte array.
  Reopening a repo diagnostic cannot authorize any consumer.
- Every pre-result resource cleanup runs before diagnostics. Every falsey
  operation, cleanup-only, staging, close, and publication failure remains an
  exact rejection.
- File diagnostics and legacy files are never removed or moved. A failed
  diagnostic may remain for investigation but cannot be mistaken for PASS.
- The checkpoint summary is opened once after atomic no-overwrite publication;
  its retained handle proves bytes and digest and denies write/delete sharing
  until metadata publication has completed.
- Workflow `pipefail` preserves failures from the drill, `tee`, or validator;
  diagnostic files and complete logs remain uploadable artifacts.

### Architecture-Fix Residual Risks

Same-permission processes may modify generation diagnostics after their proof;
this is intentional because those files are explicitly non-authoritative.
Abrupt process termination can leave a partial generation diagnostic or a
standalone temporary archive, while handled success and failure paths perform
all required closure and cleanup. The checkpoint's authoritative summary is
protected by Windows file sharing authority through metadata publication and
is subsequently governed by the existing v5 checkpoint controls.

The immutable resulting commit SHA is reported in the final handoff. Embedding
it in this tracked report would change the commit object and produce a
different SHA.

## Review Fix 3: Publication Lifecycle Remediation

Review-fix date: 2026-07-22

Review-fix base: `db9dab6aa64f7611c289f67db66bd4cae45a74e0`

Required follow-up subject: `fix: publish rollback evidence after cleanup`

### Review-Fix Initial State

`git rev-parse HEAD` matched the required base exactly. The worktree presented
to this review-fix turn already contained partial changes in the two allowed
paths `scripts/rollback-drill-contract.test.cjs` and
`scripts/rollback-drill-evidence.cjs`. Those changes were inspected against
HEAD, corrected where their checkpoint ordering conflicted with the brief, and
incorporated. No out-of-scope path was changed.

### Review-Fix RED Evidence

The inherited lifecycle tests were run before executor changes and produced
seven expected failures. The checkpoint expectation was then corrected to keep
archive authority through the PASS link, and direct transaction compensation,
standalone close, archive deletion, strict error identity, and stale-temp
coverage were completed before production implementation.

The retained aligned RED command was:

```powershell
npx --yes node@20 --test --test-name-pattern="publication transaction|authoritative through PASS|after-commit close|staged publication|operation error|standalone exact boundary|after final archive hash|standalone close failure|archive deletion failure|final fingerprint" scripts/rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 48 total, 1 passed, 9 failed, 38 skipped by the
pattern. The expected failures covered unsupported `afterCommit` compensation,
checkpoint authority/closure ordering, standalone cleanup before linking,
post-final-hash mutation detection, and primary-versus-cleanup error identity.

### Review-Fix Implementation

- Final standalone database and archive hashes now complete before the final
  data-root fingerprint. Only retained descriptor/path identity checks,
  evidence construction, staging, cleanup callbacks, and the publication link
  follow that fingerprint.
- `publishEvidence` accepts validated `onStaged`, `beforeCommit`, and
  `afterCommit` callbacks. It records the synced unpredictable temp's physical
  identity, links PASS, removes the temp name, and compensates an `afterCommit`
  failure by unlinking the output only if it is still the staged inode.
- Standalone `beforeCommit` exhaustively closes both retained handles, removes
  the generated archive, and verifies its absence before PASS can be linked.
- Checkpoint-bound `afterCommit` keeps the archive descriptor authoritative
  through the link. A close failure removes the just-linked owned PASS before
  the exact close error is rethrown.
- Operation, verification, and publication errors retain strict object
  identity when later cleanup also fails. Up to eight later cleanup errors are
  attached as a non-enumerable frozen `cleanupErrors` array when the error
  object permits it. A cleanup-only failure throws the original cleanup error.

### Review-Fix GREEN Verification

Final focused lifecycle gate using the retained RED command:

Exit code: `0`. Tests: 48 total, 10 passed, 0 failed, 38 skipped by the
pattern.

Complete rollback drill contract:

```powershell
npx --yes node@20 --test scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 67 passed, 0 failed, 0 skipped.

Complete release contract with portable PowerShell 7.6.4 added to `PATH`:

```powershell
$env:PATH = (Join-Path $env:TEMP 'codex-pwsh-7.6.4') + [IO.Path]::PathSeparator + $env:PATH
npx --yes node@20 --test scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 196 passed, 0 failed, 0 skipped. Wall time was 528.8
seconds; TAP duration was 526.0 seconds.

Pinned Node syntax checks for all three JavaScript Task 4 files returned exit
code `0`. `git diff --check` returned exit code `0` with only the checkout's
existing LF-to-CRLF warnings.

### Review-Fix Changed Files

- `scripts/run-rollback-drill.cjs`
- `scripts/rollback-drill-evidence.cjs`
- `scripts/rollback-drill-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-4-report.md`

### Review-Fix Self-Review

- The order trace proves both expensive final standalone hashes precede the
  final fingerprint, retained identities remain valid afterward, standalone
  cleanup precedes the link, and checkpoint archive authority spans the link.
- Mutation of `story_sources` after the final archive hash is detected by the
  last fingerprint and leaves neither PASS nor a transaction temp.
- Standalone close and archive-delete failures happen while only the staged
  temp exists; both block the link and clean the temp. Checkpoint close failure
  happens after link and removes the owned PASS before returning failure.
- Compensation compares descriptor-grade `dev` and `ino` identity and therefore
  does not delete an unrelated file that replaces the linked output during a
  failing callback.
- Cleanup details are bounded and non-enumerable. Primary publication and
  verification errors remain reference-equal after workspace, handle, or
  archive cleanup failures.
- The bounded hashing interfaces, normalized immutable limits object, and
  production default values are unchanged.

### Review-Fix Residual Risks

As before, abrupt process termination before standalone `beforeCommit` may
leave the random sibling archive in the system temporary directory. Normal
success and handled failures close retained handles and verify archive removal.
In checkpoint mode, termination after the PASS link naturally releases the OS
archive handle; no compensating unlink is needed because the evidence was
already verified and durably linked.

There remains an intentionally short concurrent-mutation window after the final
data-root fingerprint while quick retained-identity checks, evidence staging,
cleanup callbacks, and the hard-link transition complete. The remediation
moves the potentially 44 GiB of final retained hashing before that fingerprint
and adds no expensive hash or fingerprint work afterward.

The immutable resulting follow-up commit SHA is reported in the final handoff.
Embedding it in this tracked report would change the commit object and produce
a different SHA.

## Review Fix 4: Publication Ownership Races

Review-fix date: 2026-07-22

Review-fix base: `f2e927ffa2dda884dc413417037910be4d4eb145`

Required follow-up subject: `fix: close rollback publication ownership races`

### Findings Addressed

- The staged evidence pathname is now moved atomically to an unpredictable
  same-directory ownership claim after all pre-commit callbacks. The claimed
  inode must match the post-write descriptor's `dev` and `ino`. An authoritative
  read handle then proves exact size, complete bytes, descriptor identity, and
  claimed-path identity against the serialized evidence buffer immediately
  before the hard-link commit and remains authoritative through that link.
  Inode replacement and in-place mutation are both rejected without publication.
- Temporary cleanup and after-commit PASS compensation both atomically move the
  currently named inode to an ownership claim before inspecting it. Owned files
  are deleted only from the claimed name. Unrelated regular-file replacements
  are hard-linked back to their original path before the private claim is
  removed, eliminating the prior target-path check/unlink interval. Non-regular
  replacements are detected before a claim and remain untouched at their
  original temporary or output pathname.
- Publication tracks `hasPrimaryError` independently of the thrown value.
  Rejections with `undefined`, `null`, `0`, and `''` remain exact failures and
  still execute PASS compensation.
- Existing `cleanupErrors` are read only from an own data property. At most
  eight own array data entries are inspected and copied; accessors, sparse
  holes, non-array containers, and entries beyond the cap are not evaluated.
  Attachment failure cannot replace the exact primary error.

### RED Evidence

The deterministic security regressions were added before production edits and
run with pinned Node.js 20:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='publication rejects a staged|callback failure cleanup|old check-unlink boundary|falsey after-commit|cleanup error attachment' scripts\rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 59 total, 1 passed, 10 failed, 48 skipped by the
pattern. The expected failures were:

- replaced staged bytes were published instead of rejected;
- callback-failure cleanup deleted the unrelated temporary-path replacement;
- compensation deleted a replacement installed after its old identity check;
- all four falsey after-commit rejections were swallowed and left PASS; and
- accessor and ninth-entry reads replaced the exact primary error.

The hostile non-array control passed while the vulnerable implementation was
still present, confirming it did not depend on iterable behavior.

Controller static self-review then identified same-inode content mutation and
non-regular replacement preservation as uncovered edges. Their tests were also
added before the follow-up production edits:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='same-size in-place mutation|non-regular temporary-path replacement|non-regular output replacement' scripts\rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 58 total, 0 passed, 3 failed, 55 skipped by the
pattern. Same-size in-place mutation published successfully, while temporary
and output directory replacements were moved away from their original paths.

### GREEN Verification

The same focused lifecycle/publication command after implementation:

Exit code: `0`. Tests: 59 total, 11 passed, 0 failed, 48 skipped by the
pattern.

Final cumulative publication-security focus:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='publication rejects a staged|same-size in-place mutation|callback failure cleanup|old check-unlink boundary|non-regular output replacement|falsey after-commit|cleanup error attachment' scripts\rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 62 total, 14 passed, 0 failed, 48 skipped by the
pattern. The three-edge follow-up alone passed 3 of 3 tests.

Complete rollback drill contract:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts\rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 81 passed, 0 failed, 0 skipped.

Pinned Node.js 20 syntax checks:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --check scripts\run-rollback-drill.cjs
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --check scripts\rollback-drill-evidence.cjs
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --check scripts\rollback-drill-contract.test.cjs
```

Exit codes: `0`, `0`, `0`.

```powershell
git diff --check
```

Exit code: `0`. Git emitted only the checkout's existing LF-to-CRLF warnings.

### Review-Fix Changed Files

- `scripts/rollback-drill-evidence.cjs`
- `scripts/rollback-drill-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-4-report.md`

### Review-Fix Self-Review

- No target pathname is checked and then unlinked. Every potentially destructive
  cleanup first atomically claims the currently named inode with `rename`.
- The staged inode is claimed and re-bound after callbacks, with no callback or
  unrelated asynchronous work between exact content verification and `link`.
- The expected bytes are serialized once. The post-sync descriptor length and
  the claimed descriptor's complete bytes must match that bounded buffer; an
  extra-byte probe, after-read descriptor check, and claimed-path check close
  growth, truncation, same-size mutation, and pathname replacement cases.
- A claimed unrelated replacement is restored through a no-overwrite hard link;
  restoration failure fails closed instead of deleting either the replacement
  or a competing target.
- Directory and other non-regular replacements are never moved into a claim;
  deterministic callback replacement at both temporary and output paths keeps
  its original pathname and contents after rejection.
- PASS compensation runs for every caught primary value, including all falsey
  JavaScript values, and preserves unrelated output bytes at `summary.json`.
- Cleanup detail collection allocates no array proportional to attacker-owned
  length and never invokes a `cleanupErrors` property or element accessor.
- Existing hashing, fingerprinting, evidence validation, callback order, and
  `run-rollback-drill.cjs` behavior are unchanged.

### Review-Fix Residual Risks

Ownership claims use 128 bits of cryptographic randomness in the validated
evidence directory. As with other pathname transactions, abrupt process
termination can leave a private claim behind; normal success and handled
failure paths exhaustively release owned claims. Restoring an unrelated regular
inode requires it to be hard-linkable, which holds for the evidence-file
replacement contract. A concurrent regular-to-non-regular type swap in the
narrow, callback-free interval between the non-regular gate and atomic claim
fails closed with the object preserved under the private claim rather than
deleting it; ordinary non-regular replacements remain at the original path.

The immutable resulting follow-up commit SHA is reported in the final handoff.
Embedding it in this tracked report would change the commit object and produce
a different SHA.
