<div align="center">

# 🎬 本地短剧助手

**本地优先的 AI 短剧 & 漫剧生成工具 —— 可从源码或 Docker 运行，完全开源，数据默认保存在本机**

*LocalMiniDrama · AI-powered short drama creator*

[![version](https://img.shields.io/badge/version-1.3.3-blue?style=flat-square)](#-快速开始)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](#-快速开始)
[![stack](https://img.shields.io/badge/Vue3%20%2B%20Node.js%20%2B%20Electron-informational?style=flat-square)](#-项目架构)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/Shunlly/LocalMiniDrama/pulls)

**[English](docs/en.md) · 简体中文 · [作者故事](docs/story.md)**

[![GitHub](https://img.shields.io/badge/GitHub-Shunlly%2FLocalMiniDrama-181717?logo=github&style=flat-square)](https://github.com/Shunlly/LocalMiniDrama)
[![Gitee](https://img.shields.io/badge/Gitee-bi__shang__a%2Flocalminidrama-C71D23?logo=gitee&style=flat-square)](https://gitee.com/bi_shang_a/localminidrama)

[**🚀 源码 / Docker 运行**](#-快速开始) · [**📖 配置 AI**](docs/configuration.md) · [**🗺 画布文档**](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

</div>

---

<table>
<tr>
<td width="25%" align="center"><b>🔒 本地优先</b><br/>SQLite + 本地文件，外部 AI 按配置调用</td>
<td width="25%" align="center"><b>🎬 全流程</b><br/>剧本 → 角色/场景 → 分镜 → 视频合成</td>
<td width="25%" align="center"><b>🤖 多模型</b><br/>通义 / 火山 / 可灵 / Gemini 等</td>
<td width="25%" align="center"><b>🗺 双视图</b><br/>列表精细编辑 + 画布批量编排</td>
</tr>
</table>

市面上 AI 短剧工具不少，但真正能**本地保存工程数据、开箱即用、灵活接入自有 AI API**的并不多。
本项目用纯 JavaScript 从零搭建；SQLite 数据库和生成文件默认保存在本机，使用外部 AI、图床或中转站时，提示词、参考图或素材会发送到对应服务。

> ✅ 无订阅费 · ✅ 工程数据默认本地存储 · ✅ 支持多家 AI 服务商 · ✅ 完全开源可二次开发

---

## 当前怎么运行

包版本为 `1.3.3`。当前从源码或 Docker 运行即可，不要按发版下载使用。

- 后端 `backend-node`：Express + SQLite（better-sqlite3），端口 **5679**，启动执行 `runMigrationsAndEnsure`
- 前端 `frontweb`：Vite + Vue 3，端口 **3013**，开发时代理 `/api` 与 `/static`
- 语言：纯 JavaScript，无 TypeScript
- 未配置外部 API Key 也可以启动和开发界面；真正生成内容到「AI 配置」页填写
- PDF/图片 OCR、音视频转写、真实厂商账号深度联调、移动端都不在当前完成范围

详细步骤见下方 [快速开始](#-快速开始) 和 [开发指南](docs/quickstart.md)。

---

## 目录

- [当前怎么运行](#当前怎么运行)
- [界面预览](#-界面预览)
- [核心功能](#-核心功能)
- [快速开始](#-快速开始)
- [AI 服务商](#-ai-服务商支持)
- [项目架构](#-项目架构)
- [后续计划](#-后续计划-roadmap)
- [参与贡献](#-参与贡献)
- [联系社区](#-联系--社区)

---

## 📸 界面预览

<div align="center">
  <img src="项目截图/首页截图.png" alt="首页 · 项目列表" width="960"/><br/>
  <sub>首页 · 项目卡片一览，亮色模式</sub>
</div>

<br/>

<div align="center">
  <img src="项目截图/画布模式.png" alt="画布工作流 · 分镜流水线" width="960"/><br/>
  <sub>🆕 画布模式 · 分镜流水线可视化 · 节点内编辑/生成 · 工作流整组重跑</sub>
</div>

<br/>

<table>
  <tr>
    <td align="center"><img src="项目截图/武侠.png" alt="剧集管理页" width="480"/><br/><sub>剧集管理 · 分集 + 资源库</sub></td>
    <td align="center"><img src="项目截图/武侠分镜.png" alt="分镜编辑页" width="480"/><br/><sub>分镜制作 · 图片 + 视频一键生成</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="项目截图/新版本4宫格分镜.png" alt="角色管理页" width="480"/><br/><sub>角色生成 · AI 自动提取并生成角色形象图</sub></td>
    <td align="center"><img src="项目截图/专业分镜.png" alt="专业分镜参数" width="480"/><br/><sub>分镜制作 · 专业视频参数（景别 / 运镜 / 灯光 / 景深）</sub></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><img src="项目截图/本剧场景库.png" alt="本剧场景库" width="720"/><br/><sub>场景库 · 一键「加入本集」，复用已有场景素材</sub></td>
  </tr>
</table>

---

## 🎬 AI 生成实拍效果

> 以下 3 段视频由**本软件自动工作流选择即梦 1.0**生成，展示连续分镜下角色外貌一致性。

<table>
  <tr>
    <td align="center">
      <video src="项目截图/1.mp4" controls width="300"></video><br/>
      <sub>分镜 1 · 即梦 1.0</sub>
    </td>
    <td align="center">
      <video src="项目截图/2.mp4" controls width="300"></video><br/>
      <sub>分镜 2 · 服装一致</sub>
    </td>
    <td align="center">
      <video src="项目截图/3.mp4" controls width="300"></video><br/>
      <sub>分镜 3 · 人物统一</sub>
    </td>
  </tr>
</table>

> 💡 同时支持火山 **Seedance 2.0**、通义万相、Vidu、可灵 Kling（含 Omni）等，模型越新效果通常越好。

---

## ✨ 核心功能

<details open>
<summary><b>🔄 完整创作流程（点击展开/收起）</b></summary>

| 步骤 | 功能 | 说明 |
|:----:|------|------|
| 1 | **故事生成** | 输入梗概 + 风格，AI 自动生成多集剧本 |
| 2 | **剧本编辑** | 分集管理，剧本文本可自由编辑 |
| 3 | **角色生成** | AI 提取角色列表，逐个生成角色形象图 |
| 4 | **场景生成** | 从剧本自动提取场景，生成场景背景图 |
| 5 | **道具生成** | 从剧本提取/手动添加道具，生成道具图 |
| 6 | **分镜生成** | 按集自动生成分镜脚本（含景别/运镜/台词） |
| 7 | **图片/视频生成** | 逐镜生成静帧图与视频片段 |
| 8 | **合成视频** | 所有分镜视频自动合成为完整剧集文件 |

</details>

<details>
<summary><b>⚡ 一键流水线 · 项目管理 · 分镜编辑</b></summary>

- **一键生成 / 补全并生成**：从角色到合成视频全自动；智能跳过已有内容
- **失败自动重试**：每步最多 3 次，应对限流；实时进度与错误日志
- **工程 ZIP 导出/导入** · **全局素材库** · **16:9 / 9:16 / 1:1 画幅**
- **经典 / 全能分镜** · **`@图片N` 多图参考** · **尾帧衔接** · **导出分镜表 HTML**
- **图片/视频提示词**全文编辑 · 手动上传/拖拽替换参考图
- **项目就绪度与唯一下一步** · **素材五步流程** · 生成动作不可用时直接说明原因

</details>

### 🗺 双模式画布工作台

制作页 / 剧集详情 → **画布模式**（`/film/:id/canvas`），在同一路由切换「制作」与「自由」，并与列表模式共享生产数据：

| 能力 | 说明 |
|------|------|
| 制作模式 | 每镜一行的生产流水线；保留剧本节点、镜头检查器、工作流整组重跑和原有动作门禁 |
| 自由节点 | `text` / `image` / `video` / `config` / `reference`，写入 `metadata.free_canvas` |
| 自由编辑 | 单选、多选、框选、连线、复制粘贴、删除、撤销与重做 |
| 素材侧栏 | 搜索、图片/视频筛选、分组折叠、上传入口和拖入画布 |
| 保存恢复 | 显示净化后的失败原因，对未保存变更精确重试；保存不覆盖生产图或未知 metadata |
| 生产衔接 | 符合资格的媒体可保存为素材；通过明确目标选择转换为生产引用，自由节点仍保留 |
| 项目迁移 | 项目 ZIP 导入/导出保留自由画布，并执行项目、媒体与归档安全校验 |
| 剧本节点 | 画布起点直接编辑剧本、AI 生成故事、提取角色/场景/道具 |
| 节点操作面板 | 单击节点下方编辑/生成，无需频繁切列表 |
| 镜头检查器 | 右侧停靠编辑、前后镜头导航、真实图片/视频/配音摘要与未保存草稿保护 |

当前交付范围为桌面端。素材中心支持本地图片/视频上传，以及从 Wikimedia Commons 搜索公开图片/视频、查看作者和许可来源、预览并安全下载入库；网页 URL 入口用于把故事正文导入项目。使用者仍需自行确认素材许可是否满足具体用途，其他第三方素材平台暂未接入。AI 配置提供多厂商预设、自定义 OpenAI 兼容厂商和手工模型列表，但不包含通用 `/v1/models` 远端模型自动发现。PDF/图片 OCR、音视频转写、移动/触控、自动模型发现、协作与完整 Agent/MCP 后置；真实第三方 Provider 的账号、模型、区域、额度、计费与长耗时行为也属于部署后深度联调范围。自动化测试不调用外部真实 Provider。

📖 [画布工作流完整文档](docs/plans/2026-06-15-drama-canvas-workflow-plan.md) · 验收收尾报告：`http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`

### 🤖 AI 配置 · 🌓 亮/暗主题 · 自定义提示词

AI 配置按文本、素材图片、分镜图片、视频和 TTS 五类核心服务展示覆盖状态、默认配置与连接测试结果；新增配置时按基础信息、厂商认证、高级接口、模型和调用策略逐步填写。支持多厂商预设、自定义 OpenAI 兼容厂商和手工模型列表；Google Gemini 文本使用官方 Gemini OpenAI 兼容端点 `https://generativelanguage.googleapis.com/v1beta/openai`，当前连接测试仍只验证配置端点，不会通过通用 `/v1/models` 自动导入远端模型。支持一键配置通义、火山和 Agnes，9 类提示词可自定义覆盖。

---

## 🚀 快速开始

当前推荐从源码或 Docker 运行。

### 环境要求

| 用途 | Node.js |
|------|---------|
| 根目录、后端、前端、Docker、通用 PR/分支门禁 | 20.x（`.nvmrc` 为 `20`，`engines` 为 `>=20.0.0 <21`） |
| 桌面依赖安装、原生重建、打包、Windows 制品安全扫描 | 22.12.0（`desktop/.npmrc` 启用 `engine-strict`） |
| Electron 运行时 | Electron 43.1.1 自带 Node.js 24 |

### 源码开发

```bash
git clone https://github.com/Shunlly/LocalMiniDrama.git
cd LocalMiniDrama

# 后端开发热重载（端口 5679）；无热重载可用 npm start
cd backend-node && npm install
# configs/config.yaml 已随仓库提供，无需从 example 复制
# AI Key 通过前端「AI 配置」写入数据库；启动时自动 runMigrationsAndEnsure
npm run dev

# 前端（端口 3013，新终端）
cd frontweb && npm install && npm run dev
```

浏览器打开 `http://127.0.0.1:3013`。Vite 把 `/api` 和 `/static` 代理到 `http://127.0.0.1:5679`。后端 CORS 只允许前端 `3013`（`http://localhost:3013` 与 `http://127.0.0.1:3013`）。

也可以双击根目录 **`run_dev.bat`** 或运行 **`run_dev.ps1`** 一键启动（启动器实际打开的也是 `127.0.0.1`）。启动器只会复用已验证的 LocalMiniDrama 前后端；`5679` 或 `3013` 被其他程序占用时会明确退出，不会终止陌生进程。新启动的服务会在通过就绪探针后才打开浏览器，60 秒内未就绪则失败并保留服务窗口供排错。Vite 默认只监听 `127.0.0.1`，确需局域网调试时必须显式设置 `VITE_DEV_SERVER_HOST`。

未配置外部 API Key 也可以启动、浏览界面和跑本地测试；调用外部模型生成时再到「AI 配置」填写。

后端就绪检查：

```bash
curl.exe --fail http://127.0.0.1:5679/ready
```

### Docker

Compose **不挂载应用源码**，只把数据目录和只读配置源挂进容器。改完源码后必须重建镜像，不能指望容器热更新仓库里的 JS/Vue：

```bash
docker compose up -d --build --wait
docker compose ps
```

| 服务 | 地址 |
|------|------|
| 前端 | `http://127.0.0.1:3013` |
| 前端 Docker 健康检查 | `http://127.0.0.1:3013/healthz`（代理后端 `/ready`） |
| 后端健康检查 | `http://127.0.0.1:5679/health` |
| 后端就绪检查 | `http://127.0.0.1:5679/ready` |

默认只绑定宿主机 `127.0.0.1`，并使用只读根文件系统、`no-new-privileges` 与能力裁剪。容器级校验：

```bash
npm run verify:docker
```

`npm run verify:docker` 检查镜像边界，并在临时验证容器内跑前后端测试，不代替正在运行的 Compose 服务。`npm run docker:up` 要求 Git 工作树干净，并把当前 Git SHA 写入镜像 revision；未提交改动请直接用 `docker compose up -d --build --wait`。

生产 E2E 必须在仓库外新建空数据目录后设置 `LOCALMINIDRAMA_DATA_DIR`，再执行 `npm run docker:e2e:up` 和 `npm run verify:e2e`，最后销毁 E2E profile 与临时数据目录；完整 PowerShell 命令见 [开发指南](docs/quickstart.md#运行方式二docker)。仓库测试使用本地协议兼容 Provider，不代表真实厂商账号已深度联调。

异常退出若留下维护租约，必须按 [维护租约恢复步骤](docs/quickstart.md#q-如何备份迁移项目数据) 先检查归属，再用精确作用域和 PID 显式恢复；不要直接删除锁文件。

### 测试

```bash
# 后端（Node.js 内置测试运行器）
npm --prefix backend-node test

# 前端（ESM，Node.js 内置测试运行器）
npm --prefix frontweb test

# 包级校验
npm --prefix backend-node run verify
npm --prefix frontweb run verify

# 仓库源码门禁
npm run verify
```

📖 [详细开发 / Docker / 备份指南](docs/quickstart.md) · [AI 配置指南](docs/configuration.md)

---

## 🤖 AI 服务商支持

| 服务商 | 文本 | 图片 | 视频 |
|--------|:----:|:----:|:----:|
| 阿里云 DashScope（通义） | ✅ | ✅ | ✅ |
| 火山引擎 Volcengine（豆包 / Seedance 2.0） | ✅ | ✅ | ✅ |
| 可灵 Kling AI（含 Omni） | — | ✅ | ✅ |
| Agnes AI | ✅ | ✅ | ✅ |
| Google Gemini（文本 / Gemini 原生图片模型 / Veo） | ✅ | ✅ | ✅ |
| Vidu 生数科技 | — | — | ✅ |
| NanoBanana（含代理） | — | ✅ | — |
| 本地 Ollama 等 OpenAI 兼容 | ✅ | — | — |
| 其他 OpenAI 兼容接口 | ✅ | ✅ | ✅ |

> Novel2Anime 生产工作流会调用已启用并通过就绪检查的文本、素材图、分镜图、视频和 TTS 配置，再由本机 FFmpeg/FFprobe 合成与校验；Google Gemini 文本走官方 Gemini OpenAI 兼容端点，图片走 Gemini `generateContent` 原生图片模型（不是 Imagen API），视频走 Veo。真实 Google 账号、模型、额度和计费行为仍需在「AI 配置」中单独连接测试。Draft 预演仍可使用本地 mock 产物，production QA 会拒绝 mock/占位产物。仓库生产 E2E 使用本地协议兼容 Provider 验证完整非 mock 链路，不代表每个第三方厂商、账号、模型或额度组合都已深度联调。当前模型来自内置预设或手工录入，不会通过通用 `/v1/models` 自动发现；素材中心支持本地素材和 Wikimedia Commons 网络素材，展示远端作者与许可元数据并安全下载入库，但使用者仍需核对具体用途的许可兼容性，更多平台及用途许可判断后置。移动端 Web 重排、触控行为和移动画布/列表降级不在当前桌面范围内。

---

## 🏗 项目架构

```
LocalMiniDrama/
├── backend-node/     # Express + SQLite，生成/合成/导入导出
├── frontweb/         # Vue 3 + Element Plus + @vue-flow/core
│   └── src/views/    # FilmList · DramaDetail · FilmCreate · DramaCanvas · AiConfig · FreeCreate · MediaLibrary
├── desktop/          # Electron 打包 exe
└── docs/             # 文档与计划
```

| 层 | 技术 |
|----|------|
| 语言 | 纯 JavaScript（无 TypeScript） |
| 前端 | Vue 3 · Vite · Element Plus · Pinia · @vue-flow/core · 开发端口 3013 |
| 后端 | Node.js · Express · SQLite（better-sqlite3）· 端口 5679 · 启动时 `runMigrationsAndEnsure` |
| 桌面 | Electron 43.1.1 · electron-builder 26 · 安装/打包用 Node.js 22.12.0 |

---

## 🗺 后续计划 Roadmap

| 状态 | 计划 | 说明 |
|:----:|------|------|
| ✅ | Seedance 2.0 + 全能模式 | 多图 `@图片N` · `universal_segment_text` |
| ✅ | 画布工作流 | 列表/画布双视图 · 整组重跑 · 节点面板 |
| ✅ | 场景图 → 全景图 | 已支持由场景主图生成 2:1 全景图，并随项目导入导出 |
| ✅ | 列表侧分镜参考图/首尾帧上传 | 制作页列表模式已支持上传和绑定 |
| ✅ | 画布侧参考图统一入口 | 画布生成时可管理和选择分镜参考媒体 |
| ✅ | 参考图自由选择 | 生图时可手动指定角色、场景等参考媒体 |
| ✅ | 宫格图生成视频 | 支持将宫格参考交给声明兼容能力的视频模型 |
| ✅ | Wikimedia Commons 网络素材 | 支持公开图片/视频搜索、作者与许可来源展示、预览选择、安全下载和项目/全局素材入库 |
| 📋 | 更多网络素材平台与许可兼容判断 | 其他第三方平台接入及针对具体用途的自动许可兼容判断后置 |
| 📋 | 远端模型自动发现 | 通用 `/v1/models` 模型列表发现与导入后置；当前使用厂商预设、自定义兼容厂商和手工模型 |
| 📋 | 第三方 Provider 深度联调 | 真实厂商、账户、模型版本、额度与计费组合后置；每个部署仍须本地连接测试和非敏感样例验收 |
| 📋 | PDF/图片 OCR 与音视频转写 | 产品能力仍后置，不能当作已完成 |
| 📋 | 移动端 Web | 移动重排、触控行为和移动画布/列表降级后置；当前验收矩阵仅覆盖桌面视口 |

> 认领功能或提建议 → [GitHub Issues](https://github.com/Shunlly/LocalMiniDrama/issues)

<details>
<summary><b>📋 更多历史版本亮点（v1.2.3 及更早）</b></summary>

- **v1.2.3** 分镜解说旁白 · 导出解说 SRT
- **v1.2.2** 连贯帧模式 · 小说/长文导入 · ffmpeg 自动解压
- **v1.2.1** 可灵 Kling · 视频历史版本 · 场景/道具「加入本集」
- **v1.1.x** 多集剧本 · AI 并发 · 四宫格 · 批量生图/视频 …

详见 **[CHANGELOG.md](CHANGELOG.md)**

</details>

---

## 🎯 适合谁

| 用户 | 场景 |
|------|------|
| 📹 内容创作者 | 批量生产 AI 短剧 / 漫剧 |
| 🔒 隐私敏感 | 工程数据默认本地保存；外部 AI 调用按所选服务商传输 |
| 🛠 开发者 | 二次开发、接入新 AI 服务商 |
| 🌱 入门探索 | 低成本体验 AI 视频全流程 |

---

## 🤝 参与贡献

- 🐛 [报告 Bug](https://github.com/Shunlly/LocalMiniDrama/issues)
- 💡 [功能建议](https://github.com/Shunlly/LocalMiniDrama/issues)
- 🔧 Fork → PR
- ⭐ **Star** 帮助更多人发现本项目

**GitHub 仓库建议 Topics**（在仓库 Settings → Topics 添加，便于搜索）：  
`ai-video` `short-drama` `storyboard` `vue3` `electron` `local-first` `seedance` `comic-drama`

---

<details>
<summary><b>☕ 一杯咖啡的鼓励</b></summary>

项目完全开源、无订阅。若对你有帮助，欢迎随缘打赏（自愿，不影响 Issue/PR 处理）：

<table>
  <tr>
    <td align="center"><img src="项目截图/weixinpay.jpg" alt="微信赞赏码" width="200"/><br/><sub>微信支付</sub></td>
    <td align="center"><img src="项目截图/ali.jpg" alt="支付宝收款码" width="200"/><br/><sub>支付宝</sub></td>
  </tr>
</table>

</details>

---

## 💬 联系 & 社区

[作者故事 & 碎碎念](docs/story.md) · 微信交流 / 用户群（二维码见仓库 `项目截图/` 目录）

> 群二维码约 7 天有效，过期请加作者微信拉群。

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**如果这个项目对你有帮助，请点 ⭐ Star —— 这是对作者最大的鼓励！**

[🚀 源码 / Docker 运行](docs/quickstart.md) · [📖 配置 AI](docs/configuration.md) · [🗺 画布文档](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

</div>
