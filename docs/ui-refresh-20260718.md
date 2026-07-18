# Desktop UI Refresh Notes

Date: 2026-07-18
Scope: LocalMiniDrama desktop web workspace

## Research References

The following public pages were inspected in the in-app browser during this
review. They are reference points for interaction hierarchy, not assets to
copy into the product:

- [Linear](https://linear.app/) - compact navigation, strong typographic
  hierarchy, and a clear primary work surface.
- [Krea](https://www.krea.ai/) - one obvious primary action and a focused
  creative workspace instead of a feature inventory.
- [Runway](https://runwayml.com/) - content is the visual anchor; controls
  support the content rather than competing with it.
- [Descript](https://www.descript.com/) - script and media stay adjacent, and
  delivery actions remain part of the editing workspace instead of a separate
  administrative page.

## Decisions For LocalMiniDrama

LocalMiniDrama is a local production tool, so a dark marketing hero and
large decorative imagery would be the wrong tradeoff. The desktop refresh
keeps the existing light/dark themes and applies the useful parts of the
references to the project list:

1. Make the project workspace title, count, search, and sort visible before
   the project cards.
2. Keep creation and import as the prominent actions; move infrequent theme
   and recycle-bin actions to quiet icon controls with accessible labels.
3. Let each project card expose status, episode/storyboard counts, and update
   time in a stable order so a user can scan and choose the next project.
4. Provide a query-specific no-results state with a single recovery action
   rather than leaving an apparently empty page.
5. Keep keyboard focus rings, tooltips, and existing route/API behavior
   intact. No new runtime dependency or external image is required.

## Round Two Audit Findings

The desktop acceptance pass then inspected the live application at 1440x900
and 1366x768 in both themes. The product-manager review identified four
follow-up priorities:

1. AI 配置 must use the same surface, border, text, table, and form tokens in
   dark mode; Element Plus defaults must not create a bright panel inside a
   dark shell.
2. The production workbench must reserve space for its sticky navigation when
   an anchor is selected, so section headings and their primary action remain
   visible.
3. The workbench must expose one concise current-state explanation and next
   action before the long production canvas competes for attention.
4. The media library empty state must have one primary upload action. Network
   URL import is a project-level workflow and must say so explicitly.

These priorities preserve the existing desktop information architecture while
making the next action easier to scan. Mobile layout, touch gestures, and
real-provider integration remain deferred by the release scope.

## Acceptance Criteria

- Project search is debounced and server-backed so title, description, style,
  genre, tags, metadata, and the localized style/genre labels shown in the UI
  can be matched across every page of results.
- Sort order is deterministic and has a visible selected label.
- Search, status, and sort state are normalized into the route; clearing a
  search restores the full list without dropping unrelated query state.
- Icon-only controls have an accessible name and a visible tooltip.
- Project links remain keyboard reachable and have a visible focus state.
- The layout remains usable at 1440x900 and 1366x768 in both themes.
- Frontend unit/contract tests and production E2E remain green after the
  refresh.
- The live acceptance evidence records the source revision, viewport, theme,
  and exact flow state for every new screenshot.

## Deliberately Deferred

Mobile-specific layout, touch gestures, broad canvas redesign, and external
provider branding remain outside this desktop release pass. They need their
own interaction and evidence matrix rather than being inferred from the
desktop layout.

## Round Three: Visual Work Surface

The next review revisited the same public references in the in-app browser on
2026-07-18. The useful pattern was consistent across the products: the work
should be identifiable at a glance, the active state should be filterable
without leaving the surface, and a user should have one obvious way to
continue.

The project list now applies those patterns to local production data:

1. A project card uses the first usable storyboard image as its visual cover,
   then falls back to a character, scene, or prop image. Placeholder media is
   never rendered as a real cover.
2. Projects can be filtered by lifecycle status in the same control row as
   search and sorting. Filtering, pagination, and deterministic sorting are
   executed by the backend so projects beyond the first page remain reachable.
3. A card includes an explicit `继续制作` affordance while the whole card
   remains one keyboard-reachable project link.
4. Broken or unavailable cover URLs degrade to a labeled `待生成画面` or
   `尚无画面` placeholder rather than a broken-image icon.

The implementation is intentionally desktop-first. It uses existing project
media and the current Element Plus/icon stack, so it does not add a new image
host, dependency, or provider contract. The route and visual helpers are
covered by `frontweb/test/projectListRouting.test.js` and
`frontweb/test/projectListVisual.test.js`; backend query behavior is covered by
`backend-node/test/dramaList.test.js`. The live acceptance matrix
must include at least one project with a real cover, one placeholder-only
project, both themes, and each status filter state.

## Round Four: End-to-End Production Flow

The final desktop pass applies the same compact, media-first hierarchy beyond
the project list:

1. Every project card exposes a dedicated `素材` link that opens the source
   intake workflow and preserves a validated return route.
2. AI readiness distinguishes checking, ready, missing, and failed states;
   only a confirmed missing service sends the user to configuration.
3. The canvas inspector stays docked, reports current-shot progress and usable
   media counts, and moves to the previous or next shot without discarding an
   unsaved draft.
4. The final production step is named `交付与导出` and keeps composition,
   validated video/subtitle downloads, and validated project ZIP export in one
   workspace.

Evidence for these paths is stored in
`frontweb/public/reports/product-acceptance/final-20260718/` and linked from the
HTML acceptance report. Mobile-specific reflow and live third-party Provider
deep integration remain separately deferred.

## Round Five: Workflow-First Hierarchy

The final workflow pass reduces diagnostic detail without hiding the next
decision:

1. Project readiness keeps its score and one next action visible while the
   eight-item diagnostic list starts collapsed. Expanding it does not move or
   replace the next action.
2. The full-production pipeline starts as one compact status row while idle,
   auto-opens for running work, and exposes the full reasons and controls only
   when needed. The expanded state has one heading and one status source.
3. AI configuration separates `服务状态` from `配置管理`. Direct service links
   open configuration management, while a generic visit opens service status.
   The horizontal tabs implement roving focus and Left/Right keyboard movement.
4. The final navigation label is `交付与导出`; production E2E follows that
   user-facing label instead of the obsolete `合成视频` text.

## Evidence Authority

Evidence authority: machine-artifact
Tracked evidence role: illustrative

This tracked document and the HTML report describe the desktop workflow and
retain historical visual context. They do not record a current release result,
source revision, image digest, or mutable test count. Formal release approval is
determined only by machine artifacts generated from the final clean source
revision and by GitHub checks for that same revision.

Final full-viewport captures are generated outside the tracked report under
`artifacts/e2e-production/acceptance-report/`. The ignored manifest records the
source revision, viewport, theme, byte size, and SHA-256 for each capture and is
validated together with `artifacts/e2e-production/evidence.json`. A source
change invalidates that evidence and requires the machine gates to run again.

## Illustrative Screenshots

The following tracked screenshots remain useful for reviewing the workflow
hierarchy, but they are not final same-revision machine evidence:

- `33-project-readiness-compact-1280.jpg` is 1265x712.
- `34-film-pipeline-compact-1280.jpg` is 1265x712.
- `35-ai-config-management-1280.png` is 1280x376 and intentionally stops above
  configuration rows.

Their dimensions do not satisfy the final full-viewport matrix. The production
E2E path must generate new ignored captures for the contract-defined viewport
and theme matrix after the final source revision is clean.

## Deferred External Gates

Real external Provider integration, mobile/touch reflow, and Authenticode remain
explicitly deferred. The tracked report does not include a Provider URL, API
credential, or substitute screenshot claim for those gates. They require their
own runtime evidence before their respective scopes can be approved.
