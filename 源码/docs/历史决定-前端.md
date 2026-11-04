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

## 2026-10-06 备注菜单可辨识性

- 用户要求「添加备注」带图标。更多菜单和已保存菜单使用一致的线描备注图标，沿用相邻菜单项的大小、颜色与文字对齐。

## 2026-10-06 AI 分析流程

- 用户反馈 AI 分析需要确定的步骤太多。从素材进入时默认使用当前素材，隐藏整套工具导航，将更换素材、用量与历史结果放在可展开区域；主要操作显示「开始分析」。继续保留实际 API / CLI 调用前的一次主进程确认，取消不发送；结果自动保留草稿，正式笔记与分类仍手动采用。

- 后续用户明确指认原生「确认本次 AI 调用」弹窗并要求去掉：此最新指令覆盖此前分析逐次确认约定。文字/图片解读与分类由点击「开始分析」直接调用，不再次弹窗；仍不自动运行、不自动重试。音频转录保留原任务确认。macOS 钥匙串授权由用户在系统窗口处理，不能绕过；解密后的密钥仅在主进程存活期间按目的地址和密文版本复用，不写入明文文件，也不返回前端。

## 2026-10-06 关联结果摘要

- 关联想法和语义搜索的结果使用可读摘要：优先备注，再取正文／已提取文字；不重复标题，不显示 Markdown 标记、图片路径或抖音分享口令。清理仅作用于派生显示和本机检索输入，不改写原资料或云端解读原文。
- 同一素材正文相同的本机副本从参考素材的关联结果中排除；不凭同标题或同来源屏蔽不同摘录。分数仍是本机向量相似度，不代表已确认的关系。

## 2026-10-06 卡片正文 Markdown

- 卡片详情、资料库预览与画布共用的只读正文显示应渲染 Markdown 标题、引用、行内代码及内部引用名称，保留列表和安全网页链接。编辑器沿用原始文本及原保存规则；浏览显示不得改写原资料。内部引用显示名称并不宣称实现来源跳转，附件名称不触发自动读取。

## 2026-10-06 笔记阅读与链接整合

- 用户要求优化笔记并整合下方链接区。阅读视图收紧空行与段间距、强调标题和列表字段，收录授权原话置于可展开的收录记录；不改写或删除原文、作者归因及不确定性说明。
- 正文网页来源、内部引用与所在收藏集汇总为「链接与关联」。保留原文中的引用；同 URL 在汇总区去重。内部引用只在当前可见资料中唯一匹配时打开，同名与缺失引用提供查找，不伪造关系或跳往同名的错误资料。其他素材列表不称为已有关联。
- 用户更正目标技能为 answer-with-clarity-zh v31；旧 answer-clearly-zh 不能代替新版。取得并读取 v31 实际文件之前不把旧规则植入 AI 提示词。已有笔记不自动重写，不为验收调用真实模型。

- 已取得并校验用户提供的 answer-with-clarity-zh-v31.zip。v31 表达规则仅接入 API / CLI 的 AI 解读提示词，保留原作者、来源、条件和时间范围；不把旧记录写成当前状态。不改分类 JSON 协议，不全局安装技能，不自动重写已有笔记。原包与校验记录保留在 verification/clarity-v31-20261006/source/。

## 2026-10-14 解读时间与来源保留

- AI 解读输入明确附带收录、创建、修改或标注日期，各日期不等于事件发生时间；状态以材料记录语境表述，不能当作实时进展。日期未知时明确说明。已有生成正文原样保留于结果草稿。
- 新保存的解读笔记附带材料时间范围及原素材的安全网页链接，由程序提取和去重，不依赖模型生成引用。已有笔记不批量重写。
- 已完成解读默认查看或保存，不让旧「开始分析」事件重新请求。主动再次生成置于「更多分析选项」，无需额外弹窗；继续保留处理中的同步锁、无自动重试、保存重试不生成的约束。本轮回归仅使用模拟模型。

## 2026-10-25 独立回看工作台

- 用户要求回看、未读红点、Grill Me 对话和可定制组件库组成独立页面，不嵌入我的资料库卡片界面。无 hash 的桌面默认入口使用 `#/recall`，资料库保留独立往返入口。
- 已读与待回看分别记录：打开摘录后保存已读，回看完成由用户点击。继续使用原事务会话与回看卡片，不复制原文或迁移资料库。
- Grill Me 只发送本次对话及用户主动引用的摘录；点击发送即调用既有AI连接，失败不自动重试。浏览器预览必须标明示例数据和本地追问演示。现有AI密钥、来源边界及无真实收费自动验收约定继续有效。
- 本轮交付为独立预览和新的桌面候选，原候选应用、日常启动入口与正式软件未覆盖。说明和画面在 `../../../workbench-20261025/`。

## 2026-10-25 独立工作台 V2 案例优化

- 用户明确要求使用此前积累的审美案例优化独立页面。V2采用Eames的阅读层级/对象观察框、Dennis的细线目录以及Rabo的总览/细看尺度分工；具体图证与取舍在原 `design-brief.md`。
- 维持回看、红点、Grill Me、组件定制及原事务行为。新增 `src/recall/recallEditorial.css`；旧版页面源文件在 `../../../workbench-20261025/v1/`。
- 本轮只交付V2本机预览。此前生成的桌面候选仍是V1，不把源码/预览变更当作已替换安装版。

