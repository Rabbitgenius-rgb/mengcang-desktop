'use strict';
// Read committed records through the app's own IndexedDB API. Never inspect
// Chromium's files, evaluate material text, or expose unfinished editor drafts.
function workspaceReadScript(identity, {includeAssets = false} = {}) {
  if (typeof identity !== 'string' || !identity || identity.length > 4096) throw Error('工作区标识无效');
  return `(${async function (key, includeAssets) {
    const name = 'mengcang-sublime-workspace-v1';
    if (typeof indexedDB.databases !== 'function') throw Error('当前软件无法安全检查资料库，请更新梦藏');
    if (!(await indexedDB.databases()).some(value => value.name === name)) return null;
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction.abort(); };
      request.onerror = () => reject(Error('软件资料库读取失败；原内容未更改'));
      request.onsuccess = () => {
        const db = request.result;
        let tx;
        try { tx = db.transaction('workspaces', 'readonly'); }
        catch { db.close(); reject(Error('软件资料格式不可读取；原内容未更改')); return; }
        const read = tx.objectStore('workspaces').get(key);
        let result = null, failure;
        read.onsuccess = () => {
          try {
            const raw = read.result;
            if (raw === undefined) return;
            const state = raw.format === 'workspace-storage-v2' ? raw.state : raw;
            if (!state || !Array.isArray(state.cards) || !Array.isArray(state.savedIds) || !Array.isArray(state.hiddenIds)) throw Error('软件资料格式不可读取');
            const allowed = new Set(state.savedIds), hidden = new Set(state.hiddenIds);
            const cards = state.cards.filter(card => allowed.has(card.id) && !hidden.has(card.id)).map(card => {
              const {attachment, image, ...metadata} = card;
              // All editable drafts live outside these committed card records.
              return {...metadata,
                imageAvailable: !!image || !!attachment?.type?.startsWith('image/'),
                image: includeAssets ? (image || '') : (typeof image === 'string' && !image.startsWith('data:') ? image : ''),
                attachment: attachment ? (includeAssets ? attachment : {name:attachment.name,type:attachment.type,size:attachment.size}) : null};
            });
            result = {revision: raw.format === 'workspace-storage-v2' ? raw.revision : 0,
              state: {schemaVersion:1,version:1,cards,savedIds:state.savedIds,favoriteIds:state.favoriteIds || [],hiddenIds:state.hiddenIds,
                collections:state.collections || [],boards:state.boards || [],annotations:state.annotations || {},drafts:{}}};
          } catch (error) { failure = error; tx.abort(); }
        };
        read.onerror = () => { failure = Error('软件资料读取失败'); };
        tx.oncomplete = () => { db.close(); resolve(result); };
        const failed = () => { db.close(); reject(failure || Error('软件资料读取中断；原内容未更改')); };
        tx.onabort = failed; tx.onerror = failed;
      };
    });
  }.toString()})(${JSON.stringify(identity)},${includeAssets === true})`;
}

async function readWorkspaceSnapshot(webContents, identity, options = {}) {
  if (!webContents || webContents.isDestroyed() || !webContents.getURL().startsWith('mengcang://app/')) throw Error('请先打开梦藏并等待资料库加载完成');
  let timer;
  try {
    return await Promise.race([
      webContents.executeJavaScript(workspaceReadScript(identity, options), false),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('软件资料读取超时，请等待当前保存完成后重试')), 15000); })
    ]);
  } finally { clearTimeout(timer); }
}
module.exports = {workspaceReadScript, readWorkspaceSnapshot};
