import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, LoaderCircle, Plus, Search, X } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorNotice, Loading, Pagination, StatusBadge, stageLabels } from "../components/Common";
import type { Account, CloudFlow, FlowPage, JobDetail } from "../types";

const stepNames = ["源账号", "选择流程", "目标账号", "执行迁移"];

export function MigrationPage({
  onManageAccounts,
  onViewRecords,
}: {
  onManageAccounts: () => void;
  onViewRecords: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [sourceAccountQuery, setSourceAccountQuery] = useState("");
  const [targetAccountQuery, setTargetAccountQuery] = useState("");
  const [step, setStep] = useState(1);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState<Map<string, CloudFlow>>(new Map());
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [flowPage, setFlowPage] = useState<FlowPage | null>(null);
  const [page, setPage] = useState(1);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [template, setTemplate] = useState("{name}_迁移_{datetime}");
  const [creating, setCreating] = useState(false);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.accounts().then(setAccounts).catch((caught) => setError(caught instanceof Error ? caught.message : "无法读取账号")).finally(() => setLoadingAccounts(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadFlows = useCallback(async () => {
    if (!sourceId || step !== 2) return;
    setLoadingFlows(true); setError("");
    try { setFlowPage(await api.flows(sourceId, debouncedQuery, page)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "无法读取流程"); }
    finally { setLoadingFlows(false); }
  }, [debouncedQuery, page, sourceId, step]);

  useEffect(() => { void loadFlows(); }, [loadFlows]);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    let active = true;
    const poll = async () => {
      try {
        const updated = await api.migration(job.id);
        if (active) setJob(updated);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "无法刷新任务进度");
      }
    };
    const timer = window.setInterval(() => void poll(), 1500);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [job?.id, job?.status]);

  const selectedFlows = useMemo(() => Array.from(selected.values()), [selected]);
  const source = accounts.find((account) => account.id === sourceId);
  const target = accounts.find((account) => account.id === targetId);
  const sourceAccounts = useMemo(
    () => accounts.filter((account) => matchesAccount(account, sourceAccountQuery)),
    [accounts, sourceAccountQuery],
  );
  const targetAccounts = useMemo(
    () => accounts.filter((account) => account.id !== sourceId && matchesAccount(account, targetAccountQuery)),
    [accounts, sourceId, targetAccountQuery],
  );

  function chooseSource(id: string) {
    setSourceId(id); setTargetId(""); setTargetAccountQuery(""); setSelected(new Map()); setFlowPage(null); setQuery(""); setPage(1); setError("");
  }

  function toggleFlow(flow: CloudFlow) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(flow.appId)) next.delete(flow.appId);
      else if (next.size < 10) next.set(flow.appId, flow);
      return next;
    });
  }

  async function startMigration() {
    if (!sourceId || !targetId || selectedFlows.length === 0) return;
    setCreating(true); setError("");
    try {
      const created = await api.createMigration({ sourceAccountId: sourceId, targetAccountId: targetId, flows: selectedFlows, nameTemplate: template });
      setJob(created); setStep(4);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法创建迁移任务"); }
    finally { setCreating(false); }
  }

  function reset() {
    setStep(1); setSourceId(""); setTargetId(""); setSourceAccountQuery(""); setTargetAccountQuery(""); setSelected(new Map()); setQuery(""); setPage(1); setFlowPage(null); setTemplate("{name}_迁移_{datetime}"); setJob(null); setError("");
  }

  if (loadingAccounts) return <><PageHeading /><section className="surface"><Loading label="正在读取迁移账号" /></section></>;

  return (
    <>
      <PageHeading />
      <ol className="stepper">
        {stepNames.map((name, index) => { const number = index + 1; return <li key={name} className={number === step ? "is-current" : number < step ? "is-done" : ""}><span>{number < step ? <Check size={14} /> : number}</span><strong>{name}</strong></li>; })}
      </ol>
      <ErrorNotice message={error} />

      {accounts.length < 2 ? (
        <section className="surface"><EmptyState title="至少需要两个影刀账号" detail="添加账号后，即可指定源账号和目标账号。" /><div className="empty-action"><button className="primary-button" type="button" onClick={onManageAccounts}><Plus size={16} />添加迁移账号</button></div></section>
      ) : step === 1 ? (
        <section className="surface wizard-surface">
          <div className="surface-heading"><div><small>步骤 1</small><h2>选择源账号</h2></div><span className="selection-count">{source ? `已选：${source.displayName}` : "未选择"}</span></div>
          <div className="account-picker">
            <div className="account-search search-field"><Search size={16} /><input type="search" value={sourceAccountQuery} onChange={(event) => setSourceAccountQuery(event.target.value)} placeholder="搜索源账号名称或账号" aria-label="搜索源账号" /></div>
            <div className="account-choice-grid">{sourceAccounts.map((account) => <button key={account.id} type="button" disabled={account.status === "invalid"} className={`account-choice ${sourceId === account.id ? "is-selected" : ""}`} onClick={() => chooseSource(account.id)}><span className="choice-check">{sourceId === account.id && <Check size={14} />}</span><span><strong>{account.displayName}</strong><small>{account.usernameMasked}</small></span><StatusBadge status={account.status} /></button>)}</div>
            {sourceAccounts.length === 0 && <div className="account-search-empty">没有找到匹配的源账号</div>}
          </div>
          <WizardActions left={<button className="secondary-button" type="button" onClick={onManageAccounts}>管理账号</button>} right={<button className="primary-button" type="button" disabled={!sourceId} onClick={() => setStep(2)}>选择流程<ArrowRight size={16} /></button>} />
        </section>
      ) : step === 2 ? (
        <section className="surface wizard-surface flow-surface">
          <div className="surface-heading"><div><small>步骤 2 · {source?.displayName}</small><h2>选择需要迁移的流程</h2></div><span className="selection-count">已选择 {selected.size} / 10</span></div>
          <div className="flow-toolbar"><div className="search-field"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索流程名称" /></div><button className="icon-button" type="button" onClick={() => void loadFlows()} title="刷新流程" aria-label="刷新流程"><LoaderCircle className={loadingFlows ? "spin" : ""} size={16} /></button></div>
          {selected.size > 0 && <div className="selected-strip">{selectedFlows.map((flow) => <button key={flow.appId} type="button" title="取消选择" onClick={() => toggleFlow(flow)}>{flow.appName}<X size={13} /></button>)}</div>}
          {loadingFlows && !flowPage ? <Loading label="正在读取云端流程" /> : (
            <div className="flow-table"><table><thead><tr><th className="check-column"></th><th>流程名称</th><th>更新时间</th></tr></thead><tbody>{flowPage?.items.map((flow) => <tr key={flow.appId} className={selected.has(flow.appId) ? "is-selected" : ""} onClick={() => toggleFlow(flow)}><td><input type="checkbox" checked={selected.has(flow.appId)} disabled={!selected.has(flow.appId) && selected.size >= 10} readOnly /></td><td><strong>{flow.appName || "未命名流程"}</strong></td><td>{flow.updateTime?.slice(0, 19).replace("T", " ") || "-"}</td></tr>)}</tbody></table>{flowPage?.items.length === 0 && <EmptyState title="没有匹配的流程" detail="请调整搜索条件。" />}</div>
          )}
          <div className="table-footer"><span>共 {flowPage?.total ?? 0} 个流程</span><Pagination page={page} pages={flowPage?.totalPages ?? 1} onChange={setPage} /></div>
          <WizardActions left={<button className="secondary-button" type="button" onClick={() => setStep(1)}><ArrowLeft size={16} />上一步</button>} right={<button className="primary-button" type="button" disabled={selected.size === 0} onClick={() => setStep(3)}>选择目标账号<ArrowRight size={16} /></button>} />
        </section>
      ) : step === 3 ? (
        <section className="surface wizard-surface">
          <div className="surface-heading"><div><small>步骤 3</small><h2>目标账号与命名</h2></div><span className="selection-count">{selected.size} 个流程</span></div>
          <div className="configuration-grid">
            <div className="configuration-main">
              <label htmlFor="target-account-search">目标账号</label>
              <div className="account-picker compact">
                <div className="account-search search-field"><Search size={16} /><input id="target-account-search" type="search" value={targetAccountQuery} onChange={(event) => setTargetAccountQuery(event.target.value)} placeholder="搜索目标账号名称或账号" aria-label="搜索目标账号" /></div>
                <div className="account-choice-grid compact">{targetAccounts.map((account) => <button key={account.id} type="button" disabled={account.status === "invalid"} className={`account-choice ${targetId === account.id ? "is-selected" : ""}`} onClick={() => setTargetId(account.id)}><span className="choice-check">{targetId === account.id && <Check size={14} />}</span><span><strong>{account.displayName}</strong><small>{account.usernameMasked}</small></span><StatusBadge status={account.status} /></button>)}</div>
                {targetAccounts.length === 0 && <div className="account-search-empty">没有找到匹配的目标账号</div>}
              </div>
              <label htmlFor="name-template">目标流程名称</label>
              <input id="name-template" className="text-input mono" value={template} maxLength={200} aria-describedby="name-template-help" onChange={(event) => setTemplate(event.target.value)} />
              <div className="template-help" id="name-template-help"><span>可用变量：</span><code>{"{name}"}</code><span>原流程名称</span><code>{"{date}"}</code><span>日期</span><code>{"{time}"}</code><span>时间</span><code>{"{datetime}"}</code><span>日期和时间</span></div>
            </div>
            <aside className="summary-panel"><h3>迁移确认</h3><dl><div><dt>源账号</dt><dd>{source?.displayName}</dd></div><div><dt>目标账号</dt><dd>{target?.displayName ?? "未选择"}</dd></div><div><dt>流程数量</dt><dd>{selected.size} 个</dd></div><div><dt>执行方式</dt><dd>后台串行</dd></div></dl><div className="flow-name-list">{selectedFlows.map((flow) => <span key={flow.appId}>{flow.appName}</span>)}</div></aside>
          </div>
          <WizardActions left={<button className="secondary-button" type="button" onClick={() => setStep(2)}><ArrowLeft size={16} />上一步</button>} right={<button className="primary-button" type="button" disabled={!targetId || creating} onClick={() => void startMigration()}>{creating ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{creating ? "正在创建" : "开始迁移"}</button>} />
        </section>
      ) : job ? (
        <JobProgress job={job} onReset={reset} onViewRecords={onViewRecords} />
      ) : null}
    </>
  );
}

function matchesAccount(account: Account, query: string) {
  const normalized = query.trim().toLowerCase();
  return !normalized || `${account.displayName} ${account.usernameMasked}`.toLowerCase().includes(normalized);
}

function PageHeading() {
  return <div className="page-heading"><div><p>云端任务</p><h1>新建流程迁移</h1><span>从一个影刀账号复制云端流程到另一个账号。</span></div></div>;
}

function WizardActions({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return <div className="wizard-actions"><div>{left}</div><div>{right}</div></div>;
}

function JobProgress({ job, onReset, onViewRecords }: { job: JobDetail; onReset: () => void; onViewRecords: () => void }) {
  const done = job.status === "succeeded" || job.status === "failed" || job.status === "partial";
  const progress = job.totalItems ? Math.round(((job.completedItems + job.failedItems) / job.totalItems) * 100) : 0;
  return <section className="surface wizard-surface">
    <div className="surface-heading"><div><small>步骤 4</small><h2>{done ? "迁移任务已结束" : "迁移任务正在执行"}</h2></div><StatusBadge status={job.status} /></div>
    <div className="job-overview"><div className="progress-row"><div><strong>{job.completedItems + job.failedItems} / {job.totalItems}</strong><span>流程处理完成</span></div><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><span className="current-stage">{stageLabels[job.currentStage] ?? job.currentStage}</span></div>
    <div className="job-items">{job.items.map((item) => <article key={item.id}><div className="job-item-heading"><div><strong>{item.sourceName}</strong><small>→ {item.targetName}</small></div><StatusBadge status={item.status} /></div><div className="item-progress"><span style={{ width: `${item.progress}%` }} /></div><div className="job-item-meta"><span>{stageLabels[item.stage] ?? item.stage}</span><span>{item.progress}%</span></div>{item.errorMessage && <p className="item-error">{item.errorMessage}</p>}</article>)}</div>
    <WizardActions left={<button className="secondary-button" type="button" onClick={onViewRecords}>查看迁移记录</button>} right={<button className="primary-button" type="button" disabled={!done} onClick={onReset}><Plus size={16} />新建迁移</button>} />
  </section>;
}