- 2026-10-25 用户在预览标注明确移除：顶部“个人工作台 / 回看 / 本地预览”栏、回看页“01 / 回看 A COLLECTION OF THOUGHTS”标签，以及整块推荐摘录/纸张插画区。保留主标题、摘录目录和四项功能，收紧顶部空间。

- 2026-10-25 用户进一步明确：页面只区分已读/未读，不再呈现“待回看/已回看”的筛选、条目标记或完成按钮；筛选为全部/未读/已读，红点表示未读。历史桥接数据保留兼容，界面与统计统一按已读记录判断。

- 2026-10-25 用户明确来源分组按线程：侧栏显示完整来源线程列表，以实例ID与线程ID区分，同名线程不合并；选中项高亮并在列表标题显示线程名。移除“当前对话”标签、右侧提示卡、主题与随手记栏；未打开摘录时列表占满主区。已启用组件改在组件库内“我的组件”中使用，保留配置和内容。

## 2026-10-25 独立工作台 V3 产品界面改版

- 用户明确要求更换当前米白/灰绿配色，并依据本轮展示的 Linear、Readwise Reader、Raycast AI Chat、Capacities 重新设计当前独立页面。该要求仅覆盖 `src/recall/` 工作台，不改变资料库视觉。
- 本轮采用雾白与石墨灰文字，低饱和蓝表示选中/操作，红点仅表示未读。回看直接显示功能标题、线程与紧凑摘录列表，详情按需展开；不恢复用户已移除的介绍横幅、面包屑栏、常驻提示/主题/笔记右栏。
- Grill Me 保留历史对话和底部输入框，对话设置按需展开。组件库区分选择工具的“组件库”和实际使用的“我的组件”；创建后自动进入使用视图，排序针对已启用组件。
- 新样式入口为 `src/recall/recallWorkspace.css`。V2 样式保留未覆盖，V2 JSX 快照在 `../../../workbench-20261025/v2/`。此次交付仍为本地预览，未更新已安装应用。
- 用户随后要求移除侧栏“来源线程”标题和旁边的总数，仅保留下面的全部线程与各线程列表，并收紧对应留白。
- 用户确认“差不多，可以通过了”：当前 V3 独立页面设计（包含上述侧栏精简）作为已确认基准，后续沿用。该确认不扩展为安装版更新或发布授权。


## 2026-10-25 桌面正式接入与真实资料导入

- 用户在验收 V3 后明确要求“接入到桌面，然后导入真实数据”，授权本轮安装与资料合并。已更新 `/Users/rabbit/Applications/梦藏.app`，正式资料目录和 Vault 身份沿用原值。
- 仅导入正式 Harness 实例的 14 条已保存回看，来自 3 个线程；原 ID、正文、来源和事务回执保留。10 条隔离/旧版验收记录留在旧候选目录，不导入浏览器示例数据。
- 实际部署与数据结果在 `../../../workbench-20261025/desktop-integration-20261025/`。该目录私有保存程序/资料回退副本。安装版已展示真实记录，不能继续称本轮仅为预览。
- `desktop/production-config.json` 随正式包配置原 `runtime/bridge`，不覆盖正式 userDataPath/vaultPath；日常启动脚本改为打开正式应用。原候选主程序保留用于回退，不与正式版同时占用此桥接。
- 已完成桌面实际画面、原文及来源对照、收藏重试不重复、32 项相关主进程与 14 项回看模型/事务检查。AI 设置和加密凭据逐文件对照保持原样；未发起真实模型调用。

- 用户指出真实回看中标题和正文重复：仅在显示层拆分。标题等于原文时只显示一份摘录，正文以独立标题开头时摘要省去该前缀；列表与阅读详情共用规则。原记录、来源和事务回执不改写，不按正文相同删除不同收藏记录。


## 2026-10-25 浮窗标题与删除笔记

- 用户更正“就是跟浮窗里的一样”：摘录列表和原文详情默认显示浮窗已有的整理标题／手动标题，下方完整保留原始正文。该要求覆盖此前隐藏重复标题及裁剪正文前缀的显示规则，不再从原文另造标题。
- 主进程仅从既有浮窗缓存读取当前摘录 ID 的标题，复用 sticky-title.cjs 的优先级；缺少缓存时沿用浮窗的短原标题／“回看笔记”回退。不生成主题、不调用模型，不把隔离验收标题送入正式列表。
- 回看列表和详情均提供“删除笔记”。确认后沿用 card.hide 归档事务，保留原文、来源、回执和已读状态，支持立即撤销，也可从资料库“已归档卡片”恢复；取消和 Escape 不修改笔记。
- 已安装至正式梦藏并实际展示 14 条真实摘录的浮窗标题。删除／撤销在浏览器示例及隔离持久化夹具验证，真实资料不做删除验收。程序回退包及画面在 ../../../workbench-20261025/desktop-integration-20261025/titles-delete-20261025/。


