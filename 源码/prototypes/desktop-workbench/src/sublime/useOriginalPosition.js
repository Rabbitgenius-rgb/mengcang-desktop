import { useEffect, useRef, useState } from 'react';
import { findOriginalWebPosition } from './originalPosition.js';

// English excerpts retain their existing browser link. A Chinese excerpt is
// compared only after an explicit click, with no changes to saved materials.
export function useOriginalPosition({ api, library, scope }) {
  const [state, setState] = useState(null),
    run = useRef(0),
    latest = useRef(null),
    pending = useRef(false);
  latest.current = { api, library, scope };
  useEffect(() => {
    run.current++;
    pending.current = false;
    setState(null);
    return () => {
      run.current++;
      pending.current = false;
    };
  }, [api, scope]);
  async function open(event, excerpt) {
    if (!/[\u3400-\u9fff]/u.test(excerpt?.webAnchor?.exact || '')) return;
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const id = excerpt.id,
      number = ++run.current;
    const saved = library.find((card) => card.id === id);
    // Closing a native confirmation refocuses the window and reloads unchanged
    // cards from IndexedDB. Compare the actionable fields, not array identity.
    const current = () => {
      if (run.current !== number || latest.current.api !== api || latest.current.scope !== scope) return false;
      if (!saved) return true;
      const card = latest.current.library.find((item) => item.id === id);
      return (
        !!card &&
        card.sourceUrl === saved.sourceUrl &&
        card.sourceCardId === saved.sourceCardId &&
        card.webAnchor?.exact === saved.webAnchor?.exact &&
        card.webAnchor?.prefix === saved.webAnchor?.prefix &&
        card.webAnchor?.suffix === saved.webAnchor?.suffix
      );
    };
    setState({ id, status: 'loading' });
    try {
      const result =
        state?.id === id && state.status === 'located' && state.quote === excerpt.webAnchor.exact && state.sourceUrl === excerpt.sourceUrl
          ? state.result
          : await findOriginalWebPosition(excerpt, library, api, current);
      if (!current()) return;
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setState(result.sourceSentence ? { id, status: 'located', result, quote: excerpt.webAnchor.exact, sourceUrl: excerpt.sourceUrl } : null);
    } catch (error) {
      let message = '暂时无法可靠定位。';
      if (error?.code === 'AI_CONFIRMATION_REQUIRED') message = '已取消，本次未发送摘录。';
      else if (['AI_DISABLED', 'MODEL_NOT_CONFIGURED', 'API_KEY_REQUIRED', 'POSITION_API_REQUIRED'].includes(error?.code))
        message = '请先在“本机工具 → AI 连接与用量”配置并启用 API。';
      else if (/^(MODEL_|INVALID_RESPONSE|API_|INTELLIGENCE_BUSY)/u.test(error?.code || '')) message = '翻译服务未能完成这次请求。';
      if (current()) setState({ id, status: 'error', message });
    } finally {
      if (run.current === number) {
        pending.current = false;
        if (!current()) setState(null);
      }
    }
  }
  return { state, open };
}
