import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/components/ui/toaster";

// Define generic types matching Rust structs
export interface Account {
    id: string;
    name: string;
    username: string;
    password: string;
}

export interface Settings {
    language: string;
    theme: string;
    auto_update: boolean;
}

// Config shape matches Rust backend: { accounts: AccountConfig[], settings: Settings }

interface ConfigContextType {
    settings: Settings;
    accounts: Account[];
    setAccounts: (accounts: Account[]) => void;
    updateSettings: (newSettings: Partial<Settings>) => Promise<void>;
    saveAccounts: (newAccounts: Account[]) => Promise<void>;
    reloadConfig: () => Promise<void>;
}

const defaultSettings: Settings = {
    language: "zh-CN",
    theme: "system",
    auto_update: true,
};

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<Settings>(defaultSettings);
    const [accounts, setAccountsState] = useState<Account[]>([]);

    // On mount, load config
    useEffect(() => {
        reloadConfig();
    }, []);

    // Sync theme
    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        if (settings.theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            root.classList.add(systemTheme);
        } else {
            root.classList.add(settings.theme);
        }
    }, [settings.theme]);

    const reloadConfig = async () => {
        try {
            const config: { accounts: any[], settings?: any } = await invoke("load_config");

            // Transform accounts to include IDs for frontend usage if needed //
            // Note: backend Config.accounts is Vec<AccountConfig> without IDs. 
            // We generate IDs based on index or simple hash for React keys/logic.
            // But if we want to PERSIST the ID, we might need to change backend.
            // For now, let's stick to the App.tsx logic of generating IDs on load.

            const loadedAccounts = config.accounts.map((a: any, idx: number) => ({
                id: `acc_${idx}_${Date.now()}`, // Re-generating IDs on every reload might be an issue if we rely on them for selection state.
                // ideally backend should store IDs. 
                // For now, we will trust that list order is preserved.
                name: a.name || `账号${idx + 1}`,
                username: a.username,
                password: a.password,
            }));

            setAccountsState(loadedAccounts);

            if (config.settings) {
                setSettings({
                    language: config.settings.language || "zh-CN",
                    theme: config.settings.theme || "system",
                    auto_update: config.settings.auto_update !== undefined ? config.settings.auto_update : true
                });
            }
        } catch (e) {
            console.error("Failed to load config:", e);
            toast.error("加载配置失败");
        }
    };

    const saveConfigToBackend = async (newAccounts: Account[], newSettings: Settings) => {
        try {
            // Convert frontend Account objects back to backend AccountConfig
            const accountsForBackend = newAccounts.map(a => ({
                name: a.name,
                username: a.username,
                password: a.password,
            }));

            await invoke("save_config", {
                config: {
                    accounts: accountsForBackend,
                    settings: newSettings
                }
            });
        } catch (e) {
            console.error("Failed to save config:", e);
            throw e;
        }
    };

    const updateSettings = async (newSettings: Partial<Settings>) => {
        const updated = { ...settings, ...newSettings };
        setSettings(updated);
        try {
            await saveConfigToBackend(accounts, updated);
            // toast.success("设置已更新");
        } catch (e) {
            toast.error("保存设置失败");
            // revert?
        }
    };

    const saveAccounts = async (newAccounts: Account[]) => {
        setAccountsState(newAccounts);
        try {
            await saveConfigToBackend(newAccounts, settings);
        } catch (e) {
            toast.error("保存账号失败");
        }
    };

    return (
        <ConfigContext.Provider value={{
            settings,
            accounts,
            setAccounts: setAccountsState, // purely local state update if needed, but usually we use saveAccounts
            updateSettings,
            saveAccounts,
            reloadConfig
        }}>
            {children}
        </ConfigContext.Provider>
    );
}

export function useConfig() {
    const context = useContext(ConfigContext);
    if (context === undefined) {
        throw new Error("useConfig must be used within a ConfigProvider");
    }
    return context;
}
