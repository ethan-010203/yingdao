import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/AuthContext";
import { appendOperationLog } from "@/lib/supabase";
import { AccountDetailDialog } from "@/components/AccountDetailDialog";
import { AddAccountDialog } from "@/components/AddAccountDialog";
import { ReLoginDialog } from "@/components/ReLoginDialog";
import { Toaster, toast } from "@/components/ui/toaster";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SettingsPage } from "@/components/SettingsPage";
import { useConfig } from "@/contexts/ConfigContext";
import {
  FolderSync,
  Users,
  Search,
  RefreshCw,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Check,
  X,
  CloudDownload,
  HardDrive,
  Plus,
  Loader2,
} from "lucide-react";

// 类型定义
// 类型定义
// Account is now imported from ConfigContext or defined there. 
// But strictly speaking, App.tsx defines its own Account interface. 
// Let's use the one from ConfigContext or keep it compatible.
interface Account {
  id: string;
  name: string;
  username: string;
  password: string;
}

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


type Theme = "light" | "dark" | "system";

type Page = "home" | "migrate" | "accounts" | "local" | "cloud" | "settings";
type LocalStep = "list" | "target" | "migrating" | "result";
type CloudStep = "source" | "list" | "target" | "migrating" | "result";

function App() {
  // Auth
  const { user, signOut, username, isAdmin } = useAuth();
  const { accounts, settings, saveAccounts, updateSettings } = useConfig();

  const handleUpdateSettings = (newSettings: Partial<typeof settings>) => {
    updateSettings(newSettings);
  };


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
    toast.success(`账号 "${acc?.name || '未命名'}" 已删除`);
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
      toast.success(`账号 "${data.name}" 已更新`);
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
      toast.success(`账号 "${data.name}" 添加成功`);
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
    setLoadingText("正在扫描本地流程...");
    try {
      const flows: LocalFlow[] = await invoke("get_local_flows");
      setLocalFlows(flows);
    } catch (e) {
      toast.error(`扫描失败: ${e}`);
    }
    setLoading(false);
    setLoadingText("");
  };

  const localNextToTarget = () => {
    if (selectedLocalIds.size === 0) {
      toast.error("请先选择要迁移的流程");
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
      toast.error("请选择或输入目标账号");
      return;
    }

    setLocalStep("migrating");
    setLoadingText("正在登录目标账号...");

    try {
      const token: string = await invoke("login_account", {
        username: creds.username,
        password: creds.password,
        accountType: "target"
      });

      const selectedFlows = Array.from(selectedLocalIds).map(i => localFlows[i]);
      setLoadingText(`正在迁移 ${selectedFlows.length} 个流程...`);

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
      toast.error(`操作失败: ${e}`);
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
      toast.error("请选择或输入源账号");
      return;
    }

    setLoading(true);
    setLoadingText("正在登录并获取流程...");

    try {
      const token: string = await invoke("login_account", {
        username: creds.username,
        password: creds.password,
        accountType: "source"
      });
      setSourceToken(token);

      const flows: CloudFlow[] = await invoke("get_cloud_flows", { token });
      setCloudFlows(flows);
      setCloudStep("list");
    } catch (e) {
      toast.error(`登录失败: ${e}`);
    }
    setLoading(false);
    setLoadingText("");
  };

  const cloudNextToTarget = () => {
    if (selectedCloudIds.size === 0) {
      toast.error("请先选择要迁移的流程");
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
      toast.error("请选择或输入目标账号");
      return;
    }

    setCloudStep("migrating");
    setLoadingText("正在登录目标账号...");

    try {
      const token: string = await invoke("login_account", {
        username: creds.username,
        password: creds.password,
        accountType: "target"
      });

      const selectedFlows = Array.from(selectedCloudIds).map(i => cloudFlows[i]);
      setLoadingText(`正在迁移 ${selectedFlows.length} 个流程...`);

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
      toast.error(`操作失败: ${e}`);
      setCloudStep("target");
    }
    setLoadingText("");
  };

  // 删除本地流程
  const deleteLocalFlows = async () => {
    if (selectedLocalIds.size === 0) return;
    if (!confirm(`确定要删除 ${selectedLocalIds.size} 个流程吗？`)) return;

    const selectedFlows = Array.from(selectedLocalIds).map(i => localFlows[i]);
    setLoading(true);
    setLoadingText(`正在删除...`);

    try {
      await invoke("delete_local_flows", { request: { flows: selectedFlows } });
      await refreshLocalFlows();
      setSelectedLocalIds(new Set());
      toast.success("删除成功");
      // 记录操作日志
      const flowNames = selectedFlows.map(f => f.name).join('、')
      if (user?.id) {
        await appendOperationLog(user.id, `删除了 ${selectedFlows.length} 个本地流程：${flowNames}`)
      }
    } catch (e) {
      toast.error(`删除失败: ${e}`);
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
        <span>每页</span>
        <select
          value={pageSize}
          onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="h-8 rounded-xl border-0 bg-muted/50 px-2.5 text-sm focus:ring-2 focus:ring-ring/30 outline-none transition-all"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
        <span>条</span>
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
        <p className="text-muted-foreground/80 font-medium">{loadingText}</p>
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
      <div className="space-y-2">
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
          <span className="font-medium">手动输入</span>
        </div>
      </div>

      {selectedId === "manual" && (
        <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-muted/30 animate-fade-in">
          <Input
            type="text"
            placeholder="用户名"
            value={manualUser}
            onChange={e => setManualUser(e.target.value)}
          />
          <Input
            type="password"
            placeholder="密码"
            value={manualPwd}
            onChange={e => setManualPwd(e.target.value)}
          />
        </div>
      )}
    </div>
  );

  // ===== 页面渲染 =====

  // 设置页面
  const renderSettings = () => (
    <div className="h-full animate-in fade-in zoom-in-95 duration-300">
      <SettingsPage />
    </div>
  );

  // 首页
  const renderHome = () => (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gradient">
          欢迎使用影刀工具
        </h1>
        <p className="text-muted-foreground/70 mt-2">选择一个功能开始</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card
          variant="default"
          className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
          onClick={() => setPage("migrate")}
        >
          <CardHeader className="p-7">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
              <FolderSync className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-lg">迁移流程</CardTitle>
            <CardDescription>本地或云端流程迁移到其他账号</CardDescription>
          </CardHeader>
        </Card>

        <Card
          variant="default"
          className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
          onClick={() => setPage("accounts")}
        >
          <CardHeader className="p-7">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
              <Users className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-lg">账号管理</CardTitle>
            <CardDescription>
              管理已保存的账号 ({accounts.length})
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );

  // 迁移选择页
  const renderMigrate = () => (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <Button variant="ghost" onClick={() => setPage("home")} className="mb-4 -ml-3 text-muted-foreground/70">
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回首页
        </Button>
        <h1 className="text-3xl font-bold text-gradient">迁移流程</h1>
        <p className="text-muted-foreground/70 mt-1">选择迁移方式</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card
          className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
          onClick={startLocalMigration}
        >
          <CardHeader className="p-7">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
              <HardDrive className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-lg">本地迁移</CardTitle>
            <CardDescription>将本地缓存的流程迁移到指定账号</CardDescription>
          </CardHeader>
        </Card>

        <Card
          className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
          onClick={startCloudMigration}
        >
          <CardHeader className="p-7">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
              <CloudDownload className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-lg">云端迁移</CardTitle>
            <CardDescription>从一个账号迁移流程到另一个账号</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );

  // 账号管理页
  const renderAccounts = () => (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-10">
        <div>
          <Button variant="ghost" onClick={() => setPage("home")} className="mb-4 -ml-3 text-muted-foreground/70">
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回首页
          </Button>
          <h1 className="text-3xl font-bold text-gradient">账号管理</h1>
        </div>
        <Button onClick={() => { setEditingAccount(null); setShowAddForm(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          添加账号
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-5">
              <Users className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground/70 mb-5">暂无保存的账号</p>
            <Button onClick={() => { setEditingAccount(null); setShowAddForm(true); }}>
              添加第一个账号
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map(acc => (
            <Card
              key={acc.id}
              className={cn("transition-all duration-200", isAdmin && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3]")}
              onClick={() => isAdmin && openAccountDetail(acc)}
            >
              <CardContent className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                    {acc.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold">{acc.name}</div>
                    <div className="text-sm text-muted-foreground/60">{acc.username}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingAccount(acc);
                      setShowAddForm(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/8"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`确定要删除账号 "${acc.name}" 吗？`)) {
                        deleteAccount(acc.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // 本地迁移页
  const renderLocalMigration = () => (
    <div className="max-w-4xl mx-auto">
      {(loading || localStep === "migrating") && renderLoading()}

      <div className="flex items-center justify-between mb-8">
        <div>
          <Button variant="ghost" onClick={() => setPage("home")} className="-ml-3 mb-2 text-muted-foreground/70">
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold text-gradient">本地迁移</h1>
        </div>
        <div className="flex gap-1.5">
          {["选择流程", "目标账号", "完成"].map((step, idx) => (
            <Badge
              key={step}
              variant={
                (localStep === "list" && idx === 0) ||
                  (localStep === "target" && idx === 1) ||
                  ((localStep === "result" || localStep === "migrating") && idx === 2)
                  ? "default"
                  : "secondary"
              }
              className="text-xs"
            >
              {idx + 1}. {step}
            </Badge>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {localStep === "list" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">选择要迁移的本地流程</h3>
                <Button variant="outline" size="sm" onClick={refreshLocalFlows} disabled={loading}>
                  <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                  刷新
                </Button>
              </div>

              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                  <Input
                    placeholder="搜索流程..."
                    value={localSearch}
                    onChange={e => { setLocalSearch(e.target.value); setLocalCurrentPage(1); }}
                    className="pl-10"
                  />
                </div>
                <span className="text-sm text-muted-foreground/60 whitespace-nowrap">
                  已选 {selectedLocalIds.size} / {filteredLocalFlows.length}
                </span>
              </div>

              <div className="rounded-2xl border border-border/30 overflow-hidden max-h-[300px] overflow-y-auto">
                {paginatedLocalFlows.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground/70">
                    {localSearch ? "未找到匹配的流程" : "暂无本地流程"}
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
                  <Button variant="outline" size="sm" onClick={() => setSelectedLocalIds(new Set(filteredLocalFlows.map(f => localFlows.indexOf(f))))}>
                    全选
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedLocalIds(new Set())}>
                    取消全选
                  </Button>
                  {isAdmin && (
                    <Button variant="destructive" size="sm" onClick={deleteLocalFlows} disabled={selectedLocalIds.size === 0}>
                      <Trash2 className="h-4 w-4 mr-1" />
                      删除
                    </Button>
                  )}
                </div>
                <Button onClick={localNextToTarget} disabled={selectedLocalIds.size === 0}>
                  下一步
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {localStep === "target" && (
            <div className="space-y-6">
              {renderAccountSelector(targetAccountId, setTargetAccountId, targetManualUser, setTargetManualUser, targetManualPwd, setTargetManualPwd, "选择目标账号")}

              <div className="p-4 rounded-2xl bg-primary/6 text-center">
                <span className="text-primary font-medium">已选择 {selectedLocalIds.size} 个流程</span>
              </div>

              <div className="flex justify-between pt-4 border-t border-border/20">
                <Button variant="outline" onClick={() => setLocalStep("list")}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  上一步
                </Button>
                <Button
                  onClick={localDoMigrate}
                  disabled={!targetAccountId || (targetAccountId === "manual" && (!targetManualUser || !targetManualPwd))}
                >
                  开始迁移
                </Button>
              </div>
            </div>
          )}

          {localStep === "result" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-center">迁移完成</h3>

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
                成功 {results.filter(r => r.success).length} / {results.length} 个
              </div>

              <div className="flex justify-center pt-4">
                <Button onClick={() => setPage("home")}>返回首页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // 云端迁移页
  const renderCloudMigration = () => (
    <div className="max-w-4xl mx-auto">
      {(loading || cloudStep === "migrating") && renderLoading()}

      <div className="flex items-center justify-between mb-8">
        <div>
          <Button variant="ghost" onClick={() => setPage("home")} className="-ml-3 mb-2 text-muted-foreground/70">
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold text-gradient">云端迁移</h1>
        </div>
        <div className="flex gap-1.5">
          {["源账号", "选择流程", "目标账号", "完成"].map((step, idx) => (
            <Badge
              key={step}
              variant={
                (cloudStep === "source" && idx === 0) ||
                  (cloudStep === "list" && idx === 1) ||
                  (cloudStep === "target" && idx === 2) ||
                  ((cloudStep === "result" || cloudStep === "migrating") && idx === 3)
                  ? "default"
                  : "secondary"
              }
              className="text-xs"
            >
              {idx + 1}. {step}
            </Badge>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {cloudStep === "source" && (
            <div className="space-y-6">
              {renderAccountSelector(sourceAccountId, setSourceAccountId, sourceManualUser, setSourceManualUser, sourceManualPwd, setSourceManualPwd, "选择源账号（从此账号获取流程）")}

              <div className="flex justify-end pt-4 border-t border-border/20">
                <Button
                  onClick={cloudLoginSource}
                  disabled={!sourceAccountId || (sourceAccountId === "manual" && (!sourceManualUser || !sourceManualPwd)) || loading}
                >
                  登录并获取流程
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {cloudStep === "list" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">选择要迁移的流程</h3>

              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                  <Input
                    placeholder="搜索流程..."
                    value={cloudSearch}
                    onChange={e => { setCloudSearch(e.target.value); setCloudCurrentPage(1); }}
                    className="pl-10"
                  />
                </div>
                <span className="text-sm text-muted-foreground/60 whitespace-nowrap">
                  已选 {selectedCloudIds.size} / {filteredCloudFlows.length}
                </span>
              </div>

              <div className="rounded-2xl border border-border/30 overflow-hidden max-h-[300px] overflow-y-auto">
                {paginatedCloudFlows.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground/70">
                    {cloudSearch ? "未找到匹配的流程" : "暂无云端流程"}
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
                  <Button variant="outline" size="sm" onClick={() => setSelectedCloudIds(new Set(filteredCloudFlows.map(f => cloudFlows.indexOf(f))))}>
                    全选
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedCloudIds(new Set())}>
                    取消全选
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCloudStep("source")}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    上一步
                  </Button>
                </div>
                <Button onClick={cloudNextToTarget} disabled={selectedCloudIds.size === 0}>
                  下一步
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {cloudStep === "target" && (
            <div className="space-y-6">
              {renderAccountSelector(targetAccountId, setTargetAccountId, targetManualUser, setTargetManualUser, targetManualPwd, setTargetManualPwd, "选择目标账号")}

              <div className="p-4 rounded-2xl bg-primary/6 text-center">
                <span className="text-primary font-medium">已选择 {selectedCloudIds.size} 个流程</span>
              </div>

              <div className="flex justify-between pt-4 border-t border-border/20">
                <Button variant="outline" onClick={() => setCloudStep("list")}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  上一步
                </Button>
                <Button
                  onClick={cloudDoMigrate}
                  disabled={!targetAccountId || (targetAccountId === "manual" && (!targetManualUser || !targetManualPwd))}
                >
                  开始迁移
                </Button>
              </div>
            </div>
          )}

          {cloudStep === "result" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-center">迁移完成</h3>

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
                成功 {results.filter(r => r.success).length} / {results.length} 个
              </div>

              <div className="flex justify-center pt-4">
                <Button onClick={() => setPage("home")}>返回首页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );


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
      {page === "home" && renderHome()}
      {page === "migrate" && renderMigrate()}
      {page === "accounts" && renderAccounts()}
      {page === "local" && renderLocalMigration()}
      {page === "cloud" && renderCloudMigration()}
      {page === "settings" && renderSettings()}

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
