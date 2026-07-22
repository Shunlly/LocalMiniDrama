# Rollback Security Remediation Task 3 Report

Date: 2026-07-22

Base commit: `b79d89f17e0fdd6e9088d5ff2cd8301747af7062`

Required commit subject: `fix: prove checkpoint container bind identity`

## Initial State

The task started from the exact controller-provided baseline with a clean
working tree:

```powershell
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
```

Exit codes: `0`, `0`. HEAD was
`b79d89f17e0fdd6e9088d5ff2cd8301747af7062`; status output was empty.

## Pinned Environment

All authoritative behavior and contract runs used Node 20.20.2 and both
required PowerShell hosts:

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
```

Verified versions:

- Node.js 20.20.2
- Windows PowerShell 5.1.26100.8655
- PowerShell 7.6.4

## RED Evidence

The source contract and behavior harness were added before the production
implementation. An initial attempted RED run exposed a harness defect: the
driver's `CheckpointDirectory` parameter was reset when the production script
was dot-sourced. That run was discarded because it did not execute the real
checkpoint flow. The production file was restored exactly to baseline, the
driver retained its requested path before dot-sourcing, and the corrected RED
was then run against unchanged baseline production.

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint container bind proof is retained|checkpoint proves the captured container' scripts/release-contract.test.cjs
```

Exit code: `1`. Tests: 128 total, 0 passed, 28 failed, 100 skipped.

The 28 expected failures were the source contract, 24 behavior leaves across
Windows PowerShell 5.1 and PowerShell 7, both host parents, and the behavior
parent. The unchanged checkpoint script completed checkpoint creation in the
exploit and rejection scenarios instead of stopping before artifact creation:

- A source reported as A was swapped before the host lock while fake container
  visibility retained original A.
- Missing and wrong marker bytes were never read by the running container.
- Source, destination, RW, duplicate-destination, type, and captured-container
  reinspection changes were not rejected.
- No unpredictable exact-byte marker, bounded retry, or pre-consumer marker
  cleanup existed.
- Injected marker cleanup failures and read-plus-cleanup precedence could not be
  exercised because there was no marker lifecycle.

This is the retained valid RED evidence. No real Docker command was used.

## Implementation

`Confirm-RollbackContainerBindAuthority` was added with the required interface
and called immediately after `/app/data` source capture, directory-lock open,
native identity capture, and pathname identity assertion.

- It re-derives the retained identity from the supplied `SafeFileHandle` and
  reasserts the locked host pathname before marker creation.
- It creates one
  `.localminidrama-bind-proof-<32-hex-guid>.tmp` in the locked root with
  `FileMode.CreateNew`, 32 bytes from `RandomNumberGenerator`, raw byte writes,
  durable `Flush(true)`, and `FileShare.Read`.
- The retained stream permits reads while preventing marker overwrite and
  deletion during proof.
- It calls `docker exec <captured-id> node -e <fixed-reader> -- <path> <hex>`
  through an argument array. The fixed Node reader opens the exact marker path
  and compares byte length and content without a shell.
- It allows at most three attempts with 100 ms between attempts. The basename,
  expected bytes, reader, and captured container ID remain fixed. Missing or
  mismatched bytes are never accepted.
- After byte success, one full-object inspection of the same captured ID must
  report the exact container ID and exactly one matching destination with the
  same bind source, `bind` type, and boolean read-write state. The retained host
  identity is then reasserted again.
- A `finally` block independently disposes the RNG if needed, closes the marker
  stream, and removes only a marker successfully created by this invocation.
- `Complete-RollbackInvocation` preserves the original proof or reinspection
  `ErrorRecord` and attaches cleanup failures. Cleanup-only failure remains a
  terminating failure.

No restore or compensation behavior changed.

## GREEN Evidence

Focused Task 3 source and behavior coverage:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint container bind proof is retained|checkpoint proves the captured container' scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 128 total, 28 passed, 0 failed, 100 skipped.
Both PowerShell hosts passed all 12 behavior leaves. A GREEN iteration found
that an inner `ThrowTerminatingError` preserved the read failure but bypassed
cleanup-detail attachment. The final implementation retains that `ErrorRecord`
and performs the single terminating throw through `Complete-RollbackInvocation`.

Task 3 plus the existing checkpoint-creation orchestration focus:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --check scripts/release-contract.test.cjs
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint container bind proof is retained|checkpoint proves the captured container|release rollback checkpoint fake toolchain' scripts/release-contract.test.cjs
```

Exit codes: `0`, `0`. Tests: 130 total, 31 passed, 0 failed, 99 skipped.
The existing creation harness passed success, publication conflicts, recovery,
lock retention, and post-process release under both hosts with exact proof
bytes recorded before shutdown.

Complete serial release contract:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts/release-contract.test.cjs
```

