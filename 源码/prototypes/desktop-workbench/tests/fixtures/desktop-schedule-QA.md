# 日程桌面回归 fixture

Vite 路由：`/tests/fixtures/desktop-schedule.html`。此页预先设置 `window.mengcang`，随后动态加载真实 `src/DesktopApp.jsx`；默认偏好为 `view: schedule`。

所有来源、日程、SVG、保存和连接状态均为虚构。无 Electron IPC、文件 API、真实 Vault、外部应用或业务网络请求。页面内“保存到 Obsidian”在此入口仅表示模拟写入。此 fixture 不能证明真实 Vault 或已安装 Electron 验收。

## 数据与隔离

- 2 条待安排：整理窗边观察线索、读一段缓慢观察手册。
- 今日 09:00–10:00：上午的光影记录。
- 今日 14:00–15:00：午后整理观察笔记。
- 今日 14:30–15:30：重叠的叶影速写，应与上一条重叠显示。
- 今日 07:30–08:00：完成晨间阅读，状态为 `done`。
- 1 条灵感、1 张内联合成 SVG 素材、1 本虚构书、1 个空目标项目，足以检查来源预览与完整打开。
- 首次加载/重置时按 `Asia/Shanghai` 当天生成日期，并以 UTC ISO 字符串储存时间。保留 localStorage 时沿用该组日期与修改；跨日回归请点“重置 fixture 数据”。
- 只使用当前 origin 下 `mengcang:desktop-schedule:20260929:v1:state`、`:drafts`、`:preferences`。与 desktop-interactions fixture 隔离。重置只移除这三个键后重载。
- “新建/更新”仅在成功提交时增加。浏览、来源预览、搜索、切换、输入本机草稿、失败及冲突不增加；幂等重放也不增加。来源笔记写入、草稿写入与打开请求单独计数。

## UI 回归路径

1. 从该路由进入，检查“日程”主导航、待安排区、当天时间轴、上午/下午项与重叠项。切换日期或仅浏览不能增加新建/更新。
2. 新建一条无时间的日程；选择项目、来源，保存应增加新建 1，并出现在待安排。备注是手工输入，不应自动生成内容。
3. 打开待安排项，安排今日起止时间；保存应只增加更新 1，并从待安排移到对应时间。修改标题、备注或完成状态同样为更新。
4. 点击日程来源预览，应打开真实 `RelatedPreview`；原日程保持选中。预览返回、完整打开来源、工作区前进/返回应不提交日程。原图、原书、Obsidian 按钮只记录模拟打开请求。
5. 先输入未提交修改，再点“模拟断线”。保留当前日程和草稿，正式保存应禁用；继续输入仍可保存本机草稿。恢复连接后不自动提交；刷新页面应恢复持久化草稿。
6. 先改日程备注，再点“外部修改选中日程”。默认跟随当前选中；也可用 QA 下拉显式指定已有项。该项 hash 与外部备注会变化，草稿应保留并显示冲突。核对当前版本、保留草稿并采用当前版本后，仍需主动保存。
7. 点“下次保存失败”，随后提交一次日程。只该次失败，新建/更新计数不变，草稿保留；重试成功后计数增加 1。
8. 点“切换旧连接器”。snapshot 去掉 schedules 与 `capabilities.schedule`，日程入口或保存应按产品能力降级，不能把缺失能力解释为空日程并允许提交。点“恢复日程能力”恢复正常。
9. 保存后清草稿、丢弃草稿与新建草稿退出均应支持 `draftSet(key, null)`；不得报空值错误。删除只在 localStorage 成功后更新内存。
10. “收起 QA”可释放高度；工具条的实际高度通过 ResizeObserver 自动给桌面工作区留位，避免遮挡正文。

## 模拟 API 契约

异步方法返回 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`。`scheduleSave` 输入为 `{action, id, operationId, expectedHash, fields}`；`fields` 含 `title, notes, plannedStart, plannedEnd, timeZone, projectId, sourcePath, status`。成功 `data` 为 `{item,operationId}`，完整日程 DTO 位于 `item`。

重复同一 operationId 与完全相同请求，直接返回首次结果，不再次写入；同 operationId 改内容返回 `OPERATION_ID_REUSED`。更新必须匹配当前 hash，创建已有 ID 返回 `CONFLICT`。无效标题、时间范围、时区、状态、项目与来源均不能写入。旧能力、离线与失败开关不执行日程写入。

`window.mengcangScheduleQA.inspect()` 返回只读克隆，含 counters、schedules、drafts、preferences、连接/能力状态与 seedDate，便于自动化核验；应用源码不依赖这个 QA 对象。
