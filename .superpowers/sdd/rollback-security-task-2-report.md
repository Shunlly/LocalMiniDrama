# Rollback Security Remediation Task 2 Report

Date: 2026-07-22

Base commit: `0cfc61881fb46b95a665ed48f8de243c224decd4`

Required subject: `fix: retain rollback compensation authority`

## Initial State

The task started from the exact controller-provided base with a clean working
tree:

```powershell
git rev-parse HEAD
git status --short
```

Exit codes: `0`, `0`. HEAD was
`0cfc61881fb46b95a665ed48f8de243c224decd4`; status output was empty.

## Pinned Environment

All release-contract behavior runs used Node 20.20.2 and both required
PowerShell hosts:

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
```

Host versions:

- Windows PowerShell 5.1.26100.8655
- PowerShell 7.6.4
- Node.js 20.20.2

## RED Evidence

The behavior harness and source contract were added before production edits.
The behavior cases execute the restore script and use real Windows sharing
operations from separate Node processes.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback compensation authority retains|release rollback restore binds every data operation' scripts/release-contract.test.cjs
```

Exit code: `1`. Tests: 115 total, 0 passed, 18 failed, 97 skipped.

All 14 behavior leaves failed under both hosts, their two host parents failed,
the behavior parent failed, and the source contract failed. The failures were
the expected missing behavior:

- `restore_failure` and `startup_failure` allowed overwrite, rename,
  delete/recreate, and swap-before-open of compensation `data.zip`.
- Both preparation and failed-startup terminal paths allowed archive mutation.
- Successful rollback allowed compensation-directory replacement before
  `backup:data`.
- Backup failure and authority-acquisition failure allowed compensation
  directory replacement.
- The source contract found no outer compensation archive authority.

A filtered diagnostic replay produced the same exit code and counts and
confirmed that every leaf failed on an unblocked archive or directory mutation,
not on harness setup.

## Implementation

- Compensation directory names now use
  `compensation-<UTC>-<32-hex-guid>`.
- The outer invocation opens the compensation directory lock on the line
  immediately after directory creation.
- After successful `backup:data`, the outer invocation opens exactly one
  `Pre-rollback compensation backup` file authority before hashing or writing
  records.
- Initial and pre-consumer SHA-256 calculations use the retained stream through
  `Get-RollbackFileAuthoritySha256` and
  `Assert-RollbackFileAuthorityHash`.
- Both automatic restore consumers receive the exact retained authority
  `.Path`, with `Assert-RollbackFileAuthority` directly adjacent to each
  external invocation.
- Preparation, failed-startup, recovery-health, successful-health, and both
  terminal-shutdown paths borrow the same outer-owned authority and lock.
- Outer cleanup disposes the archive authority, then the directory lock, then
  the previously retained data-root lock. Inner branches never open or dispose
  another compensation authority.
- Backup-command and authority-open failures skip destructive rollback restore,
  retain the compensation directory, perform forward recovery, and avoid null
  authority dereferences.
- No branch automatically deletes a published compensation ZIP or directory.

## GREEN Evidence

Focused Task 2 behavior and source contract:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback compensation authority retains|release rollback restore binds every data operation' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 115 total, 18 passed, 0 failed, 97 skipped.

The first broader restore replay exposed one stale Task 1 oracle expectation:
exit code `1`, 117 total, 17 passed, 3 failed, 97 skipped. Both host subtests
correctly recorded `Pre-rollback compensation backup` alongside `Rollback data
backup` and `Archived runtime config` at the rollback data restore boundary.
The expected authority set was updated; production code did not change.

Final Task 2 plus complete restore-orchestration focus:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback compensation authority retains|rollback restore fake toolchain' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 117 total, 20 passed, 0 failed, 97 skipped. Both
PowerShell hosts passed success, preparation recovery, failed-startup recovery,
terminal failure, cleanup failure, and the pre-mutation rejection matrix.

Final serial release contract:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 135 passed, 0 failed, 0 skipped.

