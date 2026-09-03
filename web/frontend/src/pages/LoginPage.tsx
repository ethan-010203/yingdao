import { useState, type FormEvent } from "react";
import { Cloud, Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, UserRound } from "lucide-react";
import { api } from "../api";
import { Brand } from "../components/Layout";
import type { HealthPayload, User } from "../types";

export function LoginPage({
  health,
  initialMessage,
  onLogin,
}: {
  health: HealthPayload | null;
  initialMessage?: string;
  onLogin: (user: User) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialMessage ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await api.login(username.trim(), password);
      setPassword("");
      onLogin(result.user);
    } catch (caught) {
      setPassword("");
      setError(caught instanceof Error ? caught.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <header className="login-header">
        <Brand />
        <span className="login-domain"><Cloud size={15} />yingdao.ethan010203.online</span>
      </header>
      <main className="login-main">
        <section className="login-panel">
          <div className="login-panel-heading">
            <span className="login-icon"><LockKeyhole size={22} /></span>
            <div><small>安全访问</small><h1>登录管理控制台</h1></div>
          </div>
          <form className="login-form" onSubmit={submit}>
            <label htmlFor="username">用户名</label>
            <div className="input-with-icon"><UserRound size={17} /><input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={submitting} autoFocus /></div>
            <label htmlFor="password">密码</label>
            <div className="input-with-icon"><LockKeyhole size={17} /><input id="password" type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} /><button type="button" className="icon-only" title={visible ? "隐藏密码" : "显示密码"} aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button login-button" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />}{submitting ? "正在登录" : "登录"}</button>
          </form>
          <div className={`login-service ${health ? "is-online" : ""}`}><span className="dot" />{health ? `服务正常 · v${health.version}` : "正在连接服务"}</div>
        </section>
      </main>
    </div>
  );
}
