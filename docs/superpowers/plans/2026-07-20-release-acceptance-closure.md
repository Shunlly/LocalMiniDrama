# Release Acceptance Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make incomplete AI-service links open the affected configuration directly and expand clean-commit desktop visual evidence from 20 to 28 screenshots.

**Architecture:** Reuse `serviceCoverage` as the authoritative post-load routing state and reuse the existing add/edit dialogs rather than adding route state or a new workflow. Extend the existing acceptance capture contract with four deterministic surfaces and teach the production E2E preparer/readiness predicate how to navigate and validate them.

**Tech Stack:** Vue 3, Vue Router, Element Plus, Node.js 20 built-in test runner, Playwright, Docker Compose.

## Global Constraints

- Mobile layout work remains out of scope.
- Real third-party Provider account, quota, and model validation remains out of scope.
- A failed connection must never trigger an automatic external request.
- Every capture must reject visible loading masks, blank output, and protected Provider values.
- Final evidence must bind exactly 28 original-viewport PNG files to a clean full Git commit.

---

### Task 1: Direct AI Configuration Entry

**Files:**
- Modify: `frontweb/src/components/AIConfigContent.vue`
- Test: `frontweb/test/aiConfigContentSource.test.js`

**Interfaces:**
- Consumes: `serviceCoverage.value.services`, `shouldAutoOpenRequestedService(coverageItem)`, `openAddForService(serviceType)`, `openEdit(row, { repairIssue })`, and `configWriteLocked.value`.
- Produces: `applyRequestedService(serviceType)` that opens add for a missing service, opens edit for a non-ready target configuration, and otherwise focuses the filtered list.

- [ ] **Step 1: Write the failing source-contract test**

Add assertions to `project readiness service links are consumed as an AI configuration filter`:

```js
assert.match(source, /coverageItem\?\.targetConfig\s*&&\s*!coverageItem\.ready/)
assert.match(source, /await openEdit\(coverageItem\.targetConfig, \{ repairIssue: coverageItem\.issue \}\)/)
assert.ok(
  source.indexOf('shouldAutoOpenRequestedService(coverageItem)')
    < source.indexOf('coverageItem?.targetConfig && !coverageItem.ready'),
)
assert.ok(
  source.indexOf('coverageItem?.targetConfig && !coverageItem.ready')
    < source.indexOf('await focusServiceConfigs(normalized)'),
)
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
node --test frontweb/test/aiConfigContentSource.test.js
```

Expected: the project-readiness deep-link test fails because `applyRequestedService` only adds or filters.

- [ ] **Step 3: Implement the minimal authoritative auto-open behavior**

In `applyRequestedService`, after the missing-service branch and before `focusServiceConfigs`, add:

```js
if (coverageItem?.targetConfig && !coverageItem.ready && !configWriteLocked.value) {
  await openEdit(coverageItem.targetConfig, { repairIssue: coverageItem.issue })
  return
}
```

Do not call `openTest`; connection failures open edit without performing a Provider request.

- [ ] **Step 4: Verify GREEN and the related repair tests**

Run:

