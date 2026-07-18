# Workflow Execution Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop production path directly executable while separating current location, completion state, inspected history, and the next command.

**Architecture:** Add two small pure-state helpers for episode labels and compact pipeline commands, extend the existing navigation composable for current-section tracking, and keep source/AI state inside their current owners. Existing routes, API contracts, action gates, draft protection, provider behavior, and Docker topology remain unchanged.

**Tech Stack:** Vue 3 Composition API, Element Plus, Pinia, Vue Router, Node.js built-in test runner, Playwright production E2E, Vite.

## Global Constraints

- Desktop web only; mobile reflow and touch behavior stay deferred.
- Preserve every route, API payload, generation algorithm, provider protocol, database field, return-query rule, and Docker service.
- Preserve draft flush, unsaved-change confirmation, fail-closed AI writes, vendor lock, cost confirmation, and readiness gates.
- Do not add a runtime dependency, decorative asset, gradient, new color system, or viewport-scaled font size.
- Use existing semantic tokens and Element Plus icons; new controls have at least 32px interaction height and at most 8px radius.
- Follow red-green-refactor for every production-code change.
- Do not stage the pre-existing acceptance-report edits until the final evidence task.

---

### Task 1: Production Context Labels

**Files:**
- Create: `frontweb/src/utils/filmCreateContext.js`
- Create: `frontweb/test/filmCreateContext.test.js`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/test/filmCreateAccessibility.test.js`

**Interfaces:**
- Produces: `formatEpisodeContextLabel(episode, fallbackIndex = 0): string`.
- Preserves: `selectedEpisodeId`, `onEpisodeSelect`, and all route/draft behavior.

- [ ] **Step 1: Write failing formatter and source-contract tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatEpisodeContextLabel } from '../src/utils/filmCreateContext.js'

test('episode context always identifies the episode number before its title', () => {
  assert.equal(
    formatEpisodeContextLabel({ episode_number: 2, title: '雨夜来电' }),
    '第 2 集 · 雨夜来电',
  )
  assert.equal(formatEpisodeContextLabel({ episode_number: 3, title: '' }), '第 3 集')
  assert.equal(formatEpisodeContextLabel({ title: '尾声' }, 4), '第 5 集 · 尾声')
})

test('episode context does not duplicate a default episode title', () => {
  assert.equal(
    formatEpisodeContextLabel({ episode_number: 1, title: '第1集' }),
    '第 1 集',
  )
})
```

Extend `filmCreateAccessibility.test.js` with assertions for visible `项目` and
`当前集` labels, `aria-label="当前集"`, a project title attribute, use of
`formatEpisodeContextLabel`, and absence of `clearable` on the episode select.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm --prefix frontweb test -- test/filmCreateContext.test.js test/filmCreateAccessibility.test.js`

Expected: FAIL because the helper and context contracts do not exist.

- [ ] **Step 3: Implement the pure formatter**

```js
export function formatEpisodeContextLabel(episode, fallbackIndex = 0) {
  const number = Math.max(1, Number(episode?.episode_number) || Number(fallbackIndex) + 1)
  const prefix = `第 ${number} 集`
  const compactPrefix = `第${number}集`
  const title = String(episode?.title || '').trim()
  if (!title || title === prefix || title === compactPrefix) return prefix
  return `${prefix} · ${title}`
}
```

- [ ] **Step 4: Update the header without changing selection behavior**

Import the formatter. Wrap the project title and episode select in context
groups with visible `项目` and `当前集` labels. Add
`:title="projectPageTitle"` to the project value, set `aria-label="当前集"`,
remove `clearable`, then change the option loop to `v-for="(ep, index) in
(store.drama?.episodes || [])"`. Every option then uses:

```vue
:label="formatEpisodeContextLabel(ep, index)"
```

Replace the fixed inline `130px` width with a scoped CSS
constraint of `width: min(240px, 20vw); min-width: 170px;` and retain ellipsis
for long selected values.

- [ ] **Step 5: Run focused and adjacent tests**

Run: `npm --prefix frontweb test -- test/filmCreateContext.test.js test/filmCreateAccessibility.test.js test/scriptDraft.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontweb/src/utils/filmCreateContext.js frontweb/src/views/FilmCreate.vue frontweb/test/filmCreateContext.test.js frontweb/test/filmCreateAccessibility.test.js
git commit -m "feat: clarify production project and episode context"
```

### Task 2: Current Workbench Location And Unique Anchors

