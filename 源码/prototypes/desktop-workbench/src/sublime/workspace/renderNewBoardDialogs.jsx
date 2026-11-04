import React from 'react';
import { uid } from './constants.js';
import { VAULT_DISCONNECTED_MESSAGE } from './constants.js';
import { download } from './constants.js';
import { inlineWorkspaceAttachment } from '../attachmentStore.js';
import { valueOf } from '../../desktopModel.js';
import { cardCapturePayload } from '../workspaceView.js';
export function renderNewBoardDialogs(view) {
  const { modal, state, connected, api, saving, createBoard, setModal, exportText, copyText, stateRef, commit, onRefresh, notify, setError } = view;
  return (
    <>
      {modal.type === 'new-board' && (
        <form onSubmit={(event) => createBoard(event).catch(() => {})}>
          <label className="sw-field">
            名称
            <input name="name" aria-label="画布名称" placeholder="名称" required autoFocus />
          </label>
          <label className="sw-field">
            从收藏集开始
            <select name="collection">
              <option value="">选择收藏集</option>
              {state.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <p className="sw-muted">画布仅保存在本机，只有你可见。</p>
          <footer>
            <button className="sw-primary" type="submit">
              创建
            </button>
          </footer>
        </form>
      )}
      {modal.type === 'export' && (
        <>
          <p>{modal.count} 张卡片</p>
          <label className="sw-field">
            格式
            <select
              aria-label="导出格式"
              value={modal.format}
              onChange={(event) => setModal((value) => ({ ...value, format: event.target.value, text: exportText(value.cards, event.target.value) }))}
            >
              <option value="markdown">Markdown</option>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="mcp">外部 AI 资料包（JSON）</option>
              <option value="html">可发布资料合集（HTML）</option>
            </select>
          </label>
          <textarea readOnly aria-label="导出预览" value={modal.text} rows={10} />
          <footer>
            <button onClick={() => copyText(modal.text)}>复制</button>
            <button
              className="sw-primary"
              onClick={() =>
                download(
                  modal.text,
                  `梦藏-卡片.${modal.format === 'markdown' ? 'md' : modal.format === 'mcp' ? 'json' : modal.format}`,
                  ['json', 'mcp'].includes(modal.format) ? 'application/json' : modal.format === 'html' ? 'text/html' : 'text/plain',
                )
              }
            >
              下载
            </button>
          </footer>
        </>
      )}
      {modal.type === 'copy' && (
        <>
          <textarea readOnly value={modal.text} autoFocus onFocus={(e) => e.target.select()} />
          <p>按 ⌘C 复制选中的文字。</p>
        </>
      )}
      {modal.type === 'vault' && (
        <>
          <p>将文字、笔记和出处保存为新笔记。原文件选中后另存于仓库的 originals 目录，并记录文件哈希；已有笔记不会被覆盖。</p>
          <blockquote>{modal.card.title}</blockquote>
          {!connected && (
            <p className="sw-muted" role="status">
              {VAULT_DISCONNECTED_MESSAGE}
            </p>
          )}
          {modal.card.attachment && (
            <>
              <label className="sw-menu-row">
                <input
                  type="checkbox"
                  checked={modal.includeAttachment}
                  onChange={(event) => setModal((value) => ({ ...value, includeAttachment: event.target.checked }))}
                />
                同时保存原文件 · {modal.card.attachment.name}
              </label>
              {connected && !api?.captureAttachmentAvailable && (
                <p className="sw-muted">当前连接器尚不支持原文件入库；需要更新连接器。取消此选项可仅保存文字，原文件仍在本机。</p>
              )}
            </>
          )}
          <footer>
            <button
              className="sw-primary"
              disabled={saving || !connected || (modal.includeAttachment && !api?.captureAttachmentAvailable)}
              onClick={async () => {
                try {
                  if (!connected) throw Error(VAULT_DISCONNECTED_MESSAGE);
                  const key = `vault:${modal.card.id}`,
                    operationId = stateRef.current.drafts[key]?.operationId || uid(),
                    payload = cardCapturePayload(
                      modal.includeAttachment && modal.card.attachment
                        ? { ...modal.card, attachment: await inlineWorkspaceAttachment(modal.card.attachment) }
                        : modal.card,
                      {
                        operationId,
                        caption: state.annotations[modal.card.id]?.note ?? modal.card.caption,
                        includeAttachment: modal.includeAttachment,
                      },
                    );
                  const prior = stateRef.current.drafts[key];
                  if (prior?.payload && JSON.stringify(prior.payload) !== JSON.stringify(payload))
                    throw Error('上次请求的内容已变化，请保留这张卡并核对仓库后再新建副本。');
                  await commit({ type: 'draft.set', key, value: { operationId, payload } });
                  const result = valueOf(await api.capture(payload));
                  await commit({ type: 'draft.set', key, value: { operationId, payload, savedPath: result.note?.path || '' } });
                  await onRefresh?.();
                  setModal(null);
                  notify('已保存到梦藏仓库');
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              确认保存新笔记
            </button>
          </footer>
        </>
      )}
      {modal.type === 'about' && (
        <>
          <p>
            此工作区在本机保存笔记、文件、收藏和画布，按当前梦藏仓库身份分别存储。“私密”是本地标记，内容不会自动公开。单附件上限64MiB，本机工作区连同附件的总保存上限256MiB；完整备份也受此上限约束。附件编码会增加体积。
          </p>
          <p>
            关键词搜索、手工收藏与连线不调用 AI。AI 解读与分类支持 API / CLI，默认关闭，启用后点击开始分析即调用。本机
            OCR、语义搜索和关联需在连接设置中手动启用，不使用云端额度。
          </p>
          <p>
            这是单人资料库，不包含账号、通知和协作。Kindle、Readwise、浏览器书签以及社交平台内容可通过导出文件导入。来源订阅支持手动刷新和勾选导入；分享支持独立卡片及可发布
            HTML 合集文件，不自动上传。
          </p>
          <p>
            已有知识库内容只读展示；编辑会创建本地副本，不覆盖原笔记。新卡可单独存入本地资料库。独立软件直接读取文件，不需要 Obsidian
            插件或账号。普通卡片导出不含完整附件；工作区备份只保存本机数据，原知识库请另行备份。
          </p>
        </>
      )}
    </>
  );
}
