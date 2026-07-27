# 快速开始 / 开发指南

**导航：[项目主页](../README.md) | [English](en.md) | [AI 配置](configuration.md) | [版本历史](changelog.md)**

---

## 目录

- [当前发布状态与运行建议](#当前发布状态与运行建议)
  - [自由画布集成状态](#自由画布集成状态2026-07-27)
- [运行方式一：源码开发（当前建议）](#运行方式一源码开发当前建议)
  - [环境要求](#环境要求)
  - [启动后端](#1-启动后端)
  - [启动前端](#2-启动前端)
  - [一键启动脚本](#3-一键启动脚本)
- [本地构建 Windows 候选](#本地构建-windows-候选)
  - [正式发布顺序](#正式发布顺序)
- [配置文件说明](#配置文件说明)
- [数据库与数据目录](#数据库与数据目录)
- [运行方式二：Docker（当前候选部署）](#运行方式二docker当前候选部署)
- [常见问题 FAQ](#常见问题-faq)

---

## 当前发布状态与运行建议

当前源码与三个包的版本为 `1.3.3` 发布候选。Git 目前只有 `v1.3.0`、`v1.3.1`、`v1.3.2` 标签，没有 `v1.3.3` 标签或正式 Release；[Releases](https://github.com/Shunlly/LocalMiniDrama/releases) 仅作为历史页，不能据此推断当前存在正式 Setup 或 Portable。

当前建议按下文从源码运行，或使用 Docker 部署候选源码。本地源码、Docker 或自行构建的 Windows 候选即使运行通过，也不是 GitHub 正式发布。正式二进制必须等同一 Git SHA 的 CI、源码、Docker、Windows 制品、安全、回滚与产品验收全部通过，并在 draft Release 人工复核后正式发布。

### 当前能力与延期边界

- 素材中心当前支持本地图片/视频上传、搜索和类型筛选；网页 URL 入口只提取故事正文并写入项目。第三方图片/视频搜索、版权或授权来源核验、预览选择和下载入库不属于 `1.3.3` 桌面候选。
- AI 配置当前支持厂商预设、自定义 OpenAI 兼容厂商和手工模型列表。连接测试会探测配置端点，但不会通过通用 `/v1/models` 自动发现或导入远端模型。
- 外部真实 Provider 的厂商、账户、模型版本、额度、计费和长耗时行为仍需每个部署自行连接测试和非敏感样例验收；仓库测试不得使用真实凭据。
- 移动端重排、触控行为和移动画布/列表降级后置；本候选只按桌面矩阵验收。

### 自由画布集成状态（2026-07-27）

同一路由中的「制作 + 自由」桌面工作台已经完成任务 1-5、8 项产品验收三轮复审（`Spec PASS / Quality PASS`）和 ZIP 导入导出安全复审（`Spec PASS / Security PASS`）。E2E 流程代码、证据校验契约及串行门禁接线也已完成 `Spec PASS / Quality PASS` 复审。

上述结论不包含真实 Docker 运行证据。1280x720、1366x768、1440x900 的亮色/暗色生产 E2E 尚未执行，最终发布状态必须保持 **待验证 / UNVERIFIED**。测试只使用本地协议兼容测试服务，不调用外部真实 Provider。启动前端后可查看独立报告：`http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`。

---

## 运行方式一：源码开发（当前建议）

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

## 本地构建 Windows 候选

> 以下命令只生成本地未发布候选，不会创建 GitHub Release。打包前请先确保已完成后端和前端的 `npm install`。

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

配置文件位于 `backend-node/configs/config.yaml`（后端源码模式）、`%APPDATA%\localminidrama-desktop-dev\backend\configs\config.yaml`（Electron 开发模式）或 `%APPDATA%\localminidrama-desktop\backend\configs\config.yaml`（Setup / Portable 模式）。

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

## 运行方式二：Docker（当前候选部署）

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

Docker 镜像固定使用 Node.js 20，并在后端容器内安装 `ffmpeg`；编译工具只存在于依赖构建阶段。容器默认把 `backend-node/data` 挂载到 `/app/data`，数据库和生成素材会保留在本机项目目录下；发布回滚脚本会把从实际 backend 容器捕获并验证的宿主 bind source 通过 `LOCALMINIDRAMA_DATA_DIR` 重新绑定到该目标。前端容器使用 Nginx 提供 Vite 的生产构建产物，源码没有 bind mount。生产容器启用只读根文件系统、`no-new-privileges`、能力裁剪和受限临时目录。

后端 Compose 不会让宿主机配置直接覆盖运行配置。`LOCALMINIDRAMA_CONFIG_DIR`（默认 `./backend-node/configs`）只读挂载到容器的 `/app/config-source`；入口脚本会在降权前通过 `runtime-config-policy.cjs` 将其净化到 `/tmp/localminidrama-config/config.yaml`，应用通过 `LOCALMINIDRAMA_CONFIG_PATH` 读取净化结果。自定义配置必须提供 `config.yaml`，每次启动都会重新净化。

`npm run docker:up` 要求 Git 工作树干净，并把当前完整提交 SHA 写入后端和前端镜像的 OCI revision 标签。修改源码尚未提交时可直接执行 `docker compose up -d --build --wait` 做开发检查，但 revision 会是 `unknown`，不能用于发布证据或正式回滚检查点；提交后必须重新运行 `npm run docker:up`。Docker 是当前候选的可用部署路径，但本地镜像构建、运行或验收结果不构成 GitHub 正式发布。

Docker 默认只把 `5679` 和 `3013` 绑定到宿主机 `127.0.0.1`，不会向局域网公开无认证接口。确需远程访问时，请先增加反向代理、认证和 TLS，再显式调整端口绑定。

容器内完整验证：

```bash
npm run verify:docker
```

单独运行 `npm run verify:e2e` 不会自动启动测试服务；下面的 `npm run docker:e2e:up` 会显式启动本地协议兼容测试服务。必须在干净工作树按顺序执行：

```bash
npm run docker:e2e:up
npm run verify:e2e
docker compose --profile e2e down --volumes --remove-orphans
```

`docker:e2e:up` 等价于带可信 Git revision 的 `docker compose --profile e2e up -d --build --wait`。E2E 会调用本地协议兼容的文本、图片、视频和 TTS 测试端点，生成成片、验证桌面视口播放、下载与项目导出，然后清理测试项目；测试不得调用外部真实 Provider，也不等同于外部云 Provider 深度联调。截至 2026-07-27，自由画布脚本与契约已复审，但上述真实 Docker 命令和六组亮/暗视口矩阵仍未执行，不能写入发布通过结论。

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

如果锁文件内容的 schema 是 `localminidrama.maintenance-quarantine.v1`，说明释放锁时发现目录、符号链接或其他非普通文件替身。公开路径上的隔离标记用于阻止新进程误启动，`claimDirectory` 与 `claimEntry` 指向同目录下保留的原替身。此时不要运行自动恢复，也不要删除标记或 claim；先停止全部源码、桌面和 Docker 后端，保全两者并查明替换来源，再在独占维护窗口人工处理。系统不会自动把 claim 移回公开路径，因为跨平台 rename 无法同时保证“不覆盖恢复窗口中新出现的对象”。

发布或升级验收时，先停止后端与 Docker，确认 Git 工作树干净，再从仓库根目录运行：

```bash
npm run verify:rollback
```

Windows 会在启动器当前 Node 进程中直接运行演练，内部测试子进程有 10 分钟硬超时；检查点和恢复脚本启动的外部命令树由 Job Object 约束。临时文件清理要求 NTFS/ReFS，并按保留句柄的文件身份删除。Linux 宿主必须可用 Docker、Git、Git LFS，并已按 `backend-node/package-lock.json` 安装后端依赖：启动器先在宿主确认 Git 工作树干净、记录完整提交 SHA、确认后端端口未监听并持有同一数据根的维护租约，再把仓库、数据根和检查点归档只读挂载到固定摘要的 Node.js 20 镜像。维护租约绑定原锁文件的设备号、inode 和新鲜心跳。容器成功后宿主会再次核对工作树仍干净且 SHA 未变化。容器禁用网络与额外能力，使用归属当前 UID/GID 的私有 `/tmp`，只有 `artifacts/rollback-drill/` 可写；诊断路径含符号链接、宿主服务仍在运行、维护租约变化、源码版本变化或容器边界无法建立时都会失败关闭。启动器和 CI 都通过私有 CID 文件、唯一标签和容器名三路发现并校验归属，清理后以同名哨兵容器建立 Docker daemon 屏障；只有复核标签、名称和 CID 均不存在后才释放宿主维护租约。无法证明 CLI 退出或容器清理完成时会保留租约，按上文维护恢复流程处理。

不带参数的 `npm run verify:rollback` 是独立演练：它先运行备份恢复专项测试，再把当前数据做脱敏备份并恢复到临时隔离目录，校验 SQLite、媒体、原文、凭据排除、中断清理和恢复前回滚副本。演练完成所有验证、句柄关闭和临时归档清理后，才在标准输出写出唯一一行 `LOCALMINIDRAMA_ROLLBACK_RESULT_V1=...` 机器结果；其中绑定 `localminidrama.rollback-drill.v3` 的精确 UTF-8 字节及其小写 SHA-256。CI 和发布流程直接校验这条实时管道结果，不会重新打开仓库文件来决定成功。结果要求 `input_mode: standalone`、`backup.archive_retained: false`、有效的归档摘要和数据根摘要，以及 `operations.source_data_root_unchanged: true`。

文件系统中的演练记录只用于诊断。每次成功演练以 `wx+` 新建独立的 `artifacts/rollback-drill/summary-v3-<commit>-<random>.json`，不会覆盖、重命名或删除任何已有记录。旧的 `artifacts/rollback-drill/summary.json`、v1/v2/v3 文件即使存在也保持原样，不能作为当前演练或发布的权威结果；临时归档仍会在独立演练结束前删除。

独立演练只接受一个物理数据根，数据库、素材和导入原文必须是该目录下的同级项：

```text
<data-root>/
├── drama_generator.db
├── storage/
└── story_sources/
```

如果数据库、`storage/` 和 `story_sources/` 的已配置父目录不是同一个物理目录，演练会失败关闭；仅有看起来相同的路径文本不能代替物理目录证明。

`verify:rollback` 只证明备份与恢复链路可用，不会保留上线回退所需的真实备份。正式升级前必须建立可追溯的回退检查点：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$checkpoint = "D:\backup\localminidrama-$stamp"
npm run checkpoint:rollback -- -CheckpointDirectory $checkpoint
```

`checkpoint:rollback` 要求当前服务由 `npm run docker:up` 构建且健康。脚本会在停机前从实际运行的 backend 容器捕获 `/app/data` 和 `/app/config-source`：数据挂载必须恰好一个、类型为可写 bind，且宿主 source 必须是真实目录。脚本核对两份镜像 revision 与当前 Git SHA 一致，把镜像保存到 `images.tar`，把规范化数据 source 写入固定归档文件 `data-bind-source.txt`，并在 `localminidrama.release-rollback-checkpoint.v5` metadata 中记录小写原生 `data_root_identity`。如果相同路径上的物理数据根在检查点创建期间被替换，脚本会中止；路径文本相同不视为同一目录。

停止 Docker 后，脚本以重新检查的 bind source 创建并保留 `checkpoint/data.zip`，随后自动对这一精确配对运行 `npm run verify:rollback -- --archive <checkpoint/data.zip> --data-root <inspected-bind-source>`。不要用其他归档或数据根替换该配对。检查点脚本只接受子进程标准输出中的唯一、有界机器结果，严格解码 UTF-8、核对摘要并验证 `input_mode: checkpoint-bound` 与 `backup.archive_retained: true`；它不会读取仓库中的 `artifacts/rollback-drill/summary.json` 或其他诊断文件。

验证通过后，`checkpoint/rollback-drill-summary.json` 由脚本使用 `FileMode.CreateNew` 直接在最终路径创建；同一个保留的读写权威句柄（same retained read/write authority）负责写入精确证据字节、持久化刷新、逐字节复核、最终路径身份校验和 SHA-256 计算，不存在临时文件移动或关闭后重开边界。v5 `metadata.json` 也通过同一机制直接创建，并保持自己的权威句柄直到成功输出完成；摘要句柄则持续持有到 metadata 创建完成。摘要中的归档 SHA-256、v5 metadata 中记录的归档 SHA-256 和当前保留的 `data.zip` 字节摘要必须三方一致，历史数据根 SHA-256 也会复制到 v5 metadata。脚本同时从演练开始前一直对 `data.zip` 保持读取锁，直至演练、证据校验和 metadata 发布全部完成。

v5 是升级和回退的唯一发布权威格式。v4 检查点仍可检查，但不具备发布权威性，升级或回退前必须重新创建为 v5。检查点必须位于仓库和实时数据目录之外且至少保留到新版本完成业务验收；身份校验不能替代 `data.zip`、`images.tar`、净化后的运行配置、`data-bind-source.txt` 或前向补偿证据，不能只保留 metadata 而删除这些文件。

**v5 本地信任边界**：这里的“唯一发布权威格式”只表示当前工具链接受的本地检查点格式。v5 会在一次受信任的创建或恢复调用期间，用保留句柄、文件身份和摘要把所读取的文件绑定为一组内部一致、可抵抗同机路径竞争的字节；v5 本身没有签名。操作员对受保护检查点存储的控制，以及恢复时对具体检查点目录的主动选择，才是本地授权来源。`metadata.json` 的 `created_at` 仅供记录和排查，不证明检查点仍然新鲜。检查点内记录的摘要只能证明该检查点内部关系一致；预期摘要只有通过检查点之外的受信任渠道独立保存和取得时才具有授权意义，从同一检查点目录读取“预期摘要”属于循环验证。

因此，当前流程不证明检查点创建者身份、调用前的保管链、静态存储遭恶意整体替换后的真实性或新鲜度。能替换整套检查点文件的一方可以制作另一套内部一致的 v5。需要这些保证时，应另行建设签名的外部发布账本或授权记录，并把 metadata 摘要、提交、版本、创建序列或时间、签名者身份和密钥策略绑定在检查点之外；当前命令不接受也不伪装提供 `ExpectedCommit`、`ExpectedMetadataSha256` 或签名参数。

需要回退时，优先保持当前部署运行并直接执行恢复命令；若升级后容器已经 unhealthy 或 stopped，只要 Compose 容器尚未被删除，脚本仍会从容器捕获镜像、revision、状态和配置作为补偿证据后继续回退。不要先执行会删除容器的 `docker compose down`，也不要覆盖或移动正式发布标签：

```powershell
$checkpoint = 'D:\backup\localminidrama-YYYYMMDD-HHMMSS'
npm run restore:rollback -- -CheckpointDirectory $checkpoint
```

`restore:rollback` 只接受 v5 检查点。脚本在接触数据前核对固定位置的 metadata、`data-bind-source.txt`、数据 ZIP、Compose、净化后的运行配置、镜像归档和 v3 演练摘要及其 SHA-256，再从当前 existing backend 容器重新捕获 `/app/data`。当前挂载必须仍是唯一可写 bind，且当前检查到的宿主 source 必须与检查点记录的小写原生 `data_root_identity` 表示同一个物理目录；路径文本相同但目录身份不同会失败关闭。归档 metadata 中的路径只用于证据比对，不会被用来拼接归档文件或选择备份/恢复目标；检查点备份、旧数据恢复和所有前向补偿都显式使用重新 inspect 的同一 source。

检查点创建后，当前实时数据根内的数据库、素材和原文等后代内容可以正常变化。恢复只比较 v3 摘要与 v5 metadata 之间保存的历史数据根摘要，不会重新散列当前实时字节并与该旧摘要比较；物理目录身份约束与历史内容摘要是两个不同的证明。每次启动回滚或前向部署前会先解析 Compose 确认 `/app/data` 指向该 source，启动后再 inspect 容器复核。旧版本启动失败时，脚本会尝试恢复补偿数据和升级后镜像；补偿也失败才会报告双重故障。安全归档和发布证据始终排除 Provider 凭据；成功后仍需复验一条已有媒体播放链路，并在「AI 配置」重新填写所有备份策略排除的 Provider 凭据。`v1.3.3` 目前尚未创建；任何版本标签一旦按正式流程发布，都不可移动或重写。

**源码离线目录副本**：只有在后端和 Docker 均已停止时，才可复制整个 `backend-node/data/`；不要在 SQLite 正在写入时直接拷贝。exe 数据必须使用上文 `%APPDATA%` 路径，不能用仓库目录替代。

---

### Q: 支持 Mac / Linux 吗？

当前 `1.3.3` 候选验收矩阵仅包含 Windows x64 Setup、Portable 与 unpacked。后端和前端可在其他平台源码或 Docker 运行，但桌面 macOS 构建脚本会主动拒绝执行，Linux 桌面制品也不在本次支持范围。

---

[← 返回项目主页](../README.md)
