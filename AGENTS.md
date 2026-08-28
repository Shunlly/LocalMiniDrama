# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

LocalMiniDrama (本地短剧助手) — an AI-powered local short drama creation tool. Single product, three sub-projects sharing one repo (no monorepo tooling).

### Services

| Service | Directory | Port | Start Command |
|---------|-----------|------|---------------|
| Backend (Express + SQLite) | `backend-node/` | 5679 | `npm run dev` |
| Frontend (Vite + Vue 3) | `frontweb/` | 3013 | `npm run dev` |

Frontend proxies `/api` and `/static` to backend via Vite config.

### Running Tests

```bash
# Backend tests (Node.js built-in test runner)
npm --prefix backend-node test

# Frontend tests (ESM, Node.js built-in test runner)
npm --prefix frontweb test
```

No ESLint or other lint tool is configured in this codebase.

Use the package-level verification scripts before handoff:

```bash
npm --prefix backend-node run verify
npm --prefix frontweb run verify
```

### Building

```bash
npm --prefix frontweb run build
```

### Key Development Notes

- Pure JavaScript (no TypeScript) throughout.
- Backend uses `node --watch` for hot reloading in dev mode (`npm run dev`).
- Database is SQLite (embedded via `better-sqlite3`), auto-created in `backend-node/data/`.
- Backend startup runs `runMigrationsAndEnsure()`: it applies SQL migrations and then performs table/column compatibility ensures. Explicit `npm run migrate` is mainly for manual initialization or migration verification.
- Config file at `backend-node/configs/config.yaml` already exists in the repo — no need to copy from example.
- AI content generation requires external API keys (configured via the app's "AI 配置" page), but the app fully functions without them for development/testing purposes.
- The backend also serves the built frontend from `frontweb/dist/` at port 5679 when the dist folder exists; during development, use the Vite dev server at port 3013 instead.
- Docker uses Node.js 20. Run `docker compose up -d --build --wait` after source changes because the compose services do not bind-mount application source. Use `npm run verify:docker` from the repo root for container-level verification.
- Root, backend, frontend, Docker, and common PR/branch gates use Node.js 20. Desktop dependency installation, native rebuilds, packaging, and Windows artifact security scans use Node.js 22.12.0 with `desktop/.npmrc` `engine-strict=true`; Electron 43.1.1 itself embeds Node.js 24 at runtime.
