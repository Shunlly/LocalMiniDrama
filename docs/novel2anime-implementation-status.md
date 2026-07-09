# Novel2Anime Implementation Status

Date: 2026-07-09

Scope completed in this phase: the 11 non-real-provider tasks plus the final local cleanup pass. Real ComfyUI, Ollama, cloud model, and real FFmpeg provider integrations remain deferred.

## 8 Blocker Cleanup

Completed after the 11-item phase:

1. Old async system fully converged: raw `setImmediate(` calls were removed from `backend-node/src`; legacy fire-and-forget work now goes through `legacyAsyncSchedulerService`, and `asyncAuditService` is a zero-raw-call gate.
2. Production QA gate hardened: production QA rejects `mock://` / `placeholder://` media, requires real media coverage for every storyboard, and requires non-mock provider audit records for `image`, `video`, `tts`, and `compositor`. The local mock workflow runs draft QA by default.
3. Story IR / adaptation quality improved: readable Chinese/English rules now classify sources, split storyboard/script/transcript material, extract characters and locations, infer semantic edges, and write richer episode plan fields (`source_trace`, `beats`, `conflict`, `reveal`, `continuity_notes`).
4. Large file / multimedia intake hardened: Source Intake upload has a 20MB text-file limit, parses metadata JSON strings, and clearly rejects deferred PDF/image/audio/video OCR/transcription.
5. Browser-level E2E validation added: `frontweb/scripts/e2e-smoke.cjs` opens the real frontend with Playwright, creates backend test data, and verifies the workflow panel in browser.
6. Encoding debt cleaned on relevant workflow surfaces: `qaService`, `sourceIntakeService`, `SourceIntakeWorkflowPanel.vue`, and workflow UI utils were cleaned of garbled user-facing text.
7. Host dev environment stabilized: root `doctor` script and `.nvmrc` document the Node 20/Docker path and detect missing native dependencies.
8. Change boundary organized: `docs/novel2anime-change-boundaries.md` records completed areas and deferred real integrations.

## Final Cleanup Pass

Completed on 2026-07-09:

1. AI config secret handling: API responses mask `api_key` and sensitive `settings`, expose `api_key_set`, preserve stored secrets when the frontend sends `********`, and export configs with blank API keys.
2. Saved-config execution paths: connection test, Jimeng material assets, and ModelArk asset proxy can use saved `id` / `config_id` without resending plaintext secrets.
3. Production QA cannot be bypassed by omitting `run_id`; production remediation keeps production mode instead of falling back to draft.
4. Mock-like provider rows are rejected case/space/mock-output aware, and production provider audit must contain successful non-mock output values for every required provider type.
5. Frontend workflow semantics: empty canvas pipelines are invalid, poll results require `status === 'completed'`, one-click/repair flows warn on accumulated failures, and Novel2Anime media/composite UI labels are explicit placeholders.
6. Documentation now states the current provider boundary: classic image/video flows can call configured providers, while Novel2Anime media/TTS/compositor execution remains placeholder-only until the later real-provider integration phase.

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
- Backend Docker verify: check, 49 tests, audit all passed.
- Frontend verify: check, 10 tests, build all passed.
- `http://localhost:5679/health` returned ok.
- `GET /api/v1/ai-configs` returns masked `api_key` plus `api_key_set`.
- Saved-config connection test reached the configured provider and failed with provider-side 503, confirming the saved-secret path is used without sending plaintext from the frontend.

## Deferred

The following are intentionally not implemented in this phase:
- Real Novel2Anime workflow media/TTS provider calls through `providerSdkService`.
- ComfyUI integration.
- Ollama integration.
- Cloud-model production routing.
- FFmpeg-backed Novel2Anime workflow compositor provider integration.
- Provider-side availability and quota failures from external gateways.
