# Hybrid Infinite Canvas Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop hybrid free-creation layer to the existing short-drama Vue Flow workbench while preserving production nodes, project data, provider gates, and backward-compatible canvas persistence.

**Architecture:** Keep `buildDramaCanvasGraph()` as the production graph source. Add a small, schema-validated `free_canvas` metadata model and a separate adapter/state layer for free nodes, then merge the two graphs in `DramaCanvas.vue`. Reuse the existing canvas-layout endpoint with partial metadata updates, existing upload/media/request utilities, and the current production readiness gates. The first release is desktop-only and does not add real-provider routes or AGPL source.

**Tech Stack:** Vue 3 `<script setup>`, Vue Flow 1.48, Element Plus, Node.js built-in test runner, Express, SQLite metadata JSON, Playwright production E2E, Docker Compose.

## Execution Status (2026-07-27)

This summary records delivered implementation separately from runtime release evidence. The original task checklists below remain as the execution recipe and are not mechanically checked off.

| Scope | Status | Evidence boundary |
| --- | --- | --- |
| Tasks 1-5 | **Implementation complete** | Serializable state, validated persistence, graph/history behavior, free-mode presentation, same-route workbench integration, media handling, explicit production conversion, and import/export are implemented. |
| Product acceptance | **8/8 implemented; `Spec PASS / Quality PASS`** | All eight findings passed three scoped review rounds. This is code/product-contract acceptance, not Docker runtime evidence. |
| ZIP import/export | **`Spec PASS / Security PASS`** | Scoped safety review covers bounded validation, project/media identity, archive manifest integrity, and fail-closed import/export behavior. |
| Task 6 code and contract | **Complete; `Spec PASS / Quality PASS`** | Browser workflow code, evidence manifest/verifier contract, cleanup contract, and serial production-gate wiring are present and reviewed. Tests do not call an external real Provider. |
| Task 6 runtime matrix | **`UNVERIFIED`** | Docker production E2E has not been executed for 1280x720, 1366x768, and 1440x900 in light and dark themes. No fresh screenshot or runtime manifest is claimed. |
| Task 7 documentation | **Complete** | User, package, operations, roadmap, changelog, and standalone report documentation are updated. |
| Task 7 final release gate | **Pending** | Docker rebuild, production E2E, same-revision package/security/release gates, evidence inspection, and the release decision remain open. |

The shipped scope is desktop only. Mobile/touch behavior, new real Provider routes, collaboration, and a complete Agent/MCP surface remain deferred.

## Global Constraints

- Keep existing `canvas_layout` and `workflow_groups` data readable and writable.
- Store new data under `metadata.free_canvas`; do not overwrite unknown metadata fields.
- Allowed free node types are `text`, `image`, `video`, `config`, and `reference`.
- Enforce 500 free nodes, 1000 free edges, and 50,000 characters per text node at the API boundary.
- Do not persist API keys, authorization headers, raw provider responses, or unvalidated large base64 payloads.
- Use existing project isolation, media network policy, upload validation, request timeout, cancellation, retry, and sanitized error helpers.
- Do not copy AGPL source, images, icons, or storage implementation from the reference project.
- Mobile/touch reflow, new real Provider routes, public collaboration, and full Agent/MCP chat are out of this release.
- Verify at 1280x720, 1366x768, and 1440x900 in light and dark themes.
- Use Node 20 for backend verification and Docker verification as required by `AGENTS.md`.

## File Map

Create focused pure modules for the new serializable state and graph transformation. Keep orchestration in the existing view until the behavior is stable; do not perform an unrelated `DramaCanvas.vue` rewrite.

**New frontend files:**

- `frontweb/src/utils/freeCanvasState.js`: schema defaults, normalization, limits, node/edge mutations, copy/paste ID rewriting, and serialization.
- `frontweb/src/utils/freeCanvasAdapter.js`: free model to Vue Flow graph and production reference summaries.
- `frontweb/src/utils/canvasHistory.js`: bounded immutable snapshots with undo/redo and coalesced text edits.
- `frontweb/src/components/dramaCanvas/FreeCanvasToolbar.vue`: mode-aware creation and view controls.
- `frontweb/src/components/dramaCanvas/FreeCanvasNode.vue`: generic text/image/video/config/reference presentation and handles.
- `frontweb/src/components/dramaCanvas/FreeCanvasInspector.vue`: selected-node editing and explicit production-reference conversion.

**Modified frontend files:**

