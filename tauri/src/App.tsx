import { useState, useMemo, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/AuthContext";
import { appendOperationLog } from "@/lib/supabase";
import { AccountDetailDialog } from "@/components/AccountDetailDialog";
import { AddAccountDialog } from "@/components/AddAccountDialog";
import { ReLoginDialog } from "@/components/ReLoginDialog";
import { HomePage } from "@/components/HomePage";
import { MigratePage } from "@/components/MigratePage";
import { AccountsPage } from "@/components/AccountsPage";
import { Toaster, toast } from "@/components/ui/toaster";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SettingsPage } from "@/components/SettingsPage";
import { useConfig, Account } from "@/contexts/ConfigContext";
import { useTranslation } from "@/lib/i18n";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Search,
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import Stepper, { Step } from "@/components/ui/Stepper";
import { listen } from "@tauri-apps/api/event";

// 类型定义
// Account is imported from ConfigContext

interface LocalFlow {
  user_id: string;
  app_id: string;
  uuid: string;
  name: string;
  update_time: string;
  robot_path: string;
  package_data: any;
}

interface CloudFlow {
  appId: string;
  appName: string;
  updateTime?: string;
}

interface MigrateResult {
  success: boolean;
  name: string;
  message: string;
}

interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string | null;
}

interface DownloadProgressPayload {
  downloaded: number;
  total: number;
  percentage: number;
}


type Theme = "light" | "dark" | "system";

type Page = "home" | "migrate" | "accounts" | "local" | "cloud" | "settings";
type LocalStep = "list" | "target" | "migrating" | "result";
type CloudStep = "source" | "list" | "target" | "migrating" | "result";