**Files:**
- Modify: `frontweb/src/composables/filmCreate/useNavigation.js`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Create: `frontweb/test/filmCreateNavigation.test.js`
- Modify: `frontweb/test/filmCreateAccessibility.test.js`

**Interfaces:**
- Adds: `pickActiveNavigationAnchor(entries, offset): string`.
- Extends: `useNavigation({ getAnchorIds })` with `activeNavAnchor` and
  `scrollToAnchor(id, activeId = id)`.
- Preserves: existing collapse behavior and smooth scrolling.

- [ ] **Step 1: Write failing navigation-state tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickActiveNavigationAnchor } from '../src/composables/filmCreate/useNavigation.js'

test('navigation picks the last section crossing the sticky-header offset', () => {
  const entries = [
    { id: 'anchor-script', top: -500 },
    { id: 'anchor-characters', top: 60 },
    { id: 'anchor-props', top: 420 },
  ]
  assert.equal(pickActiveNavigationAnchor(entries, 96), 'anchor-characters')
})

test('navigation keeps the first upcoming section before any section crosses', () => {
  assert.equal(
    pickActiveNavigationAnchor([
      { id: 'anchor-script', top: 140 },
      { id: 'anchor-characters', top: 700 },
    ], 96),
    'anchor-script',
  )
})
```

Add source assertions for one `:aria-current`, `.is-current`, unique
`anchor-storyboard` and `anchor-storyboard-images` values, and the batch-image
anchor before the `批量生成分镜图` action.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm --prefix frontweb test -- test/filmCreateNavigation.test.js test/filmCreateAccessibility.test.js`

Expected: FAIL because active-location tracking and the image anchor are absent.

- [ ] **Step 3: Extend the navigation composable**

Implement a pure picker that sorts finite `top` values, returns the last entry
at or above the sticky offset, and otherwise returns the first upcoming entry.
In `useNavigation`, throttle the passive `scroll` listener with one
`requestAnimationFrame`, map `getAnchorIds()` through `getElementById()` and
`getBoundingClientRect().top`, and update `activeNavAnchor`. Cancel the frame
and remove the listener on unmount.

`scrollToAnchor(id, activeId = id)` must assign `activeNavAnchor` before calling
the existing `scrollIntoView`.

- [ ] **Step 4: Bind current state and split storyboard anchors**

Initialize the composable with a lazy anchor getter:

```js
const navigation = useNavigation({
  getAnchorIds: () => navSteps.value.map((step) => step.anchor),
})
```

Bind each main step with:

```vue
:class="['status-' + step.status, { 'is-current': activeNavAnchor === step.anchor }]"
:aria-current="activeNavAnchor === step.anchor ? 'step' : undefined"
@click="scrollToAnchor(step.anchor, step.anchor)"
```

Give `分镜图` the new `anchor-storyboard-images` anchor immediately before the
batch image/video action row. Storyboard sub-items call
`scrollToAnchor('sb-' + sb.id, 'anchor-storyboard-images')` so a sub-item click
never leaves all main steps without a current value.

- [ ] **Step 5: Run focused and adjacent tests**

Run: `npm --prefix frontweb test -- test/filmCreateNavigation.test.js test/filmCreateAccessibility.test.js test/filmCreateComponentContract.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontweb/src/composables/filmCreate/useNavigation.js frontweb/src/views/FilmCreate.vue frontweb/test/filmCreateNavigation.test.js frontweb/test/filmCreateAccessibility.test.js
git commit -m "feat: track current production workbench location"
```

### Task 3: Executable Compact Pipeline Command

**Files:**
- Create: `frontweb/src/utils/filmPipelineAction.js`
- Create: `frontweb/test/filmPipelineAction.test.js`
- Modify: `frontweb/src/components/filmCreate/FilmCreatePipelinePanel.vue`
- Modify: `frontweb/test/filmCreateComponentContract.test.js`

**Interfaces:**
- Produces: `getPipelineCompactAction(state): null | { key, label, event, payload }`.
- Reuses existing component emits; no new production event is introduced.

- [ ] **Step 1: Write the failing state-matrix test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { getPipelineCompactAction } from '../src/utils/filmPipelineAction.js'