## 2026-10-25 添加回看自动去重

- 用户要求以后添加回看时自动去重。同一来源实例／线程内按正文比较，忽略首尾空白及 CRLF/CR 与 LF 的差异；不修改保存的原始正文，不按标题合并，也不跨线程吞并来源不同的内容。
- 去重在 createRecallLibrary 的原 IndexedDB 原子事务内执行，多个新请求并发时复用一个原条目，保留原标题、来源、回执、已读状态及待回看兼容状态。
- 对去重请求逐项持久保存回执别名，确保回执丢失、重启、备份恢复及用户编辑后仍复用原条目；同一请求 ID 被改写继续拒绝。归档条目不会因重试自动复活，提示从已归档卡片恢复。
- 已更新正式安装版；46 项隔离检查通过，新增检查能复现旧实现的重复收藏。通过正式保存入口执行两次新请求，均返回原条目且线程摘录数量保持 5，原文及来源字段未变。结果与程序回退包位于 ../../../workbench-20261025/desktop-integration-20261025/auto-dedup-20261025/。


## 2026-10-25 跨线程去重与主题／标题分离

- 用户明确要求不同线程的相同正文也只收藏一份，覆盖此前“仅同一线程去重”的限制。createRecallLibrary 在整个当前资料库的回看条目中比较正文，继续忽略首尾空白和换行格式，保留首次收藏的原条目、原文、出处与阅读状态。
- 跨线程复用回执单独携带本次请求 ID、完整负载摘要和原条目 ID；浮窗只在该回执与本次请求完全吻合时接受原条目的不同来源。对 Harness 保持原有严格输出格式，不新增未协商字段。
- 用户指出三条不同正文共用“轻快的悲伤”标题。已确认该文字是包含三条摘录的主题名称，不能当作单条笔记标题。桌面仅复用单条独有的缓存／手动名称，多条主题保留原分组；缺少独立名称时以短原标题或原文首句显示标题，不调用模型、不改写原资料或主题缓存。这覆盖此前桌面无条件套用浮窗主题名的规则。
- 已更新正式梦藏及配套浮窗。51 项相关检查通过；通过安装版浮窗执行两次跨线程收藏及两次重试，均复用原条目，Harness 严格格式解析通过，原线程仍为 5 条、原文及出处保持不变。程序回退包与结果在 ../../../workbench-20261025/desktop-integration-20261025/global-dedup-titles-20261025/。


## 2026-10-25 动效预览

- 用户批准列表增删过渡、详情展开和 Grill Me 新回复淡入，要求先打开预览。本轮只交付本地源码和预览；未替换已安装应用。
- React Bits Animated List、Modal Cards、AI Chat 1 的局部机制适配位于 RecallMotion.jsx 和 recallMotion.css。数据沿用原事务，不使用演示自动添条目／复制条目或模拟流式回复。
- 退出条目 inert／aria-hidden；详情 Escape 关闭并返回原按钮，快速重开可接管；仅新 assistant 回复淡入，历史不重播；减少动态模式保留全部内容和操作。
- 构建、25项现有检查、1141／1440实际浏览器路径与降动效检查通过；证据在 ../../../workbench-20261025/motion-preview-20261025/。设计说明记录来源和适配边界。

## 2026-10-25 动效桌面接入与圆角卡片

- 用户明确授权将三个已确认动效接入桌面版，保留真实资料和自动去重。已更新正式 `/Users/rabbit/Applications/梦藏.app` 的界面资源；主进程、浮窗和资料身份沿用原值。上述“仅预览”描述为上一阶段范围。
- 用户随后要求截图中的内容之间留空隙并做圆角。每条摘录改为独立白色卡片，12px 间距、12px 圆角、完整细边框，选中及悬停底色贴合圆角；不按线程合并条目。列表动效继续沿用稳定 ID。
- 更新前正常退出并保留程序和资料回退副本。两次界面更新均在重开前逐文件确认 58 个资料文件未变；重开后 13 条真实摘录的原文、标题、来源、保存时间及兼容状态与更新前快照一致。跨线程相同正文及请求重试均复用原条目，不新增线程笔记。
- 构建与 25 项检查通过；12px 间距／圆角已在浏览器及正式原生窗口看到。真实 Grill Me 未发模型请求，新回复动效使用此前本地示例验证。证据及回退文件在 ../../../workbench-20261025/desktop-integration-20261025/motion-desktop-20261025/。

## 2026-10-25 风格库替换组件库

