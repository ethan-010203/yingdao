// 后端 package.json 解析后的 JSON 对象（结构由影刀决定，前端透传不解释）
export type PackageData = Record<string, unknown>;

export interface LocalFlow {
  user_id: string;
  app_id: string;
  uuid: string;
  name: string;
  update_time: string;
  robot_path: string;
  package_data: PackageData;
}

export interface CloudFlow {
  appId: string;
  appName: string;
  updateTime?: string;
}

export interface MigrateResult {
  success: boolean;
  name: string;
  message: string;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string | null;
}

export interface DownloadProgressPayload {
  downloaded: number;
  total: number;
  percentage: number;
}

// 迁移进度事件 payload（每完成一个流程后端 emit 一次）
export interface MigrateProgressPayload {
  current: number;
  total: number;
  name: string;
  success: boolean;
  message: string;
}

// 后端 AccountConfig 序列化结构（password 仍为明文，安全改造另开）
export interface BackendAccount {
  id: string;
  name: string;
  username: string;
  password: string;
}

// 后端 Settings 序列化结构
export interface BackendSettings {
  language: string;
  theme: string;
  auto_update: boolean;
  migrate_suffix: string;
}

// 后端配置文件结构
export interface BackendConfig {
  accounts: BackendAccount[];
  settings?: BackendSettings;
}

export type Theme = "light" | "dark" | "system";
export type Page = "home" | "migrate" | "accounts" | "local" | "cloud" | "settings";
