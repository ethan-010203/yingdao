import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, ListTree, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorNotice, formatDate, Loading, Pagination, StatusBadge } from "../components/Common";
import type { Account, CloudFlow, FlowPage } from "../types";

type EditorState = { mode: "create" } | { mode: "edit"; account: Account };

export function AccountsPage({ refreshKey = 0 }: { refreshKey?: number }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [flowAccount, setFlowAccount] = useState<Account | null>(null);
  const [workingId, setWorkingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setAccounts(await api.accounts()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "无法读取账号"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function verify(account: Account) {
    setWorkingId(account.id);
    setError("");
    try {
      const updated = await api.verifyAccount(account.id);
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "账号验证失败"); }
    finally { setWorkingId(""); }
  }

  async function remove(account: Account) {
    if (!window.confirm(`确定删除“${account.displayName}”吗？迁移记录中正在使用的账号不能删除。`)) return;
    setWorkingId(account.id);
    setError("");
    try {
      await api.deleteAccount(account.id);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "账号删除失败"); }
    finally { setWorkingId(""); }
  }

  return (
    <>
      <div className="page-heading">
        <div><p>账号库</p><h1>迁移账号管理</h1><span>集中保存影刀账号，迁移时再指定源账号和目标账号。</span></div>
        <button className="primary-button" type="button" onClick={() => setEditor({ mode: "create" })}><Plus size={16} />添加账号</button>
      </div>
      <ErrorNotice message={error} />
      <section className="surface table-surface">
        <div className="surface-heading"><div><h2>影刀账号</h2><small>密码加密保存在服务器，浏览器不会读取已保存的密码。</small></div><button className="icon-button" type="button" onClick={() => void load()} title="刷新" aria-label="刷新"><RefreshCw size={16} /></button></div>
        {loading ? <Loading label="正在读取账号" /> : accounts.length === 0 ? (
          <EmptyState title="还没有迁移账号" detail="先添加至少两个影刀账号，才能进行云端迁移。" />
        ) : (
          <div className="table-scroll"><table><thead><tr><th>名称</th><th>影刀账号</th><th>状态</th><th>最近验证</th><th className="actions-column">操作</th></tr></thead><tbody>
            {accounts.map((account) => <tr key={account.id}><td><strong>{account.displayName}</strong></td><td className="mono">{account.usernameMasked}</td><td><StatusBadge status={account.status} /></td><td>{formatDate(account.lastVerifiedAt)}</td><td><div className="row-actions">
              <button type="button" title="管理流程" onClick={() => setFlowAccount(account)}><ListTree size={15} /></button>
              <button type="button" title="验证账号" disabled={workingId === account.id} onClick={() => void verify(account)}>{workingId === account.id ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}</button>
              <button type="button" title="编辑账号" onClick={() => setEditor({ mode: "edit", account })}><Pencil size={15} /></button>
              <button className="danger-action" type="button" title="删除账号" disabled={workingId === account.id} onClick={() => void remove(account)}><Trash2 size={15} /></button>
            </div></td></tr>)}
          </tbody></table></div>
        )}
      </section>
      {editor && <AccountEditor state={editor} onClose={() => setEditor(null)} onSaved={(account) => { setAccounts((current) => editor.mode === "create" ? [...current, account].sort((a, b) => a.displayName.localeCompare(b.displayName)) : current.map((item) => item.id === account.id ? account : item)); setEditor(null); }} />}
      {flowAccount && <FlowManager account={flowAccount} onClose={() => setFlowAccount(null)} />}
    </>
  );
}

