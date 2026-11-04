import React from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import './styles.css';

async function mountApp() {
  try {
    const module = window.mengcang ? await import('./StandaloneApp.jsx') : await import('./App.jsx');
    const App = window.mengcang ? module.default : module.App;
    createRoot(document.getElementById('root')).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>,
    );
  } catch (error) {
    console.error('加载梦藏界面失败：', error);
    createRoot(document.getElementById('root')).render(
      <main className="standalone-loading" role="alert">
        <h1>梦藏未能打开</h1>
        <p>原有资料仍保存在本机。请重新打开窗口。</p>
        <button onClick={() => location.reload()}>重新打开</button>
      </main>,
    );
  }
}
void mountApp();