test('pipeline compact command follows readiness and execution state', () => {
  assert.deepEqual(getPipelineCompactAction({ readinessState: 'missing', serviceType: 'video' }), {
    key: 'configure', label: '配置缺失服务', event: 'open-ai-config', payload: 'video',
  })
  assert.equal(getPipelineCompactAction({ readinessState: 'error' }).event, 'retry-readiness')
  assert.equal(getPipelineCompactAction({ readinessState: 'ready' }).event, 'start-one-click')
  assert.equal(getPipelineCompactAction({ running: true, paused: true }).event, 'resume')
  assert.equal(getPipelineCompactAction({ running: true, paused: false }), null)
  assert.equal(getPipelineCompactAction({ readinessState: 'checking' }), null)
  assert.equal(getPipelineCompactAction({ readinessState: 'ready', draftReason: '缺少剧本' }), null)
})
```

Add component contracts for `data-testid="film-pipeline-action"`, a native
button, `compactAction.label`, and the action runner.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix frontweb test -- test/filmPipelineAction.test.js test/filmCreateComponentContract.test.js`

Expected: FAIL because the state helper and command do not exist.

- [ ] **Step 3: Implement the pure action matrix**

Return `resume` first for paused running work. Return `null` for active running,
draft prerequisites, readiness checking, or any non-empty production reason
outside the `missing` state. Map `missing`, `error`, and `ready` exactly to the
events in the test.

- [ ] **Step 4: Render and dispatch the compact command**

Add a computed `compactAction` and:

```js
function runCompactAction() {
  const action = compactAction.value
  if (!action) return
  if (action.event === 'open-ai-config') emit(action.event, action.payload)
  else emit(action.event)
}
```

Render one icon-and-text native button before the disclosure button. Use
`ArrowRight`, a minimum 32px height, visible focus ring, and no command while
checking or actively running. Keep the expanded actions unchanged so both
surfaces use the same parent handlers and confirmation path.

- [ ] **Step 5: Run focused and FilmCreate action tests**

Run: `npm --prefix frontweb test -- test/filmPipelineAction.test.js test/filmCreateComponentContract.test.js test/filmCreateActionState.test.js test/filmCreateAccessibility.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontweb/src/utils/filmPipelineAction.js frontweb/src/components/filmCreate/FilmCreatePipelinePanel.vue frontweb/test/filmPipelineAction.test.js frontweb/test/filmCreateComponentContract.test.js
git commit -m "feat: make compact production status actionable"
```

### Task 4: Separate Actual And Inspected Source Stages

**Files:**
- Modify: `frontweb/src/components/SourceIntakeWorkflowPanel.vue`
- Create: `frontweb/test/sourceWorkflowInteraction.test.js`
- Modify: `frontweb/test/sourceWorkflowState.test.js`

**Interfaces:**
- `flowState.activeStepId`: actual process stage and `aria-current` owner.
- `selectedFlowStepId`: inspected detail and `aria-pressed` owner.
- No API or workflow-state payload changes.

- [ ] **Step 1: Write failing source interaction contracts**

Read the SFC and assert that the step class and `aria-current` compare against
`flowState.activeStepId`, while `aria-pressed` compares against
`inspectedFlowStep.id`. Assert that the detail templates use
`inspectedFlowStep.id`, not the process-current variable.

