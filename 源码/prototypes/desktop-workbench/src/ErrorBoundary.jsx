import React from 'react';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error('ErrorBoundary 捕获到错误：', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <div className="error-boundary-content">
            <IconAlertTriangle size={48} stroke={1.5} />
            <h2>界面加载遇到问题</h2>
            <p>当前视图暂时无法显示，请尝试刷新页面。</p>
            {this.state.error && (
              <details className="error-boundary-details">
                <summary>查看错误详情</summary>
                <pre>{this.state.error.toString()}</pre>
                {this.state.errorInfo && (
                  <pre>{this.state.errorInfo.componentStack}</pre>
                )}
              </details>
            )}
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              <IconRefresh size={15} />
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
