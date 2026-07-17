<div align="center">

# 🎬 本地短剧助手

**本地优先的 AI 短剧 & 漫剧生成工具 —— 下载即用，完全开源，数据默认保存在本机**

*LocalMiniDrama · AI-powered short drama creator*

[![version](https://img.shields.io/badge/version-1.3.1-blue?style=flat-square)](https://github.com/Shunlly/LocalMiniDrama/releases)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](#-快速开始)
[![stack](https://img.shields.io/badge/Vue3%20%2B%20Node.js%20%2B%20Electron-informational?style=flat-square)](#-项目架构)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/Shunlly/LocalMiniDrama/pulls)

**[English](docs/en.md) · 简体中文 · [作者故事](docs/story.md)**

[![GitHub](https://img.shields.io/badge/GitHub-Shunlly%2FLocalMiniDrama-181717?logo=github&style=flat-square)](https://github.com/Shunlly/LocalMiniDrama)
[![Gitee](https://img.shields.io/badge/Gitee-bi__shang__a%2Flocalminidrama-C71D23?logo=gitee&style=flat-square)](https://gitee.com/bi_shang_a/localminidrama)

[**⬇️ 下载 Release**](https://github.com/Shunlly/LocalMiniDrama/releases) · [**🚀 快速开始**](#-快速开始) · [**📖 配置 AI**](docs/configuration.md) · [**🗺 画布文档**](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

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

## 📌 v1.3.1 动态
- 🛠️ **Windows 发布修复**：前后端测试改用 Node.js 原生发现，正式发布不再依赖 shell 通配符展开
- 🆕 **桌面创作流程收口**：项目就绪度给出唯一下一步，素材导入、处理、QA、修复、剧集与时间线形成可恢复的五步流程
- 🆕 **多厂商 AI 配置**：按文本、素材图片、分镜图片、视频和 TTS 管理模型，支持连接测试、默认配置和本地/云端路由
- 🆕 **Novel2Anime 生产链路**：PDF/图片 OCR、音视频转写、图片/视频/TTS 生成与 FFmpeg 合成串成可验收工作流
- 🔧 **制作页与画布体验**：统一动作门禁、失败反馈、自动保存与离开保护，并补齐全景图、参考图、时间线和批量工作流
- 🔒 **发布安全与运维**：本机监听、SSRF/导入导出边界、敏感配置脱敏、可信媒体工具、数据备份恢复与生产 Docker 门禁

完整记录 → **[CHANGELOG.md](CHANGELOG.md)**

---

## 目录

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

### 🗺 画布工作流（LibTV 式）

制作页 / 剧集详情 → **画布模式**（`/film/:id/canvas`），与列表模式**同源数据**：

| 能力 | 说明 |
|------|------|
| 竖排流水线 | 每镜一行：经典「文本→首帧/尾帧→视频」；全能「全能分镜词→视频」 |
| 剧本节点 | 画布起点直接编辑剧本、AI 生成故事、提取角色/场景/道具 |
| 节点操作面板 | 单击节点下方编辑/生成，无需频繁切列表 |
| 右键 / 工具栏 | 新建分镜、集、角色、场景、道具；框选创建工作流 |
| 工作流组 | 框选分镜 → 创建工作流 → **整组重跑**（生图/视频/配音可勾选） |
| 布局持久化 | 拖动保存坐标；曲线连线；左键框选、中键/右键平移 |

界面预览见 [上方截图](#-界面预览) · 📖 [画布工作流完整文档](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

### 🤖 AI 配置 · 🌓 亮/暗主题 · 自定义提示词

AI 配置按文本、素材图片、分镜图片、视频和 TTS 五类核心服务展示覆盖状态、默认配置与连接测试结果；新增配置时按基础信息、厂商认证、高级接口、模型和调用策略逐步填写。支持一键配置通义、火山和 Agnes，9 类提示词可自定义覆盖。

---

## 🚀 快速开始

### 方式一：下载 exe（推荐）

前往 **[Releases 下载页](https://github.com/Shunlly/LocalMiniDrama/releases)**：

| 版本 | 说明 | 适合 |
|------|------|------|
| `LocalMiniDrama-Setup-x.x.x-x64.exe` | Windows x64 安装版，可选择安装目录 | 日常使用 |
| `LocalMiniDrama-Portable-x.x.x-x64.exe` | Windows x64 便携版，无需安装 | 试用与移动使用 |

双击运行 → 「AI 配置」填入 API Key → 开始创作。

> 当前 Windows 包未做 Authenticode 签名，首次运行可能触发 SmartScreen；请从 GitHub Releases 下载并核对 `SHA256SUMS`。首次运行配置位于 `%APPDATA%\localminidrama-desktop\backend\configs\config.yaml`。

### 方式二：源码开发

> 需要 Node.js >= 20，发布与 Docker 验证统一使用 Node.js 20。

```bash
git clone https://github.com/Shunlly/LocalMiniDrama.git
cd LocalMiniDrama

# 后端（端口 5679）
cd backend-node && npm install
# configs/config.yaml 已随仓库提供；AI Key 通过前端「AI 配置」写入数据库
npm start

# 前端（端口 3013，新终端）
cd frontweb && npm install && npm run dev
```

浏览器打开 `http://localhost:3013`，或双击根目录 **`run_dev.bat`** 一键启动。

也可以直接从仓库根目录使用 Docker：

```bash
docker compose up -d --build --wait
docker compose ps
```

前端仍访问 `http://localhost:3013`，后端健康/就绪检查为 `http://localhost:5679/health` 和 `http://localhost:5679/ready`。Compose 默认仅绑定宿主机 `127.0.0.1`，不会把无认证接口直接暴露到局域网。改动前后端源码后需重新执行 `docker compose up -d --build --wait`；完整容器验证可运行 `npm run verify:docker`。桌面产品验收报告可在 `http://localhost:3013/reports/product-acceptance/report.html` 查看。

📖 [详细开发/打包/Docker 指南](docs/quickstart.md) · [AI 配置指南](docs/configuration.md)

---

## 🤖 AI 服务商支持

| 服务商 | 文本 | 图片 | 视频 |
|--------|:----:|:----:|:----:|
| 阿里云 DashScope（通义） | ✅ | ✅ | ✅ |
| 火山引擎 Volcengine（豆包 / Seedance 2.0） | ✅ | ✅ | ✅ |
| 可灵 Kling AI（含 Omni） | — | ✅ | ✅ |
| Agnes AI | ✅ | ✅ | ✅ |
| Google Gemini（Imagen / Veo） | — | ✅ | ✅ |
| Vidu 生数科技 | — | — | ✅ |
| NanoBanana（含代理） | — | ✅ | — |
| 本地 Ollama 等 OpenAI 兼容 | ✅ | — | — |
| 其他 OpenAI 兼容接口 | ✅ | ✅ | ✅ |

> Novel2Anime 生产工作流会调用已启用并通过就绪检查的文本、素材图、分镜图、视频和 TTS 配置，再由本机 FFmpeg 合成。OpenAI 兼容表示公共协议可路由，不代表每个中转站或模型都支持全部媒体端点；真实账号仍需在「AI 配置」执行连接测试。production QA 会拒绝 mock/占位产物。

---

## 🏗 项目架构

```
LocalMiniDrama/
├── backend-node/     # Express + SQLite，生成/合成/导入导出
├── frontweb/         # Vue 3 + Element Plus + @vue-flow/core
│   └── views/        # FilmList · DramaDetail · FilmCreate · DramaCanvas
├── desktop/          # Electron 打包 exe
└── docs/             # 文档与计划
```

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 · Vite · Element Plus · Pinia · @vue-flow/core |
| 后端 | Node.js · Express · SQLite (better-sqlite3) |
| 桌面 | Electron 43.1.1 · electron-builder 26 |

---

## 🗺 后续计划 Roadmap

| 状态 | 计划 | 说明 |
|:----:|------|------|
| ✅ | Seedance 2.0 + 全能模式 | 多图 `@图片N` · `universal_segment_text` |
| ✅ | 画布工作流 | 列表/画布双视图 · 整组重跑 · 节点面板 |
| 📋 | **场景图 → 全景图** | 由场景参考图 AI 扩展超宽/360° 全景，供大景别运镜与场景库 |
| ✅ | 列表侧分镜参考图/首尾帧上传 | 制作页列表模式已支持上传和绑定 |
| 📋 | 画布侧参考图统一入口 | 画布生成时自由选择参考图 |
| 📋 | 参考图自由选择 | 生图时手动指定角色/场景参考 |
| 📋 | 宫格图生成视频 | 多帧合图作为视频输入（部分模型已支持） |

> 认领功能或提建议 → [New Issue](https://github.com/Shunlly/LocalMiniDrama/issues/new)

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

- 🐛 [报告 Bug](https://github.com/Shunlly/LocalMiniDrama/issues/new)
- 💡 [功能建议](https://github.com/Shunlly/LocalMiniDrama/issues/new)
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

[⬇️ 立即下载](https://github.com/Shunlly/LocalMiniDrama/releases) · [📖 快速开始文档](docs/quickstart.md) · [🗺 画布文档](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

</div>
