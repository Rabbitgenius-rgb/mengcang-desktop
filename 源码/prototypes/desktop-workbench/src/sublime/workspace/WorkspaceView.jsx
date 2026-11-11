import React from 'react';
import { renderWorkspaceContent } from './WorkspaceContent.jsx';
export function renderWorkspaceView(view) {
  const { root, ready, loadedIdentity, identityId, scrollRestore, navigation, isEditor, route, theme, systemLight, error } = view;
  return (
    <div
      className="sublime-workspace"
      ref={root}
      onScroll={() => {
        if (ready && loadedIdentity.current === identityId && !scrollRestore.current) navigation.record();
      }}
      data-with-dock={!isEditor}
      data-archive-nav={!isEditor || route.page === 'recall'}
      data-star-home={route.page === 'home'}
      data-ai-policy="analysis-click-to-run"
      data-theme={theme === 'system' ? (systemLight ? 'light' : 'dark') : theme}
    >
      {!ready || loadedIdentity.current !== identityId ? (
        <div className="sw-status">
          <h1>{error ? '资料库原有内容已保留' : '正在打开资料库…'}</h1>
          <p>{error || '正在读取本机资料'}</p>
          {error && (
            <button className="sw-primary" onClick={() => location.reload()}>
              重试
            </button>
          )}
        </div>
      ) : (
        renderWorkspaceContent(view)
      )}
    </div>
  );
}
