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

Task commit SHA: the SHA of the commit containing this report, resolved with
`git rev-parse HEAD` and recorded in the final handoff. A Git commit cannot
embed its own SHA in a tracked file because changing the file changes the SHA.
