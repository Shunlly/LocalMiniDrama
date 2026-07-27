# LocalMiniDrama Web 前端

Vue 3 桌面 Web，覆盖项目管理、素材中心、项目就绪度、故事素材处理、列表制作和「制作 + 自由」双模式画布工作台，对接 `backend-node`。

**包版本：** `1.3.3` 发布候选（与仓库根目录 [CHANGELOG](../CHANGELOG.md) 一致；不代表已有 `v1.3.3` 正式 Release）

## 主要流程

1. **项目与素材**：从首页创建/导入项目；在素材中心上传可跨项目复用的图片和视频。
2. **项目准备**：详情页汇总 AI 配置、素材、剧集脚本、制作资产、分镜和媒体就绪度，并给出唯一下一步。
3. **故事素材处理**：按「导入素材 → 启动处理 → QA → 修复 → 剧集/时间线」五步执行。
4. **列表制作**：编辑剧本，提取角色/道具/场景，生成分镜、图片、视频并合成成片；不可用动作会显示具体原因。
5. **画布工作台**：同一路由切换制作与自由模式；生产流水线继续共享列表数据，自由层提供五类节点、连线、选择/框选、复制粘贴、历史操作、素材拖入和显式生产引用转换。
6. **AI 配置**：汇总文本、素材图片、分镜图片、视频、TTS 五类服务覆盖和测试状态。

## 自由画布范围

- 自由节点类型为 `text`、`image`、`video`、`config`、`reference`，序列化到 `metadata.free_canvas`；生产图和未知 metadata 保持不变。
- 素材侧栏支持搜索、类型筛选、折叠、上传和拖入；保存失败会保留具体原因并只重试未保存变更，符合资格的本地媒体可保存到素材中心。
- 当前仅覆盖桌面键鼠。移动/触控、新真实 Provider 路由、协作和完整 Agent/MCP 后置；测试使用本地协议兼容服务，不调用外部真实 Provider。
- 实现、产品验收、ZIP 安全以及 E2E 代码/契约复审已完成；真实 Docker 生产 E2E 尚未执行。报告：`http://127.0.0.1:3013/reports/infinite-canvas-20260727/report.html`。

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

请先启动 `backend-node`（如 `http://localhost:5679`），并确保 `vite.config.js` 中 proxy 的 target 与后端一致。

## 技术栈

- Vue 3 + Vite
- Element Plus
- Pinia
- Vue Router
- Axios
- 纯 JavaScript（无 TypeScript）

浏览器烟测脚本为 `npm run e2e:smoke`，需要 `http://localhost:3013` 与 `http://localhost:5679` 已启动。
