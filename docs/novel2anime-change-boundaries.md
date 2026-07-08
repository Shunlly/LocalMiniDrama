# Novel2Anime Change Boundaries

Date: 2026-07-08

This document separates completed local/mock workflow work from deferred real integrations.

## Completed Boundary

- Backend workflow core: Source Intake, Story IR, workflow runs, pause/resume/retry/cancel, QA reports, remediation, timelines, provider/skill audit records.
- Backend hardening: legacy async scheduler, zero raw `setImmediate` audit, production QA non-mock media gate, upload size/type guard.
- Frontend workflow UI: Source Intake panel, workflow status, QA/remediation controls, timeline summary, source detail drawer, clean workflow labels.
- Verification: backend tests/audit, frontend tests/build, Docker verify, Playwright browser smoke script, host doctor script.
- Docs: implementation status, change boundaries, deferred integration list.

## Deferred Boundary

The following remain intentionally out of scope until the real integration phase:

- Real ComfyUI image generation.
- Real Ollama local model routing.
- Real cloud provider routing for production image/video/audio generation.
- Real FFmpeg compositor as the workflow compositor.
- Real PDF OCR, image OCR, audio transcription, and video transcription for Source Intake.

## Acceptance Rule

Mock/local workflows may pass draft QA. Production QA must not pass unless generated media records and storyboard media paths are non-mock.
