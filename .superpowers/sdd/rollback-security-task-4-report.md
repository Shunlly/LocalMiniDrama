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

## Review Fix 5: Result Authority And Cleanup Proof

Review-fix date: 2026-07-22

Implementation base: `8f4dc3dfa1270a82f72e9417c7395a9666f1e706`

Cumulative Task 4 review base:
`25c869dfb39e87251c76bcd9fb849926cd7c98dd`

Required follow-up subject: `fix: close rollback result authority gaps`

### Findings Addressed

- Checkpoint summary publication no longer moves a temporary file and then
  reopens the final path. The final path is created once with
  `FileMode.CreateNew`, `FileAccess.ReadWrite`, and `FileShare.Read`; that same
  retained stream writes, durably flushes, verifies exact bytes and identity,
  supplies the digest, and remains open through v5 metadata publication.
- The checkpoint runs the Node drill through the bounded native-process helper.
  Stdout and stderr are drained into independent fixed-size buffers. Only the
  exact stdout byte array is sent through stdin to the Node result validator;
  PowerShell parses that same in-memory byte array only after Node acceptance.
  Stderr markers are diagnostic text and cannot authorize PASS.
- CI and Release retain `pipefail`, keep stdout in the validator pipeline, and
  drain stderr through a separate 256 KiB diagnostic process. They upload
  distinct stdout and stderr logs and reject stderr truncation.
- Strict Node UTF-8 decoding preserves a BOM as input data. Explicit stream,
  envelope, and evidence canonical checks reject BOM-prefixed results. v3
  validation also requires the exact complete proof object shape before any
  consumer can accept the marker.
- Data-root hashing now performs a final reverse-order persistent identity check
  of every regular file after all content reads and before directory/root final
  checks. An earlier file changed while a later large file is read is rejected.
- Every drill workspace contains a synced random marker with a retained handle,
  plus a retained workspace directory handle. Cleanup verifies marker/path
  identity, unlinks the marker, requires the original marker link count to reach
  zero, removes the workspace, and requires the original directory link count
  to reach zero before PASS.
- A standalone archive is removed while its retained archive handle is still
  open. Its path must still identify the retained inode before removal and the
  original inode must have zero links afterward; only then is the handle closed
  and evidence publication allowed.
- The real-acceptance plan now treats repository evidence files as append-only
  diagnostics. Standalone acceptance consumes only the bounded live stdout
  machine result, while checkpoint acceptance consumes the retained summary in
  the external checkpoint.

### Reconstructed Independent RED Proof

The original implementer did not leave a usable RED transcript. To avoid
inventing one, the controller created a temporary detached worktree at the exact
implementation base, applied only the two contract-test diffs, linked the
already-installed package dependencies, and ran the focused regressions against
the old production implementation. The temporary worktree and TAP files were
then removed.

Rollback regression command:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-concurrency=1 --test-name-pattern='data root fingerprint rechecks earlier|workspace cleanup rejects|standalone archive cleanup rejects|rollback result parser rejects' scripts\rollback-drill-contract.test.cjs
```

Exit code: `1`. Tests: 62 total, 0 passed, 5 failed, 57 skipped. The old
implementation failed to reject the early-file mutation, moved workspace,
replaced marker, moved retained standalone archive, and BOM-prefixed result.

Release regression command:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-concurrency=1 --test-name-pattern='checkpoint summary is created|checkpoint native reader returns|release rollback checkpoint fake toolchain|CI isolated rollback workflow|release rollback workflow|rollback acceptance plan never' scripts\release-contract.test.cjs
```

Exit code: `1`. Tests: 108 total, 0 passed, 8 failed, 100 skipped. Both
PowerShell-host fake-toolchain rows failed, together with the direct summary,
bounded native reader, CI workflow, Release workflow, and acceptance-plan
contracts.

### GREEN Verification

The same focused rollback command on the implementation exited `0`: 62 total,
5 passed, 0 failed, 57 skipped.