function FlowManager({ account, onClose }: { account: Account; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [flowPage, setFlowPage] = useState<FlowPage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadFlows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.flows(account.id, debouncedQuery, page);
      setFlowPage(result);
      if (page > result.totalPages) setPage(Math.max(1, result.totalPages));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取账号流程");
    } finally {
      setLoading(false);
    }
  }, [account.id, debouncedQuery, page]);

  useEffect(() => { void loadFlows(); }, [loadFlows]);

  const currentFlows = flowPage?.items ?? [];
  const allCurrentSelected = currentFlows.length > 0 && currentFlows.every((flow) => selected.has(flow.appId));

  function toggle(appId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(appId)) next.delete(appId); else if (next.size < 50) next.add(appId);
      return next;
    });
  }

  function toggleCurrentPage() {
    setSelected((current) => {
      const next = new Set(current);
      if (allCurrentSelected) currentFlows.forEach((flow) => next.delete(flow.appId));
      else currentFlows.forEach((flow) => { if (next.size < 50) next.add(flow.appId); });
      return next;
    });
  }

  async function deleteSelected() {
    setConfirming(false);
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await api.deleteFlows(account.id, Array.from(selected));
      const deleted = new Set(result.results.filter((item) => item.success).map((item) => item.appId));
      setSelected((current) => new Set(Array.from(current).filter((id) => !deleted.has(id))));
      await loadFlows();
      if (result.successCount > 0) setNotice(`已将 ${result.successCount} 个流程移入回收站`);
      if (result.failureCount > 0) setError(`${result.failureCount} 个流程删除失败，请刷新后重试`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除流程失败");
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) onClose(); }}>
      <section className="modal wide flow-manager" role="dialog" aria-modal="true" aria-labelledby="flow-manager-title">
        <div className="modal-heading"><div><small>{account.usernameMasked}</small><h2 id="flow-manager-title">{account.displayName} · 流程管理</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={deleting} title="关闭" aria-label="关闭"><X size={17} /></button></div>
        <div className="flow-manager-toolbar">
          <div className="search-field"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索流程名称" /></div>
          <button className="icon-button" type="button" onClick={() => void loadFlows()} disabled={loading || deleting} title="刷新流程" aria-label="刷新流程"><RefreshCw className={loading ? "spin" : ""} size={16} /></button>
          <button className="danger-button" type="button" disabled={selected.size === 0 || deleting} onClick={() => setConfirming(true)}>{deleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}移入回收站 ({selected.size})</button>
        </div>
        {notice && <div className="notice success" role="status">{notice}</div>}
        <ErrorNotice message={error} />
        <div className="manager-table table-scroll">
          {loading && !flowPage ? <Loading label="正在读取云端流程" /> : <table><thead><tr><th className="check-column"><input type="checkbox" aria-label="选择当前页" checked={allCurrentSelected} onChange={toggleCurrentPage} /></th><th>流程名称</th><th>更新时间</th></tr></thead><tbody>{currentFlows.map((flow: CloudFlow) => <tr key={flow.appId} className={selected.has(flow.appId) ? "is-selected" : ""} onClick={() => toggle(flow.appId)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`选择 ${flow.appName}`} checked={selected.has(flow.appId)} onChange={() => toggle(flow.appId)} /></td><td><strong>{flow.appName || "未命名流程"}</strong></td><td>{flow.updateTime?.slice(0, 19).replace("T", " ") || "-"}</td></tr>)}</tbody></table>}
          {!loading && currentFlows.length === 0 && <EmptyState title="没有找到流程" detail={query ? "请调整搜索条件。" : "该账号下暂无云端流程。"} />}
        </div>
        <div className="flow-manager-footer"><span>共 {flowPage?.total ?? 0} 个流程 · 已选择 {selected.size} 个</span><Pagination page={page} pages={flowPage?.totalPages ?? 1} onChange={setPage} /><button className="secondary-button" type="button" onClick={onClose} disabled={deleting}>关闭</button></div>
      </section>
    </div>
    {confirming && <div className="modal-backdrop confirm-layer" role="presentation"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-flows-title"><div className="confirm-content"><span className="confirm-icon"><Trash2 size={20} /></span><div><h2 id="delete-flows-title">将 {selected.size} 个流程移入回收站？</h2><p>流程会从“{account.displayName}”的云端流程列表移除，请确认选择无误。</p></div></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setConfirming(false)}>取消</button><button className="danger-button" type="button" onClick={() => void deleteSelected()}><Trash2 size={15} />确认移入回收站</button></div></section></div>}
  </>;
}

function AccountEditor({ state, onClose, onSaved }: { state: EditorState; onClose: () => void; onSaved: (account: Account) => void }) {
  const editing = state.mode === "edit";
  const [displayName, setDisplayName] = useState(editing ? state.account.displayName : "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim() || (!editing && (!username.trim() || !password))) {
      setError("请完整填写账号信息"); return;
    }
    setSubmitting(true); setError("");
    try {
      const account = editing
        ? await api.updateAccount(state.account.id, { displayName: displayName.trim(), ...(username.trim() ? { username: username.trim() } : {}), ...(password ? { password } : {}) })
        : await api.createAccount({ displayName: displayName.trim(), username: username.trim(), password });
      setPassword(""); onSaved(account);
    } catch (caught) { setPassword(""); setError(caught instanceof Error ? caught.message : "保存账号失败"); }
    finally { setSubmitting(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="account-editor-title">
    <div className="modal-heading"><div><small>{editing ? "更新凭据" : "新账号"}</small><h2 id="account-editor-title">{editing ? "编辑影刀账号" : "添加影刀账号"}</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={submitting} title="关闭" aria-label="关闭"><X size={17} /></button></div>
    <form className="editor-form" onSubmit={submit}>
      <label htmlFor="account-name">账号名称</label><input id="account-name" value={displayName} maxLength={64} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：运营主账号" autoFocus />
      <label htmlFor="yingdao-username">影刀账号</label><input id="yingdao-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={editing ? `留空保留 ${state.account.usernameMasked}` : "手机号或影刀用户名"} autoComplete="off" />
      <label htmlFor="yingdao-password">影刀密码</label><div className="password-field"><input id="yingdao-password" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={editing ? "留空保留当前密码" : "输入影刀密码"} autoComplete="new-password" /><button type="button" className="icon-only" onClick={() => setVisible(!visible)} title={visible ? "隐藏密码" : "显示密码"} aria-label={visible ? "隐藏密码" : "显示密码"}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      <p className="field-note">保存前会连接影刀验证凭据。密码使用独立服务器密钥加密，不会返回网页端。</p>
      <ErrorNotice message={error} />
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>取消</button><button className="primary-button" type="submit" disabled={submitting}>{submitting && <LoaderCircle className="spin" size={16} />}{submitting ? "正在验证" : "验证并保存"}</button></div>
    </form>
  </section></div>;
}
