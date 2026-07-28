# LocalMiniDrama 桌面客户端

基于 Electron 的本地桌面应用，内嵌 `backend-node` 与 `frontweb`。当前包版本为 **1.3.3 发布候选**，候选目标为 Windows x64 Setup 与 Portable；Git 尚无 `v1.3.3` 标签或正式 Release，本地构建产物不是 GitHub 正式发布。自由画布实现及代码复审已完成，但真实 Docker 与生产 E2E 仍待验证；正式二进制必须等同一 Git SHA 的全部门禁通过并经人工发布。macOS 构建会主动拒绝执行，不在当前验收矩阵。

---

## 主要功能（1.3.3 发布候选）

| 模块 | 功能 |
|------|------|
| 画布模式（v1.2.8 增强） | 剧本节点、右键菜单、浮动工具栏；画布内新建/删除分镜/角色/场景/道具；节点内编辑与整集批量生成 |
| 双模式自由画布（2026-07-27） | 同一路由切换「制作 / 自由」；五类自由节点、框选/连线、复制粘贴、撤销重做、素材搜索/拖入、保存重试、保存为素材、显式生产引用转换和项目导入导出 |
| Agnes AI（v1.2.8） | AI 配置页一键配置文本/图片/视频三类模型，一个 Key 覆盖全流程 |
| ModelArk 私有资产库（v1.2.8） | SD2 角色认证对接火山方舟资产组；AK/SK 签名与 Bearer 双鉴权 |
| 首页（项目列表） | 创建/打开剧集项目；素材库（角色/场景/道具全局复用）；AI 配置；明暗主题切换 |
| 剧集管理页 | 管理剧集信息（标题/风格/比例）；分集列表（新增/删除/预览剧本）；本剧资源库（角色/场景/道具按剧过滤）；从素材库导入资源 |
| 制作页（分集） | 剧本编辑、角色/场景/道具 AI 生成与图片管理；分镜脚本生成与逐镜编辑（图片提示词、视频提示词） |
| 分镜全能模式 | 分镜可在**经典**与**全能模式**间切换；全能模式中间为**片段描述**（`@图片1`… 多图参考），配合 AI 配置中 **`volcengine_omni`（Seedance 2.0）** 或 **`kling_omni`（可灵 Omni）**；生视频前校验模型匹配；支持「根据分镜生成提示词」 |
| 尾帧衔接 / 导出分镜表 | **尾帧衔接**：提取本镜视频末帧设为下一镜首帧；**导出分镜表**：HTML 表格导出当前集全部镜头字段 |
| 生成任务进度 | 角色 / 场景 / 道具 / 分镜图 / 视频任务统一轮询与恢复（`generationTaskStore`） |
| 分镜图生成 | **相机角度视角**：仰视/俯视/侧面/背面角度自动影响背景透视；**四宫格序列图**：一键生成 2×2 四帧序列参考图，自动拆分面板，随时切换主分镜图 |
| 一键流水线 | **一键生成视频**：全流程自动执行；**补全并生成**：仅生成缺失内容，自动跳过已有 |
| 图片/视频生成 | 支持 DashScope、Volcengine、Gemini 等多种 API；生成失败自动重试 3 次；错误信息持久显示 |
| 合成视频 | 将所有分镜视频合成为完整剧集 |
| 主题 | 支持暗色模式（默认）与浅色模式，偏好持久保存 |

自由画布当前只验收桌面键鼠范围。移动/触控、新真实 Provider 路由、协作与完整 Agent/MCP 后置；自动化测试不调用外部真实 Provider。实现收尾报告位于 `http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`，其中最终 Docker/生产 E2E 门禁明确标记为待验证。

---

## 开发运行

1. 确保已构建前端（否则窗口内会显示「请先构建前端」提示）：
   ```bash
   cd ../frontweb && npm install && npm run build
   ```
2. 安装依赖并启动 Electron：
   ```bash
   cd desktop
   npm install
   npm start
   ```