- `frontweb/src/views/DramaCanvas.vue`: load/save free metadata, mode switch, merged graph, free events, keyboard actions, and inspector/toolbars.
- `frontweb/src/utils/canvasLayout.js`: payload building and metadata compatibility helpers.
- `frontweb/src/api/drama.js`: pass `freeCanvas` partial updates through the existing endpoint.
- `frontweb/src/components/dramaCanvas/CanvasDesktopToolbar.vue`: expose the mode switch without changing existing production action gates.
- `frontweb/src/components/dramaCanvas/CanvasContextMenu.vue`: add free-node commands using existing context-menu semantics.
- `frontweb/src/main.js` or route-level import boundary only if bundle inspection proves free components are eagerly loaded.

**New/modified tests:**

- `frontweb/test/freeCanvasState.test.js`
- `frontweb/test/freeCanvasAdapter.test.js`
- `frontweb/test/canvasHistory.test.js`
- `frontweb/test/canvasFreeModeContract.test.js`
- `frontweb/test/canvasProductionRegression.test.js` (only if existing contracts do not cover the merged graph)
- `backend-node/test/canvasLayoutValidation.test.js`
- `frontweb/test/e2e/freeCanvasWorkbench.spec.js` if the repository's E2E harness supports a new spec; otherwise extend the established production E2E script without changing its evidence contract.

**Documentation:**

- `docs/superpowers/specs/2026-07-27-infinite-canvas-integration-design.md`
- `docs/plans/2026-06-15-drama-canvas-workflow-plan.md` (mark only the free-canvas items actually delivered)
- `frontweb/README.md` and root `README.md` (desktop feature and deferred-scope wording)

---

### Task 1: Define and test the free-canvas serializable state

**Files:**
- Create: `frontweb/src/utils/freeCanvasState.js`
- Test: `frontweb/test/freeCanvasState.test.js`

**Interfaces:**
- Produces `createEmptyFreeCanvas(overrides)`, `normalizeFreeCanvas(input)`, `serializeFreeCanvas(input)`, `createFreeNode(type, overrides)`, `createFreeEdge(source, target, overrides)`, `removeFreeSelection(state, ids)`, and `cloneFreeSelection(state, ids, offset)`.
- Each function returns plain JSON-compatible values and never mutates its input.

- [ ] **Step 1: Write failing tests for defaults and limits**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEmptyFreeCanvas,
  normalizeFreeCanvas,
  serializeFreeCanvas,
} from '../src/utils/freeCanvasState.js'

test('normalizes an absent free canvas without changing production metadata', () => {
  const state = normalizeFreeCanvas(null)
  assert.equal(state.version, 1)
  assert.equal(state.mode, 'production')
  assert.deepEqual(state.nodes, [])
  assert.deepEqual(state.edges, [])
})

test('drops invalid edge references and clamps oversized text', () => {
  const state = normalizeFreeCanvas({
    nodes: [{ id: 'n1', type: 'text', content: 'x'.repeat(60000) }],
    edges: [{ id: 'e1', source: 'n1', target: 'missing' }],
  })
  assert.equal(state.nodes[0].content.length, 50000)
  assert.deepEqual(state.edges, [])
})