Exit code: `0`. Tests: 166 passed, 0 failed, 0 skipped.

Repository package verification used an explicit pinned `PATH` so package
scripts also resolved Node 20.20.2:

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
node --version
npm --prefix backend-node run verify
npm --prefix frontweb run verify
```

Exit codes: `0`, `0`, `0`. Backend verification checked 191 JavaScript files,
passed its 471-test serial suite, and completed audit. Frontend verification
checked 168 JavaScript files, passed 491 of 494 tests with 3 Windows link
capability skips, validated tracked acceptance evidence, and passed the
production build and bundle budget.

An earlier supplemental attempt invoked the pinned `npm.cmd` without prepending
its directory to `PATH`; package child scripts therefore resolved Node 24 and
the Node 20 `better-sqlite3` binary rejected ABI 137 versus 115. The corrected
commands above explicitly reported `v20.20.2` and passed. This was an
environment invocation error, not a source failure.

Both parser checks passed:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -Command '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts\create-release-rollback-checkpoint.ps1"), [ref]$tokens, [ref]$errors) | Out-Null; if($errors.Count -gt 0){$errors | ForEach-Object { Write-Error $_.Message }; exit 1}'
& 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe' -NoLogo -NoProfile -NonInteractive -Command '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts\create-release-rollback-checkpoint.ps1"), [ref]$tokens, [ref]$errors) | Out-Null; if($errors.Count -gt 0){$errors | ForEach-Object { Write-Error $_.Message }; exit 1}'
git diff --check
```

Exit codes: `0`, `0`, `0`. `git diff --check` reported no whitespace errors;
Git only emitted the checkout's existing LF-to-CRLF conversion warning.

## Changed Files

- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-3-report.md`

## Self-Review

- Physical proof uses bytes created directly in the host root identified by the
  retained directory handle, not another textual source comparison.
- The marker basename and 256-bit token are independently unpredictable. One
  basename and token are retained across every bounded retry and differ across
  invocations.
- Marker creation is exclusive, raw, durable, and read-share-only. The fake
  container checks the exact bytes visible through its own retained source.
- Native arguments remain arrays. The container command is `node -e`; no
  `cmd`, `sh`, `bash`, PowerShell, interpolation shell, or added dependency is
  used.
- Every retry targets the same captured container ID, marker path, and expected
  bytes. Three attempts and two 100 ms waits are the hard upper bound.
- Reinspection uses the same captured ID and one JSON snapshot. ID,
  destination cardinality, source, type, RW state, and retained host identity
  must all remain exact.
- The proof call precedes checkpoint `New-Item`, image tag/save, shutdown,
  backup, rollback drill, and fingerprinting. Success tests confirm no marker
  reaches image-save, shutdown, backup, fingerprint, checkpoint, or metadata
  inputs.
- Cleanup independently attempts stream close and owned-marker removal.
  Cleanup-only failure terminates; a prior container-read failure remains the
  same primary exception with ordered cleanup detail attached; outer data,
  config, and location cleanup still runs.
- Restore and Task 2 compensation code are byte-for-byte unchanged.

## Residual Risk

The behavior tests use real Windows filesystem sharing, the actual checkpoint
PowerShell flow, Node 20.20.2, and both PowerShell hosts, but fake native tools.
Live Docker Desktop bind propagation and backend-container execution remain an
operational integration risk because the brief prohibited real Docker for unit
implementation. The proof fails closed if propagation takes longer than the
bounded three-attempt window. Full-container Docker inspection is parsed only
in memory and adds one inspect call per checkpoint. A cleanup failure can leave
one random proof marker for operator cleanup, while still preventing checkpoint
creation.

## Resulting Commit

Subject: `fix: prove checkpoint container bind identity`

The immutable SHA is reported in the final handoff. A commit cannot contain
its own SHA because adding that SHA to this tracked report would produce a
different commit object and therefore a different SHA.

## Review Fix Evidence

Date: 2026-07-22

Review-fix base SHA:
`315b974755365f2ed2559f30eb7920844d5f7483`

Required review-fix subject: `fix: close checkpoint bind proof review gaps`

### Initial State

```powershell
git rev-parse HEAD
git status --short
```

Exit codes: `0`, `0`. HEAD matched the requested review base exactly. The
worktree was not clean as requested: it already contained an unstaged
`scripts/release-contract.test.cjs` delta with 76 insertions and 4 deletions.
Inspection showed that delta was a partial start on this same review fix
(native fake-Docker helpers, short-ID fixture support, and destination-case
fixture support). It was preserved and completed; no unrelated user change was
reverted.

### Review-Fix RED Evidence

Tests were completed before production edits. A first expanded behavior run
hit the command harness's 120-second ceiling because every leaf launches a new
PowerShell process; it exited `124` and was not treated as authoritative RED
evidence. The source-only RED then failed as intended:

```powershell
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='container bind proof is retained|never hides missing then success|never hides mismatch then success|matching short captured ID|same-text host directory identity replacement|hard-times out docker exec' scripts\release-contract.test.cjs
```

Exit code: `1`. Tests: 102 total, 0 passed, 1 failed, 101 skipped. The source
contract failed because no native timeout runner, canonical full container ID,
or classified transport retry existed.

The full behavior parent was then given enough time to finish:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint proves the captured container' scripts\release-contract.test.cjs
```

