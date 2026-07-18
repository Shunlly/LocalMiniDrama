# Desktop Workflow Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local production tasks the dominant desktop surface while keeping full readiness, pipeline, and provider diagnostics one accessible expansion or mode switch away.

**Architecture:** Add one shared disclosure-state composable, then use it in the project-readiness and full-pipeline components. Keep AI configuration state inside `AIConfigContent.vue` and separate the existing coverage and table regions with an accessible two-mode switch. No backend, route, schema, or provider-protocol changes are required.

**Tech Stack:** Vue 3 Composition API, Element Plus, Node.js built-in test runner, Vue SFC compiler, Vite, Playwright production E2E.

## Global Constraints

- Desktop web only; do not add mobile-specific behavior in this pass.
- Preserve every existing route, API payload, generation action, error state, and fail-closed write lock.
- Do not add a runtime dependency, decorative asset, gradient, or new color system.
- Use existing theme tokens and Element Plus icons.
- Every disclosure uses a native button, visible text, `aria-expanded`, and `aria-controls`.
- Follow red-green-refactor for every production-code change.

---

### Task 1: Shared Disclosure State

**Files:**
- Create: `frontweb/src/composables/useDisclosureState.js`
- Create: `frontweb/test/disclosureState.test.js`

**Interfaces:**
- Produces: `useDisclosureState({ defaultExpanded, forceExpanded })` returning `{ expanded, toggle, setExpanded }`.
- `forceExpanded` is an optional Vue ref/computed. A truthy value opens the disclosure but a later false value never closes user-expanded content.

- [ ] **Step 1: Write the failing composable tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'

import { useDisclosureState } from '../src/composables/useDisclosureState.js'

test('disclosure starts compact and toggles without persistence side effects', () => {
  const state = useDisclosureState()
  assert.equal(state.expanded.value, false)
  state.toggle()
  assert.equal(state.expanded.value, true)
  state.setExpanded(false)
  assert.equal(state.expanded.value, false)
})