`npm start` 的 `prestart` 会把允许发布的后端代码重新复制到 `desktop/backend-app/`。该目录可重新生成且每次复制都会先清空，只承载运行代码，**不要把它当作唯一开发数据目录**。开发模式的可变配置、数据库和媒体位于 `%APPDATA%\localminidrama-desktop-dev\backend\`，安装版位于 `%APPDATA%\localminidrama-desktop\backend\`；测试需要隔离数据时可显式设置 `LOCALMINIDRAMA_USER_DATA_DIR`。

---

## 打包为 exe

在 `desktop` 目录下执行：

```bash
cd desktop
npm install
npm run dist
```

打包前必须能解析并执行 **8.1.2** 的 `ffmpeg` 与 `ffprobe`。脚本会依次从 `FFMPEG_PATH` / `FFPROBE_PATH`、`backend-node/tools/ffmpeg/` 和系统 `PATH` 查找，将验证通过的两支工具暂存到被 Git 忽略的 `desktop/release/.media-tools/`，随后作为同一份 `extraResources` 写入发行物。可单独运行 `npm run stage:media` 检查该门禁；正式发布还会按 `media-tool-policy.js` 中固定的包、载荷和可执行文件 SHA-256 复验。

源码仓库不提交媒体二进制。Windows 本地构建可安装指定版本后显式设置路径：

```powershell
choco install ffmpeg --version=8.1.2 -y --no-progress --allow-downgrade
$env:FFMPEG_PATH = (Get-Command ffmpeg.exe).Source
$env:FFPROBE_PATH = (Get-Command ffprobe.exe).Source
npm run verify
```

GitHub CI/Release 会从固定 URL 获取该版本并在使用前逐层校验哈希。

**国内网络**：若从 GitHub 下载 Electron 或 winCodeSign 超时，使用国内镜像：

```bash
npm run dist:cn
```

本目录下的 `.npmrc` 已配置 `registry=https://registry.npmmirror.com`，`npm install` 会使用国内源；`dist:cn` 脚本会将 Electron 与 electron-builder 的二进制下载也切换到 npmmirror 镜像。

`npm run dist`（或 `dist:cn`）只生成 Setup、Portable 与 `win-unpacked`。仓库根目录的 `npm run verify:release:windows` 会在冒烟通过后追加已校验的 Unpacked ZIP、四个 SBOM 文件和 `media-tools.json`；`artifact-security.json`、`release-manifest.json` 与 `SHA256SUMS` 只有在共享 Windows 安全工作流完成独立扫描后才生成。

这些文件位于本地 `desktop/release/` 时仍是候选，不应称为可下载的 GitHub Release。当前建议从源码或 Docker 运行；只有同一 SHA 的源码、Docker、Windows 制品、安全、回滚、产品验收与 CI 全绿，并在 draft Release 人工复核后正式发布，二进制才进入正式下载与支持边界。

### 未签名制品与下载核验

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

完整发布候选目录位于 `desktop/release/`：

| 文件 | 说明 |
|------|------|
| `LocalMiniDrama-Setup-x.x.x-x64.exe` | NSIS 安装包（有安装引导，可选安装目录） |
| `LocalMiniDrama-Portable-x.x.x-x64.exe` | 便携版（单文件，无需安装，双击即用） |
| `LocalMiniDrama-Unpacked-x.x.x-x64.zip` | 已校验的未压缩应用目录归档，用于离线审查和部署，不包含用户数据备份 |
| `win-unpacked/` | 未压缩桌面目录，用于发布前检查和冒烟 |
| `artifact-security.json` | Gitleaks、Defender、Trivy、Electron Fuse 与源制品 SHA-256 证据 |
| `media-tools.json` | 打包内 FFmpeg/FFprobe 的固定来源、版本和哈希 |
| `release-manifest.json` / `SHA256SUMS` | 发布附件精确清单、字节数与 SHA-256 校验 |
| `*.cdx.json` | 四份 CycloneDX SBOM 文件，覆盖后端、前端、桌面三个独立依赖图；两个桌面文件内容相同但承担发布命名和扫描命名职责 |

