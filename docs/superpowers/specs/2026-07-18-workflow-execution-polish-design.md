# Workflow Execution Polish Design

Date: 2026-07-18
Status: Approved through the active product-quality goal and autonomous UI-improvement direction
Scope: Desktop web project list, source workflow, production workbench, and AI service overview

## Goal

Turn the existing workflow-first hierarchy into an executable production path.
Every status surface must answer three separate questions without ambiguity:

1. Where am I now?
2. What has already been completed?
3. What is the one action that moves production forward?

The pass preserves the current routes, API payloads, generation behavior,
provider contracts, project data, themes, and Docker topology.

## Evidence

Current-product screenshots captured at the live desktop application:

- `docs/audits/ui-learning-20260718/01-project-list-current.png`
- `docs/audits/ui-learning-20260718/02-film-workbench-current.png`
- `docs/audits/ui-learning-20260718/03-ai-config-current.png`
- `docs/audits/ui-learning-20260718/04-source-intake-current.png`

Public references were inspected for interaction patterns, not copied assets:

- [Krea](https://www.krea.ai/app): persistent navigation, an independent
  selected state, and one dominant action in the work surface.
- [Descript](https://www.descript.com/): script, media, and AI assistance remain
  in the same editing context.
- [Figma](https://www.figma.com/): contextual controls stay close to the
  selected work instead of becoming global navigation.
- [Linear](https://linear.app/): compact context chrome and a quiet active state.
- [WAI-ARIA aria-current](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/):
  current location is semantic state, not a substitute for completion state.

Three independent reviews agreed on the highest-impact gaps:

- the production header does not distinguish project and episode context;
- completion color in the side navigation does not identify current location;
- the compact pipeline describes a next action without making it executable;
- the source workflow conflates actual progress with the historical step being
  inspected and sends a completed user back to source import;
- AI service cards place healthy and broken services at equal priority and
  duplicate actions;
- the word `素材` represents several different scopes.

## Alternatives

### A. Evolutionary workflow polish - selected

Keep the current application shell and make the critical path executable.
This has the best ratio of user benefit to regression risk and can be covered by
focused component contracts plus the existing production E2E.

### B. New studio shell

Replace the top bar, navigation, inspector, and page hierarchy with a new
editor shell. This offers a larger visual change but would couple unrelated
canvas, routing, draft-protection, and generation behavior. It is deferred.

### C. Visual reskin only

Change colors, cards, and spacing without changing workflow semantics. This
would leave the current dead-end and orientation problems intact and is
rejected.

## Production Context Bar

The workbench header must expose two explicitly named pieces of context:

- `项目`: the current project title;
- `当前集`: `第 N 集 · 标题`.

Rules:

- The episode select is not clearable while episodes exist.
- Every episode option and selected value uses the same formatter.
- Project and episode controls have accessible names and native title/tooltips
  containing the complete value.
- Long values truncate visually without changing the accessible value.
- Selecting another episode preserves the existing draft flush, route query,
  and return context behavior.

## Workbench Navigation

Completion and current location remain independent states.

- `step.status` continues to drive the dot, connector, count, and completion
  semantics.
- `activeNavKey` drives the selected background and exactly one
  `aria-current="step"` value.
- Clicking a navigation item updates the current key immediately and performs
  the existing smooth scroll.
- Manual scrolling updates the current key from section positions, accounting
  for the sticky header. The implementation must not create one observer per
  storyboard row.
- `分镜脚本` targets the storyboard settings and script-generation heading.
- `分镜图` targets the batch image actions using a separate stable anchor.
- Completion remains visible in grayscale; the current state cannot rely on
  color alone.

## Compact Pipeline Action

The compact pipeline row contains one state-derived command next to the status
copy. The disclosure button remains a separate diagnostic command.

| State | Compact command |
| --- | --- |
| missing service | `配置缺失服务`, emits the existing service-specific `open-ai-config` event |
| readiness error | `重试检查`, emits `retry-readiness` |
| ready | `生成完整成片`, emits the existing guarded `start-one-click` path |
| paused | `继续生成`, emits `resume` |
| checking, actively running, or blocked by an unrelated draft prerequisite | no executable command |

The command is a native button, is keyboard reachable, has a stable test id,
and emits at most once per activation. Starting production must continue to use
the existing confirmation and action-gate path; the compact command may not
bypass cost or readiness protection.

## Source Workflow Semantics

The actual production stage and the inspected stage become separate state:

- `flowState.activeStepId` owns progress semantics and `aria-current="step"`.
- `selectedFlowStepId` owns the detail panel and `aria-pressed`.
- Clicking a completed historical step never changes the actual current stage.
- When new workflow data advances or fails, the selected detail follows the
  actual stage unless the user is deliberately inspecting history and the
  active stage has not changed.

The workflow copy must distinguish output scope:

- a draft run is `草稿预演已完成`;
- placeholder media is explicitly `含占位产物`;
- a production run may use `正式制作已完成` only when production evidence says
  so;
- no unqualified `已完成` may imply that a draft is a deliverable film.

## Completed Source Handoff

When the source workflow is complete and has no active/error state, it starts in
a compact completion view no taller than 180px at 1280x720.

The compact view contains:

- completion scope (`草稿预演` or `正式制作`);
- QA result;
- episode, track, duration, and placeholder summary;
- primary `进入制作` action;
- secondary `查看分集` action;
- disclosure action for full workflow history.

`进入制作` uses the first valid episode when no episode is otherwise selected,
preserves the validated project-list return context, and routes to the existing
production workbench with `?episode=<id>`.

`查看分集` focuses `#episode-list`. `继续导入故事素材` remains available only
inside the expanded history as a tertiary action. Processing, paused, failed,
blocked, and unreadable-data states always start expanded.

## Material Naming

Global and project-scoped concepts use different labels:

- global uploaded media: `素材中心`;
- reusable character, scene, and prop records: `分类素材`;
- a project card's source workflow: `故事素材`;
- the workflow heading: `故事素材流程`;
- import actions: `导入故事素材` or `继续导入故事素材`.

Accessible names for project-card links include both the project title and
`故事素材`. Routes and return-query behavior remain unchanged.

## AI Service Overview

The existing `服务状态 / 配置管理` split remains. The service overview becomes
exception-first and denser:

- sort priority: failed test, missing default/inactive, missing configuration,
  untested default, tested healthy;
- preserve the stable service-definition order within the same priority;
- the card itself remains the route to configuration management;
- each service displays at most one additional context action:
  `添加`, `补齐默认`, `立即测试/重新测试`, or none for a tested healthy service;
- all five service states and their primary actions fit in the AI dialog at
  1280x720 without scrolling;
- vendor lock, fail-closed writes, route deep links, and keyboard workspace
  navigation remain unchanged.

Closing the AI dialog retains the workbench context and returns focus to the
trigger. If configuration data changed, the parent refreshes readiness and
announces `配置已更新，正在重新检查` through the existing message/live-region
mechanism. A refresh failure keeps the last successful status and exposes the
existing retry path.

## Visual Language

- Work surfaces remain neutral and dense; purple is reserved for selected state
  and primary commands rather than tinting every container.
- Success, warning, and failure use existing semantic green, amber, and red
  tokens.
- No gradients, decorative assets, nested cards, new runtime dependencies, or
  viewport-scaled font sizes are introduced.
- New controls use existing Element Plus or Lucide-equivalent icon assets,
  existing theme tokens, at most 8px radii, and at least 32px interaction height.

## Error And Data Boundaries

- No new network endpoint, persistence field, schema, or retry loop is added.
- Existing last-successful-snapshot and fail-closed behavior is preserved.
- Draft flush and unsaved-change confirmation run before episode navigation.
- A compact action never becomes active while readiness is checking or a
  production command is already running.
- Missing or deleted episode ids fall back to the first current episode; an
  empty project keeps the existing episode-empty-state workflow.

## Verification

Automated coverage:

- formatter tests for project/episode labels and non-clearable context;
- navigation tests for unique anchors, scroll-derived current state, and one
  `aria-current="step"`;
- pipeline action-state tests for missing, error, ready, paused, checking, and
  running states;
- source workflow tests separating active and selected stages;
- source completion tests for compact/expanded behavior and production routing;
- AI coverage tests for exception-first sorting and one visible context action;
- project-list tests for the `故事素材` label and accessible name;
- existing theme, accessibility, draft protection, provider, and E2E contracts.

Browser and production acceptance:

- 1280x720, 1366x768, and 1440x900;
- light and dark themes for changed surfaces;
- project and episode context remain distinguishable with long Chinese names;
- clicking and manually scrolling update the current navigation state;
- compact pipeline commands open the correct service, retry, resume, or guarded
  production action without first expanding diagnostics;
- completed source workflow exposes `进入制作` and the episode list in the first
  viewport;
- closing AI configuration restores focus and refreshes readiness;
- zero incoherent overlap and zero horizontal overflow.

Release acceptance still requires frontend verification, root verification,
Docker rebuild with `--wait`, container verification, production E2E, security
scans, final report evidence, push, and GitHub CI on the same final commit.

## Deferred

Mobile reflow, touch behavior, real third-party Provider deep integration,
Authenticode, a new studio shell, backend protocol changes, and the broader
canvas Roadmap remain in the active product goal but outside this focused
desktop implementation cycle.
