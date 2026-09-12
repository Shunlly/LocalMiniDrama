# Git LFS Example Release Integrity Design

## Scope

Prove that the 82 MB example drama tracked by Git LFS is present as real bytes in source checkouts, is packaged unchanged in Setup, Portable, and Unpacked applications, and can be imported by the packaged Unpacked application.

The authoritative asset is:

- path: `example_drama/衣服设计天才302.zip`
- bytes: `82156132`
- SHA-256: `f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9`

## Source Contract

Create one shared Node.js contract that exports the authoritative descriptor and verifies a candidate file as a real regular file with the exact byte count and SHA-256. It must reject a Git LFS pointer, a symbolic link, a missing file, and changed bytes.

The root package exposes `verify:example-drama`. The CI `desktop` checkout and release `build-windows` checkout use `actions/checkout` with `lfs: true`, then run the source verifier after the pinned Node.js 20 setup and before dependency installation or packaging. The general root `check` gate runs only the small fixture tests for the verifier; it must not execute the 82 MB production-file check because the Ubuntu source-contract checkout intentionally does not download LFS content. Other jobs that neither build nor inspect the asset do not download LFS content.

## Packaged Artifact Contract

The Windows artifact preparation step already extracts Setup, Portable, and Unpacked and locates one packaged application per artifact. For each application it must:

- derive the application `resources` directory from its validated `app.asar` location;
- verify `resources/example_drama/衣服设计天才302.zip` with the shared source contract;
- record the normalized relative path, byte count, and SHA-256 in the artifact inventory;
- require the exact descriptor for all three application roots.

Inventory validation must reject a missing descriptor, traversal path, wrong root, wrong size, wrong digest, duplicate root, or disagreement between recorded evidence and extracted bytes.

## Packaged Import Smoke

The Unpacked smoke is the authoritative functional import test because it exposes an ordinary application directory and runs the same embedded backend as the other Windows artifacts. Once `/health`, `/ready`, and renderer readiness pass, it must:

1. request `GET /api/v1/dramas/examples` and require the authoritative filename;
2. request `POST /api/v1/dramas/import-example` with the dynamic same-origin write headers and that filename;
3. allow the import request to use the overall smoke timeout instead of the two-second health-probe timeout;
4. require HTTP 201, `success: true`, a positive `data.drama_id`, and a non-empty title;
5. query the created drama and require the imported identifier and title to be visible.

The smoke uses a fresh isolated user-data directory and performs no Provider call.

## Artifact Secret Scan

Gitleaks must scan the extracted release with:

```text
--max-archive-depth 1 --max-target-megabytes 256
```

The depth includes ZIP contents such as the bundled example while the size limit admits the 82 MB asset. The existing artifact-specific configuration and redaction remain mandatory.

## Failure Handling

- A checkout that leaves the LFS pointer fails before dependency installation or packaging.
- Packaging or artifact extraction fails closed if any of the three applications lacks the exact asset.
- A list-only smoke is insufficient; the actual import and subsequent read-back must pass.
- The artifact inventory is not accepted unless every application has independently verified example evidence.

## Verification

- Unit tests for source size/hash verification and LFS-pointer rejection.
- Desktop artifact tests for the exact three-root evidence matrix and extracted-byte tampering.
- Desktop smoke contract tests for list, import, timeout, and read-back behavior.
- Root release contract tests for both `lfs: true` checkouts, source gates, artifact verification, and Gitleaks archive options.
- A final Windows build proving source verification, all three artifact checks, and the Unpacked functional import.

## Out Of Scope

- Downloading LFS content at application runtime.
- Functional import smoke in all three packaging formats; content equality is proven for all three and functional import is proven once in Unpacked.
- Adding more bundled example archives.