Exit code: `1`. Tests: 148 total, 22 passed, 25 failed, 101 skipped across
Windows PowerShell 5.1 and PowerShell 7. Expected failures proved that the old
implementation retried reader-confirmed missing and mismatched bytes, accepted
later success, rejected matching short IDs, lacked a hard child-process
timeout, and did not exercise the real reader through native argv. A fixture
hard link also could not be removed while Node's executable image was loaded;
the harness was corrected to copy the native executable before production was
edited.

### Review-Fix Implementation Decisions

- The fixed reader reserves exits `51` through `56` for malformed expected
  hex, wrong expected length, missing marker, other read failure, actual-length
  mismatch, and byte mismatch. Every reader exit fails immediately.
- Docker exit `125` is the only retryable transport/propagation class. At most
  three attempts use one canonical full container ID, argument array, reader,
  marker path, and expected token, with 100 ms between retries.
- Captured IDs must be 12-64 lowercase hexadecimal characters. Docker
  `{{.Id}}` must return one 64-hex ID with the captured ID as its exact prefix;
  all exec and reinspection calls then use that canonical full ID.
- `Invoke-NativeCommandWithTimeout` uses `ProcessStartInfo` with
  `UseShellExecute = $false`, a Windows command-line quoting routine for the
  original argument array, redirected diagnostics capped at 4096 characters,
  and a 1500 ms hard timeout. Timeout kills and waits for the native child,
  retains the timeout as primary, and lets marker cleanup attach independently.
- The native fake Docker executes the exact supplied `node -e` reader and
  mapped marker argv. It no longer duplicates reader acceptance logic.
- The retained marker is probed from another real process: exact read succeeds
  while write, delete, rename, and replacement fail. The retained directory
  authority also blocks a same-text root replacement attempted after byte
  proof. Destination matching remains ordinal, so `/APP/DATA` is rejected.
- A final retained host-identity assertion runs after marker cleanup and before
  checkpoint creation. Restore, Provider, frontend, workflows, package
  metadata, and documentation behavior were not changed.

### Review-Fix GREEN Evidence

Pinned Node 20 Task 3 focus with both PowerShell hosts:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint container bind proof is retained|checkpoint proves the captured container' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 148 total, 48 passed, 0 failed, 100 skipped. All 22
behavior leaves passed under each host. This includes missing-then-success and
mismatch-then-success rejection, malformed expected values, short/full ID
matching, case-altered destination, post-proof replacement attempt, exact
reader argv, real Windows sharing, classified transport retry, timeout cleanup,
primary-error retention, and no leaked fake Docker child.

Existing checkpoint-creation orchestration:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 104 total, 3 passed, 0 failed, 101 skipped. Both hosts
passed success, publication conflict, recovery, lock-retention, and exact-reader
orchestration.

Complete serial release contract:

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 186 total, 186 passed, 0 failed, 0 skipped. An earlier
supplemental full run passed 185 tests with one host-discovery skip because
`pwsh.exe` was not on that process's `PATH`; the authoritative command above
corrected the environment and executed every PowerShell 7 test.

Final syntax, parser, process-leak, and whitespace gates:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --check scripts\release-contract.test.cjs
powershell.exe -NoLogo -NoProfile -NonInteractive -Command '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts\create-release-rollback-checkpoint.ps1"), [ref]$tokens, [ref]$errors) | Out-Null; if($errors.Count -gt 0){$errors | ForEach-Object { Write-Error $_.Message }; exit 1}'
& 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe' -NoLogo -NoProfile -NonInteractive -Command '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts\create-release-rollback-checkpoint.ps1"), [ref]$tokens, [ref]$errors) | Out-Null; if($errors.Count -gt 0){$errors | ForEach-Object { Write-Error $_.Message }; exit 1}'
git diff --check
```

Exit codes: `0`, `0`, `0`, `0`. No temporary fake `docker.exe` process was
left running. Git emitted only the checkout's existing LF-to-CRLF warning.

### Review-Fix Changed Files

- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-3-report.md`