- 用户明确要求移除 Grill Me，并把组件库改成用于自由调整浮窗样式的风格库，覆盖此前保留这两块功能的界面要求。导航、对话页面、摘录内讨论按钮和旧组件管理入口均已移除；历史 conversations/modules 数据保留兼容，避免阅读状态保存时顺带丢失旧内容。
- 风格库沿用当前雾白／低饱和蓝界面，提供雾白玻璃、暖纸、鼠尾草、淡紫、夜读五个预设，以及背景／文字／强调颜色、背景不透明度、圆角和阴影。先在示例面板与便签中预览，再显式应用到真实浮窗；未应用的修改不会改动浮窗。
- 样式由现有浮窗进程通过同用户私有桥接保存到单独的 recall-appearance-v1.json，原生面板和 Electron 贴出便签消费同一设置。保存失败保留旧值，退出等待风格写入，重启读回；不改写摘录、回执、Vault 或模型设置。
- 已更新正式梦藏、配套浮窗资源及原生界面。62 项相关自动检查和原生自检通过；浏览器验证预设切换、28px 圆角、阴影关闭、应用及刷新恢复，桌面页已读取真实浮窗设置。用户开始操作正式页面后停止切换测试样式，未把真实浮窗换色的人工验收标作已完成。资料比对确认 13 条真实摘录的所有原字段一致，原去重实现继续保留。
- 程序回退包、正常退出后的资料副本及预览画面在 ../../../workbench-20261025/style-library-20261025/。该目录为私有备份，不能发布。


## 2026-10-26 收敛为回看工作台

- 用户最终明确以第一张截图为准：软件仅保留现有回看插件与回看工作台，覆盖此前保留资料库与风格库的页面范围。
- 桌面与默认浏览器入口由 RecallOnlyApp 挂载；线程、搜索、未读/已读、详情、删除和恢复继续使用已有事务与来源协议。资料库、发现、画布、收藏集、风格库及全局 AI 设置不再挂载。
- 删除采用原归档事务，工作台右上角提供已归档筛选及恢复，支持立即撤销。保留其他历史数据和原回执，不为精简界面删除资料、配置或浮窗。
- 现有 Harness 插件、浮窗及私有桥接配置不修改；不发起真实 AI 请求。源码与程序回退副本保存在本轮 Codex 工作区 work/recall-only-installed。


## 2026-11-01 恢复 Sublime 资料库入口

- 用户要求恢复此前的 Sublime 式资料库。桌面入口重新挂载 StandaloneApp，首次进入资料库，恢复网页采集、素材卡片、收藏集、画布、图书阅读和设置的原有入口。
- 回看使用 10 月 26 日版本的 RecallOnlyWorkbench，保留归档筛选、恢复、独立标题、未读状态和现有事务；恢复资料库跳转及原有风格库。保留去重实现、浮窗、主进程、来源协议和资料身份。
- 只更新程序界面，不回滚个人资料、凭据、模型设置或已保存内容。恢复原有网页采集不表示已经提供浏览器扩展；本轮优先完成恢复。
- 已更新并重新打开正式桌面版；主进程等 33 个原程序文件逐项保持一致。更新前后资料库 revision 均为 129，可读卡片 171、收藏集 1、画布 1；实际桌面显示 16 条回看、3 条归档。网页提取、保存与刷新恢复在隔离浏览器预览通过，未向正式资料库加入测试卡片。程序与源码回退副本位于 ../../../../restore-sublime-20261101/before/。

## 2026-11-01 浏览器收录扩展

- 用户要求制作浏览器扩展，网页、文章、图片直接保存到梦藏，并保留现有资料和回看。Chrome/Edge MV3 扩展位于根目录 `browser-extension/`，以固定扩展 ID 通过 Native Messaging 和同用户私有 socket 连接桌面，不开放 HTTP 写入端口。
- 网页保存网址、标题和简介；文章保存主动打开页面的文字正文及段落；图片保存公开 HTTP(S) 地址的原图片附件和来源。另支持选中文字。文章内图片不批量下载，不宣称完整离线网页；不调用 AI、不读取浏览历史或站点凭据。
- 收录复用当前 workspaceSession 原子提交到独立“浏览器剪藏”收藏集，保留既有资料、回看、阅读状态及归档。请求编号和持久回执保证失败重试不会重复新增、覆盖编辑或恢复归档条目。退出等待在途保存及 renderer 持久化确认。
- 已构建并更新本机正式梦藏、注册 Chrome 本机连接；签名验证及实际 host→已打开桌面资料库的只读连接通过。更新前后 revision 均为 129，可读卡片 171（workspace 22 / Vault 149）、收藏集 1、画布 1。未向真实资料库写入测试内容。
- 扩展/安装器、剪藏事务、图片校验、原回看及退出时序检查通过。隔离真实 Native host→Unix socket→dispatcher→workspace session 链路覆盖三种保存与重试；IndexedDB 接口和图片使用隔离夹具，不代表实际 Chrome 保存验收。
- 可加载文件夹及 ZIP 在 `../../../../../交付包/梦藏浏览器扩展-0.1.0`。Chrome 扩展管理页被自动化浏览器安全策略禁止访问，须用户手动启用开发者模式、加载交付文件夹；尚未宣称扩展已在真实 Chrome 中加载或完成实页保存。程序回退副本在 `../../../../browser-clipper-20261101/before/`。
- 随后用户完成手动加载并要求继续实际测试。已在真实 Chrome 的工具栏扩展面板保存网页、文章，并通过网页图片右键菜单保存原图片；来源为 W3 的 `https://www.w3.org/History/1989/proposal.html`。三类各 1 张卡片均已读回并属于“浏览器剪藏”，本次保存验收覆盖上述先前未完成的边界。文章正文 27056 码点，按 Chrome 当时显示的翻译页面内容保存；网页没有 meta 简介，所以简介为空。图卡实际保存 `Image1.gif` 原文件（image/gif，6479 B），MCP 原图读回显示正确图像。
- 此次实测前后可读卡片为 171→174（workspace 22→25，Vault 149），revision 129→132，收藏集 1→2、画布仍 1；抽查两条既有 Vault/本地资料的完整正文、标题和来源均未变。没有删除测试卡片，也未进行本轮重启持久化或所有网站兼容性验收。三项成功截图位于 `../../../../browser-clipper-20261101/chrome-three-saves.png`。