The same focused release command on the implementation exited `0`: 108 total,
8 passed, 0 failed, 100 skipped. This includes the Windows PowerShell 5.1 and
PowerShell 7 fake-toolchain rows.

Complete rollback contract:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-concurrency=1 scripts\rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: 100 passed, 0 failed, 0 skipped. Windows emitted the
existing best-effort reparse-fixture diagnostic because the host refused that
optional file fixture with `EPERM`; the executable junction coverage and all
assertions still ran successfully.

Complete release contract:

```powershell
$env:LMD_PWSH_EXE='C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
npm run test:release
```

Exit code: `0`. Tests: 200 passed, 0 failed, 0 skipped. TAP duration was
610.4 seconds; command wall time was 610.8 seconds.

Pinned Node 20 syntax checks passed for both production JavaScript files and
both contract files. `create-release-rollback-checkpoint.ps1` parsed with zero
errors under Windows PowerShell 5.1 and PowerShell 7.6.4. `git diff --check`
exited `0`; Git emitted only the checkout's LF-to-CRLF notices.

### Changed Files

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `docs/superpowers/plans/2026-07-20-rollback-evidence-binding.md`
- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`
- `scripts/rollback-drill-contract.test.cjs`
- `scripts/rollback-drill-evidence.cjs`
- `scripts/run-rollback-drill.cjs`
- `.superpowers/sdd/rollback-security-task-4-report.md`

### Self-Review

- No checkpoint consumer reopens a repository diagnostic or summary path to
  establish authority. The checkpoint summary authority is the stream that
  created and flushed the final file.
- Captured stdout is allocated at no more than 2 MiB and stderr at no more than
  256 KiB for the drill and validator calls. Both streams continue draining
  after their retained buffers fill, so a child cannot deadlock the parent by
  filling the discarded diagnostic tail.
- The Node validator receives exactly the captured stdout bytes and emits no
  authority of its own. PowerShell's subsequent parser consumes the identical
  byte array, not reconstructed lines or a file.
- Cleanup failures, including falsey thrown values and hostile cleanup-detail
  containers, retain the exact pre-existing primary precedence and block
  diagnostic publication.
- The final file recheck is intentionally reverse ordered, leaving no expensive
  content read after an early file's final persistent identity check.
- Workspace and standalone archive proofs retain the original objects through
  deletion and require their link count to reach zero. A visible replacement or
  displacement fails before PASS and is covered by deterministic tests.

### Residual Trust Boundary

These controls prove local invocation-time consistency; they are not a global
filesystem snapshot. A same-permission process can still race after an object's
last stat, cause denial of service, or mutate protected source data after the
drill returns. The reverse final check closes the reviewed long-read mutation
window, while later concurrent mutation remains inside the protected-data-root
and operator process trust boundary.

Node exposes no portable handle-directed recursive directory deletion API. The
cleanup path therefore verifies retained identity immediately before pathname
removal and original link count immediately afterward. Visible replacement or
movement fails closed, but an actively malicious same-permission process can
still race pathname operations, delete the original itself, or cause collateral
cleanup failure. Administrator/SYSTEM access and process injection remain out
of scope. No claim of malicious-at-rest authenticity or creator identity is
made.

An abrupt process or host termination may leave an incomplete checkpoint
summary, workspace, archive, or diagnostic record. A checkpoint summary is not
release-authoritative without the later v5 metadata, and repository diagnostics
are never authoritative. Normal handled success and failure paths perform all
retained-handle proofs and cleanup described above.

The immutable resulting commit SHA is reported in the handoff rather than
embedded in this tracked report.

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
- Superseded historical note: this section originally described opening the
  checkpoint summary after a no-overwrite publication. The final Review Fix 5
  at the end of this report replaces that model with direct final-path
  `FileMode.CreateNew` creation through one retained read/write authority.
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

## Review Fix 5: Final Direct Authorities And Bounded Workflow Pumps

Review-fix date: 2026-07-22

Cumulative Task 4 review base:
`25c869dfb39e87251c76bcd9fb849926cd7c98dd`

### Findings Addressed

- Both `rollback-drill-summary.json` and `metadata.json` are created directly at
  their final path with `FileMode.CreateNew`. The same retained read/write
  authority writes, durably flushes, verifies exact bytes and final-path
  identity, and remains open through its required trust boundary. There is no
  move, close, or pathname reopen between creation and authorization.
- Native stdout and stderr reads start before asynchronous stdin pumping. All
  three streams and process completion share one deadline; timeout terminates
  the process tree and closes stdin without allowing a blocked pipe write to
  bypass the deadline.
- CI and release wrap the rollback drill with a bounded main-command timeout,
  fully write every retained stderr slice, and bound stderr-drainer shutdown.
  Drill, `tee`, validator, truncation, and inherited-writer failures all remain
  independently observable and fail the workflow.
- Workspace marker, workspace tree, and standalone archive cleanup now claim
  a pathname atomically before deletion and verify the private claim against
  the retained original handle. Unrelated replacements remain preserved.

### Supersession

Any earlier wording in this report that describes temporary-file movement or
opening a final pathname after publication is historical evidence only. This
section is the current Task 4 authority and cleanup model.

## Review Fix 6: Native Platform Containment

Review-fix date: 2026-07-22

Cumulative Task 4 review base:
`25c869dfb39e87251c76bcd9fb849926cd7c98dd`

### Findings Addressed

- Windows launches the checkpoint child suspended, assigns it to a
  kill-on-close Job Object, and only then resumes it. Timeout terminates the
  complete job and waits for zero active processes. Bounded native pipes cover
  stdout, stderr, and stdin under one deadline.
- Windows marker, workspace, and archive claims are removed through retained
  handles on NTFS/ReFS. Replacement identities and cross-type replacements are
  preserved instead of being deleted by a later pathname operation.
- POSIX cleanup is permitted only inside an actual Docker container carrying
  the launcher marker. The fixed-digest Node 20 slim container has no network,
  no capabilities, no privilege escalation, a read-only root and source/data
  mounts, and a private tmpfs owned by the selected UID/GID. Only the validated
  repository diagnostic directory is writable, and symbolic-link components
  are rejected before Docker starts.
- The Linux host proves a clean Git tree and full commit before launch. The
  commit is passed explicitly to the container; a successful child is accepted
  only after the host proves the same clean revision again. This avoids relying
  on unavailable or checkout-dependent Git LFS filters inside the container.
- Before Docker starts, the host proves the backend port is stopped and holds a
  service maintenance guard for the source data root. The random lease is
  validated from the read-only mount before source capture, before archive
  publication, and after publication. Wrong or mutated leases fail closed, and
  normal Docker success or failure releases the host guard.

### RED Evidence

- A real fixed-image probe using `mode=700` tmpfs plus an unprivileged UID
  failed `mkdtemp('/tmp/...')` with `EACCES`.
- The original slim image had no Git; the larger official image had Git but no
  Git LFS. A real read-only repository probe failed with
  `git-lfs filter-process: git-lfs: not found`. Disabling the filter marked the
  Windows/CRLF checkout broadly dirty, so it could not be an authority.
- The executable fake-Docker test initially accepted a listening host service
  and started Docker with status zero.
- The diagnostic symlink regression initially failed because no physical
  diagnostic-directory boundary function existed.
- The executor lease-forwarding regression received `undefined`, and the
  backend external-lease test had no API capable of using the host guard with a
  read-only source mount.

### GREEN Verification

Fixed Node 20 Linux rollback contract, including executable launcher, active
host-service rejection, host source proof, private cleanup, and lease transfer:

```powershell
docker run --rm --volume "${PWD}:/workspace" --volume lmd-task4-node20-deps:/workspace/backend-node/node_modules --workdir /workspace node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 node --test scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: `111` passed, `0` failed, `6` platform skips.

