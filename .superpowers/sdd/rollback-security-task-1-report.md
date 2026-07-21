# Rollback Security Remediation Task 1 Report

Date: 2026-07-22

Baseline: `ccdb85f1df999ec6c580fc77a000986d891aadb2`

## RED Evidence

The controller ran the prewritten tests before production changes with Node 20,
Windows PowerShell 5.1, and the required portable PowerShell 7 host:

```powershell
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback retained' scripts/release-contract.test.cjs
```

Exit code: `1`. The run produced the expected 9 failures: the two-host
authority cases could not find `Open-RollbackFileAuthority`, the two-host
directory cases could not bind the generalized `-Label` parameter, and the
two-host cleanup cases could not dot-source `rollback-powershell-support.ps1`.
The failing parent tests account for the other three failures. These tests were
retained as the Task 1 RED work and were not rewritten or erased.

## Implementation

- `scripts/rollback-path-identity.ps1` now opens regular non-reparse files with
  `CreateFileW`, retains the native handle in a readable `FileStream`, rechecks
  pathname identity, hashes the retained seekable stream with position
  restoration, and reads strict UTF-8 without closing the stream.
- `Open-RollbackArchiveReadLock` remains a compatibility wrapper over
  `Open-RollbackFileAuthority`. `Open-RollbackDirectoryIdentityLock` accepts a
  caller label while retaining `Rollback data root` as its default.
- `scripts/rollback-powershell-support.ps1` adds
  `Complete-RollbackInvocation`, which rethrows the original `ErrorRecord`,
  attaches ordered cleanup errors at `Exception.Data['RollbackCleanupErrors']`,
  and creates a cleanup-only failure when there is no primary error.
- Checkpoint creation retains the checkpoint-root and `configs` directory locks
  immediately after each directory is created. The pre-existing data-root and
  archive locks retain their original lifetime.
- Restore retains the checkpoint root, `configs`, and all eight fixed literal
  files before JSON parsing, text reading, or hashing. Validation reads use the
  retained streams, and each Docker, Compose, Node, or copy path consumer is
  preceded by an authority assertion.
- Both outer invocations own all handles. Cleanup disposes handles in reverse
  acquisition order and independently attempts every later environment and
  location cleanup action.

## Test Corrections

Two genuine test defects were corrected without reducing behavioral coverage:

- The pre-mutation gate assertion now distinguishes `locks:invoke:*` authority
  probes from destructive-stage lock probes. Unsafe tool commands, publication,
  location changes, and destructive probes remain forbidden at that gate.
- A stale source assertion requiring path-based hashing of
  `data-bind-source.txt` now requires retained-authority hashing and UTF-8
  reading, matching the Task 1 contract.

## GREEN Verification

All commands used the Node 20 and PowerShell environment shown in the RED
section.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback retained' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 99 total, 9 passed, 0 failed, 90 skipped. The 9 executed
tests include all three authority/cleanup parents and their Windows PowerShell
5.1 and PowerShell 7 subtests.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint and restore consume' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 93 total, 1 passed, 0 failed, 92 skipped.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 95 total, 3 passed, 0 failed, 92 skipped. Both
PowerShell hosts passed creation publication, recovery, and lock-release cases.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback restore fake toolchain' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 95 total, 3 passed, 0 failed, 92 skipped. Both
PowerShell hosts passed success, preparation failure, startup failure, terminal
compensation failure, cleanup failure, authority retention, exact-byte, and
post-process release cases.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 103 passed, 0 failed, 0 skipped.

```powershell
git diff --check
```

Exit code: `0` with no whitespace errors.

## Review-Fix Evidence Added 2026-07-22

The metadata cleanup review finding was reproduced before its production fix
with the final held-authority creation test under both PowerShell hosts:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts/release-contract.test.cjs
```

Exit code: `1`. Tests: 96 total, 0 passed, 3 failed, 93 skipped. The
Windows PowerShell 5.1 and PowerShell 7 subtests, plus their parent, failed
because an undeletable conflicting `metadata.json` replaced the publication
error and prevented deployment recovery.

After the review fix, the same focused pattern exited `0`: 97 total, 3
passed, 0 failed, 94 skipped. Both hosts retained the publication
`ErrorRecord`, attached both metadata-removal failures in order, executed the
deployment recovery command, ran every outer cleanup, and released the held
authority after process exit.

The omitted Task 1 orchestration RED was reconstructed without moving the main
checkout from `d1bea05830dd2b4e15b3c5eed12b1291b33c5302`. A detached temporary
worktree at baseline `ccdb85f1df999ec6c580fc77a000986d891aadb2` received the
final test-only diff and ran both host matrices:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts/release-contract.test.cjs
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback restore fake toolchain' scripts/release-contract.test.cjs
```

Each command exited `1` with 97 total, 3 failed, and 94 skipped. Creation
failed because baseline production did not retain the checkpoint `configs`
namespace. Restore failed before the evidence gate because baseline production
did not retain the required checkpoint file authorities. The temporary
worktree and generated patch were removed after replay.

## Second Review-Fix Evidence Added 2026-07-22

Base commit: `24f731109318fe05bcbab3c5074946ba39e7d5ab`.

Second-round review established that a failed atomic move never owns a
pre-existing final `metadata.json` path. The atomic publisher and checkpoint
failure handler no longer attempt final-path deletion. Only the invocation's
GUID-named temporary file is cleaned after publication failure. Both unlocked
and held conflicts retain their exact original bytes, the original publication
`ErrorRecord` remains primary, deployment recovery still runs, and no cleanup
error is fabricated for an unowned path.

The restore behavior harness now calls the real
`Assert-RollbackFileAuthority` before recording its label and order. It
snapshots the exact asserted authority set at each checkpoint-file consumer,
while retaining the independent Windows sharing probe. Mutation scenarios
prove a missing production assertion, incomplete post-`up` recovery, and
failed archived-down exact-byte validation cannot satisfy the harness.

Focused RED was recorded under Windows PowerShell 5.1 and PowerShell 7 for
each of the following patterns. Each exited `1` with 100 total, 0 passed, 3
failed, and 97 skipped:

- `release rollback checkpoint fake toolchain`
- `rollback restore real-authority oracle`
- `rollback restore recovery-completion oracle`
- `rollback restore archived-down oracle`

After implementation, each pattern exited `0` with 100 total, 3 passed, 0
failed, and 97 skipped. The complete `rollback restore fake toolchain` pattern
also exited `0` with 100 total, 3 passed, 0 failed, and 97 skipped, covering
successful recovery through backend lookup, mount inspection, data-root
verification, and health on every automatic-recovery branch.

One final full release contract ran serially after all source and test fixes,
with no overlapping release-contract process. It exited `0`: 114 passed, 0
failed, and 0 skipped.

## Self-Review

No unresolved correctness or security findings remain in the allowed Task 1
diff. Fixed checkpoint paths remain literal, the archive compatibility surface
is preserved, no inner recovery function owns an outer handle, strict UTF-8 and
stream-position contracts are covered on both hosts, and cleanup failures do
not replace a primary exception or skip later cleanup.

Residual runtime tradeoff: retained file authorities use `FileShare.Read` for
the complete restore invocation. This intentionally fails closed for writers,
rename/delete attempts, and consumers that request unnecessarily incompatible
Windows sharing modes. The release contract uses fake Docker/npm toolchains, so
real Docker engine sharing behavior remains an operational integration risk.

## Commit

Required subject: `fix: retain rollback checkpoint file authorities`

Task commit SHA: `d1bea05830dd2b4e15b3c5eed12b1291b33c5302`
