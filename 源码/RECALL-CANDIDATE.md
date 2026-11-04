# 梦藏回看接入候选

本目录是隔离源码候选。未安装、替换或重启正式梦藏，未读写真实资料库；真实 Electron 联调由主任务统一进行。

## 已实现

- 仅 `candidate-config.json` 明确提供 `recallBridgeDirectory` 时启动独立 `mengcang` 本机服务；无配置不开放新桥。`userDataPath` 可为候选指定独立绝对目录，在申请单实例锁前设置。
- `capture`、`list`、`get`、`setReview` 由可信主窗口的 workspace session 执行；`status` 只返回就绪状态。新服务不增加 MCP 写工具，不直接改 Vault 或 Chromium 数据文件。
- 收藏将原文、版本化来源、请求回执、已保存状态和“对话回看”收藏集成员关系一次提交；同请求重放返回现有条目，不覆盖用户后续编辑。相同请求标识携带不同内容会失败。
- 来源和回执通过卡片归一化、编辑保留与完整工作区备份/恢复。既有无来源卡片保持原结构。文字长度上限仅对受验证的外部来源卡片放宽到协议要求的 200000 UTF-16 单元。
- 关闭便签不调用删除。归档或取消保存的条目不会通过列表、读取或旧请求重放复活。`due` 初始为 true（待回看），通过 `setReview` 显式修改；重复收藏请求不会重置已修改的状态。
- 工作区切换使旧登记及待处理请求失效；旧 cleanup 不能清除新工作区登记，旧回执不能返回成功。renderer 在事务完成和发送回执前再次核对工作区；若事务已经提交但随后切换，返回可用原请求重试的身份变化错误。
- 新请求在退出时被拒绝，已接收请求参加主进程 pending 等待及原有 renderer 退出保存流程。超时返回未知结果并要求复用原请求，不宣称已保存。
- 外部纯事务使用 `failureOwner: 'caller'`，失败内容由浮窗持久 outbox 保留，不把无编辑输入的桥接错误变成阻碍退出的原生草稿。

## 构建

`node scripts/build-desktop.mjs` 将主进程模块、私有 IPC 传输与来源校验代码打包进 `desktop/build/app/recall-bridge.cjs`，交付不依赖候选外部 shared 路径。构建成功；沿用原项目现有 PDF 分块及体积提示。

主任务会在构建输出写入独立名称、`userDataPath`、`vaultPath`、`recallBridgeDirectory`；本子任务未写正式安装目录。

## 已通过的检查

- 新回看核心/IPC 11 项：原文与来源、原子成员关系、幂等及丢回包、用户后改不覆盖、事务失败无部分写入、归档不复活、选区及长度校验、工作区切换、可信主帧、超时与关闭、协议允许列表。
- 加上 workspace store、persistence、state invariants、backup merge、card editor、renderer quit：117 项通过。
- 编辑导入完整性、已有分析结果保存/回顾：132 项通过，仅模拟数据，无模型调用。
- 既有 MCP bridge/workspace/library、主窗口退出、local gateway、desktop capture：86 项通过。最初沙箱禁止 Unix socket listen；同一隔离测试脱沙箱重跑通过。
- 源码及构建产物主进程语法通过。旧组件测试的注入表补入实际 recallLibrary 以及现有 StarHome 依赖，未修改其断言。
- 竞态修复后专项检查为 16 项；连同备份、状态不变量和退出检查本轮共 62 项通过。覆盖旧 cleanup、新 ready、无 ready 事件的晚回执、同工作区重新登记、提交后切换及同请求幂等恢复；重新构建和产物语法检查通过。

测试命令：

```sh
node --test tests/recall-bridge.test.js prototypes/desktop-workbench/tests/recall-library.test.mjs
node --test prototypes/desktop-workbench/tests/sublime-store.test.mjs prototypes/desktop-workbench/tests/sublime-persistence.test.mjs prototypes/desktop-workbench/tests/sublime-state-invariants.test.mjs prototypes/desktop-workbench/tests/sublime-backup-merge.test.mjs prototypes/desktop-workbench/tests/sublime-card-editor.test.mjs prototypes/desktop-workbench/tests/sublime-renderer-quit.test.mjs
node --test prototypes/desktop-workbench/tests/sublime-editor-import-integrity.test.mjs prototypes/desktop-workbench/tests/sublime-intelligence-persistence.test.mjs prototypes/desktop-workbench/tests/sublime-intelligence-review.test.mjs
node --test tests/desktop-mcp-bridge.test.js tests/desktop-mcp-workspace.test.js tests/desktop-mcp-library.test.js tests/renderer-quit.test.js tests/local-gateway.test.js tests/desktop-capture.test.js
```

## 尚待主任务验收

实际候选 Electron 开窗就绪、真实 Unix RPC 到 IndexedDB 的保存及重启读回、浮窗联动、Harness 来源定位、独立打包，以及最终原始项目未改变检查。上述单元及接口检查不替代这些验收。
