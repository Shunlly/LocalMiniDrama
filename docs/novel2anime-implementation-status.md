# Novel2Anime Implementation Status

Date: 2026-07-08

Scope completed in this phase: the 11 non-real-provider tasks. Real ComfyUI, Ollama, cloud model, and real FFmpeg provider integrations remain deferred.

## 8 Blocker Cleanup

Completed after the 11-item phase:

1. Old async system fully converged: raw `setImmediate(` calls were removed from `backend-node/src`; legacy fire-and-forget work now goes through `legacyAsyncSchedulerService`, and `asyncAuditService` is a zero-raw-call gate.
2. Production QA gate hardened: production QA rejects `mock://` media and `provider='mock'` generation records. The local mock workflow runs draft QA by default.
3. Story IR / adaptation quality improved: readable Chinese/English rules now classify sources, split storyboard/script/transcript material, extract characters and locations, infer semantic edges, and write richer episode plan fields (`source_trace`, `beats`, `conflict`, `reveal`, `continuity_notes`).
4. Large file / multimedia intake hardened: Source Intake upload has a 20MB text-file limit, parses metadata JSON strings, and clearly rejects deferred PDF/image/audio/video OCR/transcription.
5. Browser-level E2E validation added: `frontweb/scripts/e2e-smoke.cjs` opens the real frontend with Playwright, creates backend test data, and verifies the workflow panel in browser.
6. Encoding debt cleaned on relevant workflow surfaces: `qaService`, `sourceIntakeService`, `SourceIntakeWorkflowPanel.vue`, and workflow UI utils were cleaned of garbled user-facing text.
7. Host dev environment stabilized: root `doctor` script and `.nvmrc` document the Node 20/Docker path and detect missing native dependencies.
8. Change boundary organized: `docs/novel2anime-change-boundaries.md` records completed areas and deferred real integrations.

## Completed 11 Items

1. Legacy async containment: added `asyncAuditService` and audit-script enforcement for current `setImmediate` entrypoints.
2. Legacy entrypoint workflow bridge: `/dramas/import-novel` writes Source Intake records when `drama_id` is supplied, and existing sources can start workflows.
3. Backend file upload: added `POST /dramas/:id/story-sources/upload` for text-like source files.
4. Story IR enhancement: event graph now includes inferred `cause`, `conflict`, `reveal`, and `hook` edges in addition to `next`.
5. QA auto-remediation: added granular actions `refresh_asset_bible`, `repair_storyboards`, `repair_timeline`, and `start_or_retry_workflow`.
6. Skill / prompt split: added local templates under `backend-node/prompts/skills/`.
7. Character consistency: added local continuity snapshots, identity anchors, stages, and mock reference assets.
8. Timeline enhancement: added drama/episode timeline APIs, SRT export, and manifest export.
9. Frontend workflow experience: added backend upload use, source detail drawer, workflow detail expansion, QA remediation progress, and timeline summary.
10. Tests and audits: expanded backend and frontend tests plus flow audit coverage.
11. Documentation and validation: this file records the completed scope and deferred real-provider scope.

## Validation

Passing commands:

```bash
npm --prefix backend-node run check
npm --prefix backend-node run audit
npm --prefix frontweb run check
node --test frontweb/test/novel2animeWorkflowUi.test.js
npm --prefix frontweb run build
npm run doctor
npm run verify:e2e
docker compose up -d --build
npm run verify:docker
```

Docker validation result:
- Backend verify: check, 43 tests, audit all passed.
- Frontend verify: check, 8 tests, build all passed.
- `http://localhost:5679/health` returned ok.
- `http://localhost:3013/api/v1/dramas` returned a successful API response through the frontend proxy.

## Deferred

The following are intentionally not implemented in this phase:
- Real image/video/audio provider calls.
- ComfyUI integration.
- Ollama integration.
- Cloud-model production routing.
- Real FFmpeg composition as the workflow compositor.
