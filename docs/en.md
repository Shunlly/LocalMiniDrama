<div align="center">

# 🎬 LocalMiniDrama

**A local-first AI short drama & comic generator — bring your own local or hosted providers, fully open source**

[![version](https://img.shields.io/badge/version-1.3.0-blue?style=flat-square)](https://github.com/Shunlly/LocalMiniDrama/releases)
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

### Option A — Download exe (recommended)

Go to **[Releases](https://github.com/Shunlly/LocalMiniDrama/releases)** and download the latest:
- `LocalMiniDrama-Setup-x.x.x-x64.exe` — Windows x64 NSIS installer
- `LocalMiniDrama-Portable-x.x.x-x64.exe` — Windows x64 portable build

Double-click → open **AI Config** → enter your API key → start creating.

> On first launch a config file is created at:  
> `%APPDATA%\localminidrama-desktop\backend\configs\config.yaml`

### Option B — Development Mode

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

**Latest v1.3.0 highlights:**
- 🆕 **Closed-loop desktop workflow** — project readiness exposes one next action, while source intake, processing, QA, repair, episodes, and timeline remain recoverable
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

- 🐛 **Report a bug** → [New Issue](https://github.com/Shunlly/LocalMiniDrama/issues/new)
- 💡 **Suggest a feature** → [New Issue](https://github.com/Shunlly/LocalMiniDrama/issues/new)
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
