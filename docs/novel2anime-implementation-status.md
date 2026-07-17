# Novel2Anime Implementation Status

Date: 2026-07-17
Release scope: LocalMiniDrama 1.3.2 desktop

## Status

The desktop Novel2Anime workflow is implemented end to end and is part of the 1.3.2 release candidate. It covers source intake, extraction, adaptation, asset generation, storyboards, media generation, TTS, FFmpeg composition, QA, repair, export, recovery, and cleanup.

The production E2E uses a deterministic local OpenAI-compatible provider harness so the workflow can be verified without committing external credentials. Availability, quota, billing, and model-specific behavior of any third-party account remain external concerns and must be checked from AI Configuration before a real production run.

## Completed Product Flow

1. Project Readiness exposes one next action across AI configuration, source, script/episodes, assets, storyboards, and media.
2. Source Intake presents `Import source -> Start processing -> QA -> Repair -> Episodes / Timeline` with executable empty and failure states.
3. Film Create and Canvas share project data, action prerequisites, task progress, failure recovery, reference media, first/last frames, and composition output.
4. Media Library supports validated local upload, search, type filtering, URL intake boundaries, preview, download, and cleanup.
5. Production QA requires real local media plus successful non-mock provider audit records for text/image/video/TTS/compositor stages.

## Production Provider Execution

- Text adaptation routes through an active configured text service, including OpenAI-compatible cloud gateways and local Ollama-compatible routes.
- Asset and storyboard images route through configured image services; ComfyUI execution includes workflow submission, history polling, output retrieval, cancellation, timeout, and error sanitization.
- Storyboard video uses the configured video service with bounded polling, retry, cancellation, idempotency, and local media persistence.
- Dialogue and narration use the configured TTS service and persist validated local audio.
- Episode composition validates FFmpeg/FFprobe, combines video and audio tracks, stores a local merged output, and records compositor evidence.
- Provider calls record sanitized audit state, idempotency keys, cost semantics, status, and safe error summaries.

## Source Extraction

- Text-like files are decoded and normalized with upload and content limits.
- PDF sources use embedded text where available and configured OCR for image-only pages.
- Images use the configured OCR-capable vision service.
- Audio uses an active OpenAI-compatible transcription service.
- Video is probed, duration-limited, converted to bounded audio with FFmpeg, and sent to transcription.
- Original source files remain project-scoped and are included in safe project/full-data export policies.

## Reliability And Security

- Workflow runs support pause, resume, retry, cancel, startup recovery, shutdown drain, and recorded step side effects.
- Provider requests apply timeouts, finite retries, cancellation, response-size limits, safe redirects, and SSRF checks.
- AI configuration responses, exports, backups, logs, and Provider errors redact keys, credentials, URL signatures, and nested sensitive fields.
- Import/export and media paths use controlled roots, archive entry/size limits, media signature checks, and rollback cleanup.
- Full data backup verifies SQLite and referenced files; restore refuses a live database/port and retains a pre-restore rollback copy.

## Verification Evidence

Release acceptance requires all of the following on the same source revision:

```bash
npm run verify
npm run verify:docker
npm run verify:e2e
npm run verify:release:source
npm run verify:release:windows
# After independent Gitleaks, Trivy, Defender, extraction, and Fuse checks:
npm run verify:release:artifacts
```

`verify:release:windows` builds and smoke-tests the unverified Setup, Portable, and Unpacked candidate plus SBOMs; it never creates a final release manifest before independent artifact scans pass. The production E2E covers text, asset/storyboard image, video, TTS, FFmpeg composition, playback at desktop viewports, final download, project export, injected failure recovery, and zero-residue cleanup. Final evidence is written under `artifacts/e2e-production/` and must report version `1.3.2`, the release commit SHA, and `working_tree_dirty=false`.

The Trivy vulnerability gate reads the backend, frontend, desktop, and release CycloneDX SBOMs separately. Its configuration gate scans the three real Dockerfiles rather than the extracted application tree. The backend bind-mount ownership exception is path-scoped in `backend-node/.trivyignore.yaml`, recorded in artifact security evidence, and expires on 2027-07-17 for review.

## Deferred Boundaries

### Mobile Web

The 1.3.2 acceptance matrix is desktop-only. Mobile reflow, touch-specific behavior, and a mobile Canvas/list fallback remain deferred and must not be inferred as complete from desktop screenshots or tests.

### External Provider Deep Validation

The generic production adapters and routing are implemented. The release does not claim that every vendor, model revision, private deployment, account quota, or billing policy has been validated. Each real endpoint must be configured locally, connection-tested, and accepted with non-sensitive sample content before production use. Provider credentials are never included in repository, reports, E2E evidence, exports, or backups.

### Desktop Signing And Other Platforms

Windows x64 Setup, Portable, and unpacked are the release targets. Authenticode signing, macOS artifacts, and Linux desktop artifacts are deferred; the macOS build script fails closed instead of producing an unverified artifact.
