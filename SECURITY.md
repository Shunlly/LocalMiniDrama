# 安全政策 / Security Policy

## 支持的版本 / Supported Versions

当前没有正式支持的 `v1.3.3` 二进制版本：源码与包版本是 `1.3.3` 发布候选，但 Git 尚无 `v1.3.3` 标签或正式 Release。安全报告可以针对当前候选源码提交；修复以可复现的 Git SHA 为边界，不把本地构建的 Setup、Portable 或 Docker 镜像视为正式发布制品。

There is currently no formally supported `v1.3.3` binary. The source and package version is a `1.3.3` release candidate, but Git has no `v1.3.3` tag or formally published Release. Reports may target the current candidate source. Support is scoped to a reproducible Git SHA; locally built Setup, Portable, or Docker images are not official release artifacts.

| 版本 / Version | 支持状态 / Support |
|---------------|-------------------|
| `1.3.3` 候选源码（注明 Git SHA） / candidate source (with Git SHA) | ✅ 接收安全报告；修复进入当前候选 / Reports accepted; fixes target the active candidate |
| `v1.3.0`–`v1.3.2` 标签及更早快照 / tags and older snapshots | ❌ 不提供安全维护 / Not security-maintained |
| 自行构建的二进制或镜像 / self-built binaries or images | ⚠️ 无正式二进制支持；须回溯到源码 SHA / No formal binary support; reproduce against the source SHA |

Docker 可以作为当前候选的部署路径，但本地构建、扫描或运行通过不等于 GitHub 正式发布。正式二进制支持边界只会在同一 SHA 的全部发布门禁通过且 Release 人工发布后建立。

Docker may be used to deploy the current candidate, but a successful local build, scan, or run is not a GitHub release. A formal binary support boundary begins only after all release gates pass for the same SHA and the Release is manually published.

## 报告漏洞 / Reporting a Vulnerability

**请勿通过公开 Issue 报告安全漏洞。**  
**Please do NOT report security vulnerabilities via public Issues.**

### 联系方式 / Contact

如果你发现了安全漏洞，请通过以下方式私下联系我们：  
If you discover a security vulnerability, please contact us privately:

- **GitHub Security Advisory**：打开 [Report a vulnerability](https://github.com/Shunlly/LocalMiniDrama/security/advisories/new)

请附上可复现的 Git SHA、运行方式（源码、Docker 或自行构建）、操作系统、影响和最小复现步骤。日志与截图必须先移除 API Key、令牌、Cookie、签名参数和私有 Provider 地址；不要上传真实项目数据。

Include the reproducible Git SHA, run mode (source, Docker, or self-built), operating system, impact, and minimal reproduction steps. Remove API keys, tokens, cookies, signed parameters, and private provider addresses from logs and screenshots, and do not upload real project data.

### 响应流程 / Response Process

1. 收到报告后我们会在 **3 个工作日**内确认收到
2. 评估漏洞严重程度，制定修复计划
3. 在候选源码中提供修复，或在发布门禁完成后发布新版本，并在 Changelog 中说明（不披露利用细节）
4. 感谢报告者（如果你愿意，会在 Changelog 中致谢）

### 注意事项 / Notes

本项目是**本地优先桌面应用**：SQLite 工程数据和生成文件默认保存在本机，AI API Key 存储在本地数据库。调用用户配置的 AI 服务、图床或中转站时，提示词、参考图和相关素材会发送到对应第三方端点；项目本身不提供托管中转服务。主要安全风险集中在：

- 本地文件读写权限
- 对接第三方 AI API 时的网络请求
- 依赖包的已知漏洞

This is a **local-first desktop application**. SQLite project data, generated files, and AI API keys are stored locally by default. When you call a configured AI provider, image host, or gateway, prompts, reference images, related media, and the credentials required by that endpoint are sent directly to that third party. LocalMiniDrama does not operate a hosted relay service. Security risks are mainly related to local file access, outbound third-party API requests, and known dependency vulnerabilities.
