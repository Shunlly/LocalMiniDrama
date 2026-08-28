# OpenClaw CI Contract Gate Design

## Scope

Make the existing OpenClaw compatibility contract a mandatory repository gate. This change does not alter the OpenClaw skill, backend behavior, or public API; it only prevents incompatible changes from passing `npm run check`, CI, or release source verification unnoticed.

## Selected Design

- Add a root script named `test:openclaw-contract` that runs `node --test scripts/openclaw-contract.test.cjs`.
- Add `node --check scripts/openclaw-contract.test.cjs` to the root syntax gate.
- Invoke `npm run test:openclaw-contract` from the root `check` script alongside the existing release and local contract suites.
- Continue using `npm run check` as the single CI and release entry point. Do not duplicate a second OpenClaw-only workflow step.

This keeps one authoritative source gate while making the seven existing OpenClaw tests visible and independently runnable.

## Failure Handling

- A syntax error in the contract file fails before tests execute.
- A mismatch between the skill artifacts and backend behavior fails `test:openclaw-contract` and therefore fails `check`.
- The gate must not skip based on platform, missing Provider credentials, or network availability. The contract remains local and deterministic.

## Verification

- A source-contract test must first prove that the root package does not expose or invoke `test:openclaw-contract`.
- After implementation, `npm run test:openclaw-contract` must report seven passing tests and zero failures.
- `npm run check` must execute the OpenClaw suite and exit zero.
- The root release contract suite must continue to pass on Node.js 20.

## Out Of Scope

- Real OpenClaw installation or remote Provider calls.
- Changes to OpenClaw request or response semantics.
- New workflow jobs or dependencies.