Add a state test proving a delivered workflow still reports `delivery` as the
actual stage after a historical step is selected in component-local state.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix frontweb test -- test/sourceWorkflowInteraction.test.js test/sourceWorkflowState.test.js`

Expected: FAIL because `activeFlowStep` currently owns both meanings.

- [ ] **Step 3: Split current and inspected computed state**

Replace the overloaded computed with:

```js
const actualFlowStep = computed(() => flowState.value.activeStep || flowState.value.steps[0])
const inspectedFlowStep = computed(() => (
  flowState.value.steps.find((step) => step.id === selectedFlowStepId.value)
  || actualFlowStep.value
))
```

Bind current classes and `aria-current` to `flowState.activeStepId`; bind
selected classes, `aria-pressed`, and detail content to `inspectedFlowStep`.
Watch `flowState.activeStepId` and select the new actual stage whenever it
changes. A user click changes only `selectedFlowStepId`.

- [ ] **Step 4: Add distinct visual states**

Keep status color on the number/status copy. Add a neutral selected-detail
outline for `.is-selected` and a separate current-stage marker for
`.is-current`; both must remain distinguishable in grayscale and dark mode.

- [ ] **Step 5: Run source workflow and accessibility tests**

Run: `npm --prefix frontweb test -- test/sourceWorkflowInteraction.test.js test/sourceWorkflowState.test.js test/desktopAccessibility.test.js test/sourceWorkflowLaunch.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontweb/src/components/SourceIntakeWorkflowPanel.vue frontweb/test/sourceWorkflowInteraction.test.js frontweb/test/sourceWorkflowState.test.js
git commit -m "feat: separate source progress from inspected history"
```

### Task 5: Compact Source Completion And Production Handoff

**Files:**
- Modify: `frontweb/src/components/SourceIntakeWorkflowPanel.vue`
- Modify: `frontweb/src/views/DramaDetail.vue`
- Modify: `frontweb/test/sourceWorkflowInteraction.test.js`
- Modify: `frontweb/test/desktopPmAcceptance.test.js`
- Modify: `frontweb/test/e2eProductionContract.test.js`

**Interfaces:**
- Adds emits: `enter-production`, `focus-episode-list`.
- Parent uses existing `goEpisode(epId)` and `scrollToSection('episode-list')`.
- Full history remains available through a disclosure.

- [ ] **Step 1: Write failing compact-handoff contracts**

Assert a completed workflow renders `data-testid="source-workflow-complete"`,
`进入制作`, `查看分集`, a disclosure with `aria-expanded`, and the scoped labels
`草稿预演已完成` / `正式制作已完成` / `含占位产物`. Assert that
`继续导入故事素材` is inside expanded history rather than the compact primary
action area.

Assert `DramaDetail` handles `enter-production` through `goEpisode` with a real
episode id and handles `focus-episode-list` with the existing safe scroller.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix frontweb test -- test/sourceWorkflowInteraction.test.js test/desktopPmAcceptance.test.js test/e2eProductionContract.test.js`

Expected: FAIL because completion is always expanded and routes back to import.

- [ ] **Step 3: Add the completion summary and disclosure**

Add `workflowHistoryExpanded = ref(false)` and reset it to `false` whenever
`flowState.complete` transitions from false to true. When incomplete, active,
paused, failed, blocked, or loading, always show the existing full workflow.

For complete state, render a compact summary with QA, episode, track, duration,
and placeholder values from existing normalized state. Use the run mode and
`productionPlaceholder` to choose the exact scoped completion title. Emit
`enter-production` from the primary button and `focus-episode-list` from the
secondary button. The disclosure controls the existing stepper and detail
panel without recreating their state.

- [ ] **Step 4: Wire the parent handoff**

Add:

```js
function enterSourceWorkflowProduction() {
  const episode = episodes.value.find((item) => Number(item?.id) > 0)
  if (!episode) {
    scrollToSection('episode-list')
    return
  }
  goEpisode(episode.id)
}
```

Bind both new events on `SourceIntakeWorkflowPanel`. This reuses
`withProjectListReturnTo` through `goEpisode`.

- [ ] **Step 5: Style and verify first-viewport density**

Keep the collapsed completion summary at or below 180px, use an unframed
summary row rather than nested cards, and preserve focus styles. Ensure the
`分集列表` heading is visible within 720px starting from the workflow anchor.

- [ ] **Step 6: Run source, route, and E2E-contract tests**

Run: `npm --prefix frontweb test -- test/sourceWorkflowInteraction.test.js test/sourceWorkflowState.test.js test/desktopPmAcceptance.test.js test/e2eProductionContract.test.js test/routeValidation.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontweb/src/components/SourceIntakeWorkflowPanel.vue frontweb/src/views/DramaDetail.vue frontweb/test/sourceWorkflowInteraction.test.js frontweb/test/desktopPmAcceptance.test.js frontweb/test/e2eProductionContract.test.js
git commit -m "feat: hand completed source workflows into production"
```

### Task 6: Material Scope Naming

**Files:**
- Modify: `frontweb/src/views/FilmList.vue`
- Modify: `frontweb/src/components/SourceIntakeWorkflowPanel.vue`
- Modify: `frontweb/test/projectListVisual.test.js`
- Modify: `frontweb/test/desktopHomeAssetsUi.test.js`
- Modify: `frontweb/test/e2eProductionContract.test.js`

**Interfaces:**
- Text-only contract change; routes and return queries remain byte-for-byte
  equivalent.

- [ ] **Step 1: Write failing naming contracts**