function App() {
  const { t } = useTranslation();
  // Auth
  const { user, signOut, username, isAdmin } = useAuth();
  const { accounts, settings, saveAccounts, updateSettings } = useConfig();

  const handleUpdateSettings = (newSettings: Partial<typeof settings>) => {
    updateSettings(newSettings);
  };

  // ===== 自动检测更新 =====
  const handleAutoDownload = useCallback(async (downloadUrl: string) => {
    const unlisten = await listen<DownloadProgressPayload>("download-progress", () => {
      // Progress is handled by SettingsPage if user navigates there
    });
    try {
      const filePath = await invoke<string>("download_update", { downloadUrl });
      unlisten();
      toast.success(t("settings.check_update.installing"));
      await new Promise(resolve => setTimeout(resolve, 800));
      await invoke("open_file_and_exit", { filePath });
    } catch (error) {
      unlisten();
      console.error("Auto-update download failed:", error);
      toast.error(t("settings.check_update.download_failed") + ": " + String(error));
    }
  }, [t]);

  useEffect(() => {
    if (!settings.auto_update) return;

    const timer = setTimeout(async () => {
      // 如果用户已经在设置页面，跳过自动检测（设置页有手动检查按钮）
      if (page === "settings") return;
      try {
        const info = await invoke<UpdateInfo>("check_for_update");
        if (info.hasUpdate) {
          toast.success(
            t("settings.check_update.found").replace("{version}", `v${info.latestVersion}`),
            {
              duration: 15000,
              action: info.downloadUrl
                ? {
                  label: t("settings.check_update.download"),
                  onClick: () => handleAutoDownload(info.downloadUrl!),
                }
                : undefined,
            }
          );
        }
      } catch (error) {
        console.error("Auto update check failed:", error);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [settings.auto_update, t, handleAutoDownload]);


  // 页面导航
  const [page, setPage] = useState<Page>("home");
  const [localStep, setLocalStep] = useState<LocalStep>("list");
  const [cloudStep, setCloudStep] = useState<CloudStep>("source");

  // 账号管理 - editing state remains local
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // 本地迁移状态
  const [localFlows, setLocalFlows] = useState<LocalFlow[]>([]);
  const [selectedLocalIds, setSelectedLocalIds] = useState<Set<number>>(new Set());
  const [localSearch, setLocalSearch] = useState("");
  const [localPageSize, setLocalPageSize] = useState(10);
  const [localCurrentPage, setLocalCurrentPage] = useState(1);

  // 云端迁移状态
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [sourceManualUser, setSourceManualUser] = useState("");
  const [sourceManualPwd, setSourceManualPwd] = useState("");
  const [sourceToken, setSourceToken] = useState("");
  const [cloudFlows, setCloudFlows] = useState<CloudFlow[]>([]);
  const [selectedCloudIds, setSelectedCloudIds] = useState<Set<number>>(new Set());
  const [cloudSearch, setCloudSearch] = useState("");
  const [cloudPageSize, setCloudPageSize] = useState(10);
  const [cloudCurrentPage, setCloudCurrentPage] = useState(1);

  // 目标账号
  const [targetAccountId, setTargetAccountId] = useState("");
  const [targetManualUser, setTargetManualUser] = useState("");
  const [targetManualPwd, setTargetManualPwd] = useState("");

  // 状态
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [results, setResults] = useState<MigrateResult[]>([]);

  // 弹窗状态
  const [detailAccount, setDetailAccount] = useState<Account | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [reLoginAccount, setReLoginAccount] = useState<Account | null>(null);
  const [reLoginOpen, setReLoginOpen] = useState(false);

  // 初始化 - Config is loaded by Context now
  // useEffect(() => {
  //   loadConfig();
  // }, []);

  // 主题 handling is done in ConfigContext

  // Helper to save accounts via context
  // const saveAccounts = ... already from context

  const deleteAccount = async (id: string) => {
    const acc = accounts.find(a => a.id === id);
    const newAccounts = accounts.filter(a => a.id !== id);
    await saveAccounts(newAccounts); // Context method
    toast.success(t("common.success"));
    // 记录操作日志
    if (user?.id && acc) {
      await appendOperationLog(user.id, `删除了账号「${acc.username}」`)
    }
  };

  const handleSaveAccount = async (data: { name: string; username: string; password: string }) => {
    if (editingAccount) {
      const newAccounts = accounts.map(a =>
        a.id === editingAccount.id ? { ...a, ...data } : a
      );
      await saveAccounts(newAccounts);
      toast.success(t("common.success"));
      // 记录操作日志
      if (user?.id) {
        await appendOperationLog(user.id, `编辑了账号「${data.username}」`)
      }
    } else {
      const newAcc: Account = {
        id: `acc_${Date.now()}`,
        ...data,
      };
      const newAccounts = [...accounts, newAcc];
      await saveAccounts(newAccounts);
      toast.success(t("common.success"));
      // 记录操作日志
      if (user?.id) {
        await appendOperationLog(user.id, `添加了账号「${data.username}」`)
      }
    }
    setEditingAccount(null);
  };


  const openAccountDetail = (acc: Account) => {
    setDetailAccount(acc);
    setDetailOpen(true);
  };

  const handleTokenExpired = (acc: Account) => {
    setReLoginAccount(acc);
    setReLoginOpen(true);
  };

  const updateAccountPassword = async (accountId: string, newPassword: string) => {
    const newAccounts = accounts.map(a =>
      a.id === accountId ? { ...a, password: newPassword } : a
    );
    await saveAccounts(newAccounts);
  };

  const getAccount = (id: string) => accounts.find(a => a.id === id);

  // 分页
  const filteredLocalFlows = useMemo(() => {
    if (!localSearch.trim()) return localFlows;
    const q = localSearch.toLowerCase();
    return localFlows.filter(f => f.name.toLowerCase().includes(q));
  }, [localFlows, localSearch]);

  const localTotalPages = Math.ceil(filteredLocalFlows.length / localPageSize);
  const paginatedLocalFlows = useMemo(() => {
    const start = (localCurrentPage - 1) * localPageSize;
    return filteredLocalFlows.slice(start, start + localPageSize);
  }, [filteredLocalFlows, localCurrentPage, localPageSize]);

  const filteredCloudFlows = useMemo(() => {
    if (!cloudSearch.trim()) return cloudFlows;
    const q = cloudSearch.toLowerCase();
    return cloudFlows.filter(f => f.appName.toLowerCase().includes(q));
  }, [cloudFlows, cloudSearch]);

  const cloudTotalPages = Math.ceil(filteredCloudFlows.length / cloudPageSize);
  const paginatedCloudFlows = useMemo(() => {
    const start = (cloudCurrentPage - 1) * cloudPageSize;
    return filteredCloudFlows.slice(start, start + cloudPageSize);
  }, [filteredCloudFlows, cloudCurrentPage, cloudPageSize]);

  // 本地迁移
  const startLocalMigration = async () => {
    setPage("local");
    setLocalStep("list");
    setSelectedLocalIds(new Set());
    setLocalSearch("");
    setLocalCurrentPage(1);
    setResults([]);
    await refreshLocalFlows();
  };

  const refreshLocalFlows = async () => {
    setLoading(true);
    setLoadingText(t("migrate.local.scanning"));
    try {
      const flows: LocalFlow[] = await invoke("get_local_flows");
      setLocalFlows(flows);
    } catch (e) {
      toast.error(`${t("common.error")}: ${e}`);
    }
    setLoading(false);
    setLoadingText("");
  };

  const localNextToTarget = () => {
    if (selectedLocalIds.size === 0) {
      toast.error(t("common.error"));
      return;
    }
    setLocalStep("target");
    setTargetAccountId("");
    setTargetManualUser("");
    setTargetManualPwd("");
  };

  const getTargetCredentials = () => {
    if (targetAccountId === "manual") {
      return { username: targetManualUser, password: targetManualPwd, name: targetManualUser };
    }
    const acc = getAccount(targetAccountId);
    return acc ? { username: acc.username, password: acc.password, name: acc.username } : null;
  };

  const localDoMigrate = async () => {
    const creds = getTargetCredentials();
    if (!creds || !creds.username || !creds.password) {
      toast.error(t("migrate.select_account"));
      return;
    }

    setLocalStep("migrating");
    setLoadingText(t("migrate.logging_in_target"));

    try {
      const token: string = await invoke("login_account", {
        username: creds.username,
        password: creds.password,
      });

      const selectedFlows = Array.from(selectedLocalIds).map(i => localFlows[i]);
      setLoadingText(t("migrate.migrating_flows").replace("{count}", String(selectedFlows.length)));

      const results: MigrateResult[] = await invoke("migrate_flows", {
        request: {
          flow_type: "local",
          flows: selectedFlows,
          target_token: token,
        }
      });

      setResults(results);
      setLocalStep("result");
      // 记录操作日志
      const successCount = results.filter(r => r.success).length
      const flowNames = selectedFlows.map(f => f.name).join('、')
      if (user?.id) {
        await appendOperationLog(user.id, `本地迁移 ${successCount}/${selectedFlows.length} 个流程到账号「${creds.name}」：${flowNames}`)
      }
    } catch (e) {
      toast.error(`${t("common.error")}: ${e}`);
      setLocalStep("target");
    }
    setLoadingText("");
  };

  // 云端迁移
  const startCloudMigration = () => {
    setPage("cloud");
    setCloudStep("source");
    setSourceAccountId("");
    setSourceManualUser("");
    setSourceManualPwd("");
    setSourceToken("");
    setCloudFlows([]);
    setSelectedCloudIds(new Set());
    setCloudSearch("");
    setCloudCurrentPage(1);
    setResults([]);
  };

  const getSourceCredentials = () => {
    if (sourceAccountId === "manual") {
      return { username: sourceManualUser, password: sourceManualPwd };
    }
    const acc = getAccount(sourceAccountId);
    return acc ? { username: acc.username, password: acc.password } : null;
  };

  const cloudLoginSource = async () => {
    const creds = getSourceCredentials();
    if (!creds || !creds.username || !creds.password) {
      toast.error(t("migrate.target.select"));
      return;
    }

    setLoading(true);
    setLoadingText(t("migrate.cloud.fetching"));

    try {
      const token: string = await invoke("login_account", {
        username: creds.username,
        password: creds.password,
      });
      setSourceToken(token);

      const flows: CloudFlow[] = await invoke("get_cloud_flows", { token });
      setCloudFlows(flows);
      setCloudStep("list");
    } catch (e) {
      toast.error(`${t("common.error")}: ${e}`);
    }
    setLoading(false);
    setLoadingText("");
  };

  const cloudNextToTarget = () => {
    if (selectedCloudIds.size === 0) {
      toast.error(t("common.error"));
      return;
    }
    setCloudStep("target");
    setTargetAccountId("");
    setTargetManualUser("");
    setTargetManualPwd("");
  };

  const cloudDoMigrate = async () => {
    const creds = getTargetCredentials();
    if (!creds || !creds.username || !creds.password) {
      toast.error(t("migrate.select_account"));
      return;
    }

    setCloudStep("migrating");
    setLoadingText(t("migrate.logging_in_target"));

    try {
      const token: string = await invoke("login_account", {
        username: creds.username,
        password: creds.password,
      });

      const selectedFlows = Array.from(selectedCloudIds).map(i => cloudFlows[i]);
      setLoadingText(t("migrate.migrating_flows").replace("{count}", String(selectedFlows.length)));

      const results: MigrateResult[] = await invoke("migrate_flows", {
        request: {
          flow_type: "cloud",
          flows: selectedFlows,
          target_token: token,
          source_token: sourceToken,
        }
      });

      setResults(results);
      setCloudStep("result");
      // 记录操作日志
      const successCount = results.filter(r => r.success).length
      const flowNames = selectedFlows.map(f => f.appName).join('、')
      if (user?.id) {
        await appendOperationLog(user.id, `云端迁移 ${successCount}/${selectedFlows.length} 个流程到账号「${creds.name}」：${flowNames}`)
      }
    } catch (e) {
      toast.error(`${t("common.error")}: ${e}`);
      setCloudStep("target");
    }
    setLoadingText("");
  };

  // 删除本地流程
  const deleteLocalFlows = async () => {
    if (selectedLocalIds.size === 0) return;
    if (!confirm(t("accounts.delete.flows.confirm").replace("{count}", String(selectedLocalIds.size)))) return;

    const selectedFlows = Array.from(selectedLocalIds).map(i => localFlows[i]);
    setLoading(true);
    setLoadingText(t("common.loading"));

    try {
      await invoke("delete_local_flows", { request: { flows: selectedFlows } });
      await refreshLocalFlows();
      setSelectedLocalIds(new Set());
      toast.success(t("common.success"));
      // 记录操作日志
      const flowNames = selectedFlows.map(f => f.name).join('、')
      if (user?.id) {
        await appendOperationLog(user.id, `删除了 ${selectedFlows.length} 个本地流程：${flowNames}`)
      }
    } catch (e) {
      toast.error(`${t("common.error")}: ${e}`);
    }
    setLoading(false);
    setLoadingText("");
  };

  // 渲染分页
  const renderPagination = (
    currentPage: number,
    totalPages: number,
    setPage: (p: number) => void,
    pageSize: number,
    setPageSize: (s: number) => void
  ) => (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
        <span>{t("common.pagination.per_page")}</span>
        <select
          value={pageSize}
          onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="h-8 rounded-xl border-0 bg-muted/50 px-2.5 text-sm focus:ring-2 focus:ring-ring/30 outline-none transition-all"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
        <span>{t("common.pagination.unit")}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg h-8 w-8 p-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground/70 min-w-[60px] text-center font-medium">
          {currentPage} / {totalPages || 1}
        </span>
        <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg h-8 w-8 p-0">
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // 加载遮罩
  const renderLoading = () => (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/70 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-5 animate-scale-in">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
          <Loader2 className="h-10 w-10 animate-spin text-primary relative" />
        </div>
        <p className="text-muted-foreground/80 font-medium">{loadingText || t("common.loading")}</p>
      </div>
    </div>
  );

  // 账号选择器
  const renderAccountSelector = (
    selectedId: string,
    setSelectedId: (id: string) => void,
    manualUser: string,
    setManualUser: (u: string) => void,
    manualPwd: string,
    setManualPwd: (p: string) => void,
    title: string
  ) => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="space-y-2 max-h-[240px] overflow-y-auto">
        {accounts.map(acc => (
          <div
            key={acc.id}
            onClick={() => setSelectedId(acc.id)}
            className={cn(
              "flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all duration-200",
              selectedId === acc.id
                ? "bg-primary/8 shadow-sm shadow-primary/10 ring-1 ring-primary/20"
                : "bg-muted/30 hover:bg-muted/50"
            )}
          >
            <div className={cn(
              "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
              selectedId === acc.id ? "border-primary" : "border-muted-foreground/40"
            )}>
              {selectedId === acc.id && <div className="w-2 h-2 rounded-full bg-primary" />}
            </div>
            <div className="flex-1">
              <div className="font-medium">{acc.name}</div>
              <div className="text-sm text-muted-foreground/70">{acc.username}</div>
            </div>
          </div>
        ))}

        <div
          onClick={() => setSelectedId("manual")}
          className={cn(
            "flex items-center gap-3 p-4 rounded-2xl border border-dashed cursor-pointer transition-all duration-200",
            selectedId === "manual"
              ? "border-primary/40 bg-primary/8"
              : "border-border/50 hover:border-primary/30 hover:bg-muted/30"
          )}
        >
          <div className={cn(
            "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
            selectedId === "manual" ? "border-primary" : "border-muted-foreground/40"
          )}>
            {selectedId === "manual" && <div className="w-2 h-2 rounded-full bg-primary" />}
          </div>
          <span className="font-medium">{t("migrate.target.manual")}</span>
        </div>
      </div>

      {selectedId === "manual" && (
        <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-muted/30 animate-fade-in">
          <Input
            type="text"
            placeholder={t("migrate.manual.username")}
            value={manualUser}
            onChange={e => setManualUser(e.target.value)}
          />
          <Input
            type="password"
            placeholder={t("migrate.manual.password")}
            value={manualPwd}
            onChange={e => setManualPwd(e.target.value)}
          />
        </div>
      )}
    </div>
  );

  // ===== 页面渲染 =====

  // 本地迁移页
  const renderLocalMigration = () => {
    const getLocalStepNumber = () => {
      switch (localStep) {
        case "list": return 1;
        case "target": return 2;
        case "result":
        case "migrating": return 3;
        default: return 1;
      }
    };

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {(loading || localStep === "migrating") && renderLoading()}

        <div className="flex items-center justify-between mb-2">
          <div>
            <Button variant="ghost" onClick={() => setPage("home")} className="-ml-3 mb-2 text-muted-foreground/70">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("common.back")}
            </Button>
            <h1 className="text-2xl font-bold text-gradient">{t("migrate.local")}</h1>
          </div>
        </div>

        <Stepper
          currentStep={getLocalStepNumber()}
          steps={[t("migrate.step.list"), t("migrate.step.target"), t("migrate.step.result")]}
          disableStepIndicators
          showFooter={false}
          stepCircleContainerClassName="border-0 shadow-none bg-transparent"
          stepContainerClassName="px-0 pb-6"
        >
          {/* Step 1: Select Flows */}
          <Step>
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-lg font-semibold">{t("migrate.step.list")}</h3>
                <div className="flex items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input
                      placeholder={t("common.search")}
                      value={localSearch}
                      onChange={e => { setLocalSearch(e.target.value); setLocalCurrentPage(1); }}
                      className="pl-10 h-9 text-sm"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground/60 whitespace-nowrap">
                    {t("accounts.flow.selected").replace("{count}", String(selectedLocalIds.size))} / {filteredLocalFlows.length}
                  </span>
                </div>
                <div className="rounded-xl border border-border/30 overflow-hidden max-h-[200px] overflow-y-auto bg-muted/5">
                  {paginatedLocalFlows.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground/70">
                      {localSearch ? t("common.error") : t("common.loading")}
                    </div>
                  ) : (
                    paginatedLocalFlows.map((flow) => {
                      const realIdx = localFlows.indexOf(flow);
                      return (
                        <div
                          key={realIdx}
                          onClick={() => {
                            const newSet = new Set(selectedLocalIds);
                            if (newSet.has(realIdx)) newSet.delete(realIdx);
                            else newSet.add(realIdx);
                            setSelectedLocalIds(newSet);
                          }}
                          className={cn(
                            "flex items-center gap-3 p-3.5 border-b border-border/20 last:border-0 cursor-pointer transition-all duration-200",
                            selectedLocalIds.has(realIdx) ? "bg-primary/6" : "hover:bg-muted/40"
                          )}
                        >
                          <div className={cn(
                            "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                            selectedLocalIds.has(realIdx) ? "bg-primary border-primary" : "border-muted-foreground/30"
                          )}>
                            {selectedLocalIds.has(realIdx) && <Check className="h-3 w-3 text-primary-foreground" />}
                          </div>
                          <span className="flex-1 font-medium truncate">{flow.name}</span>
                          <span className="text-sm text-muted-foreground/50">{flow.update_time}</span>
                        </div>
                      );
                    })
                  )}
                </div>
                {renderPagination(localCurrentPage, localTotalPages, setLocalCurrentPage, localPageSize, setLocalPageSize)}
                <div className="flex items-center justify-between pt-4 border-t border-border/20">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      if (selectedLocalIds.size > 0) {
                        setSelectedLocalIds(new Set());
                      } else {
                        setSelectedLocalIds(new Set(filteredLocalFlows.map(f => localFlows.indexOf(f))));
                      }
                    }}>
                      {selectedLocalIds.size > 0 ? t("common.deselect_all") : t("common.select_all")}
                    </Button>
                    {isAdmin && (
                      <Button variant="destructive" size="sm" onClick={deleteLocalFlows} disabled={selectedLocalIds.size === 0}>
                        <Trash2 className="h-4 w-4 mr-1" />
                        {t("common.delete")}
                      </Button>
                    )}
                  </div>
                  <Button onClick={localNextToTarget} disabled={selectedLocalIds.size === 0}>
                    {t("common.confirm")}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Step>

          {/* Step 2: Select Target */}
          <Step>
            <Card>
              <CardContent className="p-4 space-y-4">
                {renderAccountSelector(targetAccountId, setTargetAccountId, targetManualUser, setTargetManualUser, targetManualPwd, setTargetManualPwd, t("migrate.target.select"))}
                <div className="p-3 rounded-xl bg-primary/6 text-center">
                  <span className="text-primary text-sm font-medium">{t("accounts.flow.selected").replace("{count}", String(selectedLocalIds.size))}</span>
                </div>
                <div className="flex justify-between pt-3 border-t border-border/20">
                  <Button variant="outline" size="sm" onClick={() => setLocalStep("list")}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t("common.back")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={localDoMigrate}
                    disabled={!targetAccountId || (targetAccountId === "manual" && (!targetManualUser || !targetManualPwd))}
                  >
                    {t("migrate.start")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Step>

          {/* Step 3: Result */}
          <Step>
            <Card>
              <CardContent className="p-6 space-y-4">
                <h3 className="text-lg font-semibold text-center">{t("migrate.step.result")}</h3>
                <div className="max-h-[300px] overflow-y-auto space-y-2">
                  {results.map((r, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-center gap-3 p-3.5 rounded-xl",
                        r.success ? "bg-emerald-500/8" : "bg-red-500/8"
                      )}
                    >
                      {r.success ? (
                        <Check className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <X className="h-5 w-5 text-red-500" />
                      )}
                      <span className="font-medium">{r.name}</span>
                    </div>
                  ))}
                </div>
                <div className="text-center text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  {t("common.success")} {results.filter(r => r.success).length} / {results.length} 个
                </div>
                <div className="flex justify-center pt-4">
                  <Button onClick={() => setPage("home")}>{t("common.home")}</Button>
                </div>
              </CardContent>
            </Card>
          </Step>
        </Stepper>
      </div>
    );
  };

  // 云端迁移页
  const renderCloudMigration = () => {
    const getCloudStepNumber = () => {
      switch (cloudStep) {
        case "source": return 1;
        case "list": return 2;
        case "target": return 3;
        case "result":
        case "migrating": return 4;
        default: return 1;
      }
    };

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {(loading || cloudStep === "migrating") && renderLoading()}

        <div className="flex items-center justify-between mb-2">
          <div>
            <Button variant="ghost" onClick={() => setPage("home")} className="-ml-3 mb-2 text-muted-foreground/70">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("common.back")}
            </Button>
            <h1 className="text-2xl font-bold text-gradient">{t("migrate.cloud")}</h1>
          </div>
        </div>

        <Stepper
          currentStep={getCloudStepNumber()}
          steps={[t("migrate.step.source"), t("migrate.step.list"), t("migrate.step.target"), t("migrate.step.result")]}
          disableStepIndicators
          showFooter={false}
          stepCircleContainerClassName="border-0 shadow-none bg-transparent"
          stepContainerClassName="px-0 pb-6"
        >
          {/* Step 1: Select Source */}
          <Step>
            <Card>
              <CardContent className="p-4 space-y-4">
                {renderAccountSelector(sourceAccountId, setSourceAccountId, sourceManualUser, setSourceManualUser, sourceManualPwd, setSourceManualPwd, t("migrate.source.select"))}
                <div className="flex justify-end pt-4 border-t border-border/20">
                  <Button
                    onClick={cloudLoginSource}
                    disabled={!sourceAccountId || (sourceAccountId === "manual" && (!sourceManualUser || !sourceManualPwd)) || loading}
                  >
                    {t("migrate.cloud.fetch_button")}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Step>

          {/* Step 2: Select Flows */}
          <Step>
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-lg font-semibold">{t("migrate.step.list")}</h3>
                <div className="flex items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input
                      placeholder={t("common.search")}
                      value={cloudSearch}
                      onChange={e => { setCloudSearch(e.target.value); setCloudCurrentPage(1); }}
                      className="pl-10 h-9 text-sm"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground/60 whitespace-nowrap">
                    {t("accounts.flow.selected").replace("{count}", String(selectedCloudIds.size))} / {filteredCloudFlows.length}
                  </span>
                </div>
                <div className="rounded-xl border border-border/30 overflow-hidden max-h-[200px] overflow-y-auto bg-muted/5">
                  {paginatedCloudFlows.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground/70">
                      {cloudSearch ? t("common.error") : t("common.loading")}
                    </div>
                  ) : (
                    paginatedCloudFlows.map((flow) => {
                      const realIdx = cloudFlows.indexOf(flow);
                      return (
                        <div
                          key={realIdx}
                          onClick={() => {
                            const newSet = new Set(selectedCloudIds);
                            if (newSet.has(realIdx)) newSet.delete(realIdx);
                            else newSet.add(realIdx);
                            setSelectedCloudIds(newSet);
                          }}
                          className={cn(
                            "flex items-center gap-3 p-3.5 border-b border-border/20 last:border-0 cursor-pointer transition-all duration-200",
                            selectedCloudIds.has(realIdx) ? "bg-primary/6" : "hover:bg-muted/40"
                          )}
                        >
                          <div className={cn(
                            "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                            selectedCloudIds.has(realIdx) ? "bg-primary border-primary" : "border-muted-foreground/30"
                          )}>
                            {selectedCloudIds.has(realIdx) && <Check className="h-3 w-3 text-primary-foreground" />}
                          </div>
                          <span className="flex-1 font-medium truncate">{flow.appName}</span>
                          <span className="text-sm text-muted-foreground/50">{flow.updateTime?.substring(0, 19) || ""}</span>
                        </div>
                      );
                    })
                  )}
                </div>
                {renderPagination(cloudCurrentPage, cloudTotalPages, setCloudCurrentPage, cloudPageSize, setCloudPageSize)}
                <div className="flex items-center justify-between pt-4 border-t border-border/20">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      if (selectedCloudIds.size > 0) {
                        setSelectedCloudIds(new Set());
                      } else {
                        setSelectedCloudIds(new Set(filteredCloudFlows.map(f => cloudFlows.indexOf(f))));
                      }
                    }}>
                      {selectedCloudIds.size > 0 ? t("common.deselect_all") : t("common.select_all")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setCloudStep("source")}>
                      <ArrowLeft className="h-4 w-4 mr-1" />
                      {t("common.back")}
                    </Button>
                  </div>
                  <Button onClick={cloudNextToTarget} disabled={selectedCloudIds.size === 0}>
                    {t("common.confirm")}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Step>

          {/* Step 3: Select Target */}
          <Step>
            <Card>
              <CardContent className="p-4 space-y-4">
                {renderAccountSelector(targetAccountId, setTargetAccountId, targetManualUser, setTargetManualUser, targetManualPwd, setTargetManualPwd, t("migrate.target.select"))}
                <div className="p-3 rounded-xl bg-primary/6 text-center">
                  <span className="text-primary text-sm font-medium">{t("accounts.flow.selected").replace("{count}", String(selectedCloudIds.size))}</span>
                </div>
                <div className="flex justify-between pt-3 border-t border-border/20">
                  <Button variant="outline" size="sm" onClick={() => setCloudStep("list")}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t("common.back")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={cloudDoMigrate}
                    disabled={!targetAccountId || (targetAccountId === "manual" && (!targetManualUser || !targetManualPwd))}
                  >
                    {t("migrate.start")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Step>

          {/* Step 4: Result */}
          <Step>
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-lg font-semibold text-center">{t("migrate.step.result")}</h3>
                <div className="max-h-[220px] overflow-y-auto space-y-1.5">
                  {results.map((r, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-center gap-3 p-2.5 rounded-lg",
                        r.success ? "bg-emerald-500/8" : "bg-red-500/8"
                      )}
                    >
                      {r.success ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <X className="h-4 w-4 text-red-500" />
                      )}
                      <span className="font-medium text-sm">{r.name}</span>
                    </div>
                  ))}
                </div>
                <div className="text-center text-md font-semibold text-emerald-600 dark:text-emerald-400">
                  {t("common.success")} {results.filter(r => r.success).length} / {results.length} 个
                </div>
                <div className="flex justify-center pt-2">
                  <Button size="sm" onClick={() => setPage("home")}>{t("common.home")}</Button>
                </div>
              </CardContent>
            </Card>
          </Step>
        </Stepper>
      </div>
    );
  };


  return (
    <Layout
      currentPage={page}
      onNavigate={setPage}
      theme={settings.theme as Theme}
      onThemeChange={(t) => handleUpdateSettings({ theme: t })}
      accountsCount={accounts.length}
      onSignOut={signOut}
      username={username}
      isAdmin={isAdmin}
      language={settings.language}
    >
      {page === "home" && <HomePage accountsCount={accounts.length} onNavigate={setPage} />}
      {page === "migrate" && <MigratePage onNavigate={setPage} onStartLocal={startLocalMigration} onStartCloud={startCloudMigration} />}
      {page === "accounts" && (
        <AccountsPage
          accounts={accounts}
          isAdmin={isAdmin}
          onNavigate={setPage}
          onAddAccount={() => { setEditingAccount(null); setShowAddForm(true); }}
          onEditAccount={(acc) => { setEditingAccount(acc); setShowAddForm(true); }}
          onDeleteAccount={deleteAccount}
          onOpenDetail={openAccountDetail}
        />
      )}
      {page === "local" && renderLocalMigration()}
      {page === "cloud" && renderCloudMigration()}
      {page === "settings" && (
        <div className="h-full animate-in fade-in zoom-in-95 duration-300">
          <SettingsPage />
        </div>
      )}

      {/* 账号详情弹窗 */}
      <AccountDetailDialog
        account={detailAccount}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDeleteAccount={deleteAccount}
        onTokenExpired={handleTokenExpired}
      />

      {/* 添加/编辑账号弹窗 */}
      <AddAccountDialog
        open={addDialogOpen || showAddForm}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) setShowAddForm(false);
        }}
        onSave={handleSaveAccount}
        editAccount={editingAccount}
      />

      {/* 重新登录弹窗 */}
      <ReLoginDialog
        open={reLoginOpen}
        onOpenChange={setReLoginOpen}
        account={reLoginAccount}
        onSuccess={() => {
          if (reLoginAccount) {
            setDetailAccount(reLoginAccount);
            setDetailOpen(true);
          }
        }}
        onUpdatePassword={updateAccountPassword}
      />

      {/* Toast 通知 */}
      <Toaster position="top-center" richColors />
    </Layout>
  );
}

export default App;
