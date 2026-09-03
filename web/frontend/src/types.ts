export type User = {
  username: string;
  role: "admin" | "user";
};

export type HealthPayload = {
  status: "ok";
  service: string;
  version: string;
  uptimeSeconds: number;
};

export type Account = {
  id: string;
  displayName: string;
  usernameMasked: string;
  status: "verified" | "invalid" | "unknown";
  lastVerifiedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

export type CloudFlow = {
  appId: string;
  appName: string;
  updateTime?: string;
};

export type FlowPage = {
  items: CloudFlow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type JobStatus = "queued" | "running" | "succeeded" | "partial" | "failed";

export type JobSummary = {
  id: string;
  sourceAccountId: string;
  sourceAccountName: string;
  sourceFlowNames: string[];
  targetAccountId: string;
  targetAccountName: string;
  status: JobStatus;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  currentStage: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
};

export type JobItem = {
  id: string;
  sourceAppId: string;
  sourceName: string;
  targetName: string;
  targetAppId?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string;
  progress: number;
  errorCode?: string;
  errorMessage?: string;
  attemptCount: number;
  downloadedBytes: number;
  uploadedBytes: number;
  startedAt?: number;
  finishedAt?: number;
};

export type JobDetail = JobSummary & { items: JobItem[] };

export type Diagnostics = {
  accountCount: number;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  tempUsageBytes: number;
  workerConcurrency: number;
};

export type PageKey = "migration" | "accounts" | "records" | "diagnostics";
