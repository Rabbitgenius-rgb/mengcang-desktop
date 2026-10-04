## 2026-10-03 PDF 摘录与原文件入库增补

- 保留登录态深色卡片与浮动导航；补选文复制、高亮、带页码摘录、跨页检索、缩放和 PDF/Word 本地全文索引。
- 已实操刷新恢复高亮/索引/摘录、返回对应页、附件正文关键词搜索；桌面1250px与手机390px布局检查通过。
- 原文件入库保留字节、MIME、SHA-256与固定路径；新能力协商，旧连接器禁用带附件提交，普通RPC仍保留原大小限制。
- 59项渲染器 + 69项原生/连接器 + 4项Sites包装检查通过；三类构建通过。原文件写入仅在一次性临时仓库测试。
- AI/OCR暂停；协作、账号、通知不加入。源码与本地预览交付，不安装应用、不写真实Vault、不重载Obsidian。
- 完整证据：`verification/reading-ingest-20261003/README.md`，含截图、测试日志与源码同步记录。

# 2026-10-03 Sublime single-user scope — tested; download completion remains unverified

- Retained the approved logged-in dark visual; collaboration, account and notification controls removed by user request.
- Browser access restored. PDF canvas rendering/pages, 390×844 layout, rapid text replacement and draft reload, backup preview/merge/reload, and paused Insights were exercised through the in-app browser.
- Clipboard replacement previously restored a stale selection; corrected and re-tested with exact two-line text after reload.
- Final source/local screenshots at 1250×1000 preserve central card position, text size and dark palette. User-requested local tools and source label differ intentionally from account UI.
- 66 renderer checks and 38 native/boundary checks pass. Production/Sites and desktop resource builds pass. No current browser warning/error.
- Download requests and generated retry links are present, but this browser did not yield a completed download event or saved path. File landing is not marked passed.
- AI entries remain paused. No installed-app update, physical-phone acceptance or real Vault writes are claimed.
- Current report: [single-user verification](/Users/rabbit/Documents/ChatGPT/素材积累/梦藏-Sublime功能-20261002/verification/single-user-20261003/README.md). Historical records below retain their original scope.

---

# 2026-10-03 authenticated Sublime workspace — passed within declared local scope

- Preview: http://127.0.0.1:4191/?view=materials#/card/reference-listening
- User target: logged-in dark card/library interface; retain all AI entries without invocation.
- Status: **passed** for implemented local workflows and desktop/mobile simulated viewports. AI and cloud-service limitations are explicit, not counted as working online features.
- Matched source/local screenshots: ../../verification/auth-replica/source-card-desktop.png and local-card-desktop.png; source-card-mobile.png and local-card-mobile.png. Checked at 1250×1344 and 390×844.
- Browser verified: save, favorite, private mark, note, collection membership, rich text/newline preservation, search/media filters, local file, refresh persistence, import dedupe with source pages, actual JSON download, manual canvas connection and zoom, AI modal on mobile.
- Five Insights modes: zero network requests in dedicated audit; server/native gates reject all AI analysis and OCR.
- Resolved before handoff: off-filter exclusion, annotation export, mixed-block newline loss, async canvas overwrites, draft/history crossover, backup merge race, missing packaged AI policy and source dock icon.
- 35 automated checks pass; production build passes; final UI run has no new console errors; 19 source files synchronized with recoverable backup.
- Remaining boundaries: cloud community/collaboration/account synchronization, URL content extraction, checkout, physical-phone and installed-app acceptance. Original avatar/group counts and onboarding differ from the local reference state. No promise of complete pixel identity or cloned Sublime backend.
- Full report: ../../verification/auth-replica/README.md

---

# Sublime 视觉适配 · 2026-10-02

- **final result: passed**
- 适用范围：梦藏素材发现工作台的白色官网营销视觉适配，以及本轮列出的关键本地交互。
- 本记录由独立代理整理。构建、模型测试与源码核查由本代理完成；浏览器交互证据由主代理实际操作提供。本代理未重新操作浏览器。
- 已完成同尺寸全幅和细节截图对照、真实账号主要流程检查及七路径定向源码同步。passed 仅适用于下列白色官网风格适配和本地检查，不表示登录产品一致。

## 视觉基准与范围