### Review-Fix Self-Review

- Reader-confirmed failures can no longer be hidden by a later success;
  transport retry is an explicit single exit-code class.
- The native command inputs remain an array, no command shell is used, and the
  exact reader with spaces and quotes passes unchanged under PS5.1 and PS7.
- Every exec attempt is time-bounded. Timeout kills and waits, preserves the
  primary error, removes the marker, runs outer cleanup, performs no checkpoint,
  image-save, shutdown, backup, drill, fingerprint, or recovery operation, and
  leaves no fake child.
- Short captured IDs are bound to Docker's full immutable ID before proof; a
  nonmatching full ID fails before marker creation or exec.
- Marker sharing and directory authority reject mutation and namespace
  replacement from a separate process while exact reads remain possible.
- Marker cleanup still precedes every checkpoint consumer and retains the
  established primary-versus-cleanup error precedence.

### Review-Fix Residual Risk And Resulting SHA

No real Docker command was run, as required. Live Docker Desktop exit-code
behavior and bind propagation remain operational integration risks; the proof
fails closed if three exit-125 attempts or any 1500 ms attempt bound is
exceeded. The immutable resulting commit SHA is reported in the final handoff;
embedding it in this tracked report would change that SHA.

## Second Security-Review Fix: Timeout Hardening

Date: 2026-07-22

Timeout-hardening base SHA:
`265d4db1ab50659605baace963d3d3c3b69321d1`

Required subject: `fix: harden checkpoint proof timeouts`

### Preserved Initial State

```powershell
git rev-parse HEAD
git status --short
git diff --numstat -- scripts/create-release-rollback-checkpoint.ps1 scripts/release-contract.test.cjs
```

Exit codes: `0`, `0`, `0`. HEAD matched the requested base. The worktree
contained only the two stated uncommitted files and was preserved. Before this
wave's edits, their combined diff was 467 insertions and 114 deletions:

- `scripts/create-release-rollback-checkpoint.ps1`: 204 insertions, 59 deletions.
- `scripts/release-contract.test.cjs`: 263 insertions, 55 deletions.

The first authoritative run of the preserved worktree used pinned Node 20 and
both PowerShell hosts:

