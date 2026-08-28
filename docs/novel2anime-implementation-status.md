# Novel2Anime 实现状态

日期：2026-08-02
发布范围：LocalMiniDrama `1.3.3` 桌面候选

## 当前状态

Novel2Anime 生产工作流的源码链路已经实现，覆盖素材导入、抽取、改编、资产生成、分镜、媒体生成、TTS、FFmpeg 合成、QA、修复、导出、恢复和清理。实现完成不等于正式发布通过。干净提交 `f2fa2a85` 上已有本地 Docker 生产 E2E 与自由画布 E2E 证据；后续提交、未提交改动和 `v1.3.3` 标签/CI 合入仍须按同一 Git SHA 重跑后才能作为发布证据。

生产 E2E 使用隔离的本地 OpenAI 兼容 Provider harness，不提交外部凭据。它可以验证本地协议兼容的非 mock 流程，但不代表任何第三方账号、模型、额度、计费或长耗时行为已经深度联调；真实部署仍须在「AI 配置」中连接测试并用非敏感样例验收。

## 已实现生产流程

1. 项目就绪度在 AI 配置、素材、剧本/剧集、资产、分镜和媒体之间给出唯一下一步。
2. 故事素材处理按「导入素材 → 启动处理 → QA → 修复 → 剧集/时间线」形成可执行的空数据和失败状态。
3. 制作台与画布共享项目数据、动作前置条件、任务进度、失败恢复、参考媒体、首尾帧和合成输出。
4. 素材中心支持本地图片/视频上传、搜索、筛选、预览、下载和清理，也支持从 Wikimedia Commons 搜索公开图片/视频、展示作者与许可来源、预览并安全下载到项目或全局素材库。
5. 网页 URL 入口只负责导入故事正文，不等同于第三方媒体搜索或版权服务。
6. 生产 QA 要求真实本地媒体，以及文本、图片、视频、TTS 和合成阶段成功的非 mock Provider 审计记录。

## AI 文本与媒体能力

- 文本改编通过已启用的文本服务路由；Google Gemini 文本使用官方 Gemini OpenAI 兼容端点 `https://generativelanguage.googleapis.com/v1beta/openai`，前端提供 Gemini 文本模型预设。
- Gemini 文本的配置、路由和连接测试已接入；真实 Google 账号、模型版本、配额和计费行为仍未由仓库自动化测试验证。
- 资产图和分镜图调用已配置的图片服务；ComfyUI 路径包含提交、历史轮询、输出获取、取消、超时和错误净化。
- 分镜视频调用已配置的视频服务，具有限界轮询、重试、取消、幂等和本地媒体持久化。
- 对白和旁白调用已配置的 TTS 服务并持久化校验后的本地音频。
- 剧集合成校验 FFmpeg/FFprobe，合并音视频轨道，保存本地成片并记录合成证据。
- Provider 调用记录净化后的审计状态、幂等键、成本语义、状态和安全错误摘要。

## 素材抽取

- 文本类文件按上传和内容限制解码、规范化。
- PDF 优先使用嵌入文本；图片型页面使用已配置的 OCR。
- 图片使用具备 OCR 能力的视觉服务。
- 音频使用已启用的 OpenAI 兼容转写服务。
- 视频经过探测、时长限制和 FFmpeg 音频转换后送入转写。
- 原始素材保持项目作用域，并纳入安全项目/全量导出策略。

## 可靠性与安全

- 工作流支持暂停、恢复、重试、取消、启动恢复、关闭排空和步骤副作用记录。
- Provider 请求具备超时、有限重试、取消、响应大小限制、安全重定向和 SSRF 检查。
- AI 配置响应、导出、备份、日志和 Provider 错误会脱敏密钥、凭据、URL 签名和嵌套敏感字段。
- 导入导出和素材路径受控，具备归档条目/大小限制、媒体签名检查和失败回滚清理。
- 跨项目素材搜索采用最新请求生效策略；项目导入失败保留净化后的可重试页内反馈。
- 全量备份校验 SQLite 和引用文件；恢复会拒绝在线数据库/端口并保留恢复前回滚副本。

