import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

import { Layout } from "@/components/layout";
import { Toaster, toast } from "@/components/ui/toaster";

import { AccountDetailDialog } from "@/components/AccountDetailDialog";
import { AddAccountDialog } from "@/components/AddAccountDialog";
import { ReLoginDialog } from "@/components/ReLoginDialog";
import { HomePage } from "@/components/HomePage";
import { MigratePage } from "@/components/MigratePage";
import { AccountsPage } from "@/components/AccountsPage";

import { LocalMigrationPage } from "@/pages/LocalMigrationPage";
import { CloudMigrationPage } from "@/pages/CloudMigrationPage";

import { useAuth } from "@/contexts/AuthContext";
import { useConfig, Account } from "@/contexts/ConfigContext";
import { useTranslation } from "@/lib/i18n";

import type { Theme, Page, UpdateInfo, DownloadProgressPayload } from "@/types";

// 设置页较重（Galaxy + 操作日志查询等），用户切换到该页时再加载
const SettingsPage = lazy(() =>
  import("@/components/SettingsPage").then(m => ({ default: m.SettingsPage }))
);

function App() {
  const { t } = useTranslation();
  const { signOut, username, isAdmin } = useAuth();
  const { accounts, settings, saveAccounts, updateSettings } = useConfig();

  // 页面导航
  const [page, setPage] = useState<Page>("home");
  const pageRef = useRef(page);
  pageRef.current = page;

  // 账号弹窗状态
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [detailAccount, setDetailAccount] = useState<Account | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [reLoginAccount, setReLoginAccount] = useState<Account | null>(null);
  const [reLoginOpen, setReLoginOpen] = useState(false);

  // ===== 自动检测更新 =====
  const handleAutoDownload = useCallback(async (downloadUrl: string) => {
    const unlisten = await listen<DownloadProgressPayload>("download-progress", () => {});
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
      if (pageRef.current === "settings") return;
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

  // 账号操作
  const deleteAccount = async (id: string) => {
    const newAccounts = accounts.filter(a => a.id !== id);
    await saveAccounts(newAccounts);
    toast.success(t("common.success"));
  };

  const handleSaveAccount = async (data: { name: string; username: string; password: string }) => {
    if (editingAccount) {
      const newAccounts = accounts.map(a =>
        a.id === editingAccount.id ? { ...a, ...data } : a
      );
      await saveAccounts(newAccounts);
    } else {
      const newAcc: Account = {
        id: `acc_${Date.now()}`,
        ...data,
      };
      await saveAccounts([...accounts, newAcc]);
    }
    toast.success(t("common.success"));
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

  return (
    <Layout
      currentPage={page}
      onNavigate={setPage}
      theme={settings.theme as Theme}
      onThemeChange={(theme) => updateSettings({ theme })}
      accountsCount={accounts.length}
      onSignOut={signOut}
      username={username}
      isAdmin={isAdmin}
    >
      {page === "home" && <HomePage accountsCount={accounts.length} onNavigate={setPage} />}
      {page === "migrate" && (
        <MigratePage
          onNavigate={setPage}
          onStartLocal={() => setPage("local")}
          onStartCloud={() => setPage("cloud")}
        />
      )}
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
      {page === "local" && (
        <LocalMigrationPage
          accounts={accounts}
          migrateSuffix={settings.migrate_suffix}
          onBackHome={() => setPage("home")}
          isAdmin={isAdmin}
        />
      )}
      {page === "cloud" && (
        <CloudMigrationPage
          accounts={accounts}
          migrateSuffix={settings.migrate_suffix}
          onBackHome={() => setPage("home")}
        />
      )}
      {page === "settings" && (
        <div className="h-full animate-in fade-in zoom-in-95 duration-300">
          <Suspense fallback={
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          }>
            <SettingsPage />
          </Suspense>
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

      <Toaster position="top-center" richColors />
    </Layout>
  );
}

export default App;
