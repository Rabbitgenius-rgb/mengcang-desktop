# 梦藏 · Sublime 功能复刻与接入说明

日期：2026-10-02。范围：此前列出的六项本地功能，保留梦藏现有五个主导航和绿色、米白色视觉体系。

## 交付状态

本轮接入梦藏源代码，提供可运行候选预览；不替换已安装的梦藏，不重启 Electron 或 Obsidian，不向真实 Personal AI OS Vault 写入检查数据。原有 WorkOverview V2 源码保留，不能把整份候选打包直接等同于仅更新本轮功能的正式发布。

浏览器预览：<http://127.0.0.1:4191/?view=materials>。这是隔离资料库，使用六张公开参考素材及合成摘录；其保存、导入、收藏和白板都只操作当前浏览器库。实际 DesktopApp 使用真实 DTO 与配对连接器，不以样例填充真实资料。

## 功能与技术对应

| 功能 | 本地实现 | 验证与差别 |
| --- | --- | --- |
| 语义搜索与图片 OCR | Swift、Apple NaturalLanguage 真实句子向量、Vision OCR、同模型及语言内 cosine 检索；React 维护索引状态 | 原生测试验证无查询词的语义排序和图片文字识别。中文、英文向量可用；不声称跨语言检索。与 Sublime 的检索模型和排序不相同。索引取每张原文/OCR 前 20000 字符；原始资料不改。 |
| 收藏集与一材多藏 | React + schema 校验，同素材路径加入多个收藏集 | 同一张卡片加入两组收藏、刷新恢复已验证。桌面支持状态按 Vault 身份隔离写入 userData；浏览器使用隔离 localStorage。无账户同步和协作。 |
| Canvas 白板 | HTML/SVG 节点、拖动、缩放、键盘移动、手动连线、收藏集增量加入 | 两节点、一连线、移动、缩放和刷新恢复已验证；连线不会自动写为梦藏已确认知识关系。当前支持状态 JSON，不是 Obsidian 原生 .canvas 格式；自由绘画未实现。 |
| 网页与 PDF 摘录 | 粘贴文本/URL/HTML，PDFKit 逐页解析、扫描页 Vision 回退；保存原文、独立配文、来源和页码/位置 | 二页合成 PDF 的第二页逐字摘录、页码 2、独立配文与刷新恢复通过。已有笔记来源受 hash 校验。粘贴链接不自动抓取网页，上传的原 PDF/图片未归档为长期文件链接。 |
| 导入与采集 | CSV/JSON/Markdown/Kindle 文本解析，Readwise CSV 字段映射、内容 fingerprint 去重、稳定 operationId 重试 | 两条 CSV 摘录均保存，原文/配文/12-13 位置保留；重复导入跳过两条。是文件/粘贴导入；Kindle、Readwise、X、Instagram 的账户授权和自动同步未接入。 |
| AI 上下文导出 | 按白名单导出选定资料的 Markdown/CSV/JSON；导出前显示全文，区分原文、配文、OCR | 浏览器导出预览与纯模型内容检查通过。内置浏览器下载事件没有完成凭据，实际文件落盘未确认；不能将请求保存提示当作下载成功。无 ZIP/MCP。 |

卡片动效使用 `motion/react` spring：stiffness 40、damping 14、初始 y=20/scale=.9、0.15 秒递进且最多八阶；遵守减少动态效果、隐藏窗口停止。六张公开参考图完整显示，实际梦藏卡片仅显示实际存在的本地资源。

## 接入位置与数据边界

- `prototypes/desktop-workbench/src/DiscoveryView.jsx` 为四个子视图：发现、收藏集、白板、采集。
- `DesktopApp.jsx` 的素材页新增“打开素材发现”入口，原素材网格继续可用。
- `discoveryModel.js` 集中 schema、导入、去重、导出白名单与检索计算；`discoveryPreview.js` 只供隔离浏览器演示。
- `desktop/main.cjs`/`preload.cjs` 提供分析和支持状态 IPC。状态写入绑定期望 Vault 身份，排队后身份变化不会写入另一 Vault。
- `src/desktop-connector/capture.js` 添加受控采集；目标只在 text/web 卡片目录，独占创建、不覆盖占位、拒绝符号链接。重试保留 operationId，来源笔记版本冲突返回错误。
- 采集笔记字段保留 source_url/source_title/source_note/source_note_sha256/source_page/source_location/excerpt_sha256。正文独立保存，不将用户配文混入原文。
- 已安装连接器如果未声明 capture 能力，界面仅保留本机草稿，不冒充正式保存。

## 构建与测试

macOS 开发预览：

```sh
cd prototypes/desktop-workbench
npm ci
npm run dev -- --host 127.0.0.1 --port 4191
```

`predev` 自动编译本机 helper；需 Xcode Command Line Tools。缓存按源码、工具链、SDK、架构和二进制 hash 校验。编译失败保留旧 helper 并终止新启动；未调用云端 AI。

原生构建：从仓库根目录执行 `node scripts/build-desktop.mjs`。仅构建候选，不代表已经安装；不要覆盖现有连接凭据或真实 Vault。插件源码通过 esbuild 编译检查，但本轮没有加载新插件到真实 Obsidian。

本轮合成/临时 fixture 回归覆盖 capture、connector、gateway、security、source actions、window、discovery IPC、model、native OCR/PDF/语义，以及日程与桥接。原生 OCR 在受限沙箱里可能不能访问系统 Vision 服务；测试执行在已获授权的本机进程中，数据仍为公开参考图和合成 PDF。

## 原站比较的证据限度

公开原站页面可观察，未进入原站已登录资料库，无法核对其私有数据、真实检索结果、同步冲突策略或完整 Canvas 操作。因此本轮结论是“六项本地流程有对应实现”，不是“整个 Sublime 产品、后台和视觉 100% 相同”。已保留梦藏既定视觉，不能把绿色素材工作台称为 Sublime 首页逐像素复刻。

Sublime 官方说明了卡片多收藏、Canvas、OCR/embeddings 搜索和 AI 上下文导出：[官方对照说明](https://sublime.app/compare/arena)。网页/PDF 高亮、来源关系和账户导入见[官方 MyMind 对照](https://sublime.app/compare/mymind)。其计划还列出 MCP、CSV、ZIP 等能力：[官方功能列表](https://sublime.app/pricing)。上述公开说明不披露检索模型或后端架构。

最终自动化回归：113/113 通过，0 失败、0 跳过。分组：connector 17、gateway 19、security 9、source actions 3、window 6、discovery IPC 4、discovery model 8、capture 12、native 4、schedule 22、schedule bridge 9。最终 `build-desktop.mjs` 成功；这些结果不替代已安装应用、真实 Vault 或原站登录态验收。
