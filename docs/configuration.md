# AI 配置指南

**导航：[项目主页](../README.md) | [快速开始](quickstart.md) | [English](en.md)**

---

## 目录

- [配置入口](#配置入口)
- [五类核心服务](#五类核心服务)
- [素材抽取扩展](#素材抽取扩展)
- [网络素材（素材中心）](#网络素材素材中心)
- [阿里云 DashScope（通义）](#阿里云-dashscope通义)
  - [申请 API Key](#申请-api-key)
  - [可用模型](#可用模型)
  - [配置示例](#配置示例)
- [火山引擎 Volcengine（豆包）](#火山引擎-volcengine豆包)
  - [申请 API Key](#申请-api-key-1)
  - [可用模型](#可用模型-1)
  - [配置示例](#配置示例-1)
- [本地部署模型（Ollama 等）](#本地部署模型ollama-等)
- [其他 OpenAI 兼容接口](#其他-openai-兼容接口)
- [一键配置功能](#一键配置功能)
- [连接测试](#连接测试)
- [常见问题](#常见问题)

---

## 配置入口

点击软件 **「AI 配置」** 入口，进入 AI 服务管理页面。未配置 API Key 也可以启动软件、浏览界面和跑本地测试；只有真正调用外部模型生成时才需要在本页填写。API 地址与密钥写入本机数据库，不靠环境变量凑合，也不要把真实密钥写进 README、示例文档或 Git 提交。

当前产品覆盖文本、素材图片、分镜图片、视频和 TTS 五类成片服务。PDF/图片 OCR 与音视频转写已作为素材抽取扩展出现在同一页面，可按服务类型筛选、新增、设为默认并做连接测试；它们不计入五类成片就绪条件。厂商预设只用于填表，不等于真实图片/视频/TTS 已接入跑通，也不等于每个云 OCR/Whisper 账号已联调。Wikimedia Commons / Openverse 网络素材在**素材中心**，不是本页配置项。

「AI 服务」页顶部先展示五类核心服务的覆盖摘要，包括默认配置、配置数量和最近/本次连接测试状态；下方配置列表可按服务类型筛选。缺少默认配置时可直接新增或修复默认项，已有配置可直接查看、编辑和测试。

新增/编辑弹窗按基础信息、厂商与认证、高级接口设置、模型和调用策略分组；高级接口设置默认收起。每类服务可独立配置不同厂商和模型，互不影响。

---

## 五类核心服务

| 类型 | 用途 | 推荐服务商 |
|------|------|----------|
| 文本生成 | 剧本生成、角色提取、分镜脚本、提示词优化 | 通义 Qwen、豆包 Pro |
| 文本生成图片 | 角色形象图、场景背景图、道具图 | 通义万象、豆包图片、Agnes Image |
| 分镜图片生成 | 带角色/场景参考图的分镜静帧 | 通义万象、豆包图片、Agnes Image |
| 视频生成 | 分镜视频片段 | 豆包 Seedance（经典单链路或 **Seedance 2.0 多图 / 全能模式**） |
| 语音合成 TTS | 分镜对白与解说配音 | OpenAI 兼容 TTS 或已配置的语音服务 |

页面下拉还有更多厂商预设（Google Gemini、可灵、硅基流动、DeepSeek、OpenRouter 等）。选择预设只会预填公开 Base URL 和常见模型名；下面各节的模型表是填写示例，以页面当前下拉和控制台实际开通的模型为准。

---

## 素材抽取扩展

| 类型 | 用途 | 说明 |
|------|------|------|
| 图片识别 OCR | PDF、扫描件和图片抽文字 | 本机也可安装 Tesseract；未配置时给出中文失败引导 |
| 语音转写 | 音频、视频对白转成文字 | 通常走 OpenAI 兼容 `/audio/transcriptions` |

这两类都在「AI 配置」里填写，属于故事素材抽取扩展，不能替代上面五类成片服务。真实云 OCR/Whisper 账号、额度与长耗时行为仍后置，每个部署需自行连接测试。

---

## 网络素材（素材中心）

从 Wikimedia Commons 搜索公开图片/视频、从 Openverse 搜索公开图片，都在 **素材中心**，不是「AI 配置」里的厂商预设或一键配置项。不要把网络素材写成 API Key / Base URL / 模型名。使用者仍须自行确认许可是否满足具体用途；Openverse 目前只搜图片，视频仍以 Wikimedia Commons 为主。

---

## 阿里云 DashScope（通义）

### 申请 API Key

1. 访问 [阿里云百炼控制台](https://bailian.console.aliyun.com/)
2. 注册/登录阿里云账号
3. 进入「模型广场」，开通你需要的模型（文本类、图片类等）
4. 左侧菜单点击「API-KEY 管理」，创建新的 API Key
5. 复制 API Key（以 `sk-` 开头）

> 新用户通常有免费额度，建议先用免费额度测试。

### 可用模型

以下为页面当前下拉示例，以「AI 配置」和控制台实际开通的模型为准。一键配置的默认模型见 [一键配置功能](#一键配置功能)。

**文本生成（provider `qwen`，一键默认 `qwen-plus`）：**
| 模型名 | 说明 |
|--------|------|
| `qwen-plus` | 一键默认；日常文本 |
| `qwen3.8-max` / `qwen3.8-plus` / `qwen3.8-flash` | 页面下拉中的较新通义文本 |
| `qwen3-max` / `qwen-flash` / `qwen-turbo` | 其他常用文本 |
| `qwen-vl-max` | 视觉理解，不是一键默认 |

**图片 / 分镜图：**
| 模型名 | 说明 |
|--------|------|
| `wan2.6-image` | 通义万象（provider `dashscope`）一键默认，素材图与分镜图各一条 |
| `wanx2.1-t2i-plus` / `wanx2.1-t2i-turbo` | 万象下拉中的其他生图 |
| `qwen-image-max` | 通义千问图像（provider `qwen_image`）一键默认 |
| `qwen-image-plus` / `qwen-image` | 千问图像备选 |
| `qwen-image-edit-plus` 等 | 万象下拉中的编辑类模型，一键不创建 |

**视频生成（provider `dashscope`，一键默认 `wan2.2-kf2v-flash`）：**
| 模型名 | 说明 |
|--------|------|
| `wan2.2-kf2v-flash` | 一键默认 |
| `wan2.6-r2v-flash` / `wan2.6-t2v` / `wan2.6-i2v-flash` / `wanx2.1-vace-plus` | 页面下拉中的其他万相视频 |

DashScope **文本** 与 **图片/视频** 的 Base URL 不同，不要把 compatible-mode 套到万象/万相上：

| 用途 | provider | Base URL |
|------|----------|----------|
| 文本 | `qwen` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 素材图 / 分镜图 / 视频 | `dashscope` 或 `qwen_image` | `https://dashscope.aliyuncs.com` |

页面下拉里还有通义 TTS（如 `qwen3-tts-flash`、`cosyvoice-v2`），**一键配置不创建 TTS**，需在本页单独新增。

### 配置示例

在「AI 配置」页面新增配置：

```
文本：
  服务商：qwen
  Base URL：https://dashscope.aliyuncs.com/compatible-mode/v1
  模型：qwen-plus

图片 / 分镜图 / 视频：
  服务商：dashscope（万象/万相）或 qwen_image（千问图像）
  Base URL：https://dashscope.aliyuncs.com
  模型：wan2.6-image（万象）/ qwen-image-max（千问图像）/ wan2.2-kf2v-flash（视频）

API Key：sk-xxxxxxxxxxxxxxxx
```

---

## 火山引擎 Volcengine（豆包）

### 申请 API Key

1. 访问 [火山方舟控制台](https://console.volcengine.com/ark)
2. 注册/登录火山引擎账号
3. 进入「模型广场」，开通所需模型（文本/图片/视频）
4. 左侧点击「API Key 管理」，创建 API Key
5. 复制 API Key

> 💡 视频生成（Seedance）需要单独开通，且按生成时长计费，注意控制用量。

### 可用模型

以下为页面当前下拉示例。一键默认文本是 `deepseek-v3-2-251201`，图片/分镜图是 `doubao-seedream-4-5-251128`，视频是 `doubao-seedance-1-5-pro-251215`。Seedance 2.0 需手动选模型并配 `volcengine_omni`，一键不会改成 2.0。

**文本生成（provider `volcengine`）：**
| 模型名 | 说明 |
|--------|------|
| `deepseek-v3-2-251201` | 一键默认 |
| `doubao-1-5-pro-32k-250115` | 豆包文本 |
| `doubao-seed-1-6-250615` / `kimi-k2-thinking-251104` | 页面下拉中的其他文本 |

**图片 / 分镜图（provider `volcengine`）：**
| 模型名 | 说明 |
|--------|------|
| `doubao-seedream-4-5-251128` | 一键默认，素材图与分镜图各一条 |
| `doubao-seedream-4-0-250828` / `doubao-seedream-3-0-t2i-250415` | 下拉备选 |

**视频生成（provider `volces`）：**
| 模型名 | 说明 |
|--------|------|
| `doubao-seedance-1-5-pro-251215` | 一键默认 |
| `doubao-seedance-2-0-260128` | Seedance 2.0，方舟多参考图；配合接口规范 **`volcengine_omni`** 与分镜**全能模式** |
| `doubao-seedance-2-0-fast-260128` | Seedance 2.0 快速版 |
| `doubao-seedance-1-0-pro-250528` / `doubao-seedance-1-0-pro-fast-251015` 等 | 下拉中的 1.0 系列 |

> ⚠️ 配置中填写模型名时，系统会自动映射到正确的 API 端点 ID，两种写法均可。页面下拉里还有火山 TTS（`seed-tts-1.0`），**一键配置不创建 TTS**。

**分镜「全能模式」与接口规范（v1.2.5+，v1.2.7 增强校验）：**

- 制作页单个分镜可切换为 **「全能模式」**：中间编辑区为**片段描述**，可用 **`@图片1`、`@图片2`…** 对应参考图顺序（一般为场景 → 角色 → 物品；不含经典分镜中间主图；`@图片N` 后建议加**半角空格**）。若该框有内容，生视频时**只发送这段文本**，不会拼接下方结构化「视频提示词」。
- 在 **AI 配置 → 视频生成** 中，将 **接口规范** 选为 **`volcengine_omni`**（火山即梦 Seedance 2.0 等多图参考）或 **`kling_omni`**（可灵 Omni）。Seedance **2.x** 单段时长由后端吸附到 **4–15 秒**；方舟多图侧最多 **9** 张参考图。
- **v1.2.7**：单条生视频前会检测配置是否匹配（`kling_omni`，或 `volcengine_omni` + Seedance 2.x 模型名）；不匹配时弹窗说明，可选强制继续（降级为场景图 / 分镜主图参考）。**经典模式**无分镜参考图时会提示先生成分镜图，不提供纯文案强行生成。
- 亦可使用 **可灵 Omni** 走同一套全能分镜工作流，详见 AI 配置页内嵌说明。

### 配置示例

```
服务商：volcengine（文本/图片/分镜图）或 volces（视频）
Base URL：https://ark.cn-beijing.volces.com/api/v3
API Key：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
模型：deepseek-v3-2-251201（文本默认）/ doubao-seedream-4-5-251128（图片与分镜图）/ doubao-seedance-1-5-pro-251215（视频默认）
```

**视频生成参数（可选）：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| 分辨率 | `720p` / `1080p` / `480p` | `720p` |
| 视频时长 | 每段分镜的视频秒数（4 / 5 / 8 / 10s） | `5` |
| seed | 随机种子，固定可复现结果 | 随机 |
| camera_fixed | 是否固定摄像机 | `false` |
| watermark | 是否添加水印 | `false` |

---

## 本地部署模型（Ollama 等）

如果你在本机或内网部署了兼容 OpenAI 接口的模型服务（如 Ollama、LM Studio、vLLM 等）：

```
服务商：自定义 / OpenAI 兼容
Base URL：http://localhost:11434/v1   （Ollama 示例）
API Key：ollama   （或任意字符串，本地服务通常不验证）
模型：qwen2.5:7b   （你下载的模型名）
```

> ⚠️ 本地模型仅适用于**文本生成**，图片和视频生成通常需要专用的云端 API。

---

## 其他 OpenAI 兼容接口

任何支持 OpenAI Chat Completions 协议的接口均可接入：

```
Base URL：https://your-api-endpoint/v1
API Key：your-api-key
模型：your-model-name
```

常见兼容服务商：DeepSeek、硅基流动（SiliconFlow）、Groq、OpenRouter、Google Gemini 官方 OpenAI 兼容端点等。Gemini 文本预设对应 `https://generativelanguage.googleapis.com/v1beta/openai`，图片预设对应 Gemini 原生图片模型（不是 Imagen API），视频预设对应 Veo。预设填表后仍须在本页做连接测试，不能写成真实账号已跑通。

---

## 一键配置功能

在「AI 配置」页面顶部填写对应 API Key 后，一键会按当前源码模板批量创建记录。三条一键都 **不创建 TTS**，也不创建 OCR / 语音转写。厂商预设填表不等于真实图片/视频/TTS 接入已跑通；保存后仍须连接测试，并按控制台开通情况改模型名。

| 按钮 | 条数 | 覆盖类型 | 默认模型（各条列表第一条） | Base URL |
|------|------|----------|---------------------------|----------|
| **一键配置通义** | 5 | 文本、素材图（万象）、素材图（千问图像）、分镜图、视频 | `qwen-plus` / `wan2.6-image` / `qwen-image-max` / `wan2.6-image` / `wan2.2-kf2v-flash` | 文本：`https://dashscope.aliyuncs.com/compatible-mode/v1`；图片与视频：`https://dashscope.aliyuncs.com` |
| **一键配置火山** | 4 | 文本、素材图、分镜图、视频 | `deepseek-v3-2-251201` / `doubao-seedream-4-5-251128` / `doubao-seedream-4-5-251128` / `doubao-seedance-1-5-pro-251215` | `https://ark.cn-beijing.volces.com/api/v3` |
| **一键配置 Agnes** | 4 | 文本、素材图、分镜图、视频 | `agnes-2.0-flash` / `agnes-image-2.1-flash` / `agnes-image-2.1-flash` / `agnes-video-v2.0` | `https://apihub.agnes-ai.com/v1` |

通义弹窗标题会标明「不推荐」，按钮文案仍是「一键配置通义」。Agnes 视频接口规范为 `agnes`，endpoint `/videos`，查询 `/videos/{taskId}`。成片仍缺语音合成时，要在本页单独新增 TTS。

---

## 图床配置（v1.2.8+）

部分 AI 接口（如 Gemini 图生、Seedance 2.0 角色认证）需要将本地图片上传到公网图床。可在 `backend-node/configs/config.yaml` 的 `image_proxy` 段配置：

```yaml
image_proxy:
  expire_hours: 2              # 缓存有效期（小时）
  use_for_video: false         # 仅在明确需要公网 URL 时启用
  upload_url: https://your-proxy.example.com/api/upload
  upload_timeout_seconds: 180  # 上传超时（秒），默认 180
  upload_max_attempts: 2       # 失败重试次数
```

`upload_url` 必须由用户显式配置。未配置时不会把本地图片上传到公网图床；需要公网图片 URL 的供应商调用会改用其可用回退方式，或返回明确的配置错误。启用前请确认图床的数据保留与隐私政策。

---

## 连接测试

每条 AI 配置记录右侧有「测试」按钮，点击后会发送一条简短请求验证连接是否正常。测试成功显示绿色提示，失败会显示具体错误信息（如认证失败、模型不存在等），结果也会回显到页面顶部的服务覆盖摘要。

连接测试只证明探针请求可达，不等同于完整生成验收；模型权限、账号额度、输入规格和厂商临时故障仍需在实际生成流程中确认。

---

## 常见问题

### Q: 一键配置之后 TTS 为什么还是空的？

一键通义 5 条、一键火山 4 条、一键 Agnes 4 条，都不创建 TTS。语音合成要在「AI 配置」里按 TTS 服务类型单独新增。一键成功只表示模板已写入本机数据库，不等于真实接入已跑通。

---

### Q: Wikimedia / Openverse 要在 AI 配置里填吗？

不要。网络素材在**素材中心**，不是 AI 配置项。

---

### Q: API Key 填错了或过期了怎么办？

在「AI 配置」页面找到对应记录，点击编辑，修改 API Key 后保存即可立即生效。

---

### Q: 生成图片时提示「image size must be at least 3686400 pixels」

这是火山引擎图片生成 API 的最低像素要求。本系统会自动根据项目设定的画面比例计算合适的分辨率（最低 2560×1440），通常无需手动处理。如果仍然报错，请检查是否配置了自定义的 size 参数。

---

### Q: 视频生成提示「model does not exist」

火山引擎视频模型的 API 端点 ID 与展示名称不同。请确认你已在火山方舟控制台开通了该模型，并使用正确的模型名称。系统内置了常见模型名称的映射，两种写法（展示名 / 端点 ID）均支持。

---

### Q: 生成速度很慢怎么办？

- 图片生成通常需要 15–60 秒
- 视频生成通常需要 1–5 分钟（取决于时长和分辨率）
- 建议使用 `turbo` 或 `fast` 后缀的模型加快速度
- 如频繁遇到 429 限流，系统会自动重试，无需手动干预

---

[← 返回项目主页](../README.md)