```powershell
node --test frontweb/test/aiConfigContentSource.test.js frontweb/test/aiConfigRepairTarget.test.js frontweb/test/aiConfigWorkspace.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Request focused review and commit**

Review requirements: current coverage state is authoritative, dependency failures remain fail closed, and no navigation performs a connection test.

```powershell
git add -- frontweb/src/components/AIConfigContent.vue frontweb/test/aiConfigContentSource.test.js
git commit -m "fix: open incomplete AI configs from readiness"
```

---

### Task 2: Expand Final Visual Evidence To Main Desktop Surfaces

**Files:**
- Modify: `frontweb/scripts/acceptance-report-contract.cjs`
- Modify: `frontweb/scripts/e2e-production.cjs`
- Test: `frontweb/test/acceptanceReportVerifier.test.js`
- Test: `frontweb/test/e2eProductionContract.test.js`

**Interfaces:**
- Consumes: `captureMatrix(surface, viewports)`, `REQUIRED_FINAL_CAPTURES`, `prepareAcceptanceCaptureSurface(page, capture, fixture)`, and `waitForAcceptanceCaptureReadiness(page, capture, fixture)`.
- Produces: exact surfaces `project-list`, `media-library`, `drama-canvas`, and `free-create`, each at `1280x720` in `light` and `dark` themes.

- [ ] **Step 1: Write the failing exact-matrix test**

Change the matrix expectation in `acceptanceReportVerifier.test.js` from 20 to 28 and append these exact entries:

```js
'project-list:1280x720:light',
'project-list:1280x720:dark',
'media-library:1280x720:light',
'media-library:1280x720:dark',
'drama-canvas:1280x720:light',
'drama-canvas:1280x720:dark',
'free-create:1280x720:light',
'free-create:1280x720:dark',
```

Update final-verification fixture counts from `20` to `28` only where they assert `REQUIRED_FINAL_CAPTURES` output.

- [ ] **Step 2: Write failing E2E preparation/readiness contracts**

Extend `createCaptureReadinessPage` with visible nodes for:

```js
'.film-list': visible(),
'.projects-wrap[aria-busy="false"]': visible(),
'.project-grid': visible(),
'.media-library-page': visible(),
'.media-grid[aria-busy="false"]': visible(),
'.empty-media': visible(),
'.drama-canvas-page': visible(),
'.canvas-shell': visible(),
'.vue-flow-canvas': visible(),
'.free-create-page': visible(),
'.input-panel': visible(),
'.service-readiness.is-ready': visible(),
```

Add one successful readiness test per new surface and source assertions that preparation contains these destinations:

```js
`${FRONTEND_URL}/`
`${FRONTEND_URL}/media-library`
`${FRONTEND_URL}/film/${fixture.dramaId}/canvas?episode=${episodeId}`
`${FRONTEND_URL}/free-create`
```

- [ ] **Step 3: Run the two contract suites and verify RED**

Run:

```powershell
node --test frontweb/test/acceptanceReportVerifier.test.js frontweb/test/e2eProductionContract.test.js
```

Expected: failures show the old 20-capture matrix and unknown new readiness surfaces.

- [ ] **Step 4: Extend the exact capture matrix**

Append to `REQUIRED_FINAL_CAPTURES`:

```js
...captureMatrix('project-list', [[1280, 720]]),
...captureMatrix('media-library', [[1280, 720]]),
...captureMatrix('drama-canvas', [[1280, 720]]),
...captureMatrix('free-create', [[1280, 720]]),
```

- [ ] **Step 5: Add deterministic route preparation**

Add this helper and use its return value in `prepareAcceptanceCaptureSurface`:

```js
function acceptanceCaptureUrl(capture, fixture) {
  const episodeId = fixture.completedDrama.episodes[0].id
  const urls = {
    'project-readiness': `${FRONTEND_URL}/drama/${fixture.dramaId}#source-intake-workflow`,
    'film-pipeline': `${FRONTEND_URL}/film/${fixture.dramaId}?episode=${episodeId}`,
    'ai-config-management': `${FRONTEND_URL}/film/${fixture.dramaId}?episode=${episodeId}`,
    'ai-config-coverage': `${FRONTEND_URL}/film/${fixture.dramaId}?episode=${episodeId}`,
    'project-list': `${FRONTEND_URL}/`,
    'media-library': `${FRONTEND_URL}/media-library`,
    'drama-canvas': `${FRONTEND_URL}/film/${fixture.dramaId}/canvas?episode=${episodeId}`,
    'free-create': `${FRONTEND_URL}/free-create`,
  }
  assert.ok(urls[capture.surface], `unknown acceptance capture surface ${capture.surface}`)
  return urls[capture.surface]
}
```

Only the existing four focused surfaces enter the project-readiness or film/AI preparation branches. The four new surfaces navigate directly, set the requested theme, and do not open the AI workspace dialog.

- [ ] **Step 6: Add fail-closed readiness predicates**

Require:

```text
project-list: .film-list + .projects-wrap[aria-busy="false"] + .project-grid
media-library: .media-library-page + .media-grid[aria-busy="false"] + (.media-card or .empty-media), with no .data-load-state
drama-canvas: .drama-canvas-page + .canvas-shell + (.vue-flow-canvas or .canvas-start-state)
free-create: .free-create-page + .input-panel + .service-readiness.is-ready
```

Keep the global visible loading-mask rejection before each surface branch and return `false` for unknown surfaces.

- [ ] **Step 7: Verify GREEN**

Run:

```powershell
node --test frontweb/test/acceptanceReportVerifier.test.js frontweb/test/e2eProductionContract.test.js
npm --prefix frontweb run verify
```

Expected: both contract files and the full frontend verification pass; Windows symlink tests may remain permission-skipped.

- [ ] **Step 8: Request focused review and commit**

Review requirements: exact 28-item ordering, no readiness weakening, valid deterministic routes, and no automatic Provider calls.

```powershell
git add -- frontweb/scripts/acceptance-report-contract.cjs frontweb/scripts/e2e-production.cjs frontweb/test/acceptanceReportVerifier.test.js frontweb/test/e2eProductionContract.test.js
git commit -m "test: cover main desktop surfaces in release evidence"
```

---

### Task 3: Release Verification And Product Acceptance

**Files:**
- Verify only: repository source, Docker images, external data root, `artifacts/e2e-production`, and `desktop/release`.

**Interfaces:**
- Consumes: the clean final Git SHA, Docker Compose revision labels, production E2E evidence, rollback checkpoint schema v5 with drill schema v3, and release security scripts.
- Produces: passing final evidence, 28 screenshot descriptors, passing rollback evidence, scanned Windows artifacts, and a pushed branch whose remote SHA equals local HEAD.

- [ ] **Step 1: Run source gates on Node 20**

Run:

```powershell
$env:PATH='C:\Users\33028\AppData\Local\Temp\node-v20.20.2-win-x64;' + $env:PATH
$env:FFMPEG_PATH='C:\Users\33028\AppData\Local\Temp\localminidrama-media-62b9b662-53e4-4867-82c9-a142f31349ea\payload\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe'
$env:FFPROBE_PATH='C:\Users\33028\AppData\Local\Temp\localminidrama-media-62b9b662-53e4-4867-82c9-a142f31349ea\payload\ffmpeg-8.1.2-essentials_build\bin\ffprobe.exe'
npm run verify
git diff --check
gitleaks git --config .gitleaks.toml --redact --no-banner --log-opts=--all
gitleaks dir . --config .gitleaks-worktree.toml --redact --no-banner
npm --prefix backend-node audit --audit-level=high
npm --prefix frontweb audit --audit-level=high
npm --prefix desktop audit --audit-level=high
```

Expected: every command exits zero; Gitleaks reports no leaks; each audit reports zero vulnerabilities.

- [ ] **Step 2: Commit any gate-only source changes and require a clean tree**

Expected:

```powershell
git status --short
```

prints nothing before Docker build.

- [ ] **Step 3: Rebuild production Docker with an external data root**

Create a repository-external temporary directory, set `LOCALMINIDRAMA_DATA_DIR`, run `npm run docker:e2e:up`, and verify backend/frontend/e2e-provider images and container revision labels equal the full final SHA.

- [ ] **Step 4: Run container and production E2E gates**

Run:

```powershell
npm run verify:docker
npm run verify:e2e
```

Expected: `evidence.json` is `passed`, source commit equals final HEAD, cleanup passes, and final acceptance report contains 28 original-viewport PNGs.

- [ ] **Step 5: Execute rollback and security gates**

Run real checkpoint plus restore against the inspected external bind root, Trivy 0.64.1 HIGH/CRITICAL scans for backend/frontend images, source/worktree Gitleaks, and the offline rollback drill after Docker shutdown.

- [ ] **Step 6: Execute Windows desktop release gates**

Run `npm run verify:release:windows`, desktop smoke, artifact Gitleaks, Defender, Trivy/SBOM verification, and release metadata verification with Node 20 and trusted media tools.

- [ ] **Step 7: Perform browser acceptance**

Inspect the application and HTML report at production Docker URLs. Confirm the four new light/dark surfaces are nonblank, correctly framed, and free of overlaps; confirm an incomplete AI configuration opens its edit dialog and structural field; confirm final report verifier exits zero.

- [ ] **Step 8: Final independent reviews and push**

Require product, code, release, and security reviewers to report zero P1/P2. Push `codex/release-trivy-source-build-fix`, then verify the remote branch SHA equals local HEAD.
