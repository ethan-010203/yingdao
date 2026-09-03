import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, XCircle } from "lucide-react";
import type { JobStatus } from "../types";

export function Loading({ label = "正在读取" }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={20} />{label}</div>;
}

export function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div className="notice error" role="alert"><AlertCircle size={16} />{message}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><AlertCircle size={23} /><strong>{title}</strong><span>{detail}</span></div>;
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    verified: "已验证", invalid: "验证失败", unknown: "未验证",
    queued: "等待中", running: "迁移中", succeeded: "已完成", partial: "部分失败", failed: "失败",
  };
  const Icon = status === "succeeded" || status === "verified"
    ? CheckCircle2
    : status === "failed" || status === "partial" || status === "invalid"
      ? XCircle
      : status === "running" ? LoaderCircle : AlertCircle;
  return <span className={`status-badge status-${status}`}><Icon className={status === "running" ? "spin" : ""} size={13} />{labels[status] ?? status}</span>;
}

export function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  return (
    <div className="pagination" aria-label="分页">
      <button type="button" title="上一页" aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button>
      <span>{page} / {Math.max(1, pages)}</span>
      <button type="button" title="下一页" aria-label="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button>
    </div>
  );
}

export function formatDate(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(timestamp * 1000));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function jobStatusLabel(status: JobStatus) {
  return ({ queued: "等待执行", running: "正在迁移", succeeded: "迁移完成", partial: "部分流程失败", failed: "迁移失败" })[status];
}

export const stageLabels: Record<string, string> = {
  queued: "等待执行", authenticating: "登录影刀账号", reading_source: "读取源流程", downloading: "下载流程包",
  repacking: "重打包流程", assigning_upload: "准备上传", uploading: "上传流程包", creating: "创建目标流程",
  verifying: "校验迁移结果", completed: "处理完成", failed: "处理失败",
};
