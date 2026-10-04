import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import "./styles.css";

async function mountApp() {
  let App;
  try {
    const module = window.mengcang
      ? await import("./StandaloneApp.jsx")
      : await import("./App.jsx");
    App = window.mengcang ? module.default : module.App;
  } catch (error) {
    console.error("加载梦藏界面失败：", error);
    App = () => (
      <div className="error-boundary-fallback">
        <div className="error-boundary-content">
          <h2>应用加载失败</h2>
          <p>无法加载主应用模块，请尝试刷新页面。</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    );
  }

  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

void mountApp();
