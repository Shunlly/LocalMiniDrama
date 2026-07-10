# 安全政策 / Security Policy

## 支持的版本 / Supported Versions

我们只对最新发布版本提供安全修复。  
Security fixes are only provided for the latest release.

| 版本 / Version | 支持状态 / Support |
|---------------|-------------------|
| 最新版 / Latest | ✅ 支持 / Supported |
| 旧版本 / Older  | ❌ 不支持 / Not supported |

## 报告漏洞 / Reporting a Vulnerability

**请勿通过公开 Issue 报告安全漏洞。**  
**Please do NOT report security vulnerabilities via public Issues.**

### 联系方式 / Contact

如果你发现了安全漏洞，请通过以下方式私下联系我们：  
If you discover a security vulnerability, please contact us privately:

- **GitHub Security Advisory**：打开 [Report a vulnerability](https://github.com/xuanyustudio/LocalMiniDrama/security/advisories/new)
- **微信 / WeChat**：通过 README 中的二维码添加作者微信私信

### 响应流程 / Response Process

1. 收到报告后我们会在 **3 个工作日**内确认收到
2. 评估漏洞严重程度，制定修复计划
3. 修复完成后发布新版本，在 Changelog 中说明（不披露细节）
4. 感谢报告者（如果你愿意，会在 Changelog 中致谢）

### 注意事项 / Notes

本项目是**本地优先桌面应用**：SQLite 工程数据和生成文件默认保存在本机，AI API Key 存储在本地数据库。调用用户配置的 AI 服务、图床或中转站时，提示词、参考图和相关素材会发送到对应第三方端点；项目本身不提供托管中转服务。主要安全风险集中在：

- 本地文件读写权限
- 对接第三方 AI API 时的网络请求
- 依赖包的已知漏洞

This is a **local-first desktop application**. SQLite project data, generated files, and AI API keys are stored locally by default. When you call a configured AI provider, image host, or gateway, prompts, reference images, related media, and the credentials required by that endpoint are sent directly to that third party. LocalMiniDrama does not operate a hosted relay service. Security risks are mainly related to local file access, outbound third-party API requests, and known dependency vulnerabilities.
