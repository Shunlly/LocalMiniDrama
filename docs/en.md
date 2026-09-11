<div align="center">

# 🎬 LocalMiniDrama

**A local-first AI short drama & comic generator — bring your own local or hosted providers, fully open source**

[![version](https://img.shields.io/badge/version-1.3.3-blue?style=flat-square)](#how-to-run)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](#)
[![stack](https://img.shields.io/badge/Vue3%20%2B%20Node.js%20%2B%20Electron-informational?style=flat-square)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/Shunlly/LocalMiniDrama/pulls)

**[中文](../README.md) | English | [Author's Story](story.md)**

</div>

---

LocalMiniDrama keeps projects and generated files on your machine by default while letting you connect your own AI services. Generation is not fully offline: prompts, reference images, or media are sent to the provider and proxy endpoints you explicitly configure.
This project is built entirely in JavaScript from scratch. Review each provider's privacy policy before sending sensitive material.

> ✅ No mandatory subscription · ✅ Projects stored locally by default · ✅ Multiple AI providers · ✅ Fully open source

---

## How to run

Package version is `1.3.3`. That is the repository `package.json` version, not a GitHub Release / tag, and the release has not been merged to `main`. Run from source or Docker; do not download a GitHub Release for current use. Git still has only the `v1.3.0`, `v1.3.1`, and `v1.3.2` tags. The [Releases page](https://github.com/Shunlly/LocalMiniDrama/releases) is history only. The current branch and a dirty worktree are not a completed release.

- Backend `backend-node`: Express + SQLite (better-sqlite3), port **5679**; startup runs `runMigrationsAndEnsure`
- Frontend `frontweb`: Vite in development, port **3013**; the dev server proxies `/api`, `/static`, `/ready`, and `/health`
- Production can also `npm run build` in `frontweb` and let the backend host `frontweb/dist` on 5679 (`WEB_DIST_PATH` overrides the path). Docker production serves the frontend with Nginx
- Language: plain JavaScript, no TypeScript
- Root, backend, frontend, Docker, and common PR/branch gates use Node.js 20.x (`.nvmrc` is `20`); desktop install, native rebuilds, packaging, and Windows artifact security scans use Node.js 22.12.0 (`desktop/.npmrc` enables `engine-strict`)
- Everyday Docker: `docker compose up -d --build --wait`. Compose does **not** bind-mount application source; rebuild after code changes. Container verification: `npm run verify:docker` from the repo root
- Official `docker compose up -d --build --wait` maps `127.0.0.1:3013` and `127.0.0.1:5679` by default. That collides with source `npm run dev` and with the same `backend-node/data` directory. If those two ports are already in use, do not start the official Compose mapping. To run both, set `LOCALMINIDRAMA_FRONTEND_HOST_PORT` / `LOCALMINIDRAMA_BACKEND_HOST_PORT` and a separate `LOCALMINIDRAMA_DATA_DIR`; Compose writes `LOCALMINIDRAMA_CORS_ORIGINS` from the frontend host port. Compose writes `LOCALMINIDRAMA_CORS_ORIGINS` from the frontend host port; for remapped E2E also set `FRONTEND_URL` / `BACKEND_URL`. If you customize CORS, keep that variable aligned with the frontend host port. `npm run docker:e2e:up` only isolates `LOCALMINIDRAMA_DATA_DIR` outside the repo; it does **not** change `3013`/`5679`, and it also binds `127.0.0.1:5688`
- In development, loopback Origins are allowed. Production Docker CORS follows the frontend host port
- Production Nginx (`frontweb/nginx.conf`) must include `location = /ready` proxying the backend `/ready`, before the SPA `location /` fallback. Proxying only `/healthz` is not enough: the backup page requests `/ready` and will lock restore if it receives HTML
- Production E2E requires a clean working tree (`working_tree_dirty=false`); do not treat a historical SHA or the current dirty worktree as passing evidence
- The UI starts without external API keys; generate content only after filling **AI Config**. Filling vendor presets is not the same as real image/video/TTS vendor wiring
- User-visible errors in the UI, API, and CLI are Simplified Chinese
- Story-source intake can upload PDF/image/audio-video: text imports directly; PDFs/images need image recognition (local Tesseract or an AI Config OCR service); audio/video need a speech-transcription config. This is a source-extraction extension, not a completed film-ready capability
- OCR/transcription is a source-extraction extension, not a film-ready gate. Production still requires text, asset image, storyboard image, video, and TTS. Real cloud OCR/Whisper accounts, real image/video/TTS vendor wiring, and mobile are **not** in the current completed scope

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><img src="../项目截图/武侠.png" alt="Project list" width="480"/><br/><sub>Project list · Export/Import projects</sub></td>
    <td align="center"><img src="../项目截图/武侠分镜.png" alt="Storyboard editor" width="480"/><br/><sub>Storyboard editor · One-click image + video generation</sub></td>
  </tr>
</table>

---

## ✨ Features

### 🔄 Full Creation Workflow

| Step | Feature | Description |
|:----:|---------|-------------|
| 1 | **Story Generation** | Enter a synopsis + style; AI generates a full multi-episode script |
| 2 | **Script Editing** | Manage episodes and freely edit script text |
| 3 | **Character Generation** | AI extracts characters; generate a portrait image for each |
| 4 | **Scene Generation** | Auto-extract scenes from script; generate scene background images |
| 5 | **Prop Generation** | Extract / manually add props; generate prop images |
| 6 | **Storyboard Generation** | Auto-generate storyboard per episode (shot type, camera, dialogue…) |
| 7 | **Image / Video Generation** | Generate still image and video clip for each shot |
| 8 | **Video Synthesis** | Automatically merge all shot videos into a complete episode |

### ⚡ One-Click Pipeline

- **Generate All**: Characters → Scenes → Storyboard → Images → Videos → Synthesis — fully automated
- **Fill & Generate**: Intelligently skips already-generated content; only fills what's missing
- **Auto Retry**: Up to 3 retries per step (handles 429 rate limits etc.); errors are logged and the pipeline continues
- **Live Progress**: Shows the current step and full error log in real time

### 🗂 Project & Asset Management

- **Project Export / Import**: Pack the full project as a ZIP (images, videos, text, configs); share or migrate with one file
- **Material Library**: Global character / scene / prop library reusable across projects; per-project and global libraries are strictly isolated
- **Aspect Ratio**: Set the ratio (16:9 / 9:16 / 1:1 …) when creating a project; all generated images and videos adapt automatically
- **Episode Management**: Add / delete episodes; script preview

### ✏️ Storyboard Fine Editing

- **Classic vs Universal mode**: Toggle per storyboard. **Classic** shows the main reference image in the center (video is blocked with a prompt if no reference image); **Universal mode** uses a **segment prompt** field (`universal_segment_text`) for omni video APIs — pair with **`volcengine_omni`** (Volcengine Ark Seedance 2.0 multi-image) or **`kling_omni`** (Kling Omni), with a pre-submit config check. Classic fields remain; switch back anytime
- **`@Image1` … slot references**: In the segment prompt, use **`@图片1` / `@图片2` …** to align with the reference order (scene → characters → props; excludes the classic center panel image); “Generate from storyboard” can fill camera/movement hints. If the segment prompt is non-empty, **only that text** is sent for video (structured video fields are not concatenated)
- **Tail-frame link** (v1.2.7): Extract the last frame from the current shot’s completed video and set it as the next shot’s first frame
- **Export storyboard sheet** (v1.2.7): Export the current episode to an HTML table for review and collaboration
- **Image Prompt**: View and edit the image-generation prompt for each shot; regenerate after changes
- **Video Prompt**: Edit the full prompt text, or expand the composition panel to edit individual fields (scene / duration / action / mood / camera / shot type) — auto-reassembled on save
- **Image Management**: AI generation, manual upload, drag-and-drop; replace at any time

### Dual-mode Canvas Workbench

- The existing `/film/:id/canvas` route now switches between **Production** and **Free** modes. Production nodes and workflow gates remain intact; Free mode adds `text`, `image`, `video`, `config`, and `reference` nodes stored under `metadata.free_canvas`.
- Free mode supports single/multi/marquee selection, connections, copy/paste, delete, undo/redo, asset search and type filters, collapsible groups, uploads, and drag-in placement.
- Save failures keep a sanitized reason and retry only unsaved changes. Eligible local media can be saved as an asset, while conversion to a production reference always requires an explicit target and keeps the free node.
- Project ZIP export/import preserves the free canvas while validating archive, media, project, and reference boundaries. Existing production graph data and unknown metadata remain preserved.
- Scope is desktop keyboard/mouse only. Mobile/touch, real image/video/TTS vendor wiring, collaboration, and the complete Agent/MCP surface are deferred. Story-source OCR/transcription is wired as a source-extraction extension, not a film-ready gate; real cloud OCR/Whisper accounts remain deferred. Automated tests use a local protocol-compatible test service and never call an external real Provider.

Historical product acceptance, ZIP security, and E2E code/contract reviews only cover their original scope. Do not treat a historical SHA or the current worktree as Docker/browser evidence. Re-run `npm run verify:docker` and, on a clean tree, `npm run docker:e2e:up` followed by `npm run verify:e2e`. Local report path: `http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`.

### 🤖 AI Configuration

- Coverage summary for five core services: **text**, **asset image**, **storyboard image**, **video**, and **TTS**. OCR and transcription, if configured, are a source-extraction extension and do not replace these film-ready services
- Each service has independent providers, models, defaults, and connection-test status
- The configuration form groups basic details, provider authentication, collapsed advanced API settings, models, and invocation policy
- Compatible with **Alibaba DashScope**, **Volcengine (Doubao)**, **locally-deployed models** and any OpenAI-compatible API
- Visual config panel; changes take effect immediately; **connection test** supported
- Built-in quick-setup wizards for DashScope, Volcengine, and Agnes AI, with step-by-step API key instructions
- Connection tests probe the configured endpoint. OpenAI-compatible vendors can optionally read `/v1/models` and merge names without overwriting existing entries. Filling vendor presets is not the same as real image/video/TTS vendor wiring

### 🌓 UI / Theme

- **Dark mode** (default) and **Light mode** toggle, preference persisted
- Theme toggle available on every page

---

## 🚀 Quick Start

### Option A — Source

> The root workspace, backend, frontend, Docker, and common PR/branch gates are fixed to Node.js 20. Desktop installation, native rebuilds, packaging, and Windows artifact security scans are fixed to Node.js 22.12.0 with `engine-strict`; Electron 43.1.1 embeds Node.js 24 at application runtime.

```bash
# 1. Clone
git clone https://github.com/Shunlly/LocalMiniDrama.git
cd LocalMiniDrama

# 2. Backend (port 5679)
cd backend-node
npm install
# configs/config.yaml is already included; startup applies migrations automatically
npm run dev

# 3. Frontend (from the repository root in a new terminal, port 3013)
cd frontweb
npm install
npm run dev
```

Open `http://127.0.0.1:3013`. Development uses Vite, which proxies `/api`, `/static`, `/ready`, and `/health` to `http://127.0.0.1:5679`. In development, loopback Origins are allowed; `config.yaml` still defaults to `http://localhost:3013` and `http://127.0.0.1:3013`. Production Docker CORS follows the frontend host port (`LOCALMINIDRAMA_CORS_ORIGINS`) and does not allow arbitrary loopback ports. To let the backend host the production frontend, run `npm run build` in `frontweb`, start the backend, and open `http://127.0.0.1:5679`. Add provider URLs, models, and API keys on the **AI Config** page. Credentials are stored in the local SQLite database, not in `config.yaml`.

Backend readiness:

```bash
curl.exe --fail http://127.0.0.1:5679/ready
```

HTTP 200 with `status` `ready` means the backend can accept traffic. When not ready, `checks.database.error`, `checks.storage.error`, and `checks.maintenance.error` are Simplified Chinese (for example `数据库不可用`). `/health` is liveness only and does not mean the service can accept traffic. Compose `--wait` does not wait on `/health`.

You can also double-click `run_dev.bat` or run `run_dev.ps1` at the project root to **start both servers at once**. The launcher opens `http://127.0.0.1:3013` only after the backend `/ready` probe reports `status: ready` and the frontend page is up. It reuses verified LocalMiniDrama processes on 5679/3013 and refuses to kill unrelated listeners.

### Option B — Docker

Compose does **not** bind-mount application source. Backend `backend-node/Dockerfile` and frontend `frontweb/Dockerfile.prod` are both Node.js 20. After changing JS/Vue, rebuild the images.

Official `docker compose up -d --build --wait` maps host `127.0.0.1:3013` and `127.0.0.1:5679`. That collides with source `npm run dev` and with the same `backend-node/data/` directory (the later process often fails on the maintenance lock). If those two ports are already in use, do not start the official Compose mapping. To coexist, pick free host ports and a separate data directory:

```powershell
$env:LOCALMINIDRAMA_FRONTEND_HOST_PORT = '13013'
$env:LOCALMINIDRAMA_BACKEND_HOST_PORT = '15679'
$env:LOCALMINIDRAMA_DATA_DIR = 'D:\tmp\localminidrama-docker-data'
New-Item -ItemType Directory -Force -Path $env:LOCALMINIDRAMA_DATA_DIR | Out-Null
# Compose writes LOCALMINIDRAMA_CORS_ORIGINS for that frontend host port
docker compose up -d --build --wait
```

Compose already writes `LOCALMINIDRAMA_CORS_ORIGINS` from the frontend host port. For E2E against remapped ports, set `FRONTEND_URL` / `BACKEND_URL`. If you customize CORS, keep `LOCALMINIDRAMA_CORS_ORIGINS` aligned with that frontend host port. Unchanged ports still use:

```bash
docker compose up -d --build --wait
docker compose ps
```

Open `http://127.0.0.1:3013` (or the remapped frontend host port). Host ports bind to `127.0.0.1` only; data defaults to `backend-node/data/`. Production Nginx must keep `location = /ready` before the SPA fallback; a custom reverse proxy needs the same exact location, or backup restore will lock on HTML.

| Probe | URL | Compose use |
|------|------|------|
| Frontend page | `http://127.0.0.1:3013` | Page entry |
| Frontend `/healthz` | `http://127.0.0.1:3013/healthz` | Healthcheck; Nginx proxies backend `/ready` |
| Frontend `/ready` | `http://127.0.0.1:3013/ready` | Production Nginx must proxy `location = /ready` to the backend; do not let the SPA `index.html` handle it |
| Backend `/ready` | `http://127.0.0.1:5679/ready` | Healthcheck; HTTP 200 only when business-ready; error payloads are Simplified Chinese; `docker compose --wait` waits on this |
| Backend `/health` | `http://127.0.0.1:5679/health` | Not a healthcheck; process liveness only |

Stop with `docker compose down`. Full backup/restore requires Docker to be stopped first. `backup:data` / `restore:data` / `maintenance:recover` help and failure output are Simplified Chinese. For commands and custom `LOCALMINIDRAMA_DATA_DIR` `--data-root`, see the [backup FAQ](quickstart.md#q-如何备份迁移项目数据).

`npm run docker:up` requires a clean worktree and writes the current Git SHA into image revisions. Dirty local source should use `docker compose up -d --build --wait`; those images cannot create official rollback checkpoints. `npm run verify:docker` checks image boundaries and runs in-container tests; it does not replace a running Compose acceptance. Production Docker CORS follows the frontend host port via `LOCALMINIDRAMA_CORS_ORIGINS`; development mode is the only case where arbitrary loopback Origins pass.

### Tests

Use Node.js 20.x for the commands below (do not run the gate on host Node 24). Desktop install/packaging still uses Node.js 22.12.0.

```bash
npm --prefix backend-node test
npm --prefix frontweb test
npm --prefix backend-node run verify
npm --prefix frontweb run verify
npm run verify
```

`npm run verify:docker` checks image boundaries and runs in-container tests; it does not replace a running Compose service. Production E2E requires a clean working tree, an empty data directory outside the repo, then `npm run docker:e2e:up` followed by `npm run verify:e2e`; evidence must record `working_tree_dirty=false`. `docker:e2e:up` only isolates `LOCALMINIDRAMA_DATA_DIR`; it does not remap `3013`/`5679`, and it also binds `127.0.0.1:5688`. Do not run it while source `npm run dev` still holds those ports. If host ports were remapped, set `FRONTEND_URL` / `BACKEND_URL` before `verify:e2e`. Repository tests use a local protocol-compatible provider and must not use real credentials. User-visible errors in the UI, API, and CLI are Simplified Chinese.

There is no official `v1.3.3` GitHub Release. Local Windows Setup/Portable builds are not a published download. Unsigned-binary verification (`Unknown Publisher` / SmartScreen, `SHA256SUMS`, `release-manifest.json`, `gh attestation verify`) is documented in the root README and `desktop/README.md`.

📖 Full developer guide, packaging, and FAQ → **[Quickstart Guide](quickstart.md)**

---

## 🤖 AI Provider Support

| Provider | Text | Image | Video |
|----------|:----:|:-----:|:-----:|
| Alibaba DashScope (Qwen) | ✅ | ✅ | ✅ |
| Volcengine / Doubao (Seedance 2.0) | ✅ | ✅ | ✅ |
| Kling AI (including Omni) | — | ✅ | ✅ |
| Agnes AI | ✅ | ✅ | ✅ |
| Google Gemini (text / native image / Veo) | ✅ | ✅ | ✅ |
| Vidu | — | — | ✅ |
| NanoBanana (including proxy) | — | ✅ | — |
| Local Ollama / OpenAI-compatible text | ✅ | — | — |
| Other OpenAI-compatible APIs | ✅ | ✅ | ✅ |

📖 API key registration and configuration → **[Configuration Guide](configuration.md)**

The adapters and routing above are configuration presets. Filling those presets is not the same as real vendor wiring. Novel2Anime production routing can call enabled, ready-checked text, asset-image, storyboard-image, video, and TTS configs, then compose with local FFmpeg/FFprobe. Real image/video/TTS vendor wiring, plus each third-party account, model, quota, and billing combination, still requires a local connection test and non-sensitive sample acceptance; it is **not** complete. Repository production E2E uses a local protocol-compatible provider and requires a clean working tree. Current models come from built-in presets, manual entry, or an optional `/v1/models` read that merges names without overwriting existing entries. Wikimedia Commons and Openverse stock media are implemented (Openverse is images only; video still uses Commons); more platforms, automatic per-use license checks, and mobile Web reflow/touch/canvas fallback remain deferred. Story-source OCR/transcription is wired as a source-extraction extension: text imports directly; PDFs/images need image recognition (local Tesseract or an AI Config OCR service); audio/video need a speech-transcription config. It is not a substitute for the five production services, and real cloud OCR/Whisper accounts are not jointly tested.

---

## 🏗 Architecture

```
LocalMiniDrama/
├── backend-node/          # Node.js backend (Express + SQLite)
│   ├── src/
│   │   ├── config/        # YAML config loader
│   │   ├── db/            # SQLite connection & migrations
│   │   ├── services/      # Business logic (generation, export/import…)
│   │   └── routes/        # REST API routes
│   └── configs/           # config.yaml lives here
├── frontweb/              # Vue 3 frontend (Vite + Element Plus)
│   └── src/
│       ├── views/
│       │   ├── FilmList.vue      # Home: project list
│       │   ├── DramaDetail.vue   # Drama: info / episodes / resource library
│       │   ├── FilmCreate.vue    # Studio: script / characters / storyboard
│       │   ├── DramaCanvas.vue   # Dual-mode canvas workbench
│       │   ├── AiConfig.vue      # AI provider configuration
│       │   ├── FreeCreate.vue    # Standalone free create
│       │   └── MediaLibrary.vue  # Media library
│       ├── api/                  # Backend API wrappers
│       ├── stores/               # Pinia state management
│       └── styles/               # Global styles & theme variables
├── desktop/               # Electron shell (builds the exe)
├── docs/                  # Documentation
└── README.md
```

**Tech Stack:**

| Layer | Technology |
|-------|-----------|
| Language | Plain JavaScript (no TypeScript) |
| Frontend | Vue 3 · Vite · Element Plus · Pinia · @vue-flow/core · dev port 3013; production can be hosted by the backend from `frontweb/dist`, or by Docker Nginx |
| Backend | Node.js 20 · Express · SQLite (better-sqlite3) · port 5679 · startup `runMigrationsAndEnsure` |
| Desktop | Electron 43.1.1 · electron-builder 26 · install/packaging uses Node.js 22.12.0 |

---

## 🗺 Roadmap

| Status | Item | Notes |
|:----:|------|------|
| ✅ | Seedance 2.0 + Universal mode | Multi-ref `@图片N` · `universal_segment_text` |
| ✅ | Canvas workflow | List/canvas dual view · group rerun · node panel |
| ✅ | Scene image → panorama | 2:1 panorama from the scene main image, included in project import/export |
| ✅ | List-side storyboard refs / first-last frames | Studio list mode can upload and bind them |
| ✅ | Canvas-side reference media | Canvas generation can manage and pick storyboard reference media |
| ✅ | Free reference selection | Image generation can manually pick character, scene, and other reference media |
| ✅ | Grid-to-video | Grid references can be sent to video models that declare compatible capability |
| ✅ | Wikimedia Commons stock media | Public image/video search, author/license display, preview, safe download, and project/global library ingest |
| ✅ | Openverse images | Public image search, author/license display, same-origin thumbnail proxy, preview, and safe ingest; video still uses Commons |
| 📋 | More stock-media platforms and license compatibility | Other third-party platforms and automatic per-use license checks are deferred |
| ✅ | Optional model catalog read | OpenAI-compatible vendors can read `/v1/models` and merge into the list without overwriting existing names |
| 📋 | Real image/video/TTS and third-party Provider deep integration | Not complete; each deployment still needs a local connection test and non-sensitive sample acceptance. Filling presets is not real vendor wiring |
| ✅ | PDF/image OCR and A/V transcription entry | Story sources can upload PDF/image/audio-video; unconfigured paths get Simplified Chinese guidance. This is a source-extraction extension. Real cloud OCR/Whisper accounts remain deferred |
| 📋 | Mobile Web | Reflow, touch, and mobile canvas/list fallback are deferred; current acceptance is desktop-only |

---

## 📋 Changelog

Full version history → **[CHANGELOG](changelog.md)**

**Package 1.3.3 highlights (not a GitHub Release / main merge):**

- The release gate runs Trivy 0.64.1 from an official digest-pinned OCI image on Ubuntu, rejects unlisted ZIP attachments, binds Windows scan evidence to the final Setup, Portable, and Unpacked bytes with SHA-256, and proves Fuse coverage for each package separately.
- Media search now cancels stale requests, guarantees latest-request-wins behavior, shows a safe localized retry state, and exposes full truncated names on hover; project import failures remain visible with a safe filename, reason, retry action, and dismiss action.
- Release metadata now loads without Electron packaging dependencies while preserving exact Setup/Portable/Unpacked path and Fuse evidence checks. Static media uses an explicit safe-media MIME allowlist; active or unknown formats download with `nosniff`, while Unicode MP4 paths retain Range playback.
- `npm run docker:up` requires a clean tree and embeds the full Git SHA in both OCI image revisions. Production E2E requires a clean working tree (`working_tree_dirty=false`), then `npm run docker:e2e:up` before `npm run verify:e2e`; the latter does not start its protocol-compatible Provider automatically. The current dirty worktree is not passing evidence.
- `npm run verify:rollback` runs the focused backup/restore suite and a clean-commit drill against current local data in an isolated restore target; PR, main, and tag workflows also run a Node 20 isolated drill. `checkpoint:rollback` captures the actual bind-mounted runtime config and running image IDs before shutdown, tags and saves both images to a SHA-256-verified `images.tar`, and archives Compose, config, hashes, and same-SHA evidence. `restore:rollback` can capture immutable compensation evidence from existing unhealthy or stopped containers, verifies and loads the archived images before data changes, retains a forward-data compensation backup, and attempts to restore the forward deployment if rollback startup fails.
- 🆕 **Closed-loop desktop workflow** — project readiness exposes one next action, while source intake, processing, QA, repair, episodes, and timeline remain recoverable
- 🆕 **Dual-mode canvas workbench** — keep the production graph and add a persisted free-creation layer with five node types, asset workflows, precise save recovery, explicit production conversion, and secure project transfer. Do not treat a historical SHA as current Docker/browser evidence
- 🆕 **Multi-provider AI configuration** — presets and connection tests for text, asset image, storyboard image, video, and TTS; real vendor wiring is still deferred
- 🆕 **Novel2Anime production path** — text import, configured text/image/video/TTS routing, and local FFmpeg composition are on the auditable path. Story-source OCR/transcription is wired as an extraction extension, not a film-ready gate. Real vendor wiring, account/model/quota/billing combinations, and real cloud OCR/Whisper accounts remain deferred
- 🔧 **Film and canvas ergonomics** — consistent action gates, failure feedback, draft protection, panorama/reference media, timeline composition, and batch workflows
- 🔒 **Release and operations hardening** — localhost-only defaults, SSRF/import/export boundaries, secret-safe exports and backups, trusted media tools, production Docker, and restore drills

**v1.2.7 highlights:**
- 🆕 **Tail-frame link** — one-click extract the last frame of the current shot’s video (server-side ffmpeg) and set it as the **next shot’s first frame**
- 🆕 **Export storyboard sheet** — export the current episode’s shots to an **HTML table** (dialogue, narration, universal segment, prompts, etc.)
- 🆕 **Unified generation task progress** — shared Pinia store for character/scene/prop/storyboard image & video async jobs, with recovery after page refresh
- 🔧 **Video mode guards** — Universal mode checks **`kling_omni`** or **`volcengine_omni` + Seedance 2.x** before Omni multi-ref submit; Classic mode blocks video when no storyboard reference image
- 🔧 **Separate first/last frame binding** — last frame no longer overwrites the main panel; Seedance 2.0 certified assets marked stale when the character main image changes

**v1.2.6 / v1.2.5 highlights:**
- 🆕 **Seedance 2.0 + Universal storyboard mode** — `volcengine_omni` / `kling_omni`, multi-ref **`@图片N`**, `universal_segment_text` (see [CHANGELOG](../CHANGELOG.md))

**v1.2.3 highlights:**
- 🆕 **Storyboard narrator (narration)** — optional per-shot voice-over text separate from character `dialogue`, for TTS and editing
- 🆕 **Export narration SRT** — build subtitle cues from shot order and durations
- 🔧 **First-shot empty narration fix** — incrementally saved rows are merged from the final parsed JSON so stream-early inserts are not stuck without `narration`
- 🔧 **Stricter narration prompts** — system/user instructions require opening VO and non-empty lines when the mode is enabled
- 🎨 **Narration UI** — textarea/button contrast in light & dark themes; high-contrast “Export SRT” button

**Earlier releases:** see **[CHANGELOG.md](../CHANGELOG.md)** for v1.2.2 (coherent frames, novel import, ffmpeg) and full history.

---

## 🎯 Who Is This For

| User | Scenario |
|------|----------|
| 📹 Content creators | Batch-produce AI short dramas / comics |
| 🔒 Privacy-conscious users | Keep project data local while explicitly controlling provider and proxy endpoints |
| 🛠 Developers | Extend AI providers or customise the pipeline |
| 🌱 Beginners | Explore the AI video space at zero cost |

---

## 🔗 Similar Tools

| Tool | Notes |
|------|-------|
| **Kino 视界** | Active Chinese AI short-drama platform; cloud-based, closed source |
| **Filmaction AI** | AI-driven plot / storyboard / voice; SaaS / web, partly paid |
| **oiioii** | Open source, lightweight AI visual creation, flexible deployment |
| **ChatFire** | AI dialogue-based short drama; inspired this project's backend design |

This project focuses on **local-first project storage, a friendly UI, and easy customisation**. Feel free to open an [Issue](https://github.com/Shunlly/LocalMiniDrama/issues) to recommend other tools.

---

## 🤝 Contributing

All contributions are welcome!

- 🐛 **Report a bug** → [GitHub Issues](https://github.com/Shunlly/LocalMiniDrama/issues)
- 💡 **Suggest a feature** → [GitHub Issues](https://github.com/Shunlly/LocalMiniDrama/issues)
- 🔧 **Submit code** → Fork → Edit → Pull Request
- ⭐ **Star the project** → Help others discover it

---

## ☕ Buy the Author a Coffee

LocalMiniDrama is **free, open source, and runs locally** — maintained in spare time. If it saved you hours or helped ship a short drama, optional tips are warmly appreciated (any amount; totally voluntary).

> Tips do **not** affect features, issues, or PRs. A ⭐ Star or sharing the repo helps just as much.

<table>
  <tr>
    <td align="center">
      <img src="../项目截图/weixinpay.jpg" alt="WeChat Pay tip QR" width="200"/><br/>
      <sub><b>WeChat Pay</b></sub>
    </td>
    <td align="center">
      <img src="../项目截图/ali.jpg" alt="Alipay tip QR" width="200"/><br/>
      <sub><b>Alipay</b></sub>
    </td>
  </tr>
</table>

---

## 💬 About the Author

Just an ordinary game developer who got excited about the AI short-drama trend and built this open-source tool in JavaScript. Ship first, figure out the rest later.

Full story, inspirations, and acknowledgements → [Author's Story](story.md)

---

## 📄 License

[MIT](../LICENSE)

---

<div align="center">

**If this project helps you, a ⭐ Star is the best encouragement for the author!**

</div>
