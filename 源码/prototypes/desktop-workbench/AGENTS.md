# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Approved design combination — 2026-09-28

The user supplied three boards and approved a combined direction. Do not restart design selection:
- Inspiration: board one, colored entry list + document + related material inspector.
- Materials and books: board two, thumbnail/cover grid + detail inspector.
- Reader: board three, wide document + notes sidebar.
- Share the first board's quiet green/cream visual language and navigation: 灵感、素材、藏书、项目.
- Preserve stable four-color inspiration entry backgrounds; color is not a semantic category or confirmation state.
- Candidate relationships require explicit confirmation. Project goals may be empty; do not generate tasks or statuses.
- This folder is the stage 0 interactive design prototype, not an installed desktop app. Use clearly identified demonstration data and browser-local drafts. Do not read or mutate the Vault from this prototype.
- Source boards in public/references are user-supplied design references. Their small image regions are temporary preview art; do not invent ownership, provenance, or real records from their fictional content.
- Real Electron, PDF, VaultGateway, sync and capture integration belongs to later approved stages. Never label simulated page/text search as working real-PDF support.

## Desktop integration — 2026-09-28

The approved next stage now shares this UI with the packaged Electron application. When `window.mengcang` exists, load DesktopApp with real VaultGateway DTOs and no sample-data fallback. Browser preview remains demo-only. Preserve explicit empty captions separately from list summaries; keep confirmed整理说明 hidden. Treat operation IDs as stable retry identities, never display imported proposal IDs as confirmed relation IDs. Never use generated design-board crops as real assets. Real Vault writes require version checks in the connector, with drafts retained on conflict or disconnect. PDF reader, Notes sync and new automatic snapshot capture remain deferred.

## Desktop workspace interactions — 2026-09-29

The user approved borrowing Obsidian interaction patterns within the existing desktop design. Preserve the four main navigation entries and the approved palette:
- Back/forward restores the previous selection, filters, query and scroll positions within the current session. Opening related content as a preview does not replace the main note or add main history; full-open does.
- Related content opens in a read-only right inspector. Only explicit full-open navigates the main workspace. Merely opening or browsing never confirms a relationship or saves a note.
- Draft state remains visible near the title even when the property editor is collapsed. Distinguish durable local drafts, confirmed Obsidian saves, conflicts and persistence failures. Discard requires an inline confirmation and removes only the local draft.
- Cmd/Ctrl+K searches all loaded inspirations, materials, books and projects, including captions. Keep IME composition separate from Enter-to-open. Raw import payloads and hidden management metadata are not search content.
- The synthetic desktop fixture under tests/fixtures is for regression only and must not enter the production renderer. Do not use it as evidence of a real Vault write.


## Schedule workspace — 2026-09-29

The user approved a fifth 日程 entry with an unscheduled list, selected-day timeline and item inspector. Keep the existing green/cream palette and stable decorative four-color cards. Users explicitly create, schedule, complete, archive or restore each item; a project or inspiration must never generate tasks automatically.
- Carry the same card between list, timeline and completion states. Borrow continuity from the referenced onetake film approach without adding its film-rendering pipeline. Honor reduced motion and stop animations when the page/window is hidden.
- Browser previews use local demonstration data only. The desktop uses the schedule capability and restricted connector endpoint; an old connector must show an unavailable state rather than an empty list.
- Preserve local drafts on conflicts, missing originals and failed reads. A scheduled time change stays a marked draft until explicitly saved. Native note updates require content hashes, stable operation IDs and Vault.process.
- Proposed real-note destination is 03_projects/_schedule/ with one stable UUID Markdown file per item; installing this capability and its production write scope must be confirmed before first use. No recurrence, notification service or external calendar integration is included in this iteration.


## Search-first workspace headers — 2026-09-29

The user requested removing repeated workspace titles and subtitles (灵感、素材、藏书、项目、日程) from the content header. Use each workspace's functional search field in that position, with no duplicate local search underneath. Keep the navigation labels, document/item titles, global search/history controls, filters, date navigation and creation actions. Preserve search accessibility labels and the existing quiet visual style in both desktop and browser preview.

## Work overview — 2026-09-30

Keep five navigation entries. Projects has 工作总览 / 全部项目, with the original read-only project list. Use schedule UUIDs as the sole work-item entities and a single mounted draft/detail workspace for projects and schedule. Focus is an independent local-date dimension and can overlap doing or waiting; recommend three without a hard limit. Waiting in this version means a decision or information needed from the user. Keep action titles, project names and actual manual progress prominent. Do not generate tasks from browsing or show simulated AI progress or project completion percentages.

Schedule schema 2 and `workOverview: true`, `scheduleSchemaVersion: 2` advertise new fields. Version 1 reads with defaults and stays untouched until an explicit version 2 save. Legacy writes to a version 2 record preserve new fields; unsupported connectors keep original schedule functionality and disable new field writes. No bulk migration, registry mutation, external service or automatic completion.


## Sublime discovery visual — 2026-10-02

