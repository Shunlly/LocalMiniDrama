# Release Acceptance Closure Design

## Scope

Close two desktop release-acceptance gaps without expanding mobile or real third-party Provider integration:

1. A project readiness action that names an incomplete AI service must take the user directly to the affected configuration.
2. Final same-commit visual evidence must cover the main desktop entry and creation surfaces, not only readiness and AI configuration panels.

## AI Configuration Entry

- Keep `service_type` as the validated deep-link contract.
- After configuration and vendor-lock dependencies load, derive the current service state from `serviceCoverage`; do not trust stale route details.
- If the service is missing, open the existing add dialog for that service.
- If a target configuration exists but is not ready, open the existing edit dialog. Structural issues reuse `applyAiConfigRepairTarget` to reveal and focus credentials, model, or workflow fields. A failed connection opens the affected configuration but does not automatically call the Provider.
- If the service is ready, keep the existing filtered configuration-list destination.
- If dependency loading fails or writes are locked, remain fail closed on the filtered page with the existing retry state.

## Final Visual Evidence

Keep the existing 20 captures and add one light and one dark `1280x720` capture for each of these surfaces:

- project list
- media library
- drama canvas
- free creation

The exact final matrix therefore contains 28 PNG files. Each new surface must:

- navigate through the production frontend against the production E2E fixture;
- wait for its root and stable content state;
- reject visible loading masks, blank output, and protected Provider values;
- preserve original viewport dimensions and bind its hash to the clean Git commit in the final manifest.

The canvas capture must require a rendered Vue Flow viewport or an explicit usable canvas empty state. The media library must require a completed successful load. The project list must require its main task surface to be visible. Free creation must require its main task surface and an explicit `.service-readiness.is-ready` state; a merely non-loading service state is insufficient.

## Failure Handling

- No screenshot is accepted while a loading mask is visible.
- A missing or unknown capture surface fails closed.
- AI configuration dependency errors never auto-open a writable dialog.
- Navigation to a failed connection never triggers a network test without a user command.

## Verification

- TDD coverage for deep-link auto-open behavior and exact 28-capture matrix.
- Production E2E contract tests for route preparation and readiness predicates for all eight surface types.
- Full frontend verification and build budget.
- Clean-commit Docker production E2E producing 28 screenshots, a passing evidence record, and a passing final acceptance-report verifier.
- Browser inspection of representative light/dark project list, media library, canvas, free creation, AI repair, and HTML report states.

## Out Of Scope

- Mobile layout work.
- Deep validation against user-owned external Provider accounts, quotas, or models.
- A full screenshot matrix for every error, empty, and intermediate state; those remain covered by focused behavior tests and targeted browser acceptance.
