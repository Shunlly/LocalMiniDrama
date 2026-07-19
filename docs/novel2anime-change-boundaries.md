# Novel2Anime Change Boundaries

Date: 2026-07-19
Release scope: LocalMiniDrama 1.3.3 desktop release candidate

## Implemented Boundary

- Workflow core: Source Intake, Story IR, runs/steps, pause/resume/retry/cancel/recovery, QA, remediation, timeline, Provider audit, skill audit, idempotency, and cost semantics.
- Production media: configured text, asset-image, storyboard-image, video, and TTS routes plus FFmpeg/FFprobe composition and local output validation.
- Local integrations: Ollama-compatible text routing and ComfyUI workflow execution with polling, retrieval, cancellation, timeout, and sanitized errors.
- Source extraction: text, PDF, image OCR, audio transcription, and video-to-audio transcription with explicit size/duration/resource limits.
- Desktop Web: project readiness, five-step source workflow, list production, Canvas workflows, Material Center, AI service coverage, progressive configuration, failure recovery, and desktop accessibility.
- Operations: production Docker, health/readiness checks, full-data backup/restore, rollback evidence, structured privacy-safe logs, release manifests, SBOMs, and checksum verification.
- Verification: backend/frontend/desktop suites, Docker/Node.js 20 verification, browser acceptance, production E2E, release contract tests, dependency audit, four-SBOM vulnerability scanning, Dockerfile configuration scanning, artifact secret scanning, Defender, exact release-attachment checks, per-package Electron Fuse evidence, and cross-run SHA-256 binding of scanned Windows artifacts. Production E2E uses a local protocol-compatible Provider to prove the complete non-mock contract; it is not evidence that every external account/model/quota combination has been deeply validated.

## Deferred Boundary

- Mobile Web reflow, touch behavior, and mobile Canvas/list-mode fallback.
- Authenticode signing and signed-distribution reputation work.
- macOS and Linux desktop artifacts; macOS packaging currently fails closed.
- Vendor-specific deep validation for every external Provider/account/model/quota combination. The common adapters are implemented, but each real deployment still requires local configuration and connection testing.

## Acceptance Rules

- Draft/mock workflows may use fixtures, but production QA rejects mock/placeholder media and requires successful non-mock text/asset_image/image/video/TTS/compositor evidence.
- A release candidate is accepted only when source tests, Docker verification, clean-source production E2E, Windows artifact smoke tests, SBOM/manifest/checksum verification, Gitleaks, PR checks, and final product/security review all pass on the same commit.
- Provider credentials and signed URLs must not appear in Git history, logs, screenshots, reports, exports, backups, E2E evidence, or release artifacts.
