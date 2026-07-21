# Rollback Security Task 1 Review-Fix Report

Date: 2026-07-22

Base commit: `d1bea05830dd2b4e15b3c5eed12b1291b33c5302`

Required subject: `fix: close rollback authority review gaps`

## Pinned Environment

All PowerShell behavior runs used Node 20 and both required hosts:

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
```

The host matrix was Windows PowerShell 5.1 (`powershell.exe`) and portable
PowerShell 7.6.4.

## RED Evidence

### Cleanup merging and config boundary

The cleanup-merge behavior tests and config source/order guard were added
before production changes:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback retained cleanup|rollback restore reasserts backup and config' scripts/release-contract.test.cjs
```

Exit code: `1`. Tests: 96 total, 0 passed, 4 failed, 92 skipped. Both host
cleanup subtests and their parent showed that attached cleanup failures were
overwritten; the config-boundary guard showed no config authority assertion
directly before archived `restore:data`.

### Held metadata cleanup and recovery

The checkpoint harness retained a real conflicting `metadata.json` authority
without delete sharing before the production fix:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts/release-contract.test.cjs
```

Exit code: `1`. Tests: 96 total, 0 passed, 3 failed, 93 skipped. On Windows
PowerShell 5.1 and PowerShell 7, metadata removal replaced the original atomic
publication failure and prevented the recovery command; the parent failed with
both host subtests.

### Baseline orchestration replay

The final test-only diff was applied in a detached temporary worktree at
`ccdb85f1df999ec6c580fc77a000986d891aadb2`. The main checkout remained at the
review-fix base throughout.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts/release-contract.test.cjs
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback restore fake toolchain' scripts/release-contract.test.cjs
```

Creation replay: exit code `1`, 97 total, 0 passed, 3 failed, 94 skipped.
Baseline production allowed the checkpoint `configs` namespace to move.

Restore replay: exit code `1`, 97 total, 0 passed, 3 failed, 94 skipped.
Baseline production lacked the retained checkpoint authorities, so restore did
not reach the new evidence gate. The temporary worktree and generated patch
were removed after these runs.

### Genuine source-guard defect

The first post-implementation full run exposed one stale Task 1 source guard:
exit code `1`, 105 total, 103 passed, 1 failed, 1 skipped. It required the old
literal `checkpoint failed` message, which came from replacing the primary
checkpoint error when recovery also failed. That behavior directly
contradicted this review fix. The guard was changed to require recovery error
collection followed by rethrow of `$checkpointError`.

The corrected guard was then run alone:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback scripts fail closed' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 95 total, 1 passed, 0 failed, 94 skipped.

## Implementation

- Atomic metadata publication now retains its primary `ErrorRecord` while
  independently attempting stream disposal, final-path cleanup, and temporary
  cleanup. Cleanup failures are attached in execution order.
- Checkpoint failure handling independently attempts metadata cleanup and
  captured-deployment recovery, always tries recovery after Docker shutdown,
  and rethrows the original checkpoint error.
- `Complete-RollbackInvocation` merges cleanup errors already attached by an
  inner layer with later outer cleanup errors instead of replacing them.
- Restore reasserts both backup and archived config authorities immediately
  before the rollback `restore:data` Node boundary.
- Fake Docker and npm consumers verify literal paths and exact bytes for the
  archived Compose file, config, image archive, rollback archive, and
  compensation bind-source copy.
- Authority events are emitted only after successful lock probes. Success,
  preparation failure, startup failure, and terminal failure require the final
  probe plus the real fake-command execution or intentional injected boundary.
  A focused oracle rejects missing final probes and missing commands.

## GREEN Verification

Focused cleanup and config boundary:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback retained cleanup|rollback restore reasserts backup and config' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 97 total, 4 passed, 0 failed, 93 skipped.

Held-metadata creation behavior:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 97 total, 3 passed, 0 failed, 94 skipped.

Final-probe mutation oracle:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback restore final-authority oracle' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 95 total, 1 passed, 0 failed, 94 skipped.

Consolidated creation, restore, cleanup, config, consumer-byte, and final-probe
focus:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='rollback retained cleanup|rollback restore reasserts backup and config|release rollback checkpoint fake toolchain|rollback restore final-authority oracle|rollback restore fake toolchain' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 101 total, 11 passed, 0 failed, 90 skipped. Both
PowerShell hosts passed the creation and restore behavior matrices.

Final full release contract, run once serially after all fixes and report
creation, with portable PowerShell 7 available through both `LMD_PWSH_EXE` and
`PATH`. Earlier overlapping full-suite runs were excluded from final evidence:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 105 passed, 0 failed, 0 skipped.

```powershell
git diff --check
```

Exit code: `0` with no whitespace errors.

## Changed Files

- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/restore-release-rollback-checkpoint.ps1`
- `scripts/rollback-powershell-support.ps1`
- `scripts/release-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-1-report.md`
- `.superpowers/sdd/rollback-security-task-1-review-fix-report.md`

## Self-Review

The diff remains inside the six allowed files. Metadata cleanup preserves the
original publication/checkpoint error, cleanup ordering is stable across inner
and outer completion layers, and recovery cannot be skipped by a cleanup
failure. The config assertion is immediately adjacent to the backup assertion
and archived Node restore command. Consumer evidence is emitted only after
literal-path and exact-byte validation, and final authority evidence cannot be
satisfied by a pre-probe label or nonzero exit alone. The stale source guard
was the only existing test adjusted, and its old expectation contradicted the
required primary-error ownership.

## Residual Risk

The behavior matrix uses real Windows file sharing and both PowerShell hosts,
but Docker and npm operations are controlled fakes. Exact command arguments,
environment paths, and consumed bytes are covered; real Docker Engine and live
container sharing behavior remain an operational integration risk. The larger
atomic publication redesign remains intentionally deferred to Task 7.
