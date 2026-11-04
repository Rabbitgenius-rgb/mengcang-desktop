import React from 'react';
import { IconPlus, IconDots, IconUpload, IconSparkles, IconPencil } from '@tabler/icons-react';
import { workspaceReducer } from '.././workspaceModel.js';
import { applyBookCover } from '.././bookCover.js';
import { bookFormat } from '../../reader/readerState.js';
import { articleOriginalLocation } from '.././articleReaderModel.js';
import OriginalPositionStatus from '.././OriginalPositionStatus.jsx';
import { saveOptionsSnapshot, hasSaveOptionsChanges, applySaveOptions } from '.././saveOptions.js';
import { uid } from './constants.js';
import { IconButton } from './WorkspacePrimitives.jsx';

export function useCardActions({
  editing,
  draftKey,
  stateRef,
  commit,
  setEditorDraft,
  navigate,
  notify,
  modal,
  setModal,
  setPopover,
  nativeIds,
  saveOptionDrafts,
  epoch,
  loadedIdentity,
  identityId,
  clipperView,
  perform,
  saved,
  popover,
  share,
  originalPosition,
  startLinkedNote,
}) {
  async function saveCard(value) {
    const now = new Date().toISOString(),
      id = editing && editing.origin !== 'vault' ? editing.id : uid();
    const card = {
      ...editing,
      ...value,
      id,
      path: id,
      origin: 'local',
      sourceCardId: editing?.origin === 'vault' ? editing.id : value.sourceCardId || editing?.sourceCardId || '',
      createdAt: editing?.createdAt || now,
      updatedAt: now,
      tags: editing?.tags || [],
    };
    const actions = [
      { type: 'card.upsert', card },
      { type: 'card.save', id, saved: true },
      { type: 'card.hide', id, hidden: false },
      { type: 'card.favorite', id, value: !!value.favorite },
      { type: 'card.note', id, note: value.caption || '', private: !!value.private },
      { type: 'draft.set', key: draftKey, value: null },
      ...stateRef.current.collections.map((collection) => ({
        type: 'collection.toggleCard',
        id: collection.id,
        cardId: id,
        selected: value.collectionIds?.includes(collection.id) || false,
      })),
    ];
    await commit(actions, editing && editing.origin !== 'vault' ? { editKey: draftKey } : undefined);
    setEditorDraft(undefined);
    navigate('card', id);
    notify('已保存到本机资料库');
  }

  async function saveBookCover(image) {
    const expected = modal.card;
    await commit((latest) =>
      workspaceReducer(latest, {
        type: 'card.upsert',
        card: applyBookCover(
          latest.cards.find((value) => value.id === expected.id),
          expected,
          image,
        ),
      }),
    );
    setModal(null);
    notify('封面已保存');
  }

  async function setBookClassification(card) {
    const type = card.type === 'book' ? 'file' : 'book';
    try {
      await commit((latest) => {
        const source = latest.cards.find((value) => value.id === card.id);
        if (!source || source.origin === 'vault' || !bookFormat(source.attachment)) throw Error('该文件已变化，请重新打开卡片后设置分类。');
        return workspaceReducer(latest, { type: 'card.upsert', card: { ...source, type, updatedAt: new Date().toISOString() } });
      });
      setPopover(null);
      notify(type === 'book' ? '已移到图书' : '已移到文件');
    } catch {}
  }

  async function toggleSave(card, anchor) {
    const base = saveOptionsSnapshot(stateRef.current, card, nativeIds.includes(card.id));
    const initial = saveOptionDrafts.get(card.id) || {
      base,
      value: {
        note: base.note,
        private: base.private,
        favorite: base.favorite,
        collectionIds: [...base.collectionIds],
        newCollectionTitle: '',
        newCollectionId: uid(),
      },
    };
    setPopover({ type: 'saved', cardId: card.id, initial, anchor });
  }

  async function saveCardOptions(card, base, value) {
    const run = epoch.current;
    if (hasSaveOptionsChanges(base, value))
      await commit((existing) => {
        if (run !== epoch.current || loadedIdentity.current !== identityId) throw Error('工作区已切换，未保存到其他资料库。');
        if (base.nativeSaved && !clipperView.current.external.some((x) => x.id === card.id)) throw Error('来源资料暂不可用，请重新打开后保存。');
        return applySaveOptions(existing, card, base, value);
      });
    notify(base.saved ? '保存选项已更新' : '已保存到我的资料库');
  }

  function removeSavedCard(card) {
    perform(
      (current) =>
        [
          { type: 'card.save', id: card.id, saved: false },
          { type: 'card.favorite', id: card.id, value: false },
          ...current.collections.map((collection) => ({ type: 'collection.toggleCard', id: collection.id, cardId: card.id, selected: false })),
          ...(nativeIds.includes(card.id) ? [{ type: 'card.hide', id: card.id, hidden: true }] : []),
        ].reduce(workspaceReducer, current),
      '已从本机资料库移除',
    );
    setPopover(null);
  }

  function arrangeButton(card, compact = false) {
    const inLibrary = saved(card),
      label = inLibrary ? '整理' : '保存',
      size = compact ? 18 : 21;
    return (
      <button
        type="button"
        className={compact ? 'pr-save' : 'sw-save'}
        aria-label={compact ? label + '：' + card.title : label}
        aria-haspopup="dialog"
        aria-expanded={popover?.type === 'saved' && popover.cardId === card.id}
        onClick={(event) => toggleSave(card, event.currentTarget).catch(() => {})}
      >
        <span>{label}</span>
        {inLibrary ? <IconPencil size={size} /> : <IconPlus size={size} />}
      </button>
    );
  }

  function relatedActions(card) {
    return (
      <>
        {arrangeButton(card, true)}
        <IconButton
          label={'AI 解读：' + card.title}
          onClick={(event) => setPopover({ type: 'insights', cardId: card.id, anchor: event.currentTarget })}
          aria-haspopup="menu"
          aria-expanded={popover?.type === 'insights' && popover.cardId === card.id}
        >
          <IconSparkles size={20} />
        </IconButton>
        <IconButton label={'分享：' + card.title} onClick={() => share(card)}>
          <IconUpload size={19} />
        </IconButton>
        <IconButton
          label={'更多：' + card.title}
          onClick={(event) => setPopover({ type: 'more', cardId: card.id, anchor: event.currentTarget })}
          aria-haspopup="menu"
          aria-expanded={popover?.type === 'more' && popover.cardId === card.id}
        >
          <IconDots size={20} />
        </IconButton>
      </>
    );
  }

  async function copyText(text, message = '已复制') {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      setModal({ type: 'copy', text });
    }
  }

  function renderOriginalPosition(card, className = '', label = '原网页定位 ↗') {
    const href = articleOriginalLocation(card.sourceUrl, card.webAnchor);
    if (!href) return null;
    const status = originalPosition.state?.id === card.id ? originalPosition.state.status : '';
    const onOpen = (event) => originalPosition.open(event, card);
    return (
      <>
        <a
          className={className}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-busy={status === 'loading' || undefined}
          onClick={onOpen}
          onAuxClick={onOpen}
        >
          {status === 'loading' ? '正在匹配原文…' : label}
        </a>
        <OriginalPositionStatus card={card} state={originalPosition.state} />
      </>
    );
  }

  function cardActions(card) {
    return (
      <div className="sw-actions">
        <IconButton
          label="更多"
          onClick={(event) => setPopover({ type: 'more', cardId: card.id, anchor: event.currentTarget })}
          aria-haspopup="menu"
          aria-expanded={popover?.type === 'more' && popover.cardId === card.id}
        >
          <IconDots size={22} />
        </IconButton>
        <IconButton label="分享" onClick={() => share(card)}>
          <IconUpload size={21} />
        </IconButton>
        <IconButton
          label="AI 解读"
          onClick={(event) => setPopover({ type: 'insights', cardId: card.id, anchor: event.currentTarget })}
          aria-haspopup="menu"
          aria-expanded={popover?.type === 'insights' && popover.cardId === card.id}
        >
          <IconSparkles size={22} />
        </IconButton>
        {arrangeButton(card)}
        {saved(card) && (
          <button type="button" className="sw-write-linked" aria-haspopup="dialog" onClick={() => startLinkedNote(card)}>
            <IconPencil size={18} />
            写关联笔记
          </button>
        )}
      </div>
    );
  }
  return {
    saveCard,
    saveBookCover,
    setBookClassification,
    toggleSave,
    saveCardOptions,
    removeSavedCard,
    arrangeButton,
    relatedActions,
    copyText,
    renderOriginalPosition,
    cardActions,
  };
}