Fixed Node 20 Linux backup/restore contract with the external lease success,
mismatch, and mutation regressions:

```powershell
docker run --rm --volume "${PWD}:/workspace" --volume lmd-task4-node20-deps:/workspace/backend-node/node_modules --workdir /workspace/backend-node node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 node --test --test-concurrency=1 test/dataBackupService.test.js
```

Exit code: `0`. Tests: `46` passed, `0` failed, `0` skipped.

Fixed Node 20 Windows rollback contract:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts\rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: `120` passed, `0` failed, `3` Linux-only skips.
The optional Windows symbolic-link fixture remained unavailable because this
host denied link creation with `EPERM`; file/directory and every cross-type
replacement case passed.

Node 20 syntax checks for the backend service, launcher, drill, and rollback
contract all exited `0`. `git diff --check` exited `0` with only existing
LF-to-CRLF checkout warnings.

### Review-Fix Changed Files

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.superpowers/sdd/rollback-security-task-4-report.md`
- `backend-node/src/services/dataBackupService.js`
- `backend-node/test/dataBackupService.test.js`
- `docs/quickstart.md`
- `package.json`
- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`
- `scripts/remove-rollback-owned-path.ps1`
- `scripts/rollback-drill-contract.test.cjs`
- `scripts/run-rollback-drill-launcher.cjs`
- `scripts/run-rollback-drill.cjs`

