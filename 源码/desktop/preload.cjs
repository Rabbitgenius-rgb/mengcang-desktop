'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const methods = ['status','snapshot','readNote','readAttachment','capture','discoveryAnalyze','discoveryExtract','webCapture','captureFeed','intelligenceStatus','intelligenceConfigure','intelligenceSetKey','intelligenceRequest','nativeFilePreview','discoveryStateGet','discoveryStateSet','openOriginal','draftGet','draftSet','preferencesGet','preferencesSet','rendererReady','rendererQuitReady'];
const api = Object.fromEntries(methods.map(method => [method, (...args) => ipcRenderer.invoke(`mengcang:${method}`, ...args)]));
api.assetUrl = relativePath => typeof relativePath === 'string' ? `mengcang-asset://vault/?path=${encodeURIComponent(relativePath)}` : '';
api.subscribe = callback => { const receive = (_event, data) => callback(data); ipcRenderer.on('mengcang:event', receive); return () => ipcRenderer.removeListener('mengcang:event', receive); };
contextBridge.exposeInMainWorld('mengcang', Object.freeze(api));
