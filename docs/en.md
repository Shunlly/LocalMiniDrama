<div align="center">

# 🎬 LocalMiniDrama

**A local-first AI short drama & comic generator — bring your own local or hosted providers, fully open source**

[![version](https://img.shields.io/badge/version-1.3.3%20RC-orange?style=flat-square)](#release-candidate-status)
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

## Release Candidate Status

The source and package version is `1.3.3`, currently a release candidate. Git contains only the `v1.3.0`, `v1.3.1`, and `v1.3.2` tags; there is no `v1.3.3` tag or formally published Release. The [Releases page](https://github.com/Shunlly/LocalMiniDrama/releases) is history only. Run the current candidate from source or Docker. Official binaries require every source, Docker, Windows artifact, security, rollback, product-acceptance, and CI gate to pass for the same Git SHA, followed by review and publication of the draft Release. A successful local build or run is not a GitHub release.

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
- Scope is desktop keyboard/mouse only. Mobile/touch, new real Provider routes, collaboration, and the complete Agent/MCP surface are deferred. Automated tests use a local protocol-compatible test service and never call an external real Provider.

Tasks 1-5, all eight product-acceptance findings, ZIP security review, and E2E code/contract review are complete. The real Docker production E2E matrix has **not** run, so the final release gate remains **UNVERIFIED**. Local report: `http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`.

### 🤖 AI Configuration

- Coverage summary for five core services: **text**, **asset image**, **storyboard image**, **video**, and **TTS**
- Each service has independent providers, models, defaults, and connection-test status
- The configuration form groups basic details, provider authentication, collapsed advanced API settings, models, and invocation policy
- Compatible with **Alibaba DashScope**, **Volcengine (Doubao)**, **locally-deployed models** and any OpenAI-compatible API
- Visual config panel; changes take effect immediately; **connection test** supported
- Built-in quick-setup wizards for DashScope, Volcengine, and Agnes AI, with step-by-step API key instructions

### 🌓 UI / Theme

- **Dark mode** (default) and **Light mode** toggle, preference persisted
- Theme toggle available on every page

---

## 🚀 Quick Start

### Option A — Source (recommended for the current candidate)

> Requires Node.js >= 20. Release and Docker verification use Node.js 20.

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

Open `http://localhost:3013`, then add provider URLs, models, and API keys on the **AI Config** page. AI service credentials are stored in the local SQLite database, not in `config.yaml`.

You can also double-click `run_dev.bat` at the project root to **start both servers at once**.

### Option B — Docker (candidate deployment)

From a clean worktree at the repository root:

```bash
npm run docker:up
docker compose ps
```

Open `http://localhost:3013`. Docker is a supported deployment path for the current source candidate and records the Git SHA in clean-tree images. A local image build, successful startup, or local acceptance result is not a formally published GitHub release.

📖 Full developer guide, packaging, and FAQ → **[Quickstart Guide](quickstart.md)**

---

## 🤖 AI Provider Support

| Provider | Text | Image | Video |
|----------|:----:|:-----:|:-----:|
| Alibaba DashScope (Qwen) | ✅ | ✅ | ✅ |
| Volcengine / Doubao | ✅ | ✅ | ✅ |
| Agnes AI | ✅ | ✅ | ✅ |
| Local (Ollama, OpenAI-compat.) | ✅ | — | — |
| Other OpenAI-compatible APIs | ✅ | ✅ | — |

📖 API key registration and configuration → **[Configuration Guide](configuration.md)**

The common adapters and routing are implemented, but deep validation of every real provider, account, model revision, quota, and billing combination is deferred; test each deployment locally with non-sensitive content. Mobile Web reflow, touch behavior, and the mobile Canvas/list fallback are also deferred and are not covered by the current desktop acceptance matrix.

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
│       │   ├── FilmList.vue      # Home: project list & material library
│       │   ├── DramaDetail.vue   # Drama: info / episodes / resource library
│       │   └── FilmCreate.vue    # Studio: script / characters / storyboard
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
| Frontend | Vue 3 + Vite + Element Plus + Pinia + Axios |
| Backend | Node.js + Express + SQLite (better-sqlite3) |
| Desktop | Electron 43.1.1 + electron-builder 26 |
| Language | Plain JavaScript (no TypeScript) |

---

## 📋 Changelog

Full version history → **[CHANGELOG](changelog.md)**

**v1.3.3 release-candidate highlights:**

- The release gate runs Trivy 0.64.1 from an official digest-pinned OCI image on Ubuntu, rejects unlisted ZIP attachments, binds Windows scan evidence to the final Setup, Portable, and Unpacked bytes with SHA-256, and proves Fuse coverage for each package separately.
- Media search now cancels stale requests, guarantees latest-request-wins behavior, shows a safe localized retry state, and exposes full truncated names on hover; project import failures remain visible with a safe filename, reason, retry action, and dismiss action.
- Release metadata now loads without Electron packaging dependencies while preserving exact Setup/Portable/Unpacked path and Fuse evidence checks. Static media uses an explicit safe-media MIME allowlist; active or unknown formats download with `nosniff`, while Unicode MP4 paths retain Range playback.
- `npm run docker:up` requires a clean tree and embeds the full Git SHA in both OCI image revisions. Production E2E requires `npm run docker:e2e:up` before `npm run verify:e2e`; the latter does not start its protocol-compatible Provider automatically.
- `npm run verify:rollback` runs the focused backup/restore suite and a clean-commit drill against current local data in an isolated restore target; PR, main, and tag workflows also run a Node 20 isolated drill. `checkpoint:rollback` captures the actual bind-mounted runtime config and running image IDs before shutdown, tags and saves both images to a SHA-256-verified `images.tar`, and archives Compose, config, hashes, and same-SHA evidence. `restore:rollback` can capture immutable compensation evidence from existing unhealthy or stopped containers, verifies and loads the archived images before data changes, retains a forward-data compensation backup, and attempts to restore the forward deployment if rollback startup fails.
- 🆕 **Closed-loop desktop workflow** — project readiness exposes one next action, while source intake, processing, QA, repair, episodes, and timeline remain recoverable
- 🆕 **Dual-mode canvas workbench** — keep the production graph and add a persisted free-creation layer with five node types, asset workflows, precise save recovery, explicit production conversion, and secure project transfer; final Docker production E2E is still unverified
- 🆕 **Multi-provider AI configuration** — configure and test text, source-image, storyboard-image, video, and TTS models across local and hosted providers
- 🆕 **Novel2Anime production path** — PDF/image OCR, audio/video transcription, image/video/TTS generation, and FFmpeg composition in one auditable workflow
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