首次运行时，会在用户数据目录 `%APPDATA%/localminidrama-desktop` 下生成 `backend/`，包含 `configs/config.yaml`（从打包配置复制）、`data/`（数据库与文件存储）及 `tools/ffmpeg/`。启动程序会分别补齐缺失的 `ffmpeg.exe` 与 `ffprobe.exe`，不会覆盖用户已替换的任一工具。

---

## 脚本说明

| 脚本 | 说明 |
|------|------|
| `npm start` | 启动 Electron（开发模式） |
| `npm run build:front` | 仅构建前端（frontweb） |
| `npm run copy-front` | 将 frontweb/dist 复制到 desktop/frontweb-dist（打包前置步骤） |
| `npm test` | 运行桌面安全、单实例、打包合同及媒体工具恢复测试 |
| `npm run verify` | 运行桌面完整门禁，包括依赖树、SBOM、原生 ABI 和媒体工具执行验证 |
| `npm run stage:media` | 查找、执行验证并暂存打包使用的 ffmpeg 与 ffprobe |
| `npm run pack` | 构建前端 + 复制 + 打出未压缩目录（便于检查打包内容） |
| `npm run dist` | 构建前端 + 复制 + 打出 Windows 安装包与便携 exe |
| `npm run smoke:windows` | 启动验证 unpacked、portable、NSIS，并执行打包内 ffmpeg/ffprobe 与部分 userData 恢复场景 |
| `npm run dist:cn` | 同上，使用国内镜像（Electron、electron-builder 二进制） |
| `npm run prepare-backend` | 将 backend-node 复制到 backend-app（打包前置步骤） |
| `bash dist-mac.sh` | 主动失败并说明 macOS 不在当前发布矩阵，不会构建或上传制品 |

---

## 打包后如何看日志 / 调试

### 1. 查看后端日志文件（推荐）

双击运行 exe 时，后端日志会自动写入：

```
%APPDATA%\localminidrama-desktop\backend\logs\app.log
```

用记事本或 VS Code 打开后，点击「AI 生成角色」等按钮，查看是否有对应请求行、报错信息，便于判断是请求未发出、AI 超时还是配置有误。

### 2. 从命令行运行（实时日志）

```powershell
& "D:\path\to\release\LocalMiniDrama-Portable-x.x.x-x64.exe"
```

日志会直接打印在终端，操作软件时可实时看到所有输出。

### 3. 打开前端开发者工具

```powershell
$env:LOCALMINIDRAMA_DEVTOOLS=1
& "D:\path\to\release\LocalMiniDrama-Portable-x.x.x-x64.exe"
```

在 Network 面板查看各 API 请求（如 `POST /api/v1/generation/characters`）是否正常发出和返回。

### 4. 确认配置与网络

配置文件位于：

```
%APPDATA%\localminidrama-desktop\backend\configs\config.yaml
```

AI 相关配置需在软件「AI 配置」页面填写并保存，数据写入 `%APPDATA%\localminidrama-desktop\backend\data\drama_generator.db` 的 `ai_service_configs` 表；`config.yaml` 只保存通用运行设置。本机网络需能访问对应 API（如 dashscope、volcengine 等）。

---

## 依赖

- Node.js 22.12.0（桌面工具链；`engine-strict` 已启用）
- Electron 43.1.1 内嵌的 Node.js 24（应用运行时）
- FFmpeg 与 FFprobe（通过环境变量、仓库工具目录或系统 PATH 提供，打包时会实际执行 `-version`）
- 本仓库中的 `backend-node`（打包时通过 `prepare-backend` 复制到 `backend-app`）
- 前端需先在 `frontweb` 目录执行 `npm run build`，再打包或开发运行