### Residual Risks And Deferred Gates

- A same-permission process that can rewrite and restore the source checkout,
  replace the maintenance lease with identical bytes, or control Docker is
  outside the stated threat model. The ordinary edit case is covered by the
  host pre/post clean-revision proof.
- Administrator/SYSTEM injection and Docker-daemon compromise remain outside
  the boundary. An uncatchable host termination can leave the maintenance
  lease; the documented inspected recovery command remains required.
- The real clean-tree Linux container drill must run after this change is
  committed, because the drill intentionally rejects an uncommitted source
  tree. The final release suite and all same-SHA Docker/checkpoint/restore gates
  remain required before release and are not claimed by this section.

## Review Fix 7: Lease Identity And Interrupt-Safe Container Cleanup

### Independent Finding Intake

The next independent security review reported `Critical 0 / Important 3 /
Minor 1`:

1. The external service lease compared copyable JSON fields but did not bind
   the original lock inode or require a fresh heartbeat.
2. A signal could terminate the synchronous Docker CLI without proving that
   the daemon-owned container had stopped before the host lease was released.
3. `AssignProcessToJobObject` failure could leave the newly created suspended
   process outside the Job Object.
4. The Linux operator prerequisites did not name Git, Git LFS, and installed
   backend dependencies.

### RED Evidence

- The external-lease identity test first received the v1 lease schema and had
  no `device` or `inode` fields.
- The hardened Linux invocation test first failed because `--cidfile`,
  `--label`, and `--name` were absent.
- The Windows native bridge source test first failed because it had no direct
  `TerminateProcess` fallback or injected assignment-failure probe.
- The CI/release workflow contract first failed because it had no container
  ownership environment or EXIT cleanup and still used a five-second TERM to
  KILL grace period.

### Implementation

- External maintenance leases now use
  `localminidrama.maintenance-lease.v2`, bind canonical decimal `dev`/`ino`,
  compare the current path to that identity at every backup checkpoint, and
  require valid, ordered, non-future, non-stale `createdAt`/`heartbeatAt`
  values. Service-lock release checks descriptor and path identity before and
  after closing the descriptor, so a replacement path is preserved.