## 验证证据

源码、后端、前端、Docker 和通用 PR/分支门禁固定使用 Node.js 20.x；桌面依赖安装、原生重建、打包和 Windows 制品安全扫描固定使用 Node.js 22.12.0，Electron 运行时自带 Node.js 24。

同一干净源码修订上的完整门禁入口为：

```bash
npm run verify
npm run verify:docker
npm --prefix backend-node audit --audit-level=high --registry=https://registry.npmjs.org
npm --prefix frontweb audit --audit-level=high --registry=https://registry.npmjs.org
npm --prefix desktop audit --audit-level=high --registry=https://registry.npmjs.org
npm run verify:release:source
npm run verify:release:windows
npm run verify:release:artifacts
```

依赖审计必须显式使用官方 npm registry `https://registry.npmjs.org`；已有审计 JSON 若未绑定当前源码 SHA，只能作为历史审计上下文，不能单独写成当前发布通过。根目录没有对应 lockfile 时，不把根目录 `npm audit` 的 `ENOLOCK` 误报为依赖通过或失败。

生产 E2E 必须使用新建的仓库外空数据目录，先执行 `npm run docker:e2e:up` 启动隔离 Compose 与本地 Provider，再执行 `npm run verify:e2e`，最后销毁 E2E profile 和临时数据目录。该命令链及 PowerShell 示例见 [快速开始](quickstart.md#运行方式二docker当前候选部署)。当前候选尚无这次重新执行的 Docker 运行证据。

生产 E2E 覆盖文本、资产/分镜图片、视频、TTS、FFmpeg 合成、桌面视口播放、最终下载、项目导出、注入失败恢复和零残留清理。最终证据应写入 `artifacts/e2e-production/`，并绑定版本 `1.3.3`、完整源码 SHA 和 `working_tree_dirty=false`。

说明性产品报告中的 tracked 截图矩阵为 34 张历史/说明性图片；正式机器证据仍由 acceptance manifest 的合同矩阵生成，目前合同要求 28 张原始 viewport PNG。两者均不能在当前候选未重验时替代 Docker 生产 E2E。

## 无限画布历史失败与候选重验

2026-07-27 的自由画布运行证据记录过来源校验 403、点击「生成配置」时被画布容器拦截、刷新后文本节点未保留浏览器编辑内容，以及画布平移保存超时。它们是历史失败证据，当前代码/契约复审不能替代候选运行复验。

2026-07-23 的生产 E2E 曾在旧源码 SHA `7079fd9fe0d4f62f61430a13a90bd5f49779e6d6` 上生成 28 张截图并报告通过；当前工作区 HEAD 已不同，不能继承该结果。当前候选必须重新执行隔离 Docker E2E、截图哈希校验、清理检查和人工视觉复核后，才能更新发布结论。

## 明确后置边界

### Wikimedia 以外的网络素材与许可判断

Wikimedia Commons 的搜索、作者/许可元数据展示、预览和安全下载已实现。更多第三方素材平台接入，以及针对具体商业、编辑、再发布等用途的自动许可兼容判断后置；使用者仍需自行核对实际用途的许可条件。

### 远端模型发现

AI 配置提供厂商预设、自定义 OpenAI 兼容厂商和手工模型列表。连接测试可以探测配置端点，但当前不实现通用 `/v1/models` 发现或自动导入远端模型目录。

### 移动端与外部 Provider

`1.3.3` 验收范围仅覆盖桌面。移动重排、触控行为、移动画布/列表降级、协作、完整 Agent/MCP 面板，以及每个真实厂商/模型/账号组合的深度验证均后置。

### 桌面签名与其他平台

Windows x64 Setup、Portable 和 unpacked 是当前发布目标。Authenticode 签名、macOS 制品和 Linux 桌面制品后置；macOS 构建脚本会失败关闭，不产出未验证制品。
