<div align="center">

# 🎬 本地短剧助手

**本地优先的 AI 短剧 & 漫剧生成工具 —— 可从源码或 Docker 运行，完全开源，数据默认保存在本机**

*LocalMiniDrama · AI-powered short drama creator*

[![version](https://img.shields.io/badge/version-1.3.3%20RC-orange?style=flat-square)](#-v133-候选动态)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](#-快速开始)
[![stack](https://img.shields.io/badge/Vue3%20%2B%20Node.js%20%2B%20Electron-informational?style=flat-square)](#-项目架构)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/Shunlly/LocalMiniDrama/pulls)

**[English](docs/en.md) · 简体中文 · [作者故事](docs/story.md)**

[![GitHub](https://img.shields.io/badge/GitHub-Shunlly%2FLocalMiniDrama-181717?logo=github&style=flat-square)](https://github.com/Shunlly/LocalMiniDrama)
[![Gitee](https://img.shields.io/badge/Gitee-bi__shang__a%2Flocalminidrama-C71D23?logo=gitee&style=flat-square)](https://gitee.com/bi_shang_a/localminidrama)

[**🚀 源码 / Docker 运行**](#-快速开始) · [**🗃 Releases 历史**](https://github.com/Shunlly/LocalMiniDrama/releases) · [**📖 配置 AI**](docs/configuration.md) · [**🗺 画布文档**](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

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

## 📌 v1.3.3 候选动态

> 当前源码与包版本为 `1.3.3` 发布候选。Git 目前只有 `v1.3.0`、`v1.3.1`、`v1.3.2` 标签，没有 `v1.3.3` 标签或正式 Release；[Releases](https://github.com/Shunlly/LocalMiniDrama/releases) 仅作为历史页。当前建议从源码或 Docker 运行。正式二进制必须在同一 Git SHA 的源码、Docker、Windows 制品、安全、回滚、产品验收与 CI 全绿，并且 draft Release 经人工复核后正式发布，届时才可作为下载版本。

- 🛠️ **发布扫描修复**：PR/分支 CI 使用固定 digest 的 Trivy 0.64.1 扫描完整源码依赖与配置，并与 Tag Release 共用 Windows Gitleaks、Defender、SBOM/配置 Trivy、制品清单和离线复核工作流
- 🔧 **失败恢复与并发状态**：素材选择器保证最新请求生效、显示安全中文错误与长名称提示，项目包导入失败保留可重试的页内告警
- 🆕 **桌面创作流程收口**：项目就绪度给出唯一下一步，素材导入、处理、QA、修复、剧集与时间线形成可恢复的五步流程
- 🆕 **多厂商 AI 配置**：按文本、素材图片、分镜图片、视频和 TTS 管理模型，支持连接测试、默认配置和本地/云端路由
- 🔧 **AI 就绪度与桌面流程**：连接状态按运行实例隔离并随配置变更失效；缺凭据/模型/工作流时直达具体字段，已有项目可从素材中心直接进入网页 URL 导入
- 🆕 **Novel2Anime 生产链路**：PDF/图片 OCR、音视频转写、图片/视频/TTS 生成与 FFmpeg 合成串成可验收工作流
- 🔧 **制作页与画布体验**：项目列表支持服务端搜索/分页和项目级素材入口；画布检查器支持前后镜头与真实媒体摘要；制作台统一成片、字幕和项目包交付
- 🆕 **制作 + 自由双模式画布**：同一路由保留生产流水线，并加入五类自由节点、素材拖入、自由连线、历史操作、精确保存重试和显式生产引用转换
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

当前交付范围为桌面端。现有素材能力是本地图片/视频上传、搜索与类型筛选，以及把公开网页 URL 的正文导入项目；不包含第三方图片/视频搜索、版权来源核验或下载入库。AI 配置提供多厂商预设、自定义 OpenAI 兼容厂商和手工模型列表，但不包含通用 `/v1/models` 远端模型自动发现。移动/触控、真实 Provider 深度联调、上述网络素材能力、自动模型发现、协作与完整 Agent/MCP 后置。任务 1-5、8 项产品验收、ZIP 安全复审及 E2E 代码/契约复审已经完成，但真实 Docker 生产 E2E 尚未执行，最终发布门禁仍为 **待验证**。自动化测试不调用外部真实 Provider。

📖 [画布工作流完整文档](docs/plans/2026-06-15-drama-canvas-workflow-plan.md) · 验收收尾报告：`http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`

### 🤖 AI 配置 · 🌓 亮/暗主题 · 自定义提示词

AI 配置按文本、素材图片、分镜图片、视频和 TTS 五类核心服务展示覆盖状态、默认配置与连接测试结果；新增配置时按基础信息、厂商认证、高级接口、模型和调用策略逐步填写。支持多厂商预设、自定义 OpenAI 兼容厂商和手工模型列表；当前连接测试只验证配置端点，不会通过通用 `/v1/models` 自动导入远端模型。支持一键配置通义、火山和 Agnes，9 类提示词可自定义覆盖。

---

## 🚀 快速开始

### 当前候选：源码或 Docker（推荐）

`1.3.3` 当前没有正式可下载的 Setup 或 Portable。请按下方步骤从源码运行，或使用本节后面的 Docker 方式部署候选源码。本地自行生成的 Setup、Portable 或镜像都是未发布候选，不能称为 GitHub 正式发布。

#### Windows 未签名制品安全提示

Setup 与 Portable **未做 Authenticode 签名**，Windows 可能显示 `Unknown Publisher` 或 SmartScreen 警告。只能从 [Shunlly/LocalMiniDrama 官方 GitHub Release](https://github.com/Shunlly/LocalMiniDrama/releases) 下载；来源不明、SHA-256 不符、manifest 不符或 GitHub artifact attestation 不匹配时，均不得运行。正式 Release 正文会给出 `$tag` 和完整 `$expectedGitSha`；以下 Windows PowerShell 命令要求 Release tag、预期 Git SHA、`release-manifest.json.git_commit` 与下载的官方标签源码完全一致：

```powershell
$repo = 'Shunlly/LocalMiniDrama'
$tag = '<official release tag>'
$expectedGitSha = '<full Git SHA shown in the official Release>'
$downloadDir = Join-Path $PWD "LocalMiniDrama-$tag"
if (Test-Path -LiteralPath $downloadDir) { throw "Refusing to reuse existing directory: $downloadDir" }
New-Item -ItemType Directory -Path $downloadDir | Out-Null
gh release download $tag --repo $repo --dir $downloadDir
if ($LASTEXITCODE -ne 0) { throw 'Official GitHub Release download failed' }
$attestationArgs = @(
  '--repo', $repo,
  '--signer-workflow', "$repo/.github/workflows/release.yml",
  '--source-ref', "refs/tags/$tag",
  '--source-digest', $expectedGitSha,
  '--deny-self-hosted-runners'
)

Push-Location $downloadDir
$manifestPath = Join-Path $PWD 'release-manifest.json'
gh attestation verify $manifestPath @attestationArgs
if ($LASTEXITCODE -ne 0) { throw 'Release manifest attestation mismatch' }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.tag -ne $tag -or $manifest.git_commit -ne $expectedGitSha) { throw 'Release manifest tag or git_commit mismatch' }
$manifestArtifacts = @($manifest.artifacts)
if ($manifestArtifacts.Count -eq 0) { throw 'Release manifest contains no artifacts' }
$seenNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$expectedChecksumRows = @()
foreach ($artifact in $manifestArtifacts) {
  $name = [string]$artifact.name
  if ([string]::IsNullOrWhiteSpace($name) -or [IO.Path]::GetFileName($name) -ne $name -or -not $seenNames.Add($name)) { throw "Unsafe or duplicate manifest artifact name: $name" }
  $expectedBytes = 0L
  if (-not [long]::TryParse([string]$artifact.bytes, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$expectedBytes) -or $expectedBytes -le 0) { throw "Invalid manifest byte count: $name" }
  $expectedSha = [string]$artifact.sha256
  if ($expectedSha -cnotmatch '^[a-f0-9]{64}$') { throw "Invalid manifest SHA-256: $name" }
  $artifactPath = Join-Path $PWD $name
  $file = Get-Item -LiteralPath $artifactPath -Force -ErrorAction Stop
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Unsafe release artifact: $name" }
  if ($file.Length -ne $expectedBytes) { throw "Manifest byte count mismatch: $name" }
  $actualSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash.ToLowerInvariant()
  if ($actualSha -cne $expectedSha) { throw "Manifest SHA-256 mismatch: $name" }
  $expectedChecksumRows += "$expectedSha  $name"
}
$expectedReleaseFiles = @($manifestArtifacts | ForEach-Object { [string]$_.name }) + @('release-manifest.json', 'SHA256SUMS')
$actualReleaseFiles = @(Get-ChildItem -LiteralPath $PWD -File | ForEach-Object { $_.Name })
if (Compare-Object ($expectedReleaseFiles | Sort-Object) ($actualReleaseFiles | Sort-Object)) { throw 'Downloaded Release file set does not match the attested manifest' }
$manifestSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()
$expectedChecksumRows += "$manifestSha  release-manifest.json"
$actualChecksumRows = @(Get-Content -LiteralPath 'SHA256SUMS')
if ($actualChecksumRows.Count -ne $expectedChecksumRows.Count) { throw 'SHA256SUMS does not exactly match the attested manifest' }
for ($index = 0; $index -lt $expectedChecksumRows.Count; $index += 1) {
  if ($actualChecksumRows[$index] -cne $expectedChecksumRows[$index]) { throw 'SHA256SUMS does not exactly match the attested manifest' }
}
Pop-Location

$sourceDir = Join-Path $downloadDir 'source'
git clone --branch $tag --depth 1 "https://github.com/$repo.git" $sourceDir
$sourceSha = (& git -C $sourceDir rev-parse HEAD).Trim()
if ($sourceSha -ne $expectedGitSha) { throw 'Downloaded source does not match the expected Git SHA' }

Get-ChildItem -LiteralPath $downloadDir -File |
  Where-Object { $_.Name -match '\.(exe|zip)$' -or $_.Name -eq 'artifact-security.json' } |
  ForEach-Object {
    gh attestation verify $_.FullName @attestationArgs
    if ($LASTEXITCODE -ne 0) { throw "Artifact attestation mismatch: $($_.Name)" }
  }
```

Windows 安全工作流会先更新 Defender 签名，更新失败即停止；`AntivirusSignatureLastUpdated` 以 UTC 写入证据且不得早于扫描时间 72 小时。

### 源码开发

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

浏览器打开 `http://localhost:3013`，或双击根目录 **`run_dev.bat`** 一键启动。启动器只会复用已验证的 LocalMiniDrama 前后端；5679 或 3013 被其他程序占用时会明确退出，不会终止陌生进程。新启动的服务会在通过就绪探针后才打开浏览器，60 秒内未就绪则失败关闭并保留服务窗口供排错。Vite 默认只监听 `127.0.0.1`，确需局域网调试时必须显式设置 `VITE_DEV_SERVER_HOST`。

也可以直接从仓库根目录使用 Docker；这是当前 `1.3.3` 源码候选的可用部署路径：

```bash
npm run docker:up
docker compose ps
```

前端仍访问 `http://localhost:3013`，后端健康/就绪检查为 `http://localhost:5679/health` 和 `http://localhost:5679/ready`。Compose 默认仅绑定宿主机 `127.0.0.1`，并使用只读根文件系统、`no-new-privileges` 与能力裁剪。`npm run docker:up` 要求干净工作树，并把当前 Git SHA 写入镜像 revision；开发中的未提交源码可直接运行 `docker compose up -d --build --wait`，但这类镜像不能创建正式回滚检查点。完整容器验证可运行 `npm run verify:docker`。生产 E2E 必须先执行 `npm run docker:e2e:up`，再运行 `npm run verify:e2e`。自由画布的 E2E 代码与契约已复审，但截至 2026-07-27 尚未执行真实 Docker 矩阵，不能作为发布通过证据。本地 Docker 构建、运行或验收通过都不等于 GitHub 正式发布。发布前停止后端和 Docker，并在干净工作树运行 `npm run verify:rollback`；正式上线还必须按 [快速开始](docs/quickstart.md) 保留真实数据备份、旧提交、运行镜像 ID、Compose / 配置与 SHA-256。桌面产品验收报告可在 `http://localhost:3013/reports/product-acceptance/report.html` 查看，自由画布收尾报告位于 `http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`。

异常退出若留下维护租约，必须按 [维护租约恢复步骤](docs/quickstart.md#q-如何备份迁移项目数据) 先检查归属，再用精确作用域和 PID 显式恢复；不要直接删除锁文件。

### 发布候选验证

以下命令从仓库根目录运行；正式证据必须来自同一个干净提交：

```bash
# 版本一致性
npm run verify:version

# 源码、Node 20 容器、revision-bound Docker 与生产 E2E
npm run verify:release:source

# Windows 桌面候选构建与 smoke 验证；仍需独立安全扫描
npm run verify:release:windows

# 当前干净提交的数据备份/隔离恢复演练；PR、main 与 tag Release 也会在 Node 20 运行隔离门禁
npm run verify:rollback

# 对已独立扫描且具备 artifact-security.json、release-manifest.json、SHA256SUMS 的候选做离线复核
npm run verify:release:artifacts

# Windows 上依次执行源码/Docker/E2E 与桌面候选构建/smoke；不替代独立扫描、回滚和最终制品复核
npm run verify:release
```

完整的安全扫描、回滚检查点和发布顺序见 [开发/打包/Docker 指南](docs/quickstart.md)。

源码历史 secret scan 使用不含路径豁免的 `.gitleaks.toml`；PR、`main` 和 tag workflow 除事件范围检查外，还会用固定 digest 的官方 Gitleaks 8.30.1 OCI 镜像扫描 `--all`。PR/分支 CI 另用固定 digest 的 Trivy 0.64.1 `fs` 扫描三个 npm 依赖图（含开发依赖）和全部生产 Dockerfile。Windows 候选在打标签前与 Tag Release 复用同一安全工作流。本地未跟踪依赖、运行数据和构建输出的目录扫描使用 `.gitleaks-worktree.toml`，Windows 发布制品使用 `.gitleaks-artifacts.toml`，三类 Gitleaks 配置不能互换。

生产后端不会直接使用宿主机原始 YAML：Compose 将可选的 `LOCALMINIDRAMA_CONFIG_DIR` 挂载到 `/app/config-source`，入口脚本启动时用 `runtime-config-policy.cjs` 净化到 `/tmp/localminidrama-config/config.yaml`，再以 `node` 用户启动服务。这样即使外部配置包含调试开关或敏感字段，运行配置仍按发布策略收敛；自定义配置目录中的 `config.yaml` 会在启动时重新校验。

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

> Novel2Anime 生产工作流会调用已启用并通过就绪检查的文本、素材图、分镜图、视频和 TTS 配置，再由本机 FFmpeg/FFprobe 合成与校验；Draft 预演仍可使用本地 mock 产物，production QA 会拒绝 mock/占位产物。仓库生产 E2E 使用本地协议兼容 Provider 验证完整非 mock 链路，不代表每个第三方厂商、账号、模型或额度组合都已深度联调，真实部署仍需在「AI 配置」执行连接测试。当前模型来自内置预设或手工录入，不会通过通用 `/v1/models` 自动发现；素材中心只提供本地素材上传/筛选，网页 URL 入口用于导入故事正文，不提供第三方媒体搜索或版权来源服务。移动端 Web 重排、触控行为和移动画布/列表降级不在当前桌面发布范围内。

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
| ✅ | 场景图 → 全景图 | 已支持由场景主图生成 2:1 全景图，并随项目导入导出 |
| ✅ | 列表侧分镜参考图/首尾帧上传 | 制作页列表模式已支持上传和绑定 |
| ✅ | 画布侧参考图统一入口 | 画布生成时可管理和选择分镜参考媒体 |
| ✅ | 参考图自由选择 | 生图时可手动指定角色、场景等参考媒体 |
| ✅ | 宫格图生成视频 | 支持将宫格参考交给声明兼容能力的视频模型 |
| 📋 | 网络素材搜索与版权来源 | 第三方图片/视频搜索、版权与授权来源核验、预览选择和下载入库后置；当前仅支持本地素材上传/筛选与网页 URL 正文导入 |
| 📋 | 远端模型自动发现 | 通用 `/v1/models` 模型列表发现与导入后置；当前使用厂商预设、自定义兼容厂商和手工模型 |
| 📋 | 第三方 Provider 深度联调 | 真实厂商、账户、模型版本、额度与计费组合后置；每个部署仍须本地连接测试和非敏感样例验收 |
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

[🚀 源码 / Docker 运行](docs/quickstart.md) · [🗃 Releases 历史](https://github.com/Shunlly/LocalMiniDrama/releases) · [🗺 画布文档](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

</div>