白色基准来自 Sublime 公开官网：纯白画布、Control Upright 字体、灰色文字、亮蓝／浅蓝标签、淡绿色主按钮，以及居中的 reference 卡片和周围五张卡片。中文使用系统无衬线回退字体。原字体文件 SHA-256 为 `c29e41ec4a83c78205104f3271d0c819e0aa5e2b3f45898be61c9f9185ac2523`，与保留的官网字体一致。

样式只在素材发现打开时作用于对应工作台和外壳。搜索结果、收藏集、白板和采集页面沿用相同色彩与字体；原有五个导航入口和其他工作区保留。无查询时展示漂浮卡片，输入查询或选择“浏览全部素材”后恢复功能网格。

原站登录后的产品使用另一套深色资料库界面。当前本地方案适配的是白色官网营销视觉，不能称为“与登录后的 Sublime 产品原视觉一致”，也不能凭营销页推定账号内功能与本地实现相同。已通过真实账号检查确认：本地与登录产品在社区内容、生成式 AI 解读、协作及账号导入上存在差异。详见 [登录实测与复刻差异](../../verification/Sublime登录实测与复刻差异.md)。

示例营销卡片仅属于浏览器隔离预览。Desktop 传入真实读取的 DTO，不使用示例卡片补齐；生产漂浮区优先展示真实关联候选，再展示其他已有素材，并区分 related 与 explore。

## 已有关键检查证据

| 项目 | 本轮已有证据 | 状态 |
| --- | --- | --- |
| 独立构建 | `npm run build` 完成，生成 client、server 与 Sites 配置产物 | 通过 |
| 相关模型回归 | `node --test tests/discovery-model.test.mjs`，8/8 通过 | 通过 |
| 卡片详情 | 主代理打开漂浮卡片详情并返回，核对来源与配文 | 通过（本地） |
| 关键词搜索 | 主代理检索得到 2 张结果卡，使用功能网格 | 通过（本地） |
| 上下文导出 | 主代理核对导出预览中的 PDF 第 2 页、原文和来源；文件实际落盘不据此推定通过 | 通过（本地） |
| 白板 | 主代理核对原有卡片与连线，并缩放至 115% | 通过（本地） |
| 采集页 | 主代理打开采集界面，表单与导入入口保留 | 通过（本地） |
| 数据隔离 | 独立源码核对确认 Desktop 无 demo prop、无示例数据导入，外壳 class 仅绑定 `materials && discoveryOpen` | 通过 |
| 小屏控件 | 子导航间距与关键来源、相似度、导入数据字号已修正；真实文字卡 footer 改为文档流避免覆盖 | 修正后已核对 |

模型测试覆盖收藏集／白板状态、CSV／Kindle 来源与原文保留、导入去重、选定字段导出、同模型同语种余弦检索及 OCR 备选向量。测试不替代真实账号算法、Vault 写入或安装验收。

## 视口与截图

| 检查范围 | 视口／现有证据尺寸 | 证据 |
| --- | --- | --- |
| 桌面漂浮卡片 | 1250×1344 | [sublime-visual-desktop.png](../../verification/sublime-visual-desktop.png) |
| 桌面详情 | 1250×1344 | [sublime-detail-desktop.png](../../verification/sublime-detail-desktop.png) |
| 关键词结果 | 1250×1344 | [sublime-search.png](../../verification/sublime-search.png) |
| 导出预览 | 1250×1344 | [sublime-export-preview.png](../../verification/sublime-export-preview.png) |
| 白板 | 1250×1344 | [sublime-canvas.png](../../verification/sublime-canvas.png) |
| 采集页 | 1250×1344 | [sublime-capture.png](../../verification/sublime-capture.png) |
| 手机首页／周边卡片／详情 | 390×844 | [首页](../../verification/sublime-mobile-top.png)、[卡片](../../verification/sublime-mobile-related.png)、[详情](../../verification/sublime-mobile-detail.png) |
| 更窄手机检查 | DOM 视口 320×760、documentWidth=320；原生可见区截图 320×693，属于局部截图 | [sublime-mobile-320.png](../../verification/sublime-mobile-320.png) |

