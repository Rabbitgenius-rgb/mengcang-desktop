# 梦藏 · Mengcang

本仓库以当前梦藏 0.9.0 源码作为唯一开发来源。治理候选版采用独立名称、bundle ID、资料库和桥接目录，供本机验收。

## 构建与检查

需要 macOS 13+、Apple Silicon、Node.js 24+、Xcode Command Line Tools。依赖版本由两个源码锁文件和仓库根工具锁文件固定。

```sh
npm ci
npm ci --prefix 源码
npm ci --prefix 源码/prototypes/desktop-workbench
node 源码/scripts/prepare-bundled-runtime.mjs /path/to/local-transcription
npm run check
npm run candidate
```

转录资源可来自已有本机应用的 `Contents/Resources/local-transcription` 或历史发布包。准备脚本逐文件校验已有清单中的字节数和摘要，然后复制为仓库内的本机资源。独立候选版输出在 `qa/packages/梦藏治理候选-darwin-arm64/梦藏治理候选.app`。

## 预览与验收

`npm run preview` 打开共用界面的 `preview.html`。浏览器预览使用独立资料库，首次为空，可通过正常界面新建卡片。

`npm run acceptance:desktop` 在开发候选版的隔离资料库运行搜索、阅读定位、图片放大、关联笔记、整理和回看验收，并关闭重开读回。该命令会重建自己的测试资料。`npm run acceptance:browser` 检查浏览器新建、刷新读回、收藏集、ZIP导出、键盘和双尺寸布局。

`node governance/attachment-import-acceptance.cjs` 单独测量新附件导入及重启原件读回。旧运行时验收通过 `node governance/legacy-cold-baseline.cjs /path/to/archived-app-resources` 与 `node governance/legacy-runtime-acceptance.cjs /path/to/archived-app-resources` 复核；归档资源是包含 `package.json`、主进程和 `renderer/` 的应用资源目录。以上脚本仅使用各自的 `qa/` 隔离目录。

本轮结果、适用边界及画面见[治理验收记录](验收记录/治理验收.md)。性能使用合成附件测量，应用重开计时从新进程启动至资料库可操作。AI测试采用模拟调用。

## 存储与恢复

v3将卡片、收藏集、画布、备注、草稿和元数据分开保存。桌面附件由主进程按SHA-256管理，浏览器附件保存在IndexedDB Blob。迁移前自动备份并校验v2，连续三次成功启动后提供旧副本手动清理。

完整备份为ZIP，包含清单与原附件。旧JSON继续可导入，也可生成旧版兼容备份。超过旧版256MiB上限时阻止降级，使用v3完整备份恢复。恢复旧版本须包含迁移后新增卡片与修改，具体演练见验收记录。

## 版本来源

- `governance-0.8.6-baseline` 保留原交付快照。
- `governance-0.9.0-import` 保留本轮导入的最新源码。
- `codex/archive-workbench` 保留旧工作台、模型、样式与历史fixture。
- 原 `梦藏-Sublime功能-20261002`、`work/harness-recall-v1-20261024/mengcang` 及旧ZIP登记为历史来源，后续开发在本仓库继续。

历史0.8.6发布包仍可在原GitHub Releases找回。本轮源码与候选版按本仓库的构建及验收记录辨认。
