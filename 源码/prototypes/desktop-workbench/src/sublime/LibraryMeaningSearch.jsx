import React, {useLayoutEffect, useRef, useState} from 'react';
import {IconArrowUpRight, IconSearch} from '@tabler/icons-react';
import {valueOf} from '../desktopModel.js';
import {rankLocalMaterials} from './intelligenceHelpers.js';
import {imageResultSource} from './localMaterialSearch.js';
import './libraryMeaningSearch.css';

export function ImageResultSource({card, library, onOpen}) {
  const source = imageResultSource(card, library);
  if (!source) return <small className="ms-no-source">未记录来源</small>;
  const label = <>{source.label} · {source.title}</>;
  if (source.cardId) return <button type="button" className="ms-source" onClick={() => onOpen(source.cardId)}>{label}<IconArrowUpRight size={13} aria-hidden="true"/></button>;
  if (source.url) return <a className="ms-source" href={source.url} target="_blank" rel="noopener noreferrer">{label}<IconArrowUpRight size={13} aria-hidden="true"/></a>;
  return <small className="ms-no-source">{label}</small>;
}

// A scope is one submitted phrase and its personal-library filters. The gateway
// may refresh equivalent card objects while an on-device request is running.
export function useLibraryMeaningSearch({scopeKey, query, getCards, cache, api}) {
  const inputs = useRef(null);
  inputs.current = {query, getCards, api};
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState(null);

  useLayoutEffect(() => {
    if (!scopeKey || cache.last?.scopeKey === scopeKey) return;
    const task = new AbortController();
    const {query, getCards, api} = inputs.current;
    setResponse(null);
    async function search() {
      try {
        if (!api?.intelligenceRequest) throw Error('请在梦藏桌面版中使用本机搜索。');
        const result = await rankLocalMaterials({cards: getCards(), query, signal: task.signal,
          embed: async texts => valueOf(await api.intelligenceRequest({action: 'embed', texts}))});
        if (task.signal.aborted) return;
        const entry = {scopeKey, result};
        cache.last = entry;
        setResponse(entry);
      } catch (error) {
        if (!task.signal.aborted) setResponse({scopeKey, cache, error: error.message || '本机搜索暂时不可用，请重试。', disabled: error.code === 'AI_DISABLED'});
      }
    }
    search();
    return () => task.abort();
  }, [scopeKey, cache, attempt]);

  const issue = response?.scopeKey === scopeKey && response.cache === cache ? response : null;
  return {result: cache.last?.scopeKey === scopeKey ? cache.last.result : null,
    error: issue?.error, disabled: issue?.disabled, retry: () => setAttempt(value => value + 1)};
}

export default function LibraryMeaningSearch({active, query, search, count, onMeaning, onSettings}) {
  if (!active) return <section className="sw-status ms-empty" aria-label="关键词搜索结果">
    <IconSearch size={28} stroke={1.5} aria-hidden="true"/>
    <h2>没有找到匹配的关键词</h2>
    <p>用刚才这句话，在当前范围的本机资料里找相近的内容。</p>
    <button className="sw-primary" type="button" onClick={onMeaning}>用原话按意思找</button>
  </section>;

  return <section className="ms-search-status" aria-label="本机语义搜索状态">
    <h2>按意思找</h2>
    {search.error ? <>
      <p role="alert">{search.error}</p>
      <button type="button" onClick={search.retry}>重试</button>
      {search.disabled && <button type="button" onClick={onSettings}>打开本机搜索设置</button>}
    </> : <p role="status">{!search.result ? '正在本机查找…' : count
      ? '按与「' + query + '」的相关程度排列。'
      : '当前范围没有找到可比较的资料。试试更具体的描述，或调整筛选。'}</p>}
  </section>;
}
