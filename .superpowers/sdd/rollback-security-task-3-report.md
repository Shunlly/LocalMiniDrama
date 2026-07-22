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