Assert the project card link visibly says `故事素材` and its accessible name is
`打开项目「<title>」的故事素材流程`. Assert the global labels remain
`素材中心` and `分类素材`. Assert source import actions use
`导入故事素材` / `继续导入故事素材` and no project-card CTA is the unscoped
single word `素材`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix frontweb test -- test/projectListVisual.test.js test/desktopHomeAssetsUi.test.js test/e2eProductionContract.test.js`

Expected: FAIL on the old project-card and source action labels.

- [ ] **Step 3: Update user-facing and accessible labels**

Change only labels and dependent E2E locators. Keep the existing project-card
source URL, propagation behavior, keyboard link, and return query unchanged.

- [ ] **Step 4: Run focused and routing tests**

Run: `npm --prefix frontweb test -- test/projectListVisual.test.js test/projectListRouting.test.js test/desktopHomeAssetsUi.test.js test/e2eProductionContract.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/views/FilmList.vue frontweb/src/components/SourceIntakeWorkflowPanel.vue frontweb/test/projectListVisual.test.js frontweb/test/desktopHomeAssetsUi.test.js frontweb/test/e2eProductionContract.test.js
git commit -m "feat: clarify global and project material scopes"
```

### Task 7: Exception-First AI Overview And Return Feedback

**Files:**
- Modify: `frontweb/src/utils/aiConfigCoverage.js`
- Modify: `frontweb/src/components/AIConfigContent.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/test/aiConfigCoverage.test.js`
- Modify: `frontweb/test/aiConfigContentSource.test.js`
- Modify: `frontweb/test/filmCreateAiConfigExperience.test.js`

**Interfaces:**
- Adds: `sortAiServiceCoverage(services): Array` without mutating input.
- Changes: `getAiServiceCoverageActions` returns zero or one context action.
- Adds component emit: `configuration-changed` after successful writes.
- Parent keeps its existing close-triggered readiness refresh.

- [ ] **Step 1: Write failing ordering and action tests**

```js
test('coverage sorting puts failed and incomplete services before healthy ones', () => {
  const ordered = sortAiServiceCoverage([
    { type: 'text', state: 'default', test: { status: 'passed' } },
    { type: 'video', state: 'missing', test: { status: 'unknown' } },
    { type: 'tts', state: 'default', test: { status: 'failed' } },
  ])
  assert.deepEqual(ordered.map((item) => item.type), ['tts', 'video', 'text'])
})
```

Update existing action expectations: missing has no additional action because
the card already opens its add flow, no-default/inactive has only the repair
action when writes are unlocked, unknown/failed default has only test, and
tested healthy has no additional action. Vendor-locked missing/broken services
also have no write action; their card still opens configuration management.

Add source contracts for `orderedCoverageServices`, the
`configuration-changed` emit, a visible `返回制作` dialog-header command, and
the close feedback message.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix frontweb test -- test/aiConfigCoverage.test.js test/aiConfigContentSource.test.js test/filmCreateAiConfigExperience.test.js`

Expected: FAIL on ordering, duplicate actions, change events, and return copy.

- [ ] **Step 3: Implement stable exception-first sorting and one action**

Use priority: failed test, configured-but-broken, missing, untested default,
tested healthy. Preserve original definition order as the tie breaker and
return a new array. Update the action helper exactly to the test matrix.

In `AIConfigContent`, render `orderedCoverageServices`. Keep the card click as
the management path and render only the returned context action.

- [ ] **Step 4: Compact all five service cards into one desktop row**

Retain five columns above 1120px, reduce card padding/min-height without hiding
service state or its primary action, and remove the 1440px three-column override.
Keep the existing two-column fallback below 1120px. All interaction targets
remain at least 32px.

- [ ] **Step 5: Emit successful configuration mutations**

Define `configuration-changed` and call one helper after successful create,
update, bulk key update, delete with at least one success, vendor preset create,
and import with at least one success. Do not emit for export or connection test.

In `FilmCreate`, track whether the dialog changed. Add a custom dialog header
with an `ArrowLeft` icon and `返回制作`; keep the native close icon. On close,
retain the current cache invalidation and readiness refresh. When changed,
announce `配置已更新，正在重新检查` before awaiting the refresh; failed refresh
continues to expose the existing retry state.

- [ ] **Step 6: Run AI, accessibility, and fail-closed tests**

Run: `npm --prefix frontweb test -- test/aiConfigCoverage.test.js test/aiConfigContentSource.test.js test/aiConfigWorkspace.test.js test/filmCreateAiConfigExperience.test.js test/aiConfigFailClosed.test.js test/desktopAccessibility.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontweb/src/utils/aiConfigCoverage.js frontweb/src/components/AIConfigContent.vue frontweb/src/views/FilmCreate.vue frontweb/test/aiConfigCoverage.test.js frontweb/test/aiConfigContentSource.test.js frontweb/test/filmCreateAiConfigExperience.test.js
git commit -m "feat: prioritize AI service recovery actions"
```