## 2026-11-01 浏览器收录与阅读增强 v0.2

- 用户授权落实图文阅读模式、网页高亮与原文定位、扩展内收藏集／备注／标星，并在完成后检查。文章保存安全结构化区块与取得的本机图片，不执行原网页 HTML、脚本或样式；图片未取得时显示原因。旧纯文字文章继续可读；正文编辑后优先显示新版文字，原始图文快照与图片保留。
- 高亮保留原文、上下文和位置，支持 Reader 内定位及原网页 Text Fragment 定位；重复文字、大小写匹配等无法唯一定位时保守降级，不生成误导链接。选文、备注及原请求编号复用现有 IndexedDB 草稿与保存事务，刷新可恢复；保存失败不清空草稿，退出等待持久化。
- 扩展可多选收藏集、添加本次备注、标星，组织字段与卡片原子保存；旧请求重试兼容，不覆盖后续编辑或恢复归档。默认仍使用 activeTab；网站自动恢复高亮需用户逐站点主动授权，不默认授予全站权限。不调用 AI，原回看功能沿用现有实现。
- 本轮后端 53 项、前端 110 项、扩展 28 项检查通过；独立检查 114 项与这些检查有重叠，不重复相加。真实浏览器隔离夹具已验证图文 Reader、实际拖选后保存备注和标星、刷新后的 IndexedDB 草稿恢复，以及原网页浏览器原生黄色 Text Fragment 定位；不等同于新版 Chrome 扩展对真实网页的端到端验收。
- 最新 app.asar 与 Chrome Native Messaging host 已安装，程序签名验证通过，实际本机连接返回 `{ok:true,ready:true}`。安装前后只读资料库状态均为 revision 132、可读卡片 174（workspace 25／Vault 149）、收藏集 2、画布 1；既有文章已在新 Reader 打开，本轮安装未改写正式资料。正常退出重启后连接与数量复核一致；实际回看工作台仍显示 16 条回看、3 条归档，本轮未打开摘录详情或修改未读状态。
- 初次安装时，已加载的 `交付包/梦藏浏览器扩展-0.1.0` 目录内运行文件升级为 0.2，固定扩展 ID 保持不变；当时尚待用户手动重新加载，未将隔离测试称为新版 Chrome 实页验收。浏览器管理页的自动化安全限制继续遵守。程序回退副本位于 `../../../../reader-clipper-20261101/before/`。
- 后续用户报告已重新加载；实际 Chrome 面板出现新版选项，但收藏集为空且无错误、自动高亮未就绪，响应与旧后台格式吻合，不能据此认定后台已更新。本机已安装 host 的 `collections`、`highlights` 真实只读查询通过。已补上 `uiProtocol:2` 校验：新面板遇旧后台时明确提示更新未生效，拦截收录、设置及重试，保留刷新与旧记录查看；内部页和离线状态仍合法。扩展及独立小补丁复核均为 30/30 通过，0.2 ZIP 与原加载目录同步，旧 0.1 ZIP 保留。该次检查未新增真实测试卡片，当时继续等待用户重新加载后台。
- 随后新版后台实际就绪，已在真实 Chrome 的 W3 文章上通过扩展面板保存文章、网页，通过图片右键保存原图，并实际选中正文保存高亮。正文、来源、备注及“浏览器剪藏”归属均经 MCP 读回；原图 `Image1.gif`（image/gif，6479 B）已读取原像素。扩展“定位”后取消系统选区，高亮仍覆盖原句；重开面板后仍能恢复同一条高亮。正式 Reader 的侧栏星标、备注、图片及文章菜单“取消标星”均已核对。测试后扩展默认标星恢复为关闭，未授权网站自动高亮权限。
- 实页检查发现无 article/main 的页面会把 BODY 当内联块，吞掉标题层级；最小修复仅将 BODY 加入容器集合，增加 H1／段落／图片／H2／段落顺序回归。0.2.1 扩展 31/31 检查与独立针对性复核通过，旧 0.1.0、0.2.0 ZIP 保留。用户重新加载后已再次保存真实 W3 文章，正式 Reader 显示一级／二级／三级标题、原图、“概述”标题以及先前已存高亮；本次修复只影响新收录，不自动改写旧文章。
- 本轮共新增 5 条验收卡片，最终 revision 137、可读卡片 179（workspace 30／Vault 149）、收藏集 2、画布 1；“浏览器剪藏”8 条含此前 3 条与本轮 5 条，“对话回看”仍 16 条，实际工作台仍有 3 条归档。最新验收文章 ID 为 `browser-clip:b43368e7-7323-4906-978b-74e99210dd80`。实际画面在 `../../../../reader-clipper-20261101/installed-rich-reader.png`、`chrome-v021-saved.png`、`chrome-v02-highlight.png`。Reader 原网页链接能打开目标 URL；此次翻译页面冷开后的浏览器原生黄色定位未确认，已通过的是扩展内的定位与恢复，不将链接打开等同于原生定位成功。

