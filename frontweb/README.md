# LocalMiniDrama Web 前端

Vue 3 桌面 Web，覆盖项目管理、素材中心、项目就绪度、故事素材处理、列表制作和画布工作流，对接 `backend-node`。

**包版本：** `1.2.8`（与仓库根目录 [CHANGELOG](../CHANGELOG.md) 一致）

## 主要流程

1. **项目与素材**：从首页创建/导入项目；在素材中心上传可跨项目复用的图片和视频。
2. **项目准备**：详情页汇总 AI 配置、素材、剧集脚本、制作资产、分镜和媒体就绪度，并给出唯一下一步。
3. **故事素材处理**：按「导入素材 → 启动处理 → QA → 修复 → 剧集/时间线」五步执行。
4. **列表制作**：编辑剧本，提取角色/道具/场景，生成分镜、图片、视频并合成成片；不可用动作会显示具体原因。
5. **画布制作**：创建内容、工作流和批量生成分组呈现，与列表模式共享数据。
6. **AI 配置**：汇总文本、素材图片、分镜图片、视频、TTS 五类服务覆盖和测试状态。

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
