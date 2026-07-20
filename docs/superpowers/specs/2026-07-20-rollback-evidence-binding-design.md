# Rollback Evidence Binding Design

## Scope

Bind a rollback drill to the exact `data.zip` created by a release checkpoint and to the external data root from which that checkpoint was captured. Preserve the existing standalone drill for CI and local verification.

## Rollback Drill Inputs

`npm run verify:rollback` supports exactly two modes:

- standalone: no CLI arguments; create a temporary backup from configured data, restore it in isolation, remove the temporary archive, and publish evidence;
- checkpoint-bound: the exact paired arguments `--archive <absolute-data.zip> --data-root <absolute-directory>` in either pair order; use the supplied archive, never delete or modify it, and fingerprint the supplied data root before and after the drill.

Any unknown flag, duplicate flag, relative path, missing pair, symbolic link, non-regular archive, non-directory data root, or archive nested inside the data root fails before evidence target preparation.

## Data Root Fingerprint

The checkpoint-bound mode computes a deterministic SHA-256 over the real data-root tree. Entries are sorted by normalized relative path. The digest includes entry type, UTF-8 relative path, file byte length, and file bytes. Symbolic links and other non-file/non-directory entries are rejected. The tree is fingerprinted before and after the isolated restore; a mismatch fails the drill.

No path or file content is written to evidence. Only the digest is retained.

## Evidence Schema V3

Publish `localminidrama.rollback-drill.v3`. In addition to the existing source, focused-test, backup, restore, and operation evidence, require:

- `input_mode`: `standalone` or `checkpoint-bound`;
- `backup.archive_retained`: `false` for standalone and `true` for checkpoint-bound;
- `backup.archive_sha256`: SHA-256 of the archive that was actually restored;
- `source.data_root_sha256`: the pre-drill deterministic data-root digest;
- `operations.source_data_root_unchanged`: `true` after comparing the post-drill digest.

Evidence publication accepts v3 only. Existing v1 and v2 PASS evidence may be archived as prior evidence, but never reused as current evidence.

## Checkpoint Schema V5

The checkpoint script creates `data.zip`, computes its hash, and invokes:

```text
npm run verify:rollback -- --archive <checkpoint/data.zip> --data-root <inspected-bind-source>
```

It accepts only a clean v3 checkpoint-bound PASS for the captured commit and version. Before writing metadata it requires:

- the summary archive hash equals the checkpoint `backup_sha256`;
- `archive_retained` is true and `data.zip` still exists with the same hash;
- the summary data-root digest is valid and `source_data_root_unchanged` is true.

Metadata becomes `localminidrama.release-rollback-checkpoint.v5` and stores `data_root_sha256` alongside the existing backup, bind-source, image, config, and summary hashes.

## Restore Fail-Closed Ordering

The restore script accepts v5 only. Before loading/tagging rollback images, stopping containers, creating compensation backups, or restoring data, it must verify:

- every retained checkpoint file and existing hash contract;
- v3 schema, `checkpoint-bound` mode, clean commit and version binding;
- evidence archive hash equals metadata `backup_sha256` and current `data.zip` hash;
- evidence data-root digest equals metadata `data_root_sha256`;
- `archive_retained` and `source_data_root_unchanged` are true;
- the recorded bind-source path remains the inspected live bind source.

The restore must not recompute the old data-root digest against current live data because production data may legitimately have changed after the checkpoint. The v5 cross-binding proves what was drilled at checkpoint creation; the existing compensation backup protects current data before rollback mutation.

## Verification

- Unit tests for strict CLI parsing, paired arguments, path types, pointer/order independence, and deterministic tree hashing.
- Red-green integration tests proving checkpoint-bound mode retains and restores the supplied archive and detects data-root mutation.
- Release contract tests for v3/v5 fields, exact paired invocation, cross-hash checks, and verification ordering before every destructive operation.
- Standalone `npm run verify:rollback` in CI remains supported and publishes a v3 standalone PASS.
- Final checkpoint and restore against the actual external Docker bind root, followed by an offline standalone drill after Docker shutdown.

## Out Of Scope

- Including Provider credentials in backups.
- Treating current live data equality with checkpoint-time data as a restore prerequisite.
- Backward-compatible restore of v4 checkpoints; old checkpoints remain inspectable but are not release-authoritative.