The user explicitly requested preserving Sublime's original visual for the new discovery feature workspace: white canvas, Control Upright typography with Chinese system fallback, grey text, bright blue/pale blue pill labels, light green main CTA, generous whitespace and a centered reference card surrounded by five existing material cards. This overrides the earlier green/cream palette only while the discovery workspace is open; keep the five established navigation entries and other workspaces unchanged. Search, collections, Canvas, capture, imports and export preview retain their implemented behavior. Demo marketing-reference cards stay browser-only. Desktop cards always come from real loaded DTOs; other material suggestions must not masquerade as confirmed or semantic relationships. Respect reduced motion and hidden windows. Local preview and source integration do not authorize installing or restarting the desktop app.

## 2026-10-03 登录界面复刻与 AI 边界

- 最新目标以 Sublime 登录后的深色卡片详情与资料库为准；`src/sublime/` 保留系统字体、深色卡、浮动导航和原编辑器结构。4190 的白色官网预览保持独立。
- 用户明确要求 AI 功能仅保留，不消耗次数。Insights 五种入口、语义搜索/关联、OCR 均禁止执行；浏览器和桌面 API 的 `ai-policy.cjs` 也拒绝请求。不得因为验证交互而开启 AI。
- 新工作区笔记、附件、收藏和画布保存于按仓库身份划分的本机 IndexedDB；Private 是本机标记，不宣称云端 ACL。原 Vault 记录只读展示，编辑生成本地副本。存入 Vault 由用户在单卡菜单明确提交。
- 第三方账号同步、云端社区/实时协作不冒充实现。导入使用导出文件，不索取第三方 token。只构建源码和本地预览；不自动替换或重启已安装的梦藏应用。

## 2026-10-03 单人资料库范围

- 用户明确不需要协作、账号及通知功能。素材工作区移除协作者、账户头像和Inbox入口，不接用户社区和跨账号权限。备份/导入/主题归入本机工具。
- 保持已批准的Sublime登录态深色视觉；按现有页面完善单人采集、搜索、文件预览、合集、画布、导入导出。分享以离线文件实现，不发布云服务。
- AI相关入口仍保留并暂停。继续沿用本地预览、经检查的源码合并流程，不替换安装应用、不写入真实Vault或重载Obsidian。

## 2026-10-04 独立软件替换

- 用户明确要求用 Sublime 登录态软件界面替换整个梦藏软件，并删除旧应用与梦藏 Dashboard 插件。本轮授权构建、检查并安装独立软件，覆盖之前的禁止安装范围。
- Electron 主界面直接加载 SublimeWorkspace，不保留旧绿/米色侧栏或嵌入式入口。软件独立运行，无需 Obsidian 插件、配对或 Local REST API。保留原 Electron 用户目录、工作区身份和资料文件。
- 本机数据、手工收藏、搜索、卡片、画布、导入导出沿用现有实现。原资料只读展示，只有用户明确选择单卡入库时才创建新 Markdown；不改写旧笔记。
- 继续不提供账号、通知或协作；AI 入口全部暂停。旧程序已移至废纸篓，新程序必须完成独立启动与保存重启检查后再安装。

## 2026-10-04 中文界面

- 用户要求梦藏页面使用中文。导航、按钮、表单、提示、AI 入口及原生菜单使用简体中文，保留 Sublime 登录态视觉。
- 素材标题、正文、来源、已有用户输入保留原文，不自动翻译或迁移资料。内部路由、媒体类型、AI 模式、存储键及交换格式字段保持兼容，只翻译显示标签。
- 固定用语：我的资料库、收藏集、画布、标星／已标星、我的备注、AI 解读；五种解读为核心概述、通俗解释、反向观点、类比说明、鲜明观点。
- 本轮先完成中文页面和原版功能对照清单，AI 仍暂停；只有入口的功能不能标作已实现。

## 2026-10-04 完善单人功能与 AI 接入

- 用户要求实现除账号、通知、协作外的其余功能，沿用独立软件与中文深色视觉。
- AI 通过 API 或 CLI 接入。用户明确选择实际调用前确认；默认关闭，主进程每次生成/转录弹出原生确认，取消不得请求服务或启动 CLI。禁止用真实收费调用做自动验收。
- API 密钥只在应用内填写，通过 macOS 系统加密存储且绑定目的地址；不进入前端状态、日志、聊天或工作区备份。CLI 不执行工具、不读整个资料库，只发送当次选定素材。
- 在线分享与第三方同步本轮限定为本机功能和可发布文件，不公开资料、不部署、不授权账号同步。订阅手动读取公开来源，剪藏从用户当前页导出可见内容后预览导入。
- OCR 与句向量可调用系统本机组件，默认关闭、用户主动启用与运行，不消耗云端次数。所有生成结果、分类建议、识别结果保存均由用户明确提交；原 Vault 不改写。
- 外部 MCP 只读取用户主动导出的选定资料包，不安装旧插件，不启动远程服务，不开放整个资料库。

## 2026-10-04 本机音频转录

- 用户已确认配置本机音频转录：按需启动，完成或失败后退出转录进程、清理临时音频并释放模型内存；不运行常驻转录服务。
- 使用 whisper.cpp 的多语言 large-v3-turbo 和 FFmpeg。运行时固定放在应用资源目录，本机转录连接独立于 DeepSeek 文字／图片连接，不修改其地址、模型或密钥。
- 转录仍需用户逐次确认；本机转录不取 API 密钥、不发送云端请求。只在隔离资料库使用合成音频验收，明确保存和重启读回证据。
- 已授权完成构建、安装及原生检查，保留正式资料与现有设置。音频上传、字幕定位和片段保存沿用既有中文深色界面。
