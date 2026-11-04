import React from 'react';
import { MEDIA } from './constants.js';
import { SORTS } from './constants.js';
import { MEDIA_LABELS } from './constants.js';
import { initialFilters } from './constants.js';
import { valueOf } from '../../desktopModel.js';
import PodcastClips from '../PodcastClips.jsx';
export function renderPodcastDialogs(view) {
  const {
    modal,
    api,
    transcribePodcast,
    podcastResultDrafts,
    podcastResultIsDurable,
    persistPodcastTranscript,
    podcastRequests,
    recoverPodcastTranscript,
    libraryCards,
    state,
    savePodcast,
    filterDraft,
    noteDraft,
    collectionQuery,
    identityId,
    saveDraft,
    setModal,
    setFilterDraft,
    filters,
    setFilters,
    commit,
    notify,
    setNoteDraft,
    setCollectionQuery,
    collectionTargets,
    perform,
    navigate,
  } = view;
  return (
    <>
      {modal.type === 'podcast' && (
        <PodcastClips
          transcribeAudio={api?.intelligenceRequest ? transcribePodcast : undefined}
          getTranscriptionStatus={api?.intelligenceStatus ? () => api.intelligenceStatus().then(valueOf) : undefined}
          transcriptionDrafts={podcastResultDrafts()}
          isTranscriptionDurable={podcastResultIsDurable}
          onPersistTranscription={persistPodcastTranscript}
          transcriptionActive={[...podcastRequests.current].some((key) => key.startsWith(identityId + ':'))}
          onRecoverTranscription={recoverPodcastTranscript}
          cards={libraryCards}
          draft={state.drafts.podcastClip}
          onDraftChange={(value) => saveDraft('podcastClip', value)}
          onSave={savePodcast}
          onCancel={() => setModal(null)}
        />
      )}
      {modal.type === 'external-ai' && (
        <>
          <p>先在资料库或收藏集中选择卡片，导出“外部 AI 资料包”。只包含明确选中的正文、来源和标签；默认不含个人备注、原文件路径或附件。</p>
          <p>只读 MCP 工具可提供列表、关键词搜索和单卡读取。它只读取你指定的资料包，不接触整个资料库。</p>
          <p>
            在支持 MCP 的工具中配置命令 node，参数为梦藏应用内的 mengcang-mcp.cjs 路径、--source、资料包路径。选择资料包和接入工具后才会向该工具开放所选内容。
          </p>
          <code>/Users/rabbit/Applications/梦藏.app/Contents/Resources/app.asar.unpacked/mengcang-mcp.cjs</code>
          <p>资料合集也可导出为单个 HTML 文件，供你检查后自行发布；梦藏不会自动上传。</p>
        </>
      )}

      {modal.type === 'filters' && (
        <>
          <label className="sw-field">
            排序
            <select aria-label="排序" value={filterDraft.sort} onChange={(e) => setFilterDraft((v) => ({ ...v, sort: e.target.value }))}>
              {SORTS.map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label className="sw-menu-row">
            <input type="checkbox" checked={filterDraft.inLibrary} onChange={(e) => setFilterDraft((v) => ({ ...v, inLibrary: e.target.checked }))} />
            仅我的资料库
          </label>
          <label className="sw-menu-row">
            <input type="checkbox" checked={filterDraft.favorite} onChange={(e) => setFilterDraft((v) => ({ ...v, favorite: e.target.checked }))} />
            已标星
          </label>
          <p>素材类型</p>
          <div className="sw-filter-grid">
            {MEDIA.map((media) => (
              <label key={media}>
                <input type="radio" name="media" checked={filterDraft.media === media} onChange={() => setFilterDraft((v) => ({ ...v, media }))} />
                {MEDIA_LABELS[media]}
              </label>
            ))}
          </div>
          <p className="sw-muted">
            “最相关”按关键词匹配排序；“标星优先”按本机标星排序。关键词没有命中时可以在结果页点「按意思找」，也可从资料库选项打开语义搜索。
          </p>
          <footer>
            <button onClick={() => setFilterDraft({ ...initialFilters, query: filters.query })}>清除</button>
            <button
              className="sw-primary"
              onClick={() => {
                setFilters(filterDraft);
                setModal(null);
              }}
            >
              应用
            </button>
          </footer>
        </>
      )}
      {modal.type === 'note' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await commit([
                { type: 'card.note', id: modal.card.id, note: noteDraft, private: state.annotations[modal.card.id]?.private || false },
                { type: 'draft.set', key: `note:${modal.card.id}`, value: null },
              ]);
              setModal(null);
              notify('备注已保存');
            } catch {}
          }}
        >
          <textarea
            aria-label="我的备注"
            rows={7}
            value={noteDraft}
            onChange={(e) => {
              setNoteDraft(e.target.value);
              saveDraft(`note:${modal.card.id}`, { note: e.target.value });
            }}
            autoFocus
          />
          <footer>
            <button className="sw-primary" type="submit">
              保存备注
            </button>
          </footer>
        </form>
      )}
      {modal.type === 'bulk-collection' && (
        <>
          <input
            className="sw-field"
            aria-label="搜索收藏集"
            placeholder="搜索收藏集…"
            value={collectionQuery}
            onChange={(e) => setCollectionQuery(e.target.value)}
          />
          {state.collections
            .filter((c) => c.title.toLowerCase().includes(collectionQuery.toLowerCase()))
            .map((collection) => (
              <label key={collection.id} className="sw-menu-row">
                <input
                  type="checkbox"
                  disabled={!collectionTargets.length}
                  checked={collectionTargets.length > 0 && collectionTargets.every((id) => collection.cardIds.includes(id))}
                  onChange={(e) =>
                    perform(collectionTargets.map((cardId) => ({ type: 'collection.toggleCard', id: collection.id, cardId, selected: e.target.checked })))
                  }
                />
                {collection.title}
                <small>{collection.cardIds.length}</small>
              </label>
            ))}
          {!state.collections.length && <p>没有找到收藏集</p>}
          <button onClick={() => navigate('edit-collection')}>新建收藏集</button>
          <footer>
            <button className="sw-primary" onClick={() => setModal(null)}>
              完成
            </button>
          </footer>
        </>
      )}
    </>
  );
}