Supplemental package verification required by the repository instructions:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\npm.cmd' --prefix backend-node run verify
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\npm.cmd' --prefix frontweb run verify
```

Exit codes: `0`, `0`. Backend checked 191 JavaScript files and completed its
serial tests and audit. Frontend checked 168 JavaScript files, completed tests
and acceptance-report validation, and passed its production build and bundle
budget.

Both Windows PowerShell parsers accepted the changed restore script, and pinned
Node 20 accepted the test file with `--check`.

```powershell
git diff --check
```

Exit code: `0`; no whitespace errors were reported.

## Changed Files

- `scripts/restore-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-2-report.md`

## Self-Review

- Exactly one production acquisition targets `$compensationBackup`.
- Exactly two automatic compensation restores rehash the retained stream,
  assert the same authority immediately before consumption, and pass
  `$compensationBackupAuthority.Path`.
- The authority remains locked at preparation compensation, failed-startup
  compensation, successful and recovery health checks, and both terminal
  shutdown attempts. Real mutation probes cover overwrite, rename,
  delete/recreate, and swap-before-open.
- Success and failure fixtures prove the ZIP and directory become movable only
  after the PowerShell process exits.
- Backup failure opens no null authority, executes forward recovery, releases
  all directory handles, and never reaches rollback `restore:data`.
- Authority-open failure attempts one acquisition, opens none, executes forward
  recovery, and never reaches rollback `restore:data`.
- Cleanup ownership is outer-only and reverse ordered: archive authority,
  compensation directory lock, then older authorities and locks.
- No compensation restore path is recomputed from metadata, and no automatic
  compensation artifact deletion was introduced.
- Task 1 helper interfaces are unchanged.

## Residual Risk

The tests exercise real Windows filesystem sharing with Node 20 and both
PowerShell hosts, but Docker and npm orchestration are controlled fakes. Exact
arguments, paths, consumed bytes, authority timing, recovery ordering, and
post-exit release are covered; live Docker Engine and container behavior remain
an operational integration risk. Compensation evidence is intentionally
retained after failures and may require operator-managed cleanup.

## Commit SHA

The resulting commit SHA is reported in the final handoff. Embedding a commit's
own SHA in a tracked file would change that SHA; this report records the
immutable base and exact required subject instead.

## Review Fix

Date: 2026-07-22

Review base: `ae374e76cbe0f190becff6d9615f4cf226a720eb`

Required follow-up subject: `test: harden rollback mutation probes`

### Finding

The delete/recreate and swap-before-open probes each wrapped both filesystem
steps in one `try/catch`. A successful unlink or initial displacement followed
by a failed replacement was therefore recorded as blocked, and cleanup could
reconstruct the original pathname before the outer oracle inspected the event.

### RED

Two behavior cases run the real generated compensation probe against an
unlocked archive. Each lets the destructive first step succeed, injects a
failure only before the second step, and verifies that cleanup restores the
original bytes.

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback compensation mutation oracle' scripts/release-contract.test.cjs
```

Exit code: `1`.

```text
# tests 102
# pass 0
# fail 3
# skipped 99
```

Both leaves failed with `true !== false`: the later recreate/replacement error
hid the already successful unlink/displacement. Their parent was the third
failure.

### Harness Fix

The destructive unlink and displacement now have independent `try/catch`
blocks. Their success flags determine the mutation result immediately. The
second recreate/replacement attempt is isolated so its failure cannot change
that result, while the existing `finally` cleanup still restores the original
archive and removes probe paths.

### GREEN

Standalone mutation-sensitivity oracle:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback compensation mutation oracle' scripts/release-contract.test.cjs
```

Exit code: `0`.

```text
# tests 102
# pass 3
# fail 0
# skipped 99
```

Final Task 2 covering command with pinned Node 20, Windows PowerShell 5.1, and
PowerShell 7.6.4:

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback compensation mutation oracle|rollback compensation authority retains|release rollback restore binds every data operation' scripts/release-contract.test.cjs
```

Exit code: `0`.

```text
# tests 118
# pass 21
# fail 0
# skipped 97
```

The covering output includes passing `windows-powershell-5.1` and
`powershell-7` subtests for all seven Task 2 lifecycle cases.

```powershell
git diff --check
```

Exit code: `0`; no whitespace errors were reported.

### Review-Fix Files

- `scripts/release-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-2-report.md`

No production file changed.

### Review-Fix Concern

The partial-success paths use deterministic injected second-stage failures so
the otherwise rare Windows timing is reproducible. The full Task 2 covering
command still exercises actual Windows sharing behavior under both PowerShell
hosts.
