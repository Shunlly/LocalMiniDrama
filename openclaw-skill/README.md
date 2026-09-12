# LocalMiniDrama OpenClaw Skill

让用户通过 OpenClaw（小龙虾）自然语言控制 LocalMiniDrama，完成 AI 短剧从剧本到成片的全流程。

## 版本

`1.1.1` — 与当前后端路由同步，使用逐分镜图片/视频任务和 episode finalize 合成链路，修复场景、上传、合成状态和 AI 配置调用，并收紧远程访问安全说明。

## 安装

### 方式一：本地安装

```bash
# 复制到 OpenClaw workspace skills 目录
cp -r ./openclaw-skill ~/.openclaw/workspace/skills/local-mini-drama
```

### 方式二：发布到 SkillHub / ClawHub（后续）

```bash
skillhub publish ./openclaw-skill
```

## 配置

### 本机使用（推荐）

```bash
openclaw skill config local-mini-drama --set base_url=http://127.0.0.1:5679
```

### 远程使用

LocalMiniDrama 后端没有内置 HTTP 用户认证，**禁止直接向公网暴露 5679 端口**。远程 OpenClaw 必须通过带访问控制的私有 VPN，或通过同时启用认证和 TLS 的反向代理访问；代理仍只应转发到服务器本机的 `127.0.0.1:5679`。确认 OpenClaw 能完成身份认证后，才把 `base_url` 设置为受保护的 `https://drama.example.com`。

### 可选配置

```bash
# 默认画面比例（16:9 横屏 / 9:16 竖屏 / 1:1 方形）
openclaw skill config local-mini-drama --set default_aspect_ratio=9:16

# 默认项目单个视频片段时长（秒），对应 metadata.video_clip_duration
openclaw skill config local-mini-drama --set default_video_clip_duration=5
```

旧版 `default_video_duration` 配置继续兼容，但已弃用。Skill 按 `default_video_clip_duration` → `default_video_duration` → `5` 的顺序取值，并始终写入后端的 `metadata.video_clip_duration`。

## API 契约要点

- 创建项目读取响应的 `data.id`，并把它作为后续请求的 `drama_id` 上下文。
- 异步任务创建响应从 `data.task_id` 取任务 ID；查询任务后读取 `data.id`，其中 `data.result` 是 `null` 或需要解析的 JSON 字符串。
- 项目单片段时长写入 `metadata.video_clip_duration`；分镜生成的 `video_duration` 表示总时长，逐分镜视频请求的 `duration` 才表示该片段时长。
- 提示词覆盖请求体字段是 `content`。`bulk-update-key` 仅限厂商锁定模式，调用前先查询 `GET /api/v1/ai-configs/vendor-lock`。
- 角色提取的 `outline` 是显式提取输入；`episode_id` 只重建分集角色关联，且请求不支持 `count`。

## 使用方法

在 OpenClaw 中对话即可触发：

| 用户输入 | 触发动作 |
|---------|---------|
| "帮我创建一个仙侠短剧" | 创建项目 + 生成剧本 |
| "生成一个都市爱情短剧，讲述..." | 完整流程：创建+剧本+角色+分镜+图片+视频 |
| "生成本集分镜" | 为当前集数生成分镜 |
| "批量生成图片" | 限流并行提交每个分镜的图片任务 |
| "批量生成视频" | 限流并行提交每个分镜的视频任务 |
| "合成这集视频" | 触发视频合成 |
| "这集做好了吗" | 查询合成进度 |
| "给李逍遥生成一张图" | 使用已保存外观生成角色四视图 |
| "导出这个工程" | 导出 ZIP |
| "我有篇小说，帮我制作短剧" | 小说导入 + 生成 |
| "配置一下通义千问" | AI 配置管理 |

## API 覆盖范围（v1.1.1）

| 模块 | 覆盖情况 |
|------|---------|
| 剧集（Drama）CRUD | ✅ 完整 |
| 剧本生成（同步返回/异步任务）| ✅ 完整 |
| 角色管理 + 生成 | ✅ 完整 |
| 场景管理 + 生成 | ✅ 完整 |
| 道具管理 + 生成 | ✅ 完整 |
| 分镜生成 + 管理 | ✅ 完整 |
| 图片生成 | ✅ 完整 |
| 视频生成 | ✅ 完整 |
| 视频合成 | ✅ 完整 |
| 工程导入导出 | ✅ 完整 |
| 小说导入 | ✅ 完整 |
| AI 配置管理 | ✅ 完整 |
| 全局设置 | ✅ 完整 |
| 角色库/场景库/道具库 | ✅ 完整 |
| 异步任务查询 | ✅ 完整 |

## 文件结构

```
openclaw-skill/
├── SKILL.md       # Skill 主文件（包含 YAML frontmatter 和完整 API 指令）
├── skill.json     # Manifest 清单
├── tools.json     # 工具定义
└── README.md      # 本说明文件
```

## 与 v1.0.0 的主要变化

1. **修复 API 路径**：所有路径补全 `/api/v1` 前缀
2. **新增 trigger 词**：从 5 个扩展到 30+ 个
3. **新增 AI 配置管理**：支持配置、保存后连接测试和密钥管理
4. **新增角色/场景/道具库**：全局素材库管理
5. **新增工程导入导出**：ZIP 工程文件
6. **新增小说导入**：从小说文本自动生成剧集结构
7. **新增分镜高级操作**：优化提示词、超分、帧提示词、批量推断摄影参数
8. **完善异步任务轮询策略**：明确轮询间隔和超时处理
9. **新增 skill 配置项**：`default_aspect_ratio`、`default_video_clip_duration`，并兼容旧键 `default_video_duration`
10. **v1.1.1 路由审计**：删除已下线/假成功端点，改用生产生成链路，并禁止公网直接暴露未认证后端
