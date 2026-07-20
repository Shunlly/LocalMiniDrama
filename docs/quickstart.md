# 快速开始 / 开发指南

**导航：[项目主页](../README.md) | [English](en.md) | [AI 配置](configuration.md) | [版本历史](changelog.md)**

---

## 目录

- [运行方式一：下载 exe（推荐普通用户）](#运行方式一下载-exe推荐普通用户)
- [运行方式二：开发模式（推荐开发者）](#运行方式二开发模式推荐开发者)
  - [环境要求](#环境要求)
  - [启动后端](#1-启动后端)
  - [启动前端](#2-启动前端)
  - [一键启动脚本](#3-一键启动脚本)
- [打包为 Windows exe](#打包为-windows-exe)
  - [正式发布顺序](#正式发布顺序)
- [配置文件说明](#配置文件说明)
- [数据库与数据目录](#数据库与数据目录)
- [Docker 启动](#docker-启动)
- [常见问题 FAQ](#常见问题-faq)

---

## 运行方式一：下载 exe（推荐普通用户）

1. 前往 **[Releases](https://github.com/Shunlly/LocalMiniDrama/releases)** 页面下载最新版本：
   - `LocalMiniDrama-Setup-x.x.x-x64.exe` — NSIS 安装包（推荐，可选安装路径）
   - `LocalMiniDrama-Portable-x.x.x-x64.exe` — 免安装便携版

2. 双击运行，软件会自动启动内置后端服务。

3. 首次运行会在以下路径生成配置文件：
   ```
   %APPDATA%\localminidrama-desktop\backend\configs\config.yaml
   ```

4. 点击软件右上角「AI 配置」，填入你的 AI API Key，即可开始使用。

> 💡 不知道去哪里申请 API Key？请看 → [AI 配置指南](configuration.md)

---

## 运行方式二：开发模式（推荐开发者）

### 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | >= 20；发布与 Docker 验证使用 20.x |
| npm | 随 Node.js 附带 |
| Git | 任意版本 |

---

### 1. 启动后端

```bash
cd backend-node

# 安装依赖
npm install

# configs/config.yaml 已随仓库提供，通常无需复制模板
# AI API 地址与密钥通过前端「AI 配置」页面写入数据库
# npm run migrate 仅在首次手动初始化或新增 migration SQL 后需要；服务启动会自动补列

# 启动服务（默认端口 5679）
npm start

# 开发模式（热重载）
npm run dev
```

后端启动后以就绪端点为准；返回 HTTP 200 且 `status` 为 `ready` 才能接收业务请求：
```bash
curl.exe --fail http://127.0.0.1:5679/ready
```

---

### 2. 启动前端

**新开一个终端窗口：**

```bash
cd frontweb

# 安装依赖
npm install

# 启动开发服务器（默认端口 3013，自动代理到后端 5679）
npm run dev
```

浏览器访问 `http://localhost:3013` 即可看到界面。

---

### 3. 一键启动脚本

项目根目录提供一键启动脚本，用于**启动或复用已验证的后端和前端**：

**Windows（双击运行）：**
```
run_dev.bat
```

**PowerShell：**
```powershell
.\run_dev.ps1
```

若端口空闲，脚本会分别在两个窗口中启动后端（5679）和前端（3013），每个服务通过就绪探针后才会自动打开浏览器；60 秒内未就绪会退出并保留对应窗口供排错。若端口上已是可识别的 LocalMiniDrama 服务则直接复用；若任一端口被其他程序占用，脚本会失败关闭且不会终止该程序。

---

## 打包为 Windows exe

> 打包前请先确保已完成后端和前端的 `npm install`。

```bash
cd desktop

# 安装 Electron 相关依赖
npm install

# 打包（生成 NSIS 安装包 + 便携版 exe）
npm run dist

# 国内网络 Electron 下载慢时，使用镜像加速：
npm run dist:cn
```

`npm run dist`（或 `dist:cn`）只生成 Setup、Portable 与 `win-unpacked`，位于 `desktop/release/`：
- `LocalMiniDrama-Setup-x.x.x-x64.exe` — NSIS 安装包
- `LocalMiniDrama-Portable-x.x.x-x64.exe` — 便携版
- `win-unpacked/` — 未压缩目录

正式候选必须从仓库根目录运行 `npm run verify:release:source` 和 Windows 上的 `npm run verify:release:windows`。Windows 验证在冒烟通过后追加已校验的 `LocalMiniDrama-Unpacked-x.x.x-x64.zip`、四个 CycloneDX SBOM 文件和 `media-tools.json`；四个 SBOM 文件实际覆盖后端、前端、桌面三个独立依赖图，桌面依赖图同时使用版本化发布文件名和内部扫描文件名。CI 与 Release 共用同一套 Gitleaks、Trivy、Microsoft Defender、Electron Fuse、制品清单与 `SHA256SUMS` 安全工作流；`artifact-security.json`、`release-manifest.json` 和 `SHA256SUMS` 仅在这些独立扫描完成后生成。已有候选可用 `npm run verify:release:artifacts` 离线复核。

后端容器入口只在启动时以 root 修正绑定数据目录的属主，随后立即通过 `setpriv` 以 `node` 用户执行服务。对应 Trivy `AVD-DS-0002` 例外仅作用于 `backend-node/Dockerfile`，记录在 `backend-node/.trivyignore.yaml`，并于 2027-07-17 到期复审。

**打包原理：**
1. 构建前端静态文件
2. 复制后端代码与前端产物到 `desktop/` 
3. electron-builder 打包为 Windows exe

### 正式发布顺序

1. 在最终候选分支提交全部改动，确认版本号一致、Git 工作树干净，并在同一 SHA 完成本地全量验证与生产 Docker E2E。
2. 推送候选分支并等待分支 CI 全部通过；其中必须包含源码依赖/配置扫描、Windows 候选构建、Gitleaks、Defender、Trivy、回滚演练和制品离线复核。CI 未通过时不得打标签。
3. 合入 `main` 后再次等待该 SHA 的分支 CI 全绿，部署升级前按下文创建并保留真实回退检查点。
4. 仅对已经验收的 `main` 提交创建 annotated tag（例如 `git tag -a v1.3.3 <sha> -m "LocalMiniDrama v1.3.3"`）并推送；不要移动或覆盖已发布标签。
5. Tag workflow 只从同一提交重新验证并生成草稿 Release。核对附件精确集合、`artifact-security.json`、`release-manifest.json`、`SHA256SUMS` 和 provenance 后再人工发布草稿。
6. 升级后完成健康、就绪、已有项目、媒体播放和关键生成流程验收；回退检查点至少保留到业务验收结束。

---

## 配置文件说明

配置文件位于 `backend-node/configs/config.yaml`（开发模式）或 `%APPDATA%\localminidrama-desktop\backend\configs\config.yaml`（exe 模式）。

主要配置项：

```yaml
server:
  port: 5679          # 后端端口

database:
  path: ./data/drama_generator.db   # SQLite 数据库路径

storage:
  local_path: ./data/storage        # 生成图片/视频的本地存储目录
  upload_disk_reserve_bytes: 536870912 # 上传后至少保留 512MB 可用空间

app:
  language: zh        # 界面及提示词语言（zh / en）

style:
  default_style: realistic           # 默认画风
  default_image_ratio: "16:9"        # 默认图片比例
  default_video_ratio: "16:9"        # 默认视频比例
```

AI 服务配置通过软件内「AI 配置」页面管理，无需手动编辑 YAML。  
详细说明请见 → [AI 配置指南](configuration.md)

---

## 数据库与数据目录

| 路径 | 说明 |
|------|------|
| `backend-node/data/drama_generator.db` | SQLite 数据库（开发模式） |
| `backend-node/data/storage/` | 生成的图片和视频文件 |
| `backend-node/data/story_sources/` | 导入的原始故事素材 |
| `backend-node/data/backups/` | 默认全量备份归档目录 |
| `%APPDATA%\localminidrama-desktop\backend\data\` | exe 模式的数据库、媒体与导入原文 |
| `%APPDATA%\localminidrama-desktop\backend\configs\` | exe 模式的运行配置 |
| `%APPDATA%\localminidrama-desktop-dev\backend\` | Electron 开发模式的独立可变数据与配置 |

源码或 Docker 模式升级前，先停止后端服务，再执行 `npm --prefix backend-node run backup:data`。该命令只备份仓库的 `backend-node/data/`，会校验数据库和媒体引用，并默认排除 AI Key、URL 签名等凭据；它不会自动备份 exe 的 `%APPDATA%` 数据。数据库会在启动时自动执行迁移脚本，一般无需手动操作。

---

## Docker 启动

项目根目录已提供 `docker-compose.yml`，会同时启动后端和前端：

```bash
npm run docker:up
docker compose ps
```

启动后访问：

| 服务 | 地址 |
|------|------|
| 前端 | `http://localhost:3013` |
| 后端健康检查 | `http://localhost:5679/health` |
| 后端就绪检查 | `http://localhost:5679/ready` |
| API 路径前缀 | `http://localhost:5679/api/v1`（该前缀本身不是可访问资源） |

Docker 镜像固定使用 Node.js 20，并在后端容器内安装 `ffmpeg`；编译工具只存在于依赖构建阶段。容器会把 `backend-node/data` 挂载到 `/app/data`，数据库和生成素材会保留在本机项目目录下。前端容器使用 Nginx 提供 Vite 的生产构建产物，源码没有 bind mount。生产容器启用只读根文件系统、`no-new-privileges`、能力裁剪和受限临时目录。

后端 Compose 不会让宿主机配置直接覆盖运行配置。`LOCALMINIDRAMA_CONFIG_DIR`（默认 `./backend-node/configs`）只读挂载到容器的 `/app/config-source`；入口脚本会在降权前通过 `runtime-config-policy.cjs` 将其净化到 `/tmp/localminidrama-config/config.yaml`，应用通过 `LOCALMINIDRAMA_CONFIG_PATH` 读取净化结果。自定义配置必须提供 `config.yaml`，每次启动都会重新净化。

`npm run docker:up` 要求 Git 工作树干净，并把当前完整提交 SHA 写入后端和前端镜像的 OCI revision 标签。修改源码尚未提交时可直接执行 `docker compose up -d --build --wait` 做开发检查，但 revision 会是 `unknown`，不能用于发布证据或正式回滚检查点；提交后必须重新运行 `npm run docker:up`。

Docker 默认只把 `5679` 和 `3013` 绑定到宿主机 `127.0.0.1`，不会向局域网公开无认证接口。确需远程访问时，请先增加反向代理、认证和 TLS，再显式调整端口绑定。

容器内完整验证：

```bash
npm run verify:docker
```

单独运行 `npm run verify:e2e` 不会自动启动 Provider；下面的 `npm run docker:e2e:up` 会显式启动本地协议兼容 Provider。必须在干净工作树按顺序执行：

```bash
npm run docker:e2e:up
npm run verify:e2e
docker compose --profile e2e down --volumes --remove-orphans
```

`docker:e2e:up` 等价于带可信 Git revision 的 `docker compose --profile e2e up -d --build --wait`。E2E 会真实调用本地文本、图片、视频和 TTS 协议端点，生成成片、验证两个桌面视口播放到结束、下载与项目导出，然后清理测试项目；它不等同于外部云 Provider 深度联调。

该命令依次执行后端静态检查、测试与流程审计，以及前端静态检查、测试和生产构建。宿主机若使用 Node.js 24 等缺少 `better-sqlite3` 预编译产物的版本，可直接以 Docker/Node 20 作为权威验证路径。

停止服务：

```bash
docker compose down
```

如果只想使用 npm 脚本：

```bash
npm run docker:up
npm run docker:down
```

---

## 常见问题 FAQ

### Q: 后端启动报错 `Cannot find module 'better-sqlite3'`

```bash
cd backend-node
npm install
```

如果仍然报错，可能是 Node.js 版本不兼容，请升级到 Node.js 20.x。

---

### Q: 前端报错 `Failed to fetch` 或 API 请求 404

确认 `http://127.0.0.1:5679/ready` 返回 HTTP 200，且前端代理配置指向正确端口。
检查 `frontweb/vite.config.js` 中的 `proxy` 配置；默认 target 为 `http://127.0.0.1:5679`，自定义时由 `VITE_BACKEND_PROXY_TARGET` 显式覆盖。

---

### Q: 打包 exe 时 Electron 下载失败

使用国内镜像：
```bash
cd desktop
npm run dist:cn
```

或手动设置环境变量后再运行：
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dist
```

---

### Q: 生成的图片/视频保存在哪里？

开发模式：`backend-node/data/storage/`  
exe 模式：`%APPDATA%\localminidrama-desktop\backend\data\storage\`

目录结构：
```
storage/
├── images/        # 分镜生成的图片
├── characters/    # 角色图片
├── scenes/        # 场景图片
├── videos/        # 生成的视频片段
└── merged/        # 合成后的完整视频
```

---

### Q: 如何备份/迁移项目数据？

**单个项目**：在软件首页点击项目卡片上的「导出」，下载项目 ZIP，在新机器上导入。

**桌面 exe 完整数据**：完全退出桌面应用（关闭窗口并确认后台进程结束）后，再复制整个 `%APPDATA%\localminidrama-desktop\backend\` 到仓库外的备份目录；Electron 开发版使用独立的 `%APPDATA%\localminidrama-desktop-dev\backend\`，需要时单独备份。不要在桌面后端仍监听 5679 或 SQLite 正在写入时复制。该离线副本包含数据库中的 Provider 凭据，必须放在加密且限制访问的位置；单项目导出和下述安全归档默认不携带凭据。

复制前检查 `configs/config.yaml`：如果 `database.path` 或 `storage.local_path` 配置为指向 `backend\` 之外的绝对路径，完整备份还必须单独复制这些绝对路径指向的数据库、素材和导入原文，并在恢复后重新核对路径与访问权限。只复制默认目录不能覆盖自定义外部存储。

**源码 / Docker 完整数据（推荐在升级/迁移前使用）**：先停止后端或 Docker，确认 5679 未被占用，再执行：

```bash
npm --prefix backend-node run backup:data -- --output D:\backup\localminidrama.zip

# 恢复同样要求后端与 Docker 已停止，且目标端口和数据库未被占用
npm --prefix backend-node run restore:data -- --input D:\backup\localminidrama.zip --yes
```

恢复会先校验归档清单、大小、路径和 SQLite 完整性，并为目标数据保留恢复前回滚副本。安全备份不会携带 Provider 凭据，恢复后需要在「AI 配置」重新填写 Key 并执行连接测试。

后端被强制终止时，可能留下用于保护备份/恢复一致性的维护租约。若下一次启动明确报告 `MAINTENANCE_ACTIVE` 或 `MAINTENANCE_LOCK_FOREIGN`，不要直接删除锁文件。先停止所有源码、桌面和 Docker 后端，再从仓库根目录检查租约：

```bash
npm run maintenance:recover -- --inspect
```

只有在确认输出的作用域、PID 和心跳属于已终止的 LocalMiniDrama 进程后，才把检查到的原值原样传回并明确确认：

```bash
npm run maintenance:recover -- --owner-scope "<检查到的作用域>" --pid <检查到的PID> --yes
```

该命令不会输出租约令牌；租约仍新鲜、本机 PID 仍活跃、锁已被替换，或作用域/PID 与检查结果不一致时都会失败关闭。恢复完成后再运行 `npm run docker:up`。如果无法证明锁的归属，保留锁和数据目录，先查明仍在运行的进程，不要强制接管。

发布或升级验收时，先停止后端与 Docker，确认 Git 工作树干净，再从仓库根目录运行：

```bash
npm run verify:rollback
```

该门禁先运行 38 项备份恢复专项测试，再把当前数据做脱敏备份并恢复到临时隔离目录，校验 SQLite、媒体、原文、凭据排除、中断清理和恢复前回滚副本。临时归档在结束后删除，摘要写入被 Git 忽略的 `artifacts/rollback-drill/summary.json`；已识别的旧版本摘要会原子迁入 `artifacts/rollback-drill/archive/`，不会冒充当前结果或阻断新演练。

`verify:rollback` 只证明备份与恢复链路可用，不会保留上线回退所需的真实备份。正式升级前必须建立可追溯的回退检查点：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$checkpoint = "D:\backup\localminidrama-$stamp"
npm run checkpoint:rollback -- -CheckpointDirectory $checkpoint
```

`checkpoint:rollback` 要求当前服务由 `npm run docker:up` 构建且健康。脚本会在停机前从实际运行容器捕获不可变镜像 ID 和真实配置 bind mount，核对两份镜像 revision 与当前 Git SHA 一致，把两份镜像打上提交专属标签并保存到 `images.tar`，同时归档 Compose、运行配置及所有 SHA-256；随后才停止 Docker、创建真实数据备份并执行同提交隔离演练。中途失败会尝试用已捕获镜像自动恢复原服务。检查点必须位于仓库之外且至少保留到新版本完成业务验收，不能只保留 metadata 而删除 `images.tar`。

需要回退时，优先保持当前部署运行并直接执行恢复命令；若升级后容器已经 unhealthy 或 stopped，只要 Compose 容器尚未被删除，脚本仍会从容器捕获镜像、revision、状态和配置作为补偿证据后继续回退。不要先执行会删除容器的 `docker compose down`，也不要覆盖或移动正式发布标签：

```powershell
$checkpoint = 'D:\backup\localminidrama-YYYYMMDD-HHMMSS'
npm run restore:rollback -- -CheckpointDirectory $checkpoint
```

`restore:rollback` 在接触数据前核对 metadata、数据 ZIP、Compose、运行配置、镜像归档、演练摘要的 SHA-256，并从 `images.tar` 加载后逐一核对旧镜像 ID 与 revision；同时从当前 existing 容器捕获前向补偿目标，非健康状态会显式告警但不会阻断旧版本恢复。若当前容器已被删除，则因无法证明补偿镜像和配置而失败关闭。停机后先保留升级后数据补偿备份，再恢复旧数据并用归档 Compose / 配置及专用回退标签启动。旧版本启动失败时，脚本会尝试恢复补偿数据和升级后镜像；补偿也失败才会报告双重故障。成功后仍需复验一条已有媒体播放链路，并在「AI 配置」重新填写所有备份策略排除的 Provider 凭据。不可移动或重写 `v1.3.3` 等正式标签。

**源码离线目录副本**：只有在后端和 Docker 均已停止时，才可复制整个 `backend-node/data/`；不要在 SQLite 正在写入时直接拷贝。exe 数据必须使用上文 `%APPDATA%` 路径，不能用仓库目录替代。

---

### Q: 支持 Mac / Linux 吗？

当前发布和验收矩阵仅包含 Windows x64 Setup、Portable 与 unpacked。后端和前端可在其他平台源码运行，但桌面 macOS 构建脚本会主动拒绝执行，Linux 桌面制品也不在本次支持范围。

---

[← 返回项目主页](../README.md)