## 2026-11-01 浏览器收录 0.2.2

- 新收录保留文章自身的标题、导语、表格与嵌套编号，并跳过隐藏副本。Reader 重选正文保留未提交的备注和标星，长文选区可在当前视口快捷保存。扩展允许解除失效的收藏集选择和放弃失败待办。旧文章继续使用已存快照。
- 已安装扩展在 Chrome 保存网页、文章、原图和选文，正式 Reader 又保存一条带星备注。退出重开后共 184 张卡，原 179 条可读元数据逐项一致，回看 16 条、归档 3 条、未读 5 条。失效收藏集和积压待办使用隔离测试数据。实测范围与画面见 `../../../../clipper-fixes-20261101/verification.md`。

## 2026-11-01 文章配图与个人库相关资料

- 梦藏供用户个人使用。卡片底部最多显示三条自己已保存的相关资料，并说明关联原因；不引入公共推荐。剪藏说明以浏览器扩展直存为主，旧书签及文件导入继续可用。
- 文章配图可直接收藏为独立图卡，保留原图、图片网址及来源文章位置。正式桌面版用 W3 文章第 2 张图验证了收藏、从文章底部打开图卡、返回正文原位置以及重启后读回；重复点击没有新增副本。
- 实测仅新增一张图卡；重开后共 185 张，原有 184 张卡片的可读元数据逐项一致，原有收藏集、画布和回看状态保持不变。

## 2026-11-01 资料库主搜索

- 关键词无结果时才显示「按意思找」，复用原输入与当前类型、标星和收藏集筛选，只查询本机。图片结果使用已保存的缩略图；已收藏的来源文章可直接打开，无法唯一确定时保留原网页出处。
- 正式安装版实测「早期互联网那张用线连起来的示意图」首条为万维网概念图；图片打开 Image1.gif，出处打开《万维网的最初提案，HTML化》，返回保留结果。原库 185 条资料的可读元数据一致，回看 16 条（5 未读，3 归档）。

## 2026-11-01 扩展截图与剪藏后相关资料 0.3.0

- 扩展支持保存当前网页可见画面、在冻结预览中框选保存，保留页面标题、网址和截图范围说明。复用原图片事务与待办重试；不扩展浏览器权限。保存成功后显示最多三条本机相关资料，关联范围和打开目标由已提交回执限定。
- 正式 Chrome 扩展已实测可见区域、键盘框选、普通网页保存以及点击推荐打开原库概念图。正常退出重开后共 188 张（新增两张截图和一张网页），原 185 张可读元数据一致；工作区原完整卡片、注释、收藏归属、画布、草稿和回看读状态均与安装前快照核对一致。回看仍为 16 条、5 未读、3 归档。自动检查 182 项通过；实测画面和原安装备份位于 `../../../../screenshot-related-20261101/`。

## 2026-11-01 卡片底部相关资料双列浏览

- 用户授权按 Sublime 参考改成双列图文卡片、类型与关联范围筛选、每次增加 6 条。只使用自己的已保存可见资料；默认每个规范化网页或来源只显示一条，可主动进入“同一来源”查看其他独立素材。不同摘录不因同名删除。
- 正文预览、来源和本机图片均由已保存资料派生；打开原卡片并返回保留当前筛选及展开数量。关闭窗口后的浏览视图无需持久化，不写个人资料或回看状态。
- 实测放开分页暴露本机嵌入的弱关联过多，已在此浏览区去除整理说明与文件名干扰、校正共同向量方向并要求具体内容依据；语义不足时允许少量或空结果，不用不相关资料填满。主搜索与扩展原匹配流程保持原行为。
- 已安装正式桌面版并实际验证 W3 截图默认同源只占 1 条、同源 6→11 条、图片筛选 4 条、空结果与重置、打开 Image1.gif 并返回保留筛选。隔离浏览器验证跨来源 6→12 条、双列布局及展开后的返回恢复；正式库未写测试卡片。相关检查 46 项、导航与回看等回归 40 项通过。
- 更新后可读卡片仍为 188、revision 153，188 条元数据与两个收藏集均一致，原完整工作区存储字节一致；正式回看仍为 16 条、5 未读、3 归档。正式画面与原始程序回退副本在 `../../../../related-browser-20261101/`。本轮未更新扩展，无需重载。

## 2026-11-01 保存面板、相关卡片操作与原卡片入口

