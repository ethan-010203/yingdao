import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, Clock3, Database, HardDrive, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { ErrorNotice, formatBytes, Loading } from "../components/Common";
import type { Diagnostics, HealthPayload } from "../types";

export function DiagnosticsPage() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [stats, setStats] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [healthResult, statsResult] = await Promise.all([api.health(), api.diagnostics()]);
      setHealth(healthResult); setStats(statsResult);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法读取系统状态"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <>
    <div className="page-heading"><div><p>运行状态</p><h1>系统诊断</h1><span>服务、任务队列和临时磁盘用量。</span></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} />刷新</button></div>
    <ErrorNotice message={error} />
    {loading ? <section className="surface"><Loading label="正在读取系统状态" /></section> : health && stats ? <>
      <div className="metric-grid">
        <Metric icon={Server} label="Axum API" value="运行正常" tone="success" />
        <Metric icon={Activity} label="运行时间" value={formatUptime(health.uptimeSeconds)} />
        <Metric icon={Database} label="迁移账号" value={`${stats.accountCount} 个`} />
        <Metric icon={HardDrive} label="临时文件" value={formatBytes(stats.tempUsageBytes)} tone={stats.tempUsageBytes > 100 * 1024 * 1024 ? "warning" : undefined} />
      </div>
      <section className="surface diagnostics-surface"><div className="surface-heading"><div><h2>任务执行器</h2><small>单任务串行队列</small></div><span className="healthy-label"><CheckCircle2 size={15} />正常</span></div><dl className="diagnostics-list"><div><dt><Clock3 size={16} />等待任务</dt><dd>{stats.queuedJobs}</dd></div><div><dt><Activity size={16} />执行中</dt><dd>{stats.runningJobs}</dd></div><div><dt><CheckCircle2 size={16} />已完成</dt><dd>{stats.completedJobs}</dd></div><div><dt><ShieldCheck size={16} />并发数</dt><dd>{stats.workerConcurrency}</dd></div><div><dt><Server size={16} />服务版本</dt><dd>v{health.version}</dd></div><div><dt><HardDrive size={16} />监听方式</dt><dd>Cloudflare Tunnel</dd></div></dl></section>
    </> : null}
  </>;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Server; label: string; value: string; tone?: string }) {
  return <div className={`metric ${tone ?? ""}`}><span><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}
