import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ConfigProvider } from "./contexts/ConfigContext";
import { LoginPage } from "./components/LoginPage";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// 根据认证状态渲染不同内容的组件
function AuthenticatedApp() {
  const { user, loading } = useAuth();

  // 加载中状态
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">正在验证登录状态...</p>
        </div>
      </div>
    );
  }

  // 未登录显示登录页
  if (!user) {
    return <LoginPage />;
  }

  // 已登录显示主应用
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ConfigProvider>
          <AuthenticatedApp />
        </ConfigProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

