# LocalMiniDrama Web 前端

Vue 3 桌面 Web，覆盖项目管理、素材中心、项目就绪度、故事素材处理、列表制作和「制作 + 自由」双模式画布工作台，对接 `backend-node`。

**包版本：** `1.3.3`（与仓库根目录 [CHANGELOG](../CHANGELOG.md) 一致；不是 GitHub Release / tag，也没有把发版合并到 `main`。当前分支和脏工作树不能当作发布完成）

当前从源码或仓库根目录 Docker 运行即可，不要按发版下载使用。前端开发端口 **3013**，代理后端 **5679**。生产 E2E 必须在干净工作树重跑（证据要求 `working_tree_dirty=false`），不要凭历史 SHA 或脏工作树宣称已通过。

## 主要流程

1. **项目与素材**：从首页创建/导入项目；在素材中心上传本地图片/视频，或从 Wikimedia Commons / Openverse 搜索公开媒体、查看作者与许可、预览并下载到项目或全局素材库。Openverse 目前以图片为主，视频请用 Commons。
2. **项目准备**：详情页汇总 AI 配置、素材、剧集脚本、制作资产、分镜和媒体就绪度，并给出唯一下一步。
3. **故事素材处理**：按「导入素材 → 启动处理 → QA → 修复 → 剧集/时间线」五步执行。文本可直接导入；PDF/图片需要图片识别（可本机 Tesseract 或 AI 配置 OCR），音视频需要语音转写配置。OCR/转写是素材抽取扩展，不是成片就绪条件；真实云 OCR/Whisper 账号联调仍后置。
4. **列表制作**：编辑剧本，提取角色/道具/场景，生成分镜、图片、视频并合成成片；不可用动作会显示具体原因。
5. **画布工作台**：同一路由切换制作与自由模式；生产流水线继续共享列表数据，自由层提供五类节点、连线、选择/框选、复制粘贴、历史操作、素材拖入和显式生产引用转换。
6. **AI 配置**：汇总文本、素材图片、分镜图片、视频、TTS 五类服务覆盖和测试状态；OCR 与语音转写属于素材抽取扩展，不计入这五类成片就绪条件。Google Gemini 文本使用官方 Gemini OpenAI 兼容端点，图片预设对应 Gemini 原生图片模型而非 Imagen API，视频预设对应 Veo。厂商预设填表不等于真实图片/视频/TTS 接入已跑通，也不等于每个云 OCR/Whisper 账号已联调；连接测试不能代替深度联调。页面用户可见错误为简体中文。

## 自由画布范围

- 自由节点类型为 `text`、`image`、`video`、`config`、`reference`，序列化到 `metadata.free_canvas`；生产图和未知 metadata 保持不变。
- 素材侧栏支持搜索、类型筛选、折叠、上传和拖入；素材中心还支持 Wikimedia Commons 与 Openverse 网络搜索、作者与许可展示、预览和安全下载入库。Openverse 目前只提供图片，视频仍以 Commons 为主。更多第三方平台接入，以及针对具体用途的自动许可兼容判断仍后置；使用者仍需自行核对实际用途许可。保存失败会保留具体原因并只重试未保存变更，符合资格的本地媒体可保存到素材中心。
- 当前仅覆盖桌面键鼠。移动/触控、协作和完整 Agent/MCP 后置；真实第三方 Provider 的账号、模型、区域、额度、计费及长耗时行为也需要部署后深度联调。仓库测试使用本地协议兼容服务，不调用外部真实 Provider。
- 历史产品验收、ZIP 安全以及 E2E 代码/契约复审只说明对应历史范围。2026-07-27 的报告还记录过来源 403、节点点击被画布拦截、刷新文本不保留和画布平移保存超时，不能替代当前工作树重验。生产 E2E 必须在干净工作树、仓库外空 `LOCALMINIDRAMA_DATA_DIR` 上重跑。报告：`http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`。

## 运行

```bash
# 安装依赖
npm install

# 开发（默认端口 3013，代理到后端 5679）
npm run dev

# 构建
npm run build

# 静态检查、全部测试和生产构建
npm run verify
```

源码前端测试、构建和统一验证使用 Node.js 20.x（不要用本机 Node 24 跑门禁）；桌面依赖安装、原生重建和打包使用 Node.js 22.12.0（`desktop/.npmrc` 启用 `engine-strict`）。请先启动 `backend-node`（如 `http://127.0.0.1:5679`），并确保 `vite.config.js` 中 proxy 的 target 与后端一致。

生产 Docker 不在本目录单独启动。仓库根目录：

```bash
docker compose up -d --build --wait
```

前端生产镜像见 `frontweb/Dockerfile.prod`，固定 Node.js 20，由 Nginx 提供静态页。健康检查是 `http://127.0.0.1:3013/healthz`，代理后端 `/ready`（失败信息为简体中文）。Compose **不挂载应用源码**，改完 Vue 后必须 `--build`。容器级校验从仓库根目录执行 `npm run verify:docker`。`/health` 不是前端健康检查。页面、API 与 CLI 的用户可见错误为简体中文。

生产依赖审计必须显式使用官方 npm registry（不要用 npmmirror 的 audit，会 404）：

```bash
npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org
```

生产 Docker E2E 也不在本目录单独启动；必须在干净工作树、从仓库根目录使用新建的仓库外空 `LOCALMINIDRAMA_DATA_DIR`，按 `npm run docker:e2e:up` → `npm run verify:e2e` 顺序执行，结束后销毁 `e2e` profile 和临时数据。证据要求 `working_tree_dirty=false`。不要凭历史 SHA 宣称当前脏工作树已通过。

## 技术栈

- Vue 3 + Vite
- Element Plus
- Pinia
- Vue Router
- Axios
- 纯 JavaScript（无 TypeScript）

浏览器烟测脚本为 `npm run e2e:smoke`，默认需要 `http://localhost:3013` 与后端 `http://127.0.0.1:5679` 已启动。真实图片/视频/TTS 厂商接入、真实云 OCR/转写账号联调和移动端不在当前完成范围。OCR/转写是素材抽取扩展，正式制作仍以五类服务为成片就绪条件。