### Task 8: Desktop Acceptance, Reports, And Release Evidence

**Files:**
- Modify: `frontweb/scripts/e2e-production.cjs`
- Modify: `frontweb/test/e2eProductionContract.test.js`
- Modify: `docs/ui-refresh-20260718.md`
- Modify: `frontweb/public/reports/product-acceptance/report.html`
- Create: final screenshots under `frontweb/public/reports/product-acceptance/final-20260718/`

**Interfaces:**
- Adds a fast 1280x720 workflow-UX pass to production E2E without replaying
  media or invoking providers a third time.
- Final evidence binds to the final clean commit and rebuilt images.

- [ ] **Step 1: Write the failing E2E contract**

Assert the production script declares `{ width: 1280, height: 720 }` for a
focused workflow acceptance function and verifies:

- project/current-episode context;
- one current navigation step and distinct completion state;
- compact pipeline command;
- source completion `进入制作` command;
- five visible AI service cards;
- close-to-workbench focus restoration;
- no document/body horizontal overflow.

Do not add 1280x720 to the expensive media playback loop.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm --prefix frontweb test -- test/e2eProductionContract.test.js`

Expected: FAIL because the focused 1280 acceptance function does not exist.

- [ ] **Step 3: Implement the focused Playwright acceptance pass**

Reuse the generated production fixture and existing selectors. Open one page at
1280x720 after generation completes, perform the listed DOM/visibility/focus
assertions, reuse `attachPageAudit` and `assertNoHorizontalOverflow`, then close
the page without replaying videos or downloading artifacts.

- [ ] **Step 4: Run frontend verification**

Run: `npm --prefix frontweb run verify`

Expected: all JavaScript checks, tests, production build, and bundle budget pass.

- [ ] **Step 5: Run root and container verification**

Run: `npm run verify`

Run: `docker compose up -d --build --wait`

Run: `npm run verify:docker`

Expected: all package, release-contract, container, health, and readiness checks pass.

- [ ] **Step 6: Run production E2E and browser acceptance**

Run: `npm --prefix frontweb run e2e:production`

Capture light/dark screenshots at 1280x720, 1366x768, and 1440x900 for the
changed surfaces. Inspect every saved file, verify no credential row is shown,
and verify zero overlap/overflow plus keyboard behavior in the live Docker app.

- [ ] **Step 7: Run security and rollback gates**

Run production dependency audits:

```powershell
npm --prefix backend-node audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org
npm --prefix frontweb audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org
npm --prefix desktop audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org
```

Run the checksum-verified Gitleaks 8.28.0 binary used by the existing local
release evidence against history and the final worktree:

```powershell
gitleaks git --config .gitleaks.toml --redact --no-banner --log-opts="--all"
gitleaks dir . --config .gitleaks.toml --redact --no-banner
```

Run rollback verification from a clean commit:

```powershell
npm run verify:rollback
```

Use the digest-pinned Trivy 0.64.1 image declared in `.github/workflows/ci.yml`
to scan the final backend/frontend image IDs with `image --scanners vuln
--exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed`, and scan all three
Dockerfiles with `config --exit-code 1 --severity HIGH,CRITICAL` (including the
tracked backend ignore file). Require zero production High/Critical findings,
zero configuration failures outside the documented exception, and no leaked
credentials.

- [ ] **Step 8: Update report evidence and commit**

Update counts, write the verified final commit SHA only after final verification, product
and project-manager verdicts, changed screenshots, evidence limits, and deferred
scope. Run `git diff --check` and the report image/link verifier before commit.

```bash
git add docs/ui-refresh-20260718.md frontweb/public/reports/product-acceptance/report.html frontweb/public/reports/product-acceptance/final-20260718 frontweb/scripts/e2e-production.cjs frontweb/test/e2eProductionContract.test.js
git commit -m "test: verify executable desktop production workflows"
```

- [ ] **Step 9: Independent review, push, and CI**

Run final product, project, code, accessibility, and security reviews against
the complete branch diff. Fix every Critical/Important issue and re-run its
covering test. Push the branch, confirm GitHub CI uses the final SHA, and do not
claim formal release GO until every required remote job and same-SHA artifact
gate succeeds.
