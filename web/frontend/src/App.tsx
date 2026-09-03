import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Workflow } from "lucide-react";
import { api, setUnauthorizedHandler } from "./api";
import { Layout } from "./components/Layout";
import { AccountsPage } from "./pages/AccountsPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { LoginPage } from "./pages/LoginPage";
import { MigrationPage } from "./pages/MigrationPage";
import { RecordsPage } from "./pages/RecordsPage";
import type { HealthPayload, PageKey, User } from "./types";

function pageFromPath(): PageKey {
  const segment = window.location.pathname.split("/").filter(Boolean)[0];
  return segment === "accounts" || segment === "records" || segment === "diagnostics" ? segment : "migration";
}

export default function App() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loginMessage, setLoginMessage] = useState("");
  const [page, setPage] = useState<PageKey>(pageFromPath);
  const [loggingOut, setLoggingOut] = useState(false);

  const expireSession = useCallback(() => {
    setUser(null);
    setLoginMessage("管理登录已过期，请重新登录");
    window.history.replaceState({}, "", "/");
  }, []);

  useEffect(() => { setUnauthorizedHandler(expireSession); }, [expireSession]);
  useEffect(() => {
    const popstate = () => setPage(pageFromPath());
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, []);
  useEffect(() => {
    void Promise.allSettled([api.health(), api.me()]).then(([healthResult, authResult]) => {
      if (healthResult.status === "fulfilled") setHealth(healthResult.value);
      if (authResult.status === "fulfilled") setUser(authResult.value.user);
      setChecking(false);
    });
  }, []);

  function navigate(next: PageKey) {
    setPage(next);
    window.history.pushState({}, "", `/${next}`);
  }

  async function logout() {
    setLoggingOut(true);
    try { await api.logout(); } catch { /* Local session state still clears. */ }
    setUser(null); setLoginMessage(""); setLoggingOut(false);
    window.history.replaceState({}, "", "/");
  }

  if (checking) return <div className="app-loading"><span><Workflow size={21} /></span><LoaderCircle className="spin" size={19} />正在连接控制台</div>;
  if (!user) return <LoginPage health={health} initialMessage={loginMessage} onLogin={(authenticatedUser) => { setUser(authenticatedUser); setLoginMessage(""); navigate("migration"); }} />;

  return <Layout page={page} user={user} busy={loggingOut} onNavigate={navigate} onLogout={() => void logout()}>
    {page === "migration" && <MigrationPage onManageAccounts={() => navigate("accounts")} onViewRecords={() => navigate("records")} />}
    {page === "accounts" && <AccountsPage />}
    {page === "records" && <RecordsPage />}
    {page === "diagnostics" && <DiagnosticsPage />}
  </Layout>;
}