- 按用户追加的 Sublime 截图，统一主卡片和相关卡片的保存面板：备注、多选收藏集、新建收藏集、私密标记和标星在点击保存后一次提交。已在库中的卡片显示“已保存”，编辑整理选项不复制卡片；私密是本机标记，资料仍只保存在本机，不代表云端访问权限。
- 相关卡片悬停或键盘聚焦显示保存、解读、分享和更多工具条，操作绑定对应卡片。分享沿用离线卡片导出，解读沿用现有菜单。滚过原卡片后左上角显示其缩略入口，点击回到当前资料原位置，不切换卡片或改动浏览历史。
- 保存事务保留原正文、图片、出处与其他整理状态；并发备注修改或资料已被移除时拒绝覆盖。未提交表单仅在当前工作区会话内暂存，不改原有持久草稿。无变化的已保存表单不写库。
- 53 项针对保存事务、相关浏览、导航、持久化和回看的检查通过；隔离浏览器实测新建收藏集、私密与标星、保存后刷新恢复、不同卡片备注独立、四个操作入口及缩略返回。正式桌面版已更新，原 34 个非界面程序文件及本机连接保持一致，未修改浏览器扩展。
- 正式版实测 W3 网页截图添加备注并标星、提交后读回、再恢复为空备注和未标星。相关选区卡片的保存、解读、分享和更多菜单目标正确；原图缩略入口能返回当前截图。此次没有调用 AI 或向外分享资料。188 条可读元数据逐项保持一致，收藏集仍 2 个，回看仍为 16 条、5 未读、3 归档；revision 因保存与恢复从 153 到 155。安装前程序和资料备份及两张正式实测截图在 `../../../../save-panel-20261101/`。

## 2026-11-02 Sublime 界面对齐

- 用户批准深色外观、统一图文卡片、800px 图片详情、600px 居中文章与底部相关/高亮、紧凑保存面板、来源及收藏集胶囊、五种相关排序和筛选浮层。只使用个人库；浅色/系统选项、主搜索、按意思找、现有资料与回看保留。
- 已实现并安装新的渲染器。相关区域按来源先选最相关代表项再排序，每次增加6条；筛选草稿独立于已应用条件。筛选浮层 portal 到工作区顶层，修复1024宽度下被固定头部遮住的问题。图片支持放大、Esc关闭及焦点返回。
- 88项相关、保存、阅读、导航、主搜索与回看回归通过。隔离浏览器已实测备注/收藏集/新建收藏集/标星提交及刷新读回、无结果提示、相关6→12条及返回恢复、类型与同源筛选、清除应用、原图放大、返回来源配图、高亮切换与句段定位；1440/1280/1024宽度无横向溢出。
- 用户允许原文稿目录访问后，在安装版“本机工具”将主题改为深色。关键词和“早期互联网那张用线连起来的示意图”均找到 W3 概念图，图卡可放大、打开原网页、跳回文章原配图并定位本人已保存的高亮。桌面实测同源默认 1 个代表项、展开 6→9 条、“最近更新＋图片”4 条，进入图卡后返回仍为 4 条；收藏集“浏览器剪藏”显示 16 条。正式版的已保存面板沿用原卡片。
- 回看工作台实测全部摘录 16 条、5 未读，切换归档显示 3 条，返回正常。通过应用菜单正常退出并重开，188 张可见卡片的 ID 和元数据、2 收藏集及成员、1 画布的节点和连线均与更新前一致。47 张完整工作区卡片含 11 张带附件，正文、附件、标星、备注和回看记录逐项相同。39 项草稿只有 appearance 从 light 变为 dark，revision 155→156。概念图原始 GIF 的 6479 字节一致。
- 程序、原 Info.plist 及 IndexedDB 备份位于 `../../../../sublime-align-20261102/before/`，同目录上级保存 `aligned.asar`、`desktop-concept.png` 和 `desktop-related-filtered.png`。34 个非渲染器程序文件保持一致。恢复应用时只恢复程序及签名，不覆盖资料库。
- 另用相同渲染器与独立测试库实测保存：为已有卡片写入备注、新建并加入收藏集、标星后提交，再修改备注后关闭而未提交。正常退出重开，首次提交的三项均可读回，库内仍只有原先的 1 张卡片。验收副本已正常退出。正式版重开后又验证了 Esc 从放大图返回原图按钮焦点。

## 个人资料的出处与正文定位 — 2026-11-02

- 相关卡片的来源标题独立于卡片主体。有明确本机来源时进入该文章，并尽可能定位到原句或原图。保留原网页入口，仅在个人资料库内匹配。
- 文章底部“本文收藏”按卡片创建时间混排本人的摘录与配图，桌面并排显示。摘录即使恰好和标题相同也要展示原句，备注单独展示。同一网页的截图不因 URL 相同而成为文章配图。
- 详情放大使用已有原图，从详情显示尺寸的两倍起步，保留拖动、全图和 Esc 返回。此次调整只更新渲染器。
- 安装版已用 W3 概念图及其来源文章实测相关卡来源、摘录/第二张配图定位、图片细看与全图切换。正式库“本文收藏”并排呈现 1 图和 1 条原句，备注独立。118 项回归通过。188 张可见卡片、2 个收藏集及成员、1 个画布及节点/连线与更新前相同，原工作区数据逐字节相同。回看实测全部 16、未读 5、已归档 3。

## 个人关联笔记 — 2026-11-02

