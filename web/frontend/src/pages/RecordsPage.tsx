import { useCallback, useEffect, useState } from "react";
import { Eye, LoaderCircle, RefreshCw, RotateCcw, X } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorNotice, formatBytes, formatDate, Loading, StatusBadge, stageLabels } from "../components/Common";
import type { JobDetail, JobSummary } from "../types";

export function RecordsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setJobs(await api.migrations()); setError(""); }
    catch (caught) { if (!quiet) setError(caught instanceof Error ? caught.message : "无法读取迁移记录"); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [jobs, load]);
  useEffect(() => {
    if (!detail || (detail.status !== "queued" && detail.status !== "running")) return;
    const timer = window.setInterval(async () => {
      try { setDetail(await api.migration(detail.id)); } catch { /* Main table reports connectivity. */ }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [detail?.id, detail?.status]);

  async function open(job: JobSummary) {
    setError("");
    try { setDetail(await api.migration(job.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "无法读取任务详情"); }
  }

  async function retry() {
    if (!detail) return;
    setRetrying(true); setError("");
    try { setDetail(await api.retryMigration(detail.id)); void load(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "重试任务失败"); }
    finally { setRetrying(false); }
  }

  return <>
    <div className="page-heading"><div><p>任务历史</p><h1>迁移记录</h1><span>查看后台任务状态、每个流程的结果和失败原因。</span></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} />刷新</button></div>
    <ErrorNotice message={error} />
    <section className="surface table-surface">
      <div className="surface-heading"><div><h2>全部任务</h2><small>{jobs.length} 条迁移记录</small></div></div>
      {loading ? <Loading label="正在读取迁移记录" /> : jobs.length === 0 ? <EmptyState title="还没有迁移记录" detail="创建迁移任务后，执行进度会显示在这里。" /> : <div className="table-scroll"><table className="records-table"><thead><tr><th>创建时间</th><th>源账号</th><th>迁移流程</th><th>目标账号</th><th>进度</th><th>状态</th><th className="actions-column">详情</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td className="nowrap">{formatDate(job.createdAt)}</td><td><strong>{job.sourceAccountName}</strong></td><td><div className="record-flow-list" title={job.sourceFlowNames.join("\n")}>{job.sourceFlowNames.slice(0, 3).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}{job.sourceFlowNames.length > 3 && <small>另 {job.sourceFlowNames.length - 3} 个流程，查看详情</small>}</div></td><td><strong>{job.targetAccountName}</strong></td><td>{job.completedItems + job.failedItems} / {job.totalItems}</td><td><StatusBadge status={job.status} /></td><td><div className="row-actions"><button type="button" title="查看详情" onClick={() => void open(job)}><Eye size={15} /></button></div></td></tr>)}</tbody></table></div>}
    </section>
    {detail && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="job-detail-title">
      <div className="modal-heading"><div><small>{formatDate(detail.createdAt)}</small><h2 id="job-detail-title">{detail.sourceAccountName} → {detail.targetAccountName}</h2></div><div className="modal-title-actions"><StatusBadge status={detail.status} /><button className="icon-button" type="button" onClick={() => setDetail(null)} title="关闭" aria-label="关闭"><X size={17} /></button></div></div>
      <div className="detail-summary"><span>总计 <strong>{detail.totalItems}</strong></span><span>成功 <strong className="success-text">{detail.completedItems}</strong></span><span>失败 <strong className="danger-text">{detail.failedItems}</strong></span><span>任务编号 <code>{detail.id.slice(0, 8)}</code></span></div>
      <div className="detail-items">{detail.items.map((item) => <article key={item.id}><div className="detail-item-main"><div><strong>{item.sourceName}</strong><small>{detail.sourceAccountName}<span className="path-arrow">→</span>{detail.targetAccountName}</small><small>目标流程名称：{item.targetName}</small></div><StatusBadge status={item.status} /></div><div className="detail-progress"><span style={{ width: `${item.progress}%` }} /></div><div className="detail-meta"><span>{stageLabels[item.stage] ?? item.stage}</span><span>尝试 {item.attemptCount} 次</span><span>下载 {formatBytes(item.downloadedBytes)}</span><span>上传 {formatBytes(item.uploadedBytes)}</span></div>{item.errorMessage && <p className="item-error">{item.errorMessage}</p>}</article>)}</div>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDetail(null)}>关闭</button>{detail.failedItems > 0 && <button className="primary-button" type="button" disabled={retrying || detail.status === "running" || detail.status === "queued"} onClick={() => void retry()}>{retrying ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}{retrying ? "正在提交" : "重试失败项"}</button>}</div>
    </section></div>}
  </>;
}
