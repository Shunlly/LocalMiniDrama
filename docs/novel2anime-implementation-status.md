# Novel2Anime Implementation Status

Date: 2026-07-10

Scope completed through 2026-07-10: the 11 non-real-provider tasks, 8 blocker cleanups, the final local cleanup pass, and 9 desktop Web upgrades. Desktop Web is accepted; mobile Web and real Novel2Anime provider execution remain deferred.

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

## Desktop Web Upgrade Completion (9/9)

Completed and accepted on 2026-07-10:

| # | Upgrade | Completion |
|---|---|---|
| 1 | Shared disabled-action semantics | Enabled primary actions retain their emphasis; disabled actions are visibly muted, have no shadow, use `not-allowed`, and expose a blocking reason or a direct recovery action on the upgraded workflow surfaces. |
| 2 | Project home | Project titles and actions no longer compete for the same space; export/edit/delete are in a stable action menu, the material entry is consolidated, and the no-project state links directly to create, import, and Material Center actions. |
| 3 | Material Center | `/media-library` is the desktop entry for reusable images and videos, with upload, server-side name search, type filters, explicit empty/no-result states, and clear boundaries for project-side URL import and character/scene/prop library intake. The backend streams uploads through temporary disk files, validates image/video signatures, assigns a safe server-side extension, and cleans temporary or rolled-back files; the single-file limit remains 100MB. |
| 4 | AI service readiness | AI Configuration summarizes text, material image, storyboard image, video, and TTS coverage, including configured/default state and persisted or session connection-test state, with add/view/edit/test actions. |
| 5 | Progressive AI configuration form | The dialog is grouped into basic information, provider/authentication, model, and call-policy sections; advanced endpoint/protocol settings are collapsed by default. |
| 6 | Project readiness and one next step | Project Detail summarizes six production stages (AI configuration, source, script/episodes, assets, storyboards, and media) and exposes one current next action. Empty episode states point to the exact prerequisite. |
| 7 | Five-step story-source flow | Source Intake, Workflow, QA, remediation, and delivery are presented as `Import source -> Start processing -> QA -> Repair -> Episodes / Timeline`, with current-step summaries, action reasons, and executable empty states. |
| 8 | List production workspace | `FilmCreate` delegates full-pipeline controls to a dedicated panel, groups generation settings, and gates project, episode, storyboard, batch, pipeline, and composition actions with concrete prerequisite or in-progress reasons. |
| 9 | Canvas workspace | Desktop canvas controls are split into Create, Workflow, and Batch Generate groups; workflow controls appear only with useful selection/saved-workflow context, the empty canvas provides one primary action plus a List Mode fallback, and light-theme nodes use readable semantic surfaces with non-overlapping default columns. |

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

Accepted on 2026-07-10 with the current working tree:

```bash
docker compose up -d --build
npm run verify:docker
npm --prefix frontweb run verify
npm run verify:e2e
```

Docker validation result:
- Images rebuilt successfully from the current source; backend and frontend containers started, and the backend reported healthy.
- Backend Docker/Node 20 verify: 116 JavaScript files checked, **78/78 tests passed**, and the flow audit passed.
- Frontend verify: 85 JavaScript files checked, **91/91 tests passed**, and the Vite production build completed (1,658 modules transformed).
- `http://localhost:5679/health` returned `{ "status": "ok" }`.

E2E and browser acceptance:
- `npm run verify:e2e` passed. The Playwright smoke test creates a temporary drama and source inside a guarded `try/finally`, opens `/drama/:id` at 1366 x 900, verifies Project Readiness and all five source-flow steps plus Start Processing, then closes the browser, removes the registered source directory, calls the regular DELETE route, and runs the Docker-only hard-purge script. The purge verifies that the fixture leaves no related SQLite rows or `data/story_sources/<id>` directory.
- Desktop browser walkthrough passed at 1440 x 900 for project cards, Material Center, AI service readiness and the progressive configuration dialog, Project Readiness and the five-step source flow, List Production, and Canvas. All six pages had no root-level horizontal overflow; the final walkthrough produced no console warning or error.
- Disabled primary actions were visually and programmatically confirmed as muted, shadow-free, and `not-allowed`, while blocker text and recovery actions remained visible.

## Deferred

The following are intentionally outside the accepted scope:

### Mobile Web

- The 9/9 completion and browser acceptance above are desktop-only.
- The 2026-07-10 audit found the 390 x 844 project home, Project Detail, and List Production pages not acceptable because of horizontal overflow and desktop-only form/header layout. Mobile reflow, touch behavior, and a mobile Canvas/list-mode fallback are deferred and must not be inferred as complete from the desktop result.

### Real Novel2Anime Providers

- Existing classic text/image/video flows may call providers saved in AI Configuration; that capability is not the deferred item.
- The Novel2Anime unified workflow still uses mock/placeholder execution for real image/video media, TTS, and compositor steps through `providerSdkService`. Browser and E2E acceptance did not call or validate external generation providers.
- Real ComfyUI and Ollama adapters, cloud-model production routing for the Novel2Anime workflow, real TTS/media provider execution, and the FFmpeg-backed Novel2Anime compositor adapter remain deferred.
- Production QA deliberately rejects placeholder media and requires successful non-mock audit output for `image`, `video`, `tts`, and `compositor`; provider availability, quota, and gateway failures remain external integration concerns.
