import type {
  Account,
  Diagnostics,
  FlowPage,
  HealthPayload,
  JobDetail,
  JobSummary,
  User,
} from "./types";

export type DeleteFlowsResult = {
  successCount: number;
  failureCount: number;
  results: Array<{ appId: string; success: boolean; error?: string }>;
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(errorMessage(code));
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | undefined;

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let code = "request_failed";
    try {
      code = ((await response.json()) as { error?: string }).error ?? code;
    } catch {
      // The HTTP status remains available when an upstream proxy returns non-JSON.
    }
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthPayload>("/health"),
  me: () => request<{ user: User }>("/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  accounts: () => request<Account[]>("/accounts"),
  createAccount: (input: { displayName: string; username: string; password: string }) =>
    request<Account>("/accounts", { method: "POST", body: JSON.stringify(input) }),
  updateAccount: (
    id: string,
    input: { displayName?: string; username?: string; password?: string },
  ) => request<Account>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteAccount: (id: string) => request<void>(`/accounts/${id}`, { method: "DELETE" }),
  verifyAccount: (id: string) =>
    request<Account>(`/accounts/${id}/verify`, { method: "POST" }),
  flows: (accountId: string, query: string, page: number, pageSize = 10) => {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      pageSize: String(pageSize),
    });
    return request<FlowPage>(`/accounts/${accountId}/flows?${params}`);
  },
  deleteFlows: (accountId: string, appIds: string[]) =>
    request<DeleteFlowsResult>(`/accounts/${accountId}/flows/delete`, {
      method: "POST",
      body: JSON.stringify({ appIds }),
    }),
  createMigration: (input: {
    sourceAccountId: string;
    targetAccountId: string;
    flows: Array<{ appId: string; appName: string }>;
    nameTemplate: string;
  }) => request<JobDetail>("/migrations", { method: "POST", body: JSON.stringify(input) }),
  migrations: () => request<JobSummary[]>("/migrations"),
  migration: (id: string) => request<JobDetail>(`/migrations/${id}`),
  retryMigration: (id: string) =>
    request<JobDetail>(`/migrations/${id}/retry`, { method: "POST" }),
  diagnostics: () => request<Diagnostics>("/diagnostics"),
};

export function errorMessage(code: string) {
  const messages: Record<string, string> = {
    invalid_credentials: "用户名或密码不正确",
    rate_limited: "尝试次数过多，请在 15 分钟后重试",
    credentials_rejected: "影刀账号或密码不正确",
    upstream_unavailable: "暂时无法连接影刀服务，请稍后重试",
    upstream_session_expired: "影刀登录状态已失效，请验证账号后重试",
    upstream_invalid_response: "影刀服务返回了无法识别的数据",
    account_already_exists: "这个影刀账号已经保存过了",
    account_in_use: "该账号已被迁移记录引用，暂时不能删除",
    account_not_found: "影刀账号不存在或已被删除",
    invalid_account: "请完整填写账号名称、用户名和密码",
    invalid_migration: "迁移配置无效，请检查账号和流程选择",
    migration_not_found: "迁移任务不存在",
    flow_package_too_large: "流程压缩包超过 50 MB 限制",
    download_failed: "流程包下载失败",
    upload_failed: "流程包上传失败",
    create_failed: "在目标账号创建流程失败",
    verification_failed: "目标账号未能确认新流程",
    delete_failed: "将流程移入回收站失败",
    invalid_flow_selection: "请选择 1 到 50 个流程",
    not_authenticated: "管理登录已过期，请重新登录",
    request_failed: "请求失败，请稍后重试",
  };
  return messages[code] ?? "操作失败，请稍后重试";
}
