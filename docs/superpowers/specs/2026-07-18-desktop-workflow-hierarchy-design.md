# Desktop Workflow Hierarchy Design

Date: 2026-07-18
Status: Approved for implementation through the active product-quality goal
Scope: Desktop web workspace only

## Problem

LocalMiniDrama exposes the required production capabilities, but several global
status surfaces appear before the task the user is trying to complete:

- `ProjectReadinessPanel` pushes story-source intake below the first viewport.
- `FilmCreatePipelinePanel` presents full-production readiness and multiple
  generation modes before script editing, even when the user is working on an
  early production step.
- `AIConfigContent` shows service coverage, management actions, and the complete
  configuration table in one long surface, duplicating information and forcing
  users to scan past the overview to manage a provider.

The result is a capable product that feels administrative. The local task must
become the primary surface while global production state remains available.

## Evidence

Current-product screenshots:

- `docs/audits/ui-research-20260718/01-project-list-current.png`
- `docs/audits/ui-research-20260718/03-delivery-current.png`
- `docs/audits/ui-research-20260718/04-ai-config-current.png`
- `docs/audits/ui-research-20260718/05-source-intake-current.png`
- `docs/audits/ui-research-20260718/06-project-readiness-current.png`

Public reference pages were used for interaction hierarchy, not copied assets:

- Linear: compact chrome and a dominant work surface.
- Descript: script, media, and delivery remain in one editing context.
- Krea: media remains the visual anchor while generation controls stay quiet.
- Figma: global tools are compact and context-specific controls appear near the
  selected work.
- Frame.io: asset state and delivery state are visible without replacing the
  asset itself.

## Decision

Use an evolutionary, workflow-first redesign. Preserve routes, API contracts,
generation semantics, themes, and project data. Change hierarchy and disclosure
only:

1. Global readiness surfaces start compact and retain one visible next action.
2. Full diagnostics remain one deliberate expansion away.
3. Running production work expands automatically because progress and controls
   are then the user's current task.
4. AI configuration separates service health from provider management with an
   accessible two-mode segmented control.

This approach gives most of the UX benefit without a high-risk studio-shell
rewrite.

## Project Readiness

`ProjectReadinessPanel` becomes a disclosure surface.

The compact state contains:

- title and `readyCount / totalCount` score;
- the single computed next action and its primary button;
- an icon-and-text disclosure button with `aria-expanded` and `aria-controls`.

The expanded state adds:

- the explanatory subtitle;
- progress bar;
- eight readiness summary rows;
- five AI service chips.

The compact state is the default on `DramaDetail`, so source intake begins in
the first desktop viewport. The next action never disappears when collapsed.
Expansion state is local UI state and is not persisted to the project database.

## Full-Pipeline Panel

`FilmCreatePipelinePanel` starts compact when no pipeline is running.

The compact state contains:

- `全流程生成` label;
- current readiness kicker and title;
- one concise next-step sentence;
- disclosure control.

The expanded state preserves the current settings, production/draft actions,
readiness reason, countdown, running-task chips, error log, and pause/resume
controls. It automatically expands when `running` becomes true. A readiness
probe error does not auto-expand because the user may still edit scripts and
assets without full-production capability.

## AI Configuration Workspace

The first `AI 配置` tab gains a two-mode segmented control:

- `服务状态`: coverage score, five service cards, and per-service test/add/edit
  actions.
- `配置管理`: add/import/export/vendor shortcuts, active service filter, and the
  configuration table.

Rules:

- Opening `/ai-config?service_type=...` selects `配置管理` because the caller
  requested a concrete service.
- Selecting a configured service card or its `查看配置` action selects
  `配置管理` and applies the service filter.
- Adding or testing from a coverage card remains in `服务状态`; the dialog owns
  the immediate action and the overview refreshes after completion.
- Clearing the service filter does not switch modes.
- Vendor-lock behavior and fail-closed write locking remain unchanged.

## Visual Language

- Reuse the existing neutral surface, border, text, success, warning, and accent
  tokens from `frontweb/src/styles/theme.css`.
- Do not add gradients, decorative imagery, new runtime dependencies, or a new
  color system.
- Disclosure surfaces use at most an 8px radius.
- Core labels remain at least 13px; diagnostic metadata may remain 11-12px.
- Buttons use existing Element Plus icons. The disclosure control uses
  `ArrowDown`/`ArrowUp` and includes a visible text label.

## Accessibility

- Every disclosure has a native button, `aria-expanded`, and `aria-controls`.
- Hidden content uses `v-show`, retaining state without placing it in the
  accessibility tree while collapsed.
- The AI mode control uses `role="tablist"`, `role="tab"`, `aria-selected`, and
  keyboard-focus styles.
- The compact readiness next action remains keyboard reachable.
- Existing loading, alert, and live-region semantics remain unchanged.

## Error Handling

- Load failures continue to preserve the last successful snapshot and lock
  writes.
- Compact panels show the existing user-facing error title but defer verbose
  diagnostics until expanded.
- No new retries, network requests, or persistence paths are introduced.
- Running pipelines auto-expand so pause, resume, countdown, and error controls
  cannot be hidden during execution.

## Verification

Automated acceptance:

- component test proves readiness is collapsed initially, the next action stays
  visible, and the disclosure expands details;
- component/contract test proves the pipeline is compact while idle and expands
  when running;
- AI configuration contract test proves the two modes, service-route entry, and
  coverage-to-management transition;
- existing accessibility, theme, fail-closed, and provider tests remain green;
- frontend production build and bundle budgets remain green.

Browser acceptance at 1280x720 and 1440x900:

- source intake heading or first workflow step is visible without manually
  collapsing readiness;
- script workbench is visible beneath the compact full-pipeline row;
- expanding both disclosures reveals all existing controls;
- direct AI service links open `配置管理` with the correct filter;
- both themes have no overlap, horizontal overflow, or unreadable text.

## Release Boundaries

This pass does not change mobile reflow, Provider protocols, real third-party
credentials, generation algorithms, route names, backend schemas, or Docker
topology. Those remain tracked by the broader active release goal.
