# 梦藏 · Mengcang

梦藏是一个中文 macOS 个人资料库应用，可收集素材、检索内容、管理收藏集与画布，并通过 API 或 CLI 使用 AI。当前版本为 **0.8.6**，项目快照日期为 **2026-10-05**。

## 下载完整项目

[下载梦藏 0.8.6 项目包](https://github.com/Rabbitgenius-rgb/mengcang-desktop/releases/tag/v0.8.6)

在 Releases 中下载 `梦藏-0.8.6-项目包-20261005.zip`（约 685 MB）和对应的 `.sha256` 文件。这个 ZIP 包含 macOS 应用、源码、完整本机音频转录运行时、使用说明与验收记录。

仓库中的源码可以直接浏览和克隆；完整应用、语音模型与其他较大的运行时文件放在版本附件中。

## 功能范围

- 中文界面，素材卡片、搜索、收藏集、标星、画布与导入导出。
- 本机草稿、恢复记录、保存与重启读回。
- AI 通过 API 或 CLI 接入，每次实际调用前确认；结果由用户决定是否保存。
- 本机 OCR 与向量功能；whisper.cpp 音频转录按需启动，结束后退出。
- 当前单人版本不提供账号、通知、协作。

项目包不包含 API 密钥、个人资料库或应用用户目录。

## 使用与开发

应用面向 **macOS 13.0+ / Apple Silicon arm64**。当前应用采用 ad-hoc 签名，尚未公证；其他电脑的首次启动尚未验收。

完整构建步骤见 [使用说明](使用说明.md)。源码位于 [源码](源码/)，当前独立软件入口为 `源码/desktop/main.cjs` 与 `源码/prototypes/desktop-workbench/src/StandaloneApp.jsx`。

从本仓库开发时，先下载并解压完整项目 ZIP，将其中 `应用/` 放在仓库根目录，供准备脚本复制本机转录资源：

```sh
cd 源码
node scripts/prepare-bundled-runtime.mjs
npm ci
(cd prototypes/desktop-workbench && npm ci)
npm run desktop:build
npm run desktop:package
```

Electron 缓存要求及本机路径配置说明见使用说明。历史原型文档保留在源码中，当前交付状态以这里的说明和 [验收记录](验收记录/) 为准。

## 验证与依赖

0.8.6 已完成 225 项相关检查、隔离资料库保存与重启读回、打包一致性和签名检查。完整 ZIP 已通过 CRC、文件清单 SHA-256、权限、符号链接与独立解压验证。

[文件清单](文件清单.json) 对应完整 ZIP 的原始内容；不用于描述本仓库新增的说明文件。应用中的第三方依赖许可随对应资源保留，本机转录资源许可位于 `应用/梦藏.app/Contents/Resources/local-transcription/`。
