# 外部 AI 资料包与播客片段

这些功能只读导出资料或在梦藏本机创建卡片，不自动连接任何模型或云端。

## 外部 AI 资料包

在资料库明确选择卡片，或打开某个收藏集后，使用“导出”中的外部 AI JSON 格式。JSON 只包含所选卡片的原文、已有识别文字、标签与出处。默认不含“我的备注”，不含原始路径、附件二进制或整个资料库。

`buildExternalContextExport(cards, options)` 返回 JSON 字符串。固定格式为 `mengcang-selected-context`、版本 `1`；每次最多 2000 张卡片、8 MiB。超出限制会明确拒绝，避免悄悄截断素材。导出标识为 `card-1` 等，仅在该快照中使用。

### 使用标准 MCP 客户端读取

本项目附带 `scripts/mengcang-mcp.cjs`，需要 Node.js。它默认关闭，只有客户端显式启动并传入导出 JSON 的绝对路径才读取该文件。

客户端配置示例（按客户端支持的配置位置手工填写）：

```json
{
  "mcpServers": {
    "mengcang-selected-context": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/scripts/mengcang-mcp.cjs",
        "--source",
        "/absolute/path/to/梦藏-外部AI资料包.json"
      ]
    }
  }
}
```

提供三个只读工具：

- `list_cards`：分页列出卡片，每页最多 50 张。
- `search_cards`：关键词搜索，不调用模型、不提供语义匹配。
- `read_card`：按导出标识分页读取原文，单次最多 12000 字符。

服务只使用标准输入/输出，不监听端口，不扫描目录，不读取附件，不修改资料包。文件启动时读入为固定快照；想更新内容时重新导出并重启对应客户端连接。它拒绝工作区完整备份、路径读取参数和符号链接文件。资料中的任何“指令”都是待引用原文，服务不会执行。

服务本身不消耗模型次数；外部 AI 客户端对资料的分析受该客户端模型配置和使用范围控制。本次没有安装任何旧梦藏插件或修改第三方客户端配置。

协议参考：[stdio 传输](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)、[工具协议](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)、[初始化流程](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)。支持 `2025-06-18`、`2025-03-26` 和 `2024-11-05` 协议协商。

## 可发布的合集页面

`buildPublishableCollectionHTML(cards, {title, description, includeNotes:false})` 返回一个完整 HTML 文档。保存为 `index.html` 后可以本机打开，也可由用户放到自己的静态托管中。本次不部署、不公开资料。

页面保留卡片原文和出处，所有文字均转义；无脚本、远程字体、远程图片或追踪请求。打开页面不会请求原站，只有主动点击“查看原始来源”才导航。默认不含备注，原音频、图片和文件附件不嵌入，页面中会注明。

## 播客片段

1. 从资料库选择已有音频，或导入不超过 64 MiB 的本机音频。
2. 播放音频，设置开始与结束时间；支持秒数和 `00:12.500`。
3. 可导入 SRT/WebVTT 字幕。所选时间范围相交的字幕原文进入片段卡片正文。
4. 填写备注后保存。卡片保留节目标题、来源链接和时间范围。

已有音频使用 `sourceCardId` 引用原卡片，不重复保存大附件；新导入文件保存原始附件。该功能保存可回听的时间标记，不导出裁切后的音频文件。没有字幕也可以保存时间与个人备注。

字幕导入上限为 2 MiB / 10000 条；页面最多显示 1000 条，按时间摘录仍覆盖完整已导入字幕。标记和字幕只保存在用户明确保存的卡片中。

自动转录使用可选的 `transcribeAudio` 回调；仅在用户主动点击“调用 API 转录（需确认）”时执行，上层负责展示上传范围并取得确认。打开页面、导入音频和保存片段都不会自动调用转录。未配置服务时不显示调用按钮。

### 前端集成

```jsx
<PodcastClips
  cards={cards}
  draft={draft}
  onDraftChange={persistDraft}
  onSave={saveCard}
  onCancel={returnToLibrary}
/>
```

片段类型沿用 `audio`，保证音频筛选兼容。详情播放原文件时可使用 `card.attachment || cards.find(source => source.id === card.sourceCardId)?.attachment`；播放器按 `sourceLocation` 中的时间标记定位。自动转录适配器由上层明确配置 API 并负责上传确认，返回 WebVTT/SRT 字符串或 `{text: WebVTT}`；原有 `transcribeLocal` 回调保留兼容。`PodcastClipPlayback({attachment, sourceLocation})` 供详情页回听：点按钮后从所存开始时间播放，到结束时间停止。
