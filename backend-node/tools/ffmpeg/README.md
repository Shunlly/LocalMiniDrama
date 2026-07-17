# FFmpeg 本地目录

可以通过环境变量、系统 PATH 或此目录提供 ffmpeg 可执行文件。仓库不提交媒体二进制；Windows 桌面发布固定使用并校验 `8.1.2`。

## 需要拷贝的文件（Windows）

- `ffmpeg.exe`
- `ffprobe.exe`（若需要探测时长等信息）

从 FFmpeg 官方构建目录的 `bin` 下复制到本目录即可。

## 配置方式

推荐优先设置环境变量：

```powershell
$env:FFMPEG_PATH = "D:\Program Files\ffmpeg\bin\ffmpeg.exe"
$env:FFPROBE_PATH = "D:\Program Files\ffmpeg\bin\ffprobe.exe"
```

也可以手动把 `ffmpeg.exe` 和 `ffprobe.exe` 从同一 FFmpeg 构建目录的 `bin` 文件夹复制到本目录。两者必须版本一致；发布构建还会校验仓库策略中固定的 SHA-256。

## 路径优先级

1. 环境变量 `FFMPEG_PATH` / `FFPROBE_PATH`
2. 当前后端工作目录的 `tools/ffmpeg/`
3. 桌面 exe 同级的 `tools/ffmpeg/`
4. 桌面 exe 同级目录
5. 源码目录 `backend-node/tools/ffmpeg/`
6. 系统 PATH 中的 `ffmpeg` / `ffprobe`