```powershell
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint container bind proof is retained|checkpoint proves the captured container' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 156 total, 56 passed, 0 failed, 100 skipped. No
pre-existing focused failure was reproducible from the preserved changes.

### RED Evidence

No executable RED result from the previous agent was present in the report or
recoverable from Git, so none is claimed. Static comparison against the base is
still conclusive: `265d4db` used `ReadToEndAsync`, parameterless
`WaitForExit()`, `Task.Result`, parent-only `Process.Kill()`, unbounded proof ID
resolution and reinspection, and raw exit code 125 for retry. The preserved
test diff rejects those exact patterns and adds dual-host process-tree,
output-bound, proof-resolution, reinspection, timeout-only retry, cleanup, and
no-late-operation coverage.

The audit found one uncovered edge: a thrown termination helper replaced the
timeout because the timeout object was created after the helper call. A new
dual-host scenario was added before the production correction. A child-only
name pattern exited `0` with all 102 tests skipped because Node does not enter a
nonmatching parent; it was rejected as RED evidence. The narrowest executable
behavior parent then failed as expected:

```powershell
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint proves the captured container' scripts\release-contract.test.cjs
```

Exit code: `1`. Tests: 158 total, 52 passed, 5 failed, 101 skipped. The two
host leaves observed the injected termination-helper `IOException` as primary
with `NativeTimedOut` unset; both host parents and the behavior parent also
failed. The process returned within its outer bound and cleanup ran, isolating
error precedence rather than another hang.

### Design Decisions

- Every proof native attempt has a 10,000 ms execution bound. Timeout cleanup
  has its own 2,000 ms bound and contains no parameterless `WaitForExit()` or
  `Task.Result` access.
- Commands that need output use fixed 262,144-byte stdout and 4,096-byte stderr
  storage plus fixed read buffers. Completed async reads are consumed only
  after `IsCompleted`; excess bytes are discarded and reported as overflow.
- Byte-proof exec does not redirect output. A timeout invokes
  `taskkill.exe /PID <pid> /T /F` through `ProcessStartInfo` with shell execution
  disabled, then performs only deadline-bounded status waits. This terminates
  descendants that retain inherited stdout or stderr handles.
- A timeout exception is now constructed before tree termination. A helper
  exception records `NativeProcessTreeTerminated=false` and bounded
  `NativeTerminationDetail`; it cannot replace the timeout primary error.
- Proof retry is timeout-only, permits one retry, and requires the previous
  tree to be confirmed terminated. Native exit codes no longer infer retry.
- Captured ID resolution and full-object reinspection use the same bounded,
  memory-limited runner. Both remain bound to the canonical captured ID.
- Native inputs remain string arrays. The implementation uses no `cmd`, `sh`,
  `bash`, PowerShell script shell, or command interpreter.

### GREEN And Verification Evidence

The behavior parent after the helper-error correction:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint proves the captured container' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 158 total, 57 passed, 0 failed, 101 skipped. All 27
behavior leaves passed under Windows PowerShell 5.1 and PowerShell 7.

Final Task 3 dual-host focus:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='checkpoint container bind proof is retained|checkpoint proves the captured container' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 158 total, 58 passed, 0 failed, 100 skipped.

Existing checkpoint-creation orchestration focus:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test --test-name-pattern='release rollback checkpoint fake toolchain' scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 104 total, 3 passed, 0 failed, 101 skipped. Both
PowerShell hosts completed the existing success, publication conflict,
recovery, lock-retention, and reader orchestration coverage.

Parser and syntax checks:

```powershell
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --check scripts\release-contract.test.cjs
powershell.exe -NoLogo -NoProfile -NonInteractive -Command '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts\create-release-rollback-checkpoint.ps1"), [ref]$tokens, [ref]$errors) | Out-Null; if($errors.Count -gt 0){$errors | ForEach-Object { Write-Error $_.Message }; exit 1}'
& 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe' -NoLogo -NoProfile -NonInteractive -Command '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts\create-release-rollback-checkpoint.ps1"), [ref]$tokens, [ref]$errors) | Out-Null; if($errors.Count -gt 0){$errors | ForEach-Object { Write-Error $_.Message }; exit 1}'
```

Exit codes: `0`, `0`, `0`.

Complete release contract with pinned Node 20 and `pwsh.exe` on `PATH`:

```powershell
$env:PATH = 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64;' + $env:PATH
$env:LMD_PWSH_EXE = 'C:\Users\33028\AppData\Local\Temp\powershell-7.6.4-win-x64\pwsh.exe'
& 'C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64\node.exe' --test scripts\release-contract.test.cjs
```

Exit code: `0`. Tests: 196 passed, 0 failed, 0 skipped. Duration was 535.7
seconds. No real Docker command was used.

```powershell
git diff --check
```

Exit code: `0`. Git emitted only the checkout's existing LF-to-CRLF warnings.

### Changed Files

- `scripts/create-release-rollback-checkpoint.ps1`
- `scripts/release-contract.test.cjs`
- `.superpowers/sdd/rollback-security-task-3-report.md`

### Self-Review

- Execution, output draining, taskkill, and parent confirmation all use finite
  waits. Pending inherited pipe reads are never synchronously joined after a
  timeout.
- The timeout fixtures assert parent and descendant exit after successful tree
  termination, outer environment and location cleanup, timeout primary error,
  attached marker-cleanup detail, marker removal, and no checkpoint, image,
  shutdown, backup, drill, fingerprint, or recovery operation.
- Separate fixtures prove prompt return when taskkill hangs and when the
  termination helper throws. Neither case retries an unconfirmed process tree;
  both reach marker and outer cleanup.
- A 2 MiB inspect response cannot grow retained output beyond the fixed buffers
  and fails closed. ID resolution and reinspection hangs are independently
  bounded and clean up their full fake process trees.
- The proof marker, token, reader, canonical container ID, and argv remain
  identical across the single permitted confirmed-timeout retry.
- Source checks and behavior events confirm no shell command is introduced and
  no retry decision depends on a raw native exit code.

### Residual Risks

The tests use native Windows processes, actual inherited handles, real
filesystem sharing, Node 20.20.2, and both PowerShell hosts, but fake Docker.
Live Docker Desktop timing and `taskkill` behavior remain operational risks.
Successful `taskkill /T` plus parent exit is the production confirmation signal;
the tests additionally verify the fixture descendant has exited. If termination
cannot be confirmed, the command fails promptly without retry but the external
process tree may require operator or OS cleanup. Fixed 10-second proof bounds
can fail closed on unusually slow hosts, and Docker JSON is decoded as UTF-8.
The resulting immutable commit SHA is reported in the final handoff rather than
embedded in this tracked report.