截图像素尺寸由独立代理读取图片元数据确认。现有 `.png` 文件的编码为 JPEG，展示内容可正常识别；本轮未改写截图。1250×1344 和 390×844 不扩大为所有桌面与手机尺寸的验收。320px 只据 DOM 确认横向宽度和导航可达，不将局部图片记为完整屏幕截图。

公开官网基准：[source-live.png](../../verification/source-live.png)。登录产品参考由主代理另行检查：[资料库](../../verification/sublime-auth-library.png)、[筛选](../../verification/sublime-auth-filters.png)、[卡片](../../verification/sublime-auth-card.png)、[Staff picks](../../verification/sublime-auth-staff-picks.png)、[Insights](../../verification/sublime-auth-insights.png)。这些账号状态证据不改变白色官网适配范围。

## 最终对照与完成边界

- 全幅与细节并排图已检查：[全幅](../../verification/compare-source-preserved.png)、[细节](../../verification/compare-source-preserved-focus.png)。字体、28px 标题、85×25px 标签和配色一致；周边卡尺寸与间距有局部适配，中文描述、保存入口及梦藏外壳属于功能化调整，未声称逐像素一致。
- 修复过手机导航拥挤、关键来源字段过小和 footer 覆盖长文字卡的问题；最终图中 footer 位于卡片之后，本地控制台无 warn/error。
- 七个路径的精确同步清单写于 [visual-sync-plan.json](../../verification/visual-sync-plan.json)。主代理已按清单校验、备份并同步原源；[后检查](../../verification/visual-source-postcheck.json)确认37个已集成路径一致、91个其他基线文件保持原哈希、已安装应用不变。
- 原站模型、排序、云端同步和账号集成功能不能依据当前本地回归声明一致。
- 本轮构建和预览不代表桌面应用已安装更新，也不代表真实 Vault 已写入；不重启现有应用或 Obsidian。

---

以下保留 2026-09-28 原型历史验收记录，其 passed 仅适用于该历史阶段，不代表本轮 Sublime 视觉验收已完成。

# 梦藏阶段 0 · 设计与交互验收记录

- 记录日期：2026-09-28
- **final result: passed**
- 适用范围：当前可交互前端原型的选定视觉组合、已列典型交互与已列视口。
- 证据来源：本轮主代理的浏览器验证记录、当前源码，以及 `qa/` 中的截图与参考对照图。文档整理阶段未重新操作浏览器。

此结论不代表 Electron、Vault、真实 PDF 解析、同步或正式知识库写入通过验收，也不表示网站已经公开发布。

## 视觉基准与适配

| 页面 | 已选基准 | 本轮结论 |
| --- | --- | --- |
| 灵感 | 图 1 左上：列表／正文／相关内容三栏 | 主要组成和层级符合选定方向；保留统一导航 |
| 素材 | 图 2 右上：素材网格与详情 | 1440px 四列、1280px 三列为响应式选择 |
| 藏书 | 图 2 左下：书封网格与阅读入口 | 选中书籍信息与继续阅读入口清楚 |
| 阅读 | 图 3 右下：白纸正文与右侧阅读工具 | 正文、页码与笔记侧栏层级清楚，明确标注阅读示例 |

不同页面统一使用图 1 的导航方向，并依据全宽原型调整留白、字号和栏宽；本轮不要求缩放后的截图逐像素一致。界面控件与文字由前端实现，参考图仅用于图片和书封素材。

## 已验证的典型操作

下表的“通过”指本轮已有浏览器操作结果，不以截图代替状态验证。

| 流程 | 已验证行为 | 结果 |
| --- | --- | --- |
| 灵感筛选与探索 | 参考素材筛选正确；探索草稿切换后保留；保存探索、确认整理并刷新后维持整理状态 | 通过 |
| 灵感候选与项目入口 | 书籍候选关联确认后保留；可从来源灵感创建项目，目标说明允许留空 | 通过 |
| 素材筛选 | 文本类型仅显示对应文本素材；光影标签得到 2 条匹配结果并显示正确详情 | 通过 |
| 素材编辑与预览 | 配文保存后刷新恢复；独立笔记可展开；Obsidian 入口展示未连接状态 | 通过 |
| 藏书筛选 | 想读筛选正确；无结果时隐藏无关详情 | 通过 |
| 继续阅读与页码 | 从藏书进入阅读；页码由 128 跳转至 12 | 通过 |
| 阅读草稿与笔记 | 未保存草稿切换到素材／藏书再返回仍保留；保存笔记后刷新恢复 | 通过 |
| 阅读搜索与缩放 | 当前页搜索“山谷”得到 3 处结果；下一个结果从 1/3 变为 2/3；缩放 100% → 110% → 100% | 通过 |
| 阅读引线 | 确认后刷新仍显示“原型中已确认”；随后可撤回确认 | 通过 |
| 减少动态效果 | 设置开关可切换 | 通过 |
| 手机详情与阅读工具 | 素材详情可返回；阅读工具栏分为两行，侧栏可展开 | 通过 |
| 浏览器日志 | 本轮检查时控制台 error 与 warn 为空 | 通过 |

