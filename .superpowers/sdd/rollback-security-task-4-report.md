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
