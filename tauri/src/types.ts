export interface LocalFlow {
  user_id: string;
  app_id: string;
  uuid: string;
  name: string;
  update_time: string;
  robot_path: string;
  package_data: any;
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

export type Theme = "light" | "dark" | "system";
export type Page = "home" | "migrate" | "accounts" | "local" | "cloud" | "settings";