test('serialization contains no runtime URLs or undefined fields', () => {
  const value = serializeFreeCanvas(createEmptyFreeCanvas())
  assert.equal(JSON.stringify(value).includes('blob:'), false)
  assert.equal(JSON.stringify(value).includes('undefined'), false)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix frontweb test -- --test-name-pattern="free canvas|free-canvas"`  
Expected: FAIL because `freeCanvasState.js` does not exist.

- [ ] **Step 3: Implement the pure state module**

Implement immutable normalization with these exact invariants:

```js
const FREE_NODE_TYPES = new Set(['text', 'image', 'video', 'config', 'reference'])
const MAX_NODES = 500
const MAX_EDGES = 1000
const MAX_TEXT_LENGTH = 50000

export function normalizeFreeCanvas(input) {
  // Return a fresh, bounded object; keep only edges whose endpoints survive.
}
```

Generate IDs with `free:<type>:<timestamp>:<counter>`, preserve caller IDs only when they are unique, normalize positions to finite numbers, and make `serializeFreeCanvas` remove `blob:`/data URLs while preserving `storageKey`, `asset_ref`, and `storyboard_ref`.

- [ ] **Step 4: Run the focused tests and the JavaScript check**

Run: `npm --prefix frontweb test -- --test-name-pattern="free canvas|free-canvas"` and `npm --prefix frontweb run check`  
Expected: PASS with no existing test changes.

- [ ] **Step 5: Commit the isolated state module**

```bash
git add frontweb/src/utils/freeCanvasState.js frontweb/test/freeCanvasState.test.js
git commit -m "feat(canvas): add validated free canvas state"
```

### Task 2: Add a validated backend persistence contract

**Files:**
- Modify: `backend-node/src/services/dramaService.js` around `saveCanvasLayout`
- Modify: `backend-node/src/routes/index.js` only if route validation is not already delegated to the service
- Modify: `frontweb/src/api/drama.js`
- Test: `backend-node/test/canvasLayoutValidation.test.js`

**Interfaces:**
- Request body accepts `canvas_layout`, `free_canvas`, and `workflow_groups` as independent partial fields.
- The service returns `{ drama, metadata_version }` or the repository's established equivalent; invalid input throws the existing HTTP 400 error shape.

- [ ] **Step 1: Write failing backend tests for partial merge and isolation**

Cover: free-only update preserves `canvas_layout`; invalid type/edge/reference/limit is rejected; a user/project mismatch cannot update another project; unknown metadata keys remain; valid free data is returned after reload.

- [ ] **Step 2: Run the focused backend tests and verify the new assertions fail**

Run with the repository's Node 20 binary: `npm --prefix backend-node test -- --test-name-pattern="canvas layout|free canvas"`  
Expected: the new free-canvas assertions fail while existing canvas tests remain the baseline.

- [ ] **Step 3: Implement schema validation and merge**

Reuse the backend's existing project lookup, body parsing, error normalization, and metadata persistence. Accept only the five node types, finite coordinates, positive bounded dimensions, known edge endpoints, and the global limits. Strip runtime URL fields and sensitive keys before writing. Merge `free_canvas` without replacing unrelated metadata.

- [ ] **Step 4: Extend the frontend API wrapper**

Add an optional `freeCanvas` argument to the existing canvas-layout request without changing callers that only pass `canvasLayout` or `workflowGroups`.

- [ ] **Step 5: Run backend security and focused verification**

Run: `npm --prefix backend-node test -- --test-name-pattern="canvas layout|free canvas|security"` and `npm --prefix backend-node run check` using Node 20.  
Expected: PASS; no raw key, authorization header, or unvalidated media URL is persisted.

- [ ] **Step 6: Commit the persistence contract**

```bash
git add backend-node/src/services/dramaService.js backend-node/src/routes/index.js frontweb/src/api/drama.js backend-node/test/canvasLayoutValidation.test.js
git commit -m "feat(canvas): persist validated free canvas metadata"
```

### Task 3: Build the free graph adapter and history model

**Files:**
- Create: `frontweb/src/utils/freeCanvasAdapter.js`
- Create: `frontweb/src/utils/canvasHistory.js`
- Test: `frontweb/test/freeCanvasAdapter.test.js`
- Test: `frontweb/test/canvasHistory.test.js`

**Interfaces:**
- `buildFreeCanvasGraph(freeCanvas, context)` returns `{ nodes, edges }` with Vue Flow-compatible nodes and edges.
- `mergeCanvasGraphs(productionGraph, freeGraph, mode)` returns a fresh graph and never mutates either input.
- `createCanvasHistory(initial, options)` exposes `present()`, `commit(next, reason)`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, and `clear()`.

- [ ] **Step 1: Write failing adapter/history tests**

Test stable node IDs, default positions, selected-node reference summaries, hidden/visible mode behavior, edge cleanup, and coalescing repeated text commits into one undo step.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm --prefix frontweb test -- --test-name-pattern="free adapter|canvas history"`  
Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement adapter and bounded history**

Use `markRaw` only at the component registration boundary; keep adapter output serializable. Give each node fixed minimum dimensions and `data.freeNode` as the normalized source. Resolve `asset_ref` and `storyboard_ref` against a read-only context map to produce labels, never embed full production objects in persisted free data.

- [ ] **Step 4: Run tests and check graph immutability**

Run the focused tests plus `npm --prefix frontweb run check`.  
Expected: PASS and no mutation of fixtures after adapter/history operations.

- [ ] **Step 5: Commit the graph and history layer**

```bash
git add frontweb/src/utils/freeCanvasAdapter.js frontweb/src/utils/canvasHistory.js frontweb/test/freeCanvasAdapter.test.js frontweb/test/canvasHistory.test.js
git commit -m "feat(canvas): add free graph adapter and history"
```

### Task 4: Add free-node presentation, inspector, and toolbar

**Files:**
- Create: `frontweb/src/components/dramaCanvas/FreeCanvasToolbar.vue`
- Create: `frontweb/src/components/dramaCanvas/FreeCanvasNode.vue`
- Create: `frontweb/src/components/dramaCanvas/FreeCanvasInspector.vue`
- Modify: `frontweb/src/components/dramaCanvas/CanvasDesktopToolbar.vue`
- Modify: `frontweb/src/components/dramaCanvas/CanvasContextMenu.vue`
- Test: `frontweb/test/canvasFreeModeContract.test.js`

**Interfaces:**
- Toolbar emits `create-node(type)`, `undo`, `redo`, `fit-view`, `set-background(mode)`, and `toggle-library`.
- Node emits `update-content`, `request-convert`, `request-delete`, and `request-retry`; it receives a normalized free node and `readonly` state.
- Inspector emits `update-node`, `convert-reference`, `save-asset`, and `close`.

- [ ] **Step 1: Write failing component contract tests**

Assert that all icon-only controls have `aria-label` and `title`, the mode switch has a selected state, node content is not rendered with unsafe HTML, and the inspector exposes an explicit target selector for production conversion.

- [ ] **Step 2: Run the focused contract test and verify failure**

Run: `npm --prefix frontweb test -- --test-name-pattern="free mode|free canvas toolbar|free canvas inspector"`  
Expected: FAIL until the new component source contracts exist.

- [ ] **Step 3: Implement the components with stable dimensions**

Use existing Element Plus buttons/inputs/icons and the project's theme tokens. The toolbar must remain readable at 1280px wide. The node component must expose source/target handles only in free mode, use `nodrag`/`nopan` on editable controls, and display loading/error/empty states without changing its outer size. The inspector must not write production data directly.

- [ ] **Step 4: Run frontend checks and focused tests**

Run: `npm --prefix frontweb run check` and the focused test pattern.  
Expected: PASS with no accessibility contract regression.

- [ ] **Step 5: Commit the presentational layer**

```bash
git add frontweb/src/components/dramaCanvas/FreeCanvasToolbar.vue frontweb/src/components/dramaCanvas/FreeCanvasNode.vue frontweb/src/components/dramaCanvas/FreeCanvasInspector.vue frontweb/src/components/dramaCanvas/CanvasDesktopToolbar.vue frontweb/src/components/dramaCanvas/CanvasContextMenu.vue frontweb/test/canvasFreeModeContract.test.js
git commit -m "feat(canvas): add free mode controls and inspector"
```

### Task 5: Integrate mode switching and persistence into the workbench

**Files:**
- Modify: `frontweb/src/views/DramaCanvas.vue`
- Modify: `frontweb/src/utils/canvasLayout.js`
- Modify: `frontweb/src/composables/useCanvasContext.js` if the inspector needs a new context contract
- Test: `frontweb/test/canvasProductionRegression.test.js`

**Interfaces:**
- Keep `productionGraph` and `freeGraph` as separate computed/managed values; only the merged graph is bound to Vue Flow.
- Mode changes persist through the next debounced canvas save and are restored on load.
- Existing production events continue to use `getStoryboardRefFromNode`; free node events are routed by `id.startsWith('free:')` or an explicit node data discriminator, never by display text.

- [ ] **Step 1: Add regression tests before integration**

Assert that existing production node IDs/edges and workflow actions remain present in production mode; switching modes does not delete production nodes; a free-only save preserves `canvas_layout` and `workflow_groups`.

- [ ] **Step 2: Run regression tests to establish the failing contract**

Run: `npm --prefix frontweb test -- --test-name-pattern="production canvas|free mode persistence"`  
Expected: new assertions fail while the pre-existing canvas tests remain green.

- [ ] **Step 3: Integrate loading and saving**

On load, call `normalizeFreeCanvas(drama.metadata.free_canvas)`. On graph rebuild, pass a read-only production reference map to `buildFreeCanvasGraph`. Extend the existing debounced save payload with serialized free state and keep the current save status/error behavior. Restore the persisted viewport only after both graphs are ready.

- [ ] **Step 4: Integrate mode-specific Vue Flow behavior**

Keep the existing production configuration (`nodes-connectable=false`) in production mode. In free mode enable connection events, selection, keyboard handling, copy/paste, and the new toolbar/inspector. Pane clicks must close the inspector without accidentally creating a node. Keep `only-render-visible-elements` enabled for large production graphs and do not claim full virtualization for free nodes until measured.

- [ ] **Step 5: Implement explicit production-reference conversion**

Use existing drama/media APIs and project isolation checks. Require a selected target and show overwrite/append semantics. On success refresh the drama and preserve the free node; on failure keep the node and show a retryable sanitized message.

- [ ] **Step 6: Run focused and existing canvas tests**

Run: `npm --prefix frontweb test -- --test-name-pattern="canvas|free mode|workflow"` and `npm --prefix frontweb run check`.  
Expected: all focused and existing canvas contracts pass.

- [ ] **Step 7: Commit the workbench integration**

```bash
git add frontweb/src/views/DramaCanvas.vue frontweb/src/utils/canvasLayout.js frontweb/src/composables/useCanvasContext.js frontweb/test/canvasProductionRegression.test.js
git commit -m "feat(canvas): integrate hybrid free creation mode"
```

### Task 6: Add browser-level workflow and visual acceptance

**Files:**
- Modify: `frontweb/scripts/e2e-production.cjs` or the repository's established E2E entrypoint
- Create/modify: `frontweb/test/e2e/freeCanvasWorkbench.spec.js` only if supported by the existing runner
- Modify: `frontweb/public/reports/product-acceptance/report.html` only for tracked contract links, never as a substitute for fresh evidence
- Create ignored evidence under `artifacts/e2e-production/acceptance-report/`

**Interfaces:**
- E2E seeds a project through existing test fixtures/API and does not call a real external Provider.
- Evidence records source revision, viewport, theme, URL, and SHA-256 as required by the existing acceptance contract.

- [ ] **Step 1: Add the browser flow assertions**

Cover mode switch, text creation/edit, connection, multi-select, undo/redo, reload persistence, production-reference conversion, and recoverable save/provider error states. Use stable `data-testid`/ARIA contracts from the components, not coordinate-only clicks.

- [ ] **Step 2: Run the targeted E2E flow at one viewport**

Run the repository's established local production E2E command with the free-canvas flow selected.  
Expected: PASS in light and dark theme at 1280x720; capture evidence and inspect the rendered screenshot.

- [ ] **Step 3: Run the full viewport/theme matrix**

Run the existing production E2E matrix for 1280x720, 1366x768, and 1440x900 in both themes. Inspect for overlap, clipped text, focus visibility, and stable node/tool dimensions.

- [ ] **Step 4: Commit only tracked E2E contract changes**

```bash
git add frontweb/scripts/e2e-production.cjs frontweb/test/e2e/freeCanvasWorkbench.spec.js frontweb/public/reports/product-acceptance/report.html
git commit -m "test(canvas): cover hybrid free workbench flow"
```

### Task 7: Documentation, audit, Docker, and release verification

**Files:**
- Modify: `docs/plans/2026-06-15-drama-canvas-workflow-plan.md`
- Modify: `frontweb/README.md`
- Modify: `README.md`
- Verify: `.github/workflows/ci.yml`, Docker Compose files, release scripts, security/audit reports

- [ ] **Step 1: Update user-facing documentation**

Document the two modes, shared-reference conversion, save/error behavior, desktop-only scope, and the fact that real Provider setup remains in AI 配置. Mark only delivered roadmap checkboxes; do not claim a full Agent or mobile implementation.

- [ ] **Step 2: Run package checks with the required Node 20 toolchain**

Run:

```text
npm --prefix backend-node run verify
npm --prefix frontweb run verify
npm --prefix frontweb run build
```

Use the repository's Node 20 executable when the system npm resolves to the incompatible Node 24 runtime.

- [ ] **Step 3: Run security and dependency gates**

Run backend/frontweb/desktop audits, the CI-configured Gitleaks scan, and the CI-configured Trivy source/dependency/config scans. Confirm no credentials or reference-project source entered the diff.

- [ ] **Step 4: Rebuild and verify Docker**

Run `npm run docker:e2e:up` after source changes, then `npm run verify:docker` from the repository root. Verify health/readiness, project isolation, metadata save/reload, and graceful failure when AI is unconfigured.

- [ ] **Step 5: Perform independent product, project, test, and security review**

Review the final diff and browser evidence against the design spec. Any finding that affects user comprehension, data safety, regression risk, or evidence validity must be fixed and re-run through the relevant gate.

- [ ] **Step 6: Commit documentation and verified release changes**

```bash
git add docs/plans/2026-06-15-drama-canvas-workflow-plan.md frontweb/README.md README.md
git commit -m "docs(canvas): document hybrid workbench and acceptance"
```

## Verification Checklist

- [ ] Existing production canvas opens and behaves unchanged without `free_canvas` metadata.
- [ ] Free nodes and edges survive save, reload, export, and import.
- [ ] Invalid or cross-project free data is rejected without metadata loss.
- [ ] Text/image/video/config/reference interactions work without real Provider credentials.
- [ ] Explicit conversion is the only path from free content to production references.
- [ ] Undo/redo, copy/paste, selection, keyboard and focus behavior are covered.
- [ ] Light/dark desktop screenshots show no overlap or clipped text at all required viewports.
- [ ] Backend/frontend/desktop checks, E2E, dependency audit, source/config security scans, Docker verification, and final review all pass on the same source revision.