- 保留“已保存”面板的随卡备注。在本人资料详情的同一工具栏提供独立的“写关联笔记”，提交一次产生一张可按标题和正文检索的本机文字卡。笔记绑定具体来源卡的 ID，来源标题相同或网址相同也不合并。文章标题下列出关联笔记，笔记详情直接返回来源，或在来源已归档时提示其不可见。
- 正式桌面验收采用万维网概念图关联的 W3 文章。提交“万维网概念图的链接（实测笔记）”后按正文“概念连线回读”检索命中 1 条，已分别实测双向跳转。正式库 revision 195→196，仅新增该笔记；原文和备注、原卡数据和附件、收藏集、画布、回看均与安装前实际基线一致。本轮程序回退包与验收资料在 work/linked-notes-20261102。

## 主搜索方式切换 — 2026-11-02

- 在个人资料库、已标星和收藏集里，输入文字后可在“关键词 / 按意思找”之间切换。两种方式沿用当前查询、收藏集、类型和标星条件；本机语义搜索比较该范围内所有已保存、未归档的资料。返回结果时保留搜索方式。
- 安装版实测：在图片中搜“圆圈和箭头”，从 1 条关键词结果直接切换，语义首条是万维网概念图，打开为原附件 Image1.gif，带来源文章。“浏览器剪藏 / 图片”中“万维网”的结果从 4 条切至 5 条，切回仍为 4 条；独立收藏的概念图未混入。88 项回归通过。189 张可见资料、2 个收藏集及成员、2 个画布及内容与开始时一致，原工作区数据未改；回看实际显示全部 16、未读 5、已归档 3。本次程序回退和桌面验收图在 work/search-modes-20261102。

## 原网页入口去重 — 2026-11-02

- 卡片具备有效网页文字定位时，详情只显示“原网页定位”，不再额外显示直达同一网页的域名按钮；没有可用位置时保留原来源网址。文章阅读页自身来源入口及更多菜单中的原网页入口不变。文本定位依赖原网页是否仍能匹配所保存的文字。
- 构建与 78 项卡片、阅读、相关资料和回看检查通过；已安装桌面版，更新前后可读资料数和工作区 revision 未变。本轮原程序备份位于 work/source-link-dedupe-20261102/before。

## 中文摘录跳转英文原文 — 2026-11-02

- 点击中文摘录的“原网页定位”时，读取原来源的公开网页，只传已有网页地址；在本机以已收藏文章快照、唯一摘录、前后独特的数字和专名以及相同的段落顺序交叉确认对应段落。多份可用快照必须给出同一结果；缺少足够证据、网页变化、抓取失败或正文截断时显示失败提示和普通来源入口，不猜测位置。英文及原文一致的定位维持原有行为；不写入卡片、注释、收藏集或回看。
- 已在安装版用“本提案涉及欧洲核子研究中心……”真实摘录点击定位，Chrome 新标签收到英文文本片段并停在该段；因 Chrome 当前自动翻译，画面显示中文。同一链接在独立英文页面滚到对应段落并高亮首句。实际画面及可回退程序位于 work/cross-language-position-20261102。
- 101 项定位、阅读、相关资料、搜索和回看检查通过。验收前后原有 48 条完整工作区卡片、其附件和备注、收藏集原成员、画布及回看状态一致；可读 Vault 元数据一致。验收期间库新增一条 W3 网页剪藏和一份文章高亮草稿，均保留；原有回看为 16 条、5 未读、3 归档。

## 仅收藏中文摘录时的原文定位 — 2026-11-02

- 没有可用的已收藏文章时，使用摘录自身保留的网页前后文、原网页及摘录中未翻译的专名/数字进行本机交叉匹配。只在前后上下文均有唯一、互相印证的线索，且中间只有一个符合摘录线索的英文段落时定位；上下文缺失、重复、顺序不一致或网页截断均提示无法可靠定位，保留打开原网页的入口。仅向原站请求已有来源 URL，不上传用户摘录。
- 已在独立桌面验收副本中使用一个只有该中文高亮、没有整篇文章的资料库实际点击定位；Chrome 收到英文文本片段并停在万维网提案对应段落。隔离副本与正式资料库分开。104 项相关检查通过；正式桌面版已更新，原 190 条可读资料、收藏集、画布及 IndexedDB 工作区数据与退出前一致，回看资料保留。更新前未提交的文章高亮草稿已在重开后恢复。

### 中文摘录借助已配置 API 定位英文原文

- 先尝试原文和本机线索匹配。需要翻译时复用 AI 连接，原生确认只发送选中的中文摘录。英文原句从刚读取的来源页中选取，卡片会临时显示这句话。重复、冲突或证据不足时保留普通来源入口。
- 159 项相关检查通过。在没有文章的独立桌面资料库验证单条中文摘录后，经用户明确授权，在已安装的正式版用 DeepSeek 实测「圆圈、节点与链接」。生成及云端计数各 1 次，Chrome 和英文 W3 页面均显示目标段落。正式库从 190 条变为 191 条，除新摘录外，原工作区卡片、附件、备注、草稿、收藏集和画布逐项一致。回看共 16 条，5 条未读，3 条归档。旧程序与实测截图保存在 work/no-landmarks-position-20261102。