源码另实现了新建／编辑表单、关系示例移除／恢复及 JSON 草稿导出。未在上表列出的状态组合不单独声称完成了浏览器验收。

## 视口与截图

| 视口 | 检查页面 | 证据 |
| --- | --- | --- |
| 1440×900 | 灵感 | [inspiration-desktop.png](qa/inspiration-desktop.png) |
| 1440×900 | 素材 | [materials-desktop.png](qa/materials-desktop.png) |
| 1440×900 | 藏书 | [books-desktop.png](qa/books-desktop.png) |
| 1440×900 | 阅读 | [reader-desktop.png](qa/reader-desktop.png) |
| 1280×800 | 素材 | [materials-1280.png](qa/materials-1280.png) |
| 390×844 | 灵感 | [inspiration-mobile.png](qa/inspiration-mobile.png) |
| 390×844 | 素材 | [materials-mobile.png](qa/materials-mobile.png) |
| 390×844 | 阅读 | [reader-mobile.png](qa/reader-mobile.png) |

上述视口的本轮布局检查通过。390px 下使用底部导航，阅读页初始收起侧栏并显示双行工具栏；未据此扩大为所有手机尺寸和所有状态的验收。

参考对照图：[灵感](qa/compare-inspiration.png)、[素材](qa/compare-materials.png)、[藏书](qa/compare-books.png)、[阅读](qa/compare-reader.png)。[总览](qa/overview.png)用于快速查看页面组合。

截图记录的是具体时刻，部分页面保留了滚动位置，阅读截图也可能包含操作后的短暂提示；不应将滚动裁切或瞬时提示误判为静态布局缺陷。

## 问题收口

| 级别 | 项目 | 当前状态 |
| --- | --- | --- |
| P1 | 阻断主要浏览或操作的问题 | 当前原型范围内未发现未收口项 |
| P2 | 灵感候选依据与确认／跳过文字偏小、偏淡 | 已调整为 12px 并加深文字颜色 |
| P2 初始疑似项 | 素材详情主图在截图中呈窄条 | 已核实图片尺寸正确；原截图为详情侧栏已滚动状态，排除此项为布局缺陷 |
| P3 | 设计图裁出的图片及书封放大后不够清晰 | 已知源图分辨率限制；后续接入高分辨率原始素材再替换 |

以上收口不改变阶段边界：本地候选确认、整理标记和阅读关系均为原型状态，不写入正式 Vault，不代表自动知识整理或真实 AI 推理已经接入。

## 工程检查与证据边界

- 最终交付目录中的 `npm run build` 已通过；产物为 CSS 59.61 kB、JS 279.48 kB（gzip 86.49 kB），与临时验证副本一致。正式源码目录已启动本机 5209 预览。
- Reader 的 JSX 语法、独立打包与图标导出检查通过。
- `npm run test:sites` 尚未运行，不记为通过。该测试覆盖静态资源、页面回退与打包文件，不替代本轮交互验证。
- 内容与编辑状态保存在当前浏览器。主状态使用 `mengcang-desktop-preview-v1`，阅读草稿和示例状态使用 `mengcang-reader-preview-v1`。
- 保存失败提示及当前会话回退已实现；本轮没有浏览器存储故障注入的验收记录。
- 未进行完整 WCAG 审计、所有键盘／屏幕阅读器组合测试、帧率或长时间性能验收，不能据截图或“减少动态效果”开关推定这些项目通过。
- 没有 Electron 安装包、真实 PDF 渲染与解析、真实 Vault 读写、备忘录同步、跨设备同步或正式生产部署验收。