- The Linux launcher now runs Docker asynchronously while a service heartbeat
  remains live. It owns a 128-bit random container name and label plus a
  private CID file, catches SIGINT/SIGTERM, terminates the CLI with a bounded
  escalation, and uses bounded Docker list/stop/kill/rm commands. It requires
  a delayed final empty-label observation before releasing the service guard.
  If cleanup cannot be proven after a launch attempt, it abandons the runtime
  guard while retaining the persistent lock for inspected recovery.
- CI and release workflows supply the same private CID/name/label contract,
  repeat bounded daemon cleanup in EXIT/INT/TERM paths, and allow 30 seconds
  between TERM and KILL. The outer pipeline bound is 760 seconds so the
  720-second drill has time to complete its cleanup proof.
- The Windows bridge directly terminates an unassigned suspended process and
  waits at most two seconds for exit. Its injected assignment-failure test
  verifies the reported PID no longer exists under Windows PowerShell 5.1 and
  PowerShell 7.
- The operator guide now declares Docker, Git, Git LFS, and lockfile-installed
  backend dependencies, and documents lock identity, cleanup ordering, and
  fail-closed retained-lease recovery.

### GREEN Verification

Current Linux Node 20 rollback contract in the fixed slim image:

```powershell
docker run --rm --volume "${PWD}:/workspace" --volume "lmd-task4-node20-deps:/workspace/backend-node/node_modules" --workdir /workspace node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 node --test scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: `113` passed, `0` failed, `6` platform skips.

Current Linux Node 20 backup/restore contract:

```powershell
docker run --rm --volume "${PWD}:/workspace" --volume "lmd-task4-node20-deps:/workspace/backend-node/node_modules" --workdir /workspace/backend-node node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 node --test --test-concurrency=1 test/dataBackupService.test.js
```

Exit code: `0`. Tests: `48` passed, `0` failed, `0` skipped.

Current Windows rollback contract:

```powershell
node --test scripts/rollback-drill-contract.test.cjs
```

Exit code: `0`. Tests: `120` passed, `0` failed, `5` Linux-only skips.

The executable Linux workflow-shell contract passed in the full Node 20 image,
including drill, tee, validator, stderr truncation, inherited-writer, and
timeout propagation cases. The Windows injected Job assignment failure passed
under both required PowerShell hosts.

The complete Node 20 release contract then exited `0` with `205` passed, `0`
failed, and `1` platform skip. Node 20 syntax checks and `git diff --check`
also exited `0`; the credential endpoint/key regression scan returned no
tracked or untracked repository matches.

### Remaining Gate

This section records implementation and controller verification, not the
independent final verdict. Two fresh reviewers must still report
`Critical/Important/Minor 0/0/0` on the final bytes. After commit, the real
clean-tree Linux `npm run verify:rollback` and same-SHA release gates remain
mandatory.

## Review Fix 8: Retain Workflow Control Evidence On Cleanup Failure

Review-fix date: 2026-07-22

### Finding Addressed

The CI and release EXIT paths correctly skipped container cleanup when the
rollback session could not be proven stopped, but they still removed the
pipeline control files whenever session cleanup alone succeeded. A later
container-cleanup failure therefore contradicted the emitted diagnostic that
control evidence remained. Both the trap path and the normal post-pipeline
path now remove the stderr FIFO, pipeline script, pipeline status, and control
directory only when session cleanup and container cleanup both succeed.

### RED And GREEN Evidence

The workflow contract first failed for both CI and release because their
cleanup predicates contained only the session status. After the workflow fix,
the same focused Node 20 command passed both selected tests:

```powershell
node --test --test-name-pattern='rollback workflow enforces standalone' scripts/release-contract.test.cjs
```

Exit code: `0`. Selected tests: `2` passed, `0` failed.

The executable Linux workflow-shell contract passed under the full Node 20
image with Docker `--init`. A control run without `--init` left an orphaned
test writer as a zombie owned by the container's Node PID 1, so Linux process
group liveness remained true until the outer harness timed out. Repeating the
same test with an init reaper passed in about four seconds. GitHub's Ubuntu
host has a normal init/reaper; this was a test-container boundary, not a
workflow behavior change.

### Final Controller Verification

- Linux Node 20 rollback contract: `114` passed, `0` failed, `6` platform
  skips.
- Linux Node 20 backend backup/restore contract: `52` passed, `0` failed.
- Windows Node 20 rollback contract: `121` passed, `0` failed, `5` Linux-only
  skips.
- Windows Node 20 complete release contract: `205` passed, `0` failed, `1`
  Linux-only skip (`206` total), in 681 seconds.
- Node 20 syntax checks passed for the drill, launcher, rollback contract,
  release contract, and backend backup service.
- `git diff --check` passed with only checkout line-ending warnings.
- The exact provided endpoint and credential had zero matches across Git
  tracked files and non-ignored untracked files. Ignored local runtime data was
  intentionally left untouched and is outside the commit scope.

### Remaining Gate

The two final independent reviews and the post-commit clean-tree rollback
drill remain mandatory. No Task 4 completion claim is made by this section.

## Review Fix 9: Public-Path Lease Proof And Signaled-Daemon Containment

Review-fix date: 2026-07-22

### Findings Addressed

The latest lifecycle and release-contract review pass identified the following
remaining failure modes:

1. Service heartbeat updated the retained descriptor without proving that the
   public maintenance-lock path still named that descriptor. Release swallowed
   claim, descriptor-close, restoration, and deletion failures.
2. A sibling claim pathname left a final check-then-delete window and could
   silently move a directory or link replacement away from the public lock
   path.
3. Docker `inspect` treated every nonzero result as absence. A signal-killed
   Docker CLI and the subsequent create/remove sentinel could not prove that a
   daemon request would not arrive after the sentinel was removed.
4. CI and release could delete control evidence after a nonzero drill or
   validator result when session/container cleanup happened to return zero.
5. Fingerprint handle-close failure could replace the read/identity primary
   error. Diagnostic directory creation followed ancestor links before the
   launcher validated the physical path.
6. The Windows native-command success path observed only the root process and
   stream EOF; a Job Object descendant could remain active when success was
   returned.
7. Backend failed-output compensation attached singular `cleanupError`, while
   downstream drill and launcher diagnostics consume bounded plural
   `cleanupErrors`.

### RED Evidence

- The displaced-public-lock heartbeat test timed out with no `heartbeatError`,
  and both replacement-boundary release tests observed a silent return.
- The fingerprint dual-failure fixture received the injected close error
  instead of the exact injected read error.
- The Docker inspect fixture received no exported fail-closed inspector, and
  the Linux delayed-request fixture could recreate owned state after the old
  sentinel sequence.
- The workflow validators rejected both cleanup predicates because execution
  status was absent from their evidence-removal conditions.
- After warming the native bridge, the Windows success-path fixture returned
  in under 250 ms while its 350 ms Job descendant was still active.
- The service descriptor-close fixture received the raw close failure instead
  of `MAINTENANCE_LOCK_RELEASE_FAILED`.

### Implementation

- Every service heartbeat now checks the retained descriptor and public path
  identity before and after the write. Loss or replacement records a deliberate
  lease error; external-lease issuance and release fail closed.
- Claims now use an unpredictable private sibling directory, validate that
  directory's identity, and preserve cross-type replacements for inspection.
  Release runs every close/restoration/removal step, surfaces a stable release
  error, and attaches at most eight cleanup details as a frozen non-enumerable
  `cleanupErrors` array. Failed-backup cleanup uses the same plural contract.
- The private directory and random name protect against other OS identities.
  A process executing as the same account can discover or alter that directory
  and remains inside the documented trusted-local-operator boundary; Node does
  not expose a portable atomic unlink-by-handle primitive, and this report does
  not claim otherwise.
- A failed Docker inspect now re-lists the captured CID and refuses cleanup
  authority while it still exists or Docker state is unavailable. Any child
  signal or host interruption makes Docker CLI completion unproven even when
  subsequent best-effort cleanup is empty. The launcher abandons the service
  guard and retains both the persistent lease and control evidence.
- CI/release delete their control files only when execution, stderr handling,
  session cleanup, and container cleanup all complete normally. Nonzero or
  signaled execution emits an explicit unproven-daemon diagnostic and retains
  evidence.
- Fingerprint closure now preserves the exact primary and attaches close
  failure non-enumerably. The Linux launcher creates each diagnostic directory
  component only after validating its parent and rejects links without first
  creating an external child.
- The Windows bridge now polls `ActiveProcesses` with a bounded condition wait
  on the success path. Query failure or a descendant that does not exit fails
  closed and enters the existing Job termination cleanup.

### Current Verification

- Backend complete test command: exit `0`.
- Windows rollback contract: `125` passed, `0` failed, `6` Linux-only skips
  (`131` total).
- Linux Node 20 delayed Docker request and diagnostic-link regression: `2`
  passed, `0` failed.
- Linux Node 20 executable workflow-shell contract: `1` selected test passed,
  `0` failed.
- Node 20 CI/release workflow validators: `2` selected tests passed, `0`
  failed.
- Windows PowerShell 5.1 and PowerShell 7 Job-descendant regression: both
  hosts passed.
- Node syntax checks, both PowerShell parsers, and `git diff --check`: exit
  `0`.
- The exact provided endpoint and credential have zero repository matches
  outside ignored local runtime data.

The latest complete Node 20 release-contract rerun then exited `0` after about
632 seconds: `206` passed, `0` failed, and `1` Linux-only test skipped (`207`
total including nested tests). Final independent `0/0/0` reviews and the
post-commit clean-tree rollback drill remain mandatory; Task 4 is not closed by
this section alone.

## Review Fix 10: Recovery-Lease Ownership And Durable Control Diagnostics

Review-fix date: 2026-07-22

### Independent Findings Addressed

The next independent review reported one Critical recovery-lease reclaim race,
one Important cross-type claim recovery issue, one Minor exit-hook isolation
issue, and one Important workflow-diagnostic gap:

1. A process could validate a stale recovery lease, lose the path to a newly
   created fresh lease, and then rename and delete that fresh lease.
2. A directory or link replacement moved at the atomic claim boundary remained
   only in the private claim while the public maintenance path disappeared.
3. One service-lock release error in the process exit hook prevented later
   runtime locks from being released.
4. CI and Release retained random container/session control evidence after a
   failure but did not upload the random directory, pipeline script, or pipeline
   status file before the runner was destroyed.

Controller self-review found and fixed the symmetric recovery-lease release
race before the complete backend gate: the old release path read a copyable
token and then removed the pathname without proving that it still named the
retained descriptor.

### RED Evidence

- The initial recovery-reclaim and exit-isolation focus exited `1`: the fresh
  replacement was silently deleted, and the old exit listener threw before it
  could release the second lock.
- The cross-type replacement focus exited `1` because the public maintenance
  path was absent after the directory was preserved in the private claim.
- The recovery-release focus exited `1` because a fresh replacement installed
  after the token read was deleted and release returned successfully.
- The CI workflow contract exited `1` first for the missing
  `rollback-container.*` upload, then again for the missing retained pipeline
  and status uploads.
- The first complete backend run exited `1` with `486` passed and `1` failed.
  It exposed a real Windows identity bug: the pre-claim `lstat` represented a
  large inode as a Number while the post-claim check used BigInt, so precision
  loss could misclassify the same inode as a replacement.

### Implementation

- Stale recovery leases are now moved through the same unpredictable private
  atomic claim used by service-lock release. The claimed inode must equal the
  exact BigInt identity that was validated; only that inode is removed. A fresh
  regular replacement is restored by no-overwrite hard link and causes
  `MAINTENANCE_ACTIVE`.
- Active recovery-lease release now binds the retained descriptor identity,
  atomically claims the public path, closes the descriptor, and removes only
  the claimed inode. Claim, close, restoration, and deletion failures use the
  bounded frozen non-enumerable `cleanupErrors` contract. Recovery operation
  failures remain primary when release also fails.
- Cross-type replacements remain preserved in the private `0700` claim because
  Node exposes no portable atomic no-overwrite rename for directories or links.
  The implementation instead creates a durable `wx` public quarantine marker
  containing only the private claim basename, entry name, replacement type, and
  `manual-inspection-required` contract. A competing public entry is never
  overwritten. The operator guide documents the exclusive manual recovery
  boundary.
- The process exit hook catches each release failure independently, continues
  through every runtime lock, and emits one bounded synchronous warning without
  changing an otherwise successful process exit.
- Both workflow upload steps now include the random
  `${{ runner.temp }}/rollback-container.*` directories plus the retained
  pipeline script and status file. Successful runs still delete these controls;
  failed or uncertain runs retain and upload them with the existing stdout,
  stderr, and generated diagnostics.

### Current Verification

- Focused recovery reclaim, recovery release, quarantine-marker, and exit-hook
  regressions: `4` passed, `0` failed.
- Focused CI/Release standalone rollback workflow validators: `2` passed, `0`
  failed.
- Complete backend test suite: `487` passed, `0` failed, `0` skipped.
- Complete Windows Node 20 rollback contract: `125` passed, `0` failed, `6`
  Linux-only skips (`131` total).
- Fixed-image Linux Node 20 rollback contract: `119` passed, `0` failed, `6`
  Windows-only skips (`125` total).
- Fixed-image Linux Node 20 backend backup/restore contract: `58` passed, `0`
  failed, `0` skipped.
- Backend package verification: `191` JavaScript files passed syntax/source
  checks; `487` tests passed; the backend flow audit completed with exit `0`.
- Complete Node 20 release contract across Windows PowerShell 5.1 and PowerShell
  7.6.4: `206` passed, `0` failed, `1` Linux-only skip (`207` total), in
  approximately 629 seconds.
- Pinned Node 20 backend syntax check and `git diff --check`: exit `0`.

The complete rollback/release contracts, independent re-review, and clean-SHA
real rollback drill remain mandatory. This section does not close Task 4.

## Review Fix 11: Pre-Backup Failure Cleanup

Review-fix date: 2026-07-22

The first clean-SHA `npm run verify:rollback` attempt at `5fcc14c` correctly
rejected the live Docker backend on port 5679, but also attached an unrelated
cleanup assertion: the standalone archive path had been selected before backup,
while no archive handle or link identity had ever been created.

### RED Evidence

A standalone executor regression injected the same pre-backup service failure.
It failed because the exact primary error acquired a `cleanupErrors` detail
claiming that standalone archive authority was missing, even though the archive
path did not exist and there was nothing to delete.

### Implementation

When both archive authority fields are absent, standalone final cleanup now
proves the unpredictable sibling archive path is absent and records cleanup as
complete. It does not relax partial-authority handling: if either authority
field exists, the complete retained pair is still mandatory. If any file,
directory, or link appears at the no-authority path, absence proof fails and the
entry is preserved rather than deleted.

### GREEN Verification

- Focused pre-backup failure regression: `1` passed, `0` failed; the exact
  service failure remained primary with no fabricated cleanup detail.
- Complete Windows Node 20 rollback contract: `126` passed, `0` failed, `6`
  Linux-only skips (`132` total).
- Fixed-image Linux Node 20 rollback contract: `120` passed, `0` failed, `6`
  Windows-only skips (`126` total).

The real rollback drill must be rerun from the follow-up clean commit with the
project backend stopped. The failed precondition attempt did not mutate the
source data and published no authoritative PASS result.
