import {
  Activity,
  ArrowRightLeft,
  Cloud,
  Database,
  LogOut,
  ServerCog,
  UsersRound,
  Workflow,
} from "lucide-react";
import type { PageKey, User } from "../types";

const navigation: Array<{ key: PageKey; label: string; icon: typeof Workflow }> = [
  { key: "migration", label: "新建迁移", icon: ArrowRightLeft },
  { key: "accounts", label: "账号管理", icon: UsersRound },
  { key: "records", label: "迁移记录", icon: Database },
  { key: "diagnostics", label: "系统诊断", icon: ServerCog },
];

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Workflow size={20} /></span>
      <span><strong>影刀迁移</strong><small>云端迁移控制台</small></span>
    </div>
  );
}

export function Layout({
  page,
  user,
  busy,
  onNavigate,
  onLogout,
  children,
}: {
  page: PageKey;
  user: User;
  busy: boolean;
  onNavigate: (page: PageKey) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="主导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={page === item.key ? "is-active" : ""}
                type="button"
                onClick={() => onNavigate(item.key)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="tunnel-status"><Cloud size={14} />Cloudflare Tunnel 正常</span>
          <span className="domain">yingdao.ethan010203.online</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="page-context"><Activity size={16} />管理控制台</div>
          <div className="header-actions">
            <span className="user-chip"><span>{user.username}</span><small>{user.role}</small></span>
            <button className="icon-text-button" type="button" onClick={onLogout} disabled={busy}>
              <LogOut size={16} />退出
            </button>
          </div>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
