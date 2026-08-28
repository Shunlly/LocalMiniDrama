# Rollback Evidence Binding Design

## Scope

Bind a rollback drill to the exact `data.zip` created by a release checkpoint and to the external data root from which that checkpoint was captured. Preserve the existing standalone drill for CI and local verification.

## Rollback Drill Inputs

`npm run verify:rollback` supports exactly two modes:

- standalone: no CLI arguments; create a temporary backup from configured data, restore it in isolation, remove the temporary archive, and publish evidence;
- checkpoint-bound: the exact paired arguments `--archive <absolute-data.zip> --data-root <absolute-directory>` in either pair order; use the supplied archive, never delete or modify it, and fingerprint the supplied data root before and after the drill.

Any unknown flag, duplicate flag, relative path, missing pair, symbolic link or reparse component, non-regular archive, non-directory data root, or archive nested inside the data root fails before evidence target preparation. Bound mode records the archive identity and SHA-256 both before and after restore and accepts retention only when identity, bytes, and file type remain stable.

Physical identity is an enforceable contract, not a synonym for path plus hash. The Node drill captures `dev`, `ino`, file type, size, `ctimeNs`, and real path from an open archive descriptor, keeps that descriptor open across restore and until `publishEvidence` returns, then compares the descriptor with the path and re-hashes the same descriptor as the final pre-publication check. The Windows checkpoint parent additionally holds `data.zip` open with `FileAccess.Read` and `FileShare.Read` from the first checkpoint hash through metadata publication, so another process may read it but cannot write, delete, rename, or replace it. Tests replace the archive with identical bytes and require the Node identity check to fail; PowerShell tests require the parent lock to block write and replacement while a Node 20 reader succeeds.

## Data Root Fingerprint

The checkpoint-bound mode computes a deterministic SHA-256 over the real data-root tree. Entries are sorted by normalized relative path. The digest includes entry type, UTF-8 relative path, file byte length, and file bytes. Symbolic links and other non-file/non-directory entries are rejected. The tree is fingerprinted before and after the isolated restore; a mismatch fails the drill.

The root directory and every entry also carry a physical identity captured with BigInt `dev` and `ino` values before reading and compared after reading. Each directory is re-enumerated after its descendants are read; its identity and exact entry-name set must be unchanged. The root identity is compared again after the drill. A same-path directory or file replacement therefore fails even when its bytes are identical. Deterministic tests use hooks between the pre-check and post-check; timing races are not accepted as test evidence.

The Windows checkpoint and restore scripts also retain an open directory handle created with `FILE_FLAG_BACKUP_SEMANTICS`, read/write sharing, and no delete sharing. Checkpoint holds it from immediately after Docker bind inspection through metadata publication; restore holds it from identity validation through all image/data mutation and recovery paths. Descendant contents may change, but the root directory itself cannot be deleted, renamed, or replaced during the protected operation.

No path or file content is written to evidence. Only the digest is retained.

## Evidence Schema V3

Publish `localminidrama.rollback-drill.v3`. In addition to the existing source, focused-test, backup, restore, and operation evidence, require:

- `input_mode`: `standalone` or `checkpoint-bound`;
- `backup.archive_retained`: `false` for standalone and `true` for checkpoint-bound;
- `backup.archive_sha256`: SHA-256 of the archive that was actually restored;
- `source.data_root_sha256`: the pre-drill deterministic data-root digest;
- `operations.source_data_root_unchanged`: `true` after comparing the post-drill digest.

`backup.excluded_values` remains an integer in standalone mode and is `null` in checkpoint-bound mode because a retained archive does not expose the in-memory exclusion count. It must never be fabricated as zero. Restored database verification remains the authoritative proof that credentials are excluded.

Evidence publication accepts v3 only and validates the complete mode, digest, boolean, version, and retention relationships itself. Existing v1 and v2 PASS evidence may be archived as prior evidence, but never reused as current evidence. Archive generation names are mapped explicitly as `legacy-v1`, `v2`, and `v3`, including prior v3 evidence from a different application version.

## Checkpoint Schema V5

The checkpoint script creates `data.zip`, computes its hash, and invokes:

```text
npm run verify:rollback -- --archive <checkpoint/data.zip> --data-root <inspected-bind-source>
```

It accepts only a clean v3 checkpoint-bound record whose case-sensitive `status` is exactly `passed` for the captured commit and version. Before writing metadata it requires:

- the summary archive hash equals the checkpoint `backup_sha256`;
- `archive_retained` is true and `data.zip` still exists with the same hash;
- the summary data-root digest is valid and `source_data_root_unchanged` is true;
- the data-root physical identity captured immediately after Docker bind inspection is unchanged before and after shutdown, before and after backup, and before and after the bound drill.

On Windows, physical path identity is read through `GetFileInformationByHandle` and represented as lowercase `<8-hex-volume-serial>:<16-hex-file-index>`. The shared helper accepts regular files and directories, rejects invalid handles, and can read identity from the retained directory handle as well as from a path. Metadata becomes `localminidrama.release-rollback-checkpoint.v5` and stores both `data_root_sha256` and `data_root_identity` alongside the existing backup, bind-source, image, config, and summary hashes.

PowerShell validates schema and mode with case-sensitive comparison, digests with a case-sensitive lowercase hexadecimal pattern, and JSON booleans as actual booleans before comparing their values.

## Restore Fail-Closed Ordering

The restore script accepts v5 only. Before loading/tagging rollback images, stopping containers, creating compensation backups, or restoring data, it must verify:

- every retained checkpoint file and existing hash contract;
- v3 schema, `checkpoint-bound` mode, clean commit and version binding;
- case-sensitive `status: passed` with an actual JSON string value;
- evidence archive hash equals metadata `backup_sha256` and current `data.zip` hash;
- evidence data-root digest equals metadata `data_root_sha256`;
- `archive_retained` and `source_data_root_unchanged` are true;
- the recorded bind-source path remains the inspected live bind source;
- the current bind-source physical identity equals metadata `data_root_identity` before any destructive operation.

The restore must not recompute the old data-root digest against current live data because production data may legitimately have changed after the checkpoint. The v5 cross-binding proves what was drilled at checkpoint creation; the existing compensation backup protects current data before rollback mutation.

## Verification

- Unit tests for strict CLI parsing, paired arguments, path types, pointer/order independence, and deterministic tree hashing.
- Red-green integration tests proving checkpoint-bound mode retains and restores the supplied archive and detects archive, entry, or root replacement even when replacement bytes are identical.
- Executable PowerShell tests for native file/directory identity, a delete-denying archive read lock, a no-delete-sharing directory lock, Node 20 read compatibility, and same-path data-root replacement.
- Release contract tests for v3/v5 fields, exact paired invocation, cross-hash checks, and verification ordering before every destructive operation.
- Executable evidence-publisher and PowerShell preflight tests proving malformed or swapped metadata/summary inputs fail before any destructive command can be reached.
- Standalone `npm run verify:rollback` in CI remains supported and publishes a v3 standalone PASS.
- CI and release workflows validate v3, standalone mode, `archive_retained: false`, a lowercase data-root digest, and `source_data_root_unchanged: true` before uploading evidence.
- `docs/quickstart.md` documents v3/v5, the paired checkpoint drill, and the standalone single-root layout requirement.
- Final checkpoint and restore against the actual external Docker bind root, followed by an offline standalone drill after Docker shutdown.

## Out Of Scope

- Including Provider credentials in backups.
- Treating current live data equality with checkpoint-time data as a restore prerequisite.
- Backward-compatible restore of v4 checkpoints; old checkpoints remain inspectable but are not release-authoritative.