test('forceExpanded opens running work and does not close it afterward', async () => {
  const running = ref(false)
  const state = useDisclosureState({ forceExpanded: running })
  running.value = true
  await nextTick()
  assert.equal(state.expanded.value, true)
  running.value = false
  await nextTick()
  assert.equal(state.expanded.value, true)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix frontweb test -- test/disclosureState.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `useDisclosureState.js`.

- [ ] **Step 3: Implement the composable**

```js
import { ref, watch } from 'vue'

export function useDisclosureState({ defaultExpanded = false, forceExpanded } = {}) {
  const expanded = ref(Boolean(defaultExpanded))

  function toggle() {
    expanded.value = !expanded.value
  }

  function setExpanded(value) {
    expanded.value = Boolean(value)
  }

  if (forceExpanded) {
    watch(forceExpanded, (value) => {
      if (value) expanded.value = true
    }, { immediate: true })
  }

  return { expanded, toggle, setExpanded }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm --prefix frontweb test -- test/disclosureState.test.js`

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Commit the independently tested state primitive**

```bash
git add frontweb/src/composables/useDisclosureState.js frontweb/test/disclosureState.test.js
git commit -m "feat: add shared workflow disclosure state"
```

### Task 2: Compact Project Readiness

**Files:**
- Modify: `frontweb/src/components/ProjectReadinessPanel.vue`
- Modify: `frontweb/test/desktopAccessibility.test.js`
- Modify: `frontweb/test/desktopPmAcceptance.test.js`

**Interfaces:**
- Consumes: `useDisclosureState({ defaultExpanded })` from Task 1.
- Adds prop: `defaultExpanded: Boolean`, default `false`.
- Adds stable browser contracts: `project-readiness-toggle` and `project-readiness-details`.
- Existing `action` event and `readiness` object remain unchanged.

- [ ] **Step 1: Add failing source contracts**

```js
test('project readiness keeps the next action visible while diagnostics are collapsible', () => {
  assert.match(readinessSource, /data-testid="project-readiness-toggle"/)
  assert.match(readinessSource, /:aria-expanded="expanded"/)
  assert.match(readinessSource, /aria-controls="project-readiness-details"/)
  assert.match(readinessSource, /id="project-readiness-details"/)
  assert.match(readinessSource, /v-show="expanded"/)

  const nextActionEnd = readinessSource.indexOf('</div>', readinessSource.indexOf('class="next-action"'))
  const detailsStart = readinessSource.indexOf('id="project-readiness-details"')
  assert.ok(nextActionEnd > 0 && nextActionEnd < detailsStart)
})
```

Add the component source and this product-manager contract to
`desktopPmAcceptance.test.js`:

```js
const readinessSource = read('../src/components/ProjectReadinessPanel.vue')

test('project readiness defaults to a compact local-task-first surface', () => {
  assert.match(readinessSource, /data-testid="project-readiness-toggle"/)
  assert.match(readinessSource, /data-testid="project-readiness-details"/)
  assert.match(readinessSource, /defaultExpanded: \{ type: Boolean, default: false \}/)
  assert.match(readinessSource, /v-show="expanded"/)
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/desktopAccessibility.test.js test/desktopPmAcceptance.test.js` from `frontweb/`.

Expected: FAIL because the disclosure contracts do not exist.

- [ ] **Step 3: Implement the compact readiness component**

Use this script contract:

```js
import { ArrowDown, ArrowRight, ArrowUp } from '@element-plus/icons-vue'
import { useDisclosureState } from '@/composables/useDisclosureState'

const props = defineProps({
  readiness: { type: Object, required: true },
  defaultExpanded: { type: Boolean, default: false },
})

const { expanded, toggle } = useDisclosureState({
  defaultExpanded: props.defaultExpanded,
})
```

Keep `.next-action` outside the hidden details. Add this disclosure control to `.readiness-head`:

```vue
<button
  type="button"
  class="readiness-toggle"
  data-testid="project-readiness-toggle"
  :aria-expanded="expanded"
  aria-controls="project-readiness-details"
  @click="toggle"
>
  {{ expanded ? '收起详情' : '查看详情' }}
  <el-icon><ArrowUp v-if="expanded" /><ArrowDown v-else /></el-icon>
</button>
```

Remove the subtitle from `.readiness-head`. Immediately after `.next-action`,
render the complete diagnostic region as follows:

```vue
<div
  id="project-readiness-details"
  v-show="expanded"
  class="readiness-details"
  data-testid="project-readiness-details"
>
  <p class="readiness-subtitle">从素材、五类 AI 服务到语音、逐集合成逐项核对，只保留一个下一步动作。</p>
  <el-progress :percentage="readiness.percent" :stroke-width="6" :show-text="false" />

  <div class="summary-grid">
    <div
      v-for="item in readiness.summaryItems"
      :key="item.id"
      class="summary-item"
      :class="[`is-${item.status}`, { ready: item.ready }]"
    >
      <span class="summary-dot" aria-hidden="true" />
      <div class="summary-copy">
        <strong>{{ item.label }}</strong>
        <span>{{ item.detail }}</span>
      </div>
      <span class="summary-state">{{ stateLabel(item.status) }}</span>
    </div>
  </div>

  <div class="service-strip">
    <span class="service-strip-title">AI 默认服务</span>
    <div class="service-chip-list">
      <component
        :is="service.ready ? 'span' : 'button'"
        v-for="service in readiness.services"
        :key="service.type"
        :type="service.ready ? undefined : 'button'"
        class="service-chip"
        :class="{ ready: service.ready }"
        :title="service.ready ? `${service.label}${service.verified ? '已验证' : '已配置'}：${service.detail}` : `前往配置${service.label}`"
        @click="!service.ready && emit('action', serviceAction(service))"
      >
        <span class="service-chip-dot" aria-hidden="true" />
        <span>{{ service.label }}</span>
      </component>
    </div>
  </div>
</div>
```

Use existing tokens for a 32px minimum-height toggle, a visible `:focus-visible` ring, and an 8px-or-smaller radius.

- [ ] **Step 4: Run focused and component-adjacent tests**

Run: `node --test test/desktopAccessibility.test.js test/desktopPmAcceptance.test.js test/projectReadiness.test.js` from `frontweb/`.

Expected: all tests pass.

- [ ] **Step 5: Commit compact readiness**

```bash
git add frontweb/src/components/ProjectReadinessPanel.vue frontweb/test/desktopAccessibility.test.js frontweb/test/desktopPmAcceptance.test.js
git commit -m "feat: prioritize source intake over readiness details"
```

### Task 3: Compact Full-Pipeline Controls

**Files:**
- Modify: `frontweb/src/components/filmCreate/FilmCreatePipelinePanel.vue`
- Modify: `frontweb/test/filmCreateComponentContract.test.js`
- Modify: `frontweb/test/filmCreateAccessibility.test.js`

**Interfaces:**
- Consumes: `useDisclosureState({ forceExpanded: computed(() => props.running) })`.
- Adds stable browser contracts: `film-pipeline-toggle` and `film-pipeline-details`.
- Existing props and emitted generation events remain unchanged.

- [ ] **Step 1: Add failing compact/auto-open contracts**

```js
test('full pipeline is an accessible idle disclosure that opens for running work', () => {
  assert.match(pipelinePanelSource, /data-testid="film-pipeline-toggle"/)
  assert.match(pipelinePanelSource, /:aria-expanded="expanded"/)
  assert.match(pipelinePanelSource, /aria-controls="film-pipeline-details"/)
  assert.match(pipelinePanelSource, /id="film-pipeline-details"/)
  assert.match(pipelinePanelSource, /v-show="expanded"/)
  assert.match(pipelinePanelSource, /forceExpanded:\s*computed\(\(\) => props\.running\)/)
})
```

Also assert the compact summary renders `focusKicker`, `focusTitle`, and `focusNextStep`, so an idle user receives state without opening the full panel.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/filmCreateComponentContract.test.js test/filmCreateAccessibility.test.js` from `frontweb/`.

Expected: FAIL because the pipeline disclosure contracts do not exist.

- [ ] **Step 3: Implement the pipeline disclosure**

Use this script contract:

```js
import { computed } from 'vue'
import { ArrowDown, ArrowUp, Setting, VideoPlay } from '@element-plus/icons-vue'
import { useDisclosureState } from '@/composables/useDisclosureState'

const { expanded, toggle } = useDisclosureState({
  forceExpanded: computed(() => props.running),
})
```

Render an always-visible compact header:

```vue
<div class="pipeline-disclosure-head">
  <div class="pipeline-heading"><el-icon><VideoPlay /></el-icon><span>全流程生成</span></div>
  <div class="pipeline-compact-copy" :data-state="focusState">
    <span>{{ focusKicker }}</span>
    <strong>{{ focusTitle }}</strong>
    <span>{{ focusNextStep }}</span>
  </div>
  <button
    type="button"
    class="pipeline-toggle"
    data-testid="film-pipeline-toggle"
    :aria-expanded="expanded"
    aria-controls="film-pipeline-details"
    @click="toggle"
  >
    {{ expanded ? '收起' : '展开' }}
    <el-icon><ArrowUp v-if="expanded" /><ArrowDown v-else /></el-icon>
  </button>
</div>
```

Insert the following opening tag immediately before the current
`<div class="pipeline-toolbar">` and its closing tag immediately after the
current `.pipeline-status` block, before `</section>`:

```vue
<div id="film-pipeline-details" v-show="expanded" class="pipeline-details" data-testid="film-pipeline-details">
```

```vue
</div>
```

The wrapped block is the exact current template from `.pipeline-toolbar`
through `.pipeline-status`; do not alter its settings, actions, countdown,
task-chip, or error-log nodes while moving it.

Do not auto-open for `productionReadinessState === 'error'` or `missing`.

- [ ] **Step 4: Run focused and FilmCreate tests**

Run: `node --test test/filmCreateComponentContract.test.js test/filmCreateAccessibility.test.js test/filmCreateAiConfigExperience.test.js` from `frontweb/`.

Expected: all tests pass.

- [ ] **Step 5: Commit compact pipeline controls**

```bash
git add frontweb/src/components/filmCreate/FilmCreatePipelinePanel.vue frontweb/test/filmCreateComponentContract.test.js frontweb/test/filmCreateAccessibility.test.js
git commit -m "feat: keep full pipeline controls context aware"
```

### Task 4: Split AI Service Status From Configuration Management

**Files:**
- Modify: `frontweb/src/components/AIConfigContent.vue`
- Modify: `frontweb/test/aiConfigContentSource.test.js`
- Modify: `frontweb/test/desktopAccessibility.test.js`
- Modify: `frontweb/test/aiConfigTheme.test.js`

**Interfaces:**
- Adds local state: `configWorkspaceView`, values `coverage` and `configs`.
- Adds stable browser contracts: `ai-config-mode-coverage` and `ai-config-mode-configs`.
- Existing `initialServiceType`, service filters, dialogs, vendor lock, and CRUD functions remain unchanged.

- [ ] **Step 1: Add failing workspace-mode contracts**

```js
test('AI configuration separates service status from provider management', () => {
  assert.match(source, /role="tablist" aria-label="AI 配置工作区"/)
  assert.match(source, /data-testid="ai-config-mode-coverage"/)
  assert.match(source, /data-testid="ai-config-mode-configs"/)
  assert.match(source, /:aria-selected="configWorkspaceView === 'coverage'"/)
  assert.match(source, /:aria-selected="configWorkspaceView === 'configs'"/)
  assert.match(source, /v-show="configWorkspaceView === 'coverage'"/)
  assert.match(source, /v-show="configWorkspaceView === 'configs'"/)
  assert.match(source, /configWorkspaceView\.value = 'configs'[\s\S]*activeServiceFilter\.value = serviceType/)
})
```

Add an accessibility assertion for visible focus styles on `.config-workspace-mode:focus-visible` and a theme assertion that the selected mode uses existing `--accent-text`/border/surface tokens.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/aiConfigContentSource.test.js test/desktopAccessibility.test.js test/aiConfigTheme.test.js` from `frontweb/`.

Expected: FAIL because the two-mode workspace does not exist.

- [ ] **Step 3: Implement the mode switch and transitions**

Initialize mode from the existing route filter:

```js
const configWorkspaceView = ref(
  normalizeInitialServiceType(props.initialServiceType) ? 'configs' : 'coverage',
)
```

At the start of `focusServiceConfigs(serviceType)` add:

```js
configWorkspaceView.value = 'configs'
```

At the start of `applyRequestedService(serviceType)` set management mode when the normalized service is non-empty. Keep add, edit, and test card actions in coverage mode; only the existing view/focus path switches to management.

Add this control before the two regions:

```vue
<div class="config-workspace-switch" role="tablist" aria-label="AI 配置工作区">
  <button
    type="button"
    role="tab"
    class="config-workspace-mode"
    data-testid="ai-config-mode-coverage"
    :class="{ active: configWorkspaceView === 'coverage' }"
    :aria-selected="configWorkspaceView === 'coverage'"
    @click="configWorkspaceView = 'coverage'"
  >服务状态</button>
  <button
    type="button"
    role="tab"
    class="config-workspace-mode"
    data-testid="ai-config-mode-configs"
    :class="{ active: configWorkspaceView === 'configs' }"
    :aria-selected="configWorkspaceView === 'configs'"
    @click="configWorkspaceView = 'configs'"
  >配置管理</button>
</div>
```

Wrap the existing coverage section with `v-show="configWorkspaceView === 'coverage'"`. Wrap the action bar, filter, default tip, and table with `v-show="configWorkspaceView === 'configs'"`. Keep `configDependencyError` above both regions.

- [ ] **Step 4: Run all AI configuration tests**

Run from `frontweb/`:

```bash
node --test test/aiConfigContentSource.test.js test/aiConfigCoverage.test.js test/aiConfigExport.test.js test/aiConfigFailClosed.test.js test/aiConfigTheme.test.js test/filmCreateAiConfigExperience.test.js test/desktopAccessibility.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit the AI workspace split**

```bash
git add frontweb/src/components/AIConfigContent.vue frontweb/test/aiConfigContentSource.test.js frontweb/test/desktopAccessibility.test.js frontweb/test/aiConfigTheme.test.js
git commit -m "feat: separate AI service status and config management"
```

### Task 5: Production Evidence And Release Gates

**Files:**
- Modify: `frontweb/scripts/e2e-production.cjs`
- Modify: `frontweb/test/e2eProductionContract.test.js`
- Modify: `docs/ui-refresh-20260718.md`
- Modify: `frontweb/public/reports/product-acceptance/report.html`
- Create: `frontweb/public/reports/product-acceptance/final-20260718/33-project-readiness-compact-1280.jpg`
- Create: `frontweb/public/reports/product-acceptance/final-20260718/34-film-pipeline-compact-1280.jpg`
- Create: `frontweb/public/reports/product-acceptance/final-20260718/35-ai-config-management-1280.png`

**Interfaces:**
- Consumes the stable `data-testid` contracts from Tasks 2-4.
- Produces source and Docker browser evidence for the acceptance report.

- [ ] **Step 1: Add failing E2E source contracts**

```js
test('production E2E verifies workflow-first disclosures and AI config modes', () => {
  assert.match(source, /project-readiness-toggle/)
  assert.match(source, /project-readiness-details/)
  assert.match(source, /film-pipeline-toggle/)
  assert.match(source, /film-pipeline-details/)
  assert.match(source, /ai-config-mode-configs/)
})
```

- [ ] **Step 2: Run the E2E contract test and verify RED**

Run: `node --test test/e2eProductionContract.test.js` from `frontweb/`.

Expected: FAIL because production E2E does not yet assert the new contracts.

- [ ] **Step 3: Extend production E2E**

Add Playwright assertions that:

```js
await page.getByTestId('project-readiness-toggle').waitFor({ state: 'visible' })
await page.getByTestId('project-readiness-details').waitFor({ state: 'hidden' })
await page.getByTestId('project-readiness-toggle').click()
await page.getByTestId('project-readiness-details').waitFor({ state: 'visible' })

await page.getByTestId('film-pipeline-toggle').waitFor({ state: 'visible' })
await page.getByTestId('film-pipeline-details').waitFor({ state: 'hidden' })

await page.getByTestId('ai-config-mode-configs').click()
await page.locator('.config-list-section').waitFor({ state: 'visible' })
```

Use the project and route setup already created by `e2e-production.cjs`; do not add external Provider calls.

- [ ] **Step 4: Run package verification**

Run:

```bash
npm --prefix frontweb run verify
npm run verify
git diff --check
```

Expected: frontend tests/build/bundle budgets pass, root verification passes, and diff check reports no errors.

- [ ] **Step 5: Build and verify the final clean Docker revision**

After committing Tasks 1-4, run:

```bash
npm run docker:up
npm run verify:docker
npm run docker:e2e:up
npm run verify:e2e
npm run verify:rollback
```

Expected: backend and frontend OCI revision labels equal the final clean Git SHA; Docker verification, production E2E, and rollback drill pass.

- [ ] **Step 6: Capture and inspect browser evidence**

Use the in-app browser at `http://localhost:3013` with 1280x720 and 1440x900 desktop viewports. Save screenshots 33-35, inspect each file, verify no horizontal overflow, and verify both disclosure states and both AI modes.

- [ ] **Step 7: Update docs and acceptance report with actual evidence**

Document the workflow-first decisions, exact test counts, source SHA, Docker image IDs/revisions, E2E result, rollback result, and screenshot links. Replace `PENDING` only after the corresponding command passes.

- [ ] **Step 8: Run security and release audit**

Run npm audits for backend, frontend, and desktop; Gitleaks against history/worktree; Trivy configuration scans and final backend/frontend image vulnerability scans. Require zero Critical/High release findings or a documented release-blocking failure.

- [ ] **Step 9: Commit and push final evidence**

```bash
git add frontweb/scripts/e2e-production.cjs frontweb/test/e2eProductionContract.test.js docs/ui-refresh-20260718.md frontweb/public/reports/product-acceptance/report.html frontweb/public/reports/product-acceptance/final-20260718/33-project-readiness-compact-1280.jpg frontweb/public/reports/product-acceptance/final-20260718/34-film-pipeline-compact-1280.jpg frontweb/public/reports/product-acceptance/final-20260718/35-ai-config-management-1280.png
git commit -m "test: close workflow hierarchy release gates"
git push origin codex/release-trivy-source-build-fix
```

Expected: push succeeds and GitHub CI starts for the pushed SHA.
