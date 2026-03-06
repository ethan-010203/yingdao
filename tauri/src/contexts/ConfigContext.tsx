import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/components/ui/toaster";
import { t } from "@/lib/i18n";

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
    migrate_suffix: string;
}

// Config shape matches Rust backend: { accounts: AccountConfig[], settings: Settings }

interface ConfigContextType {
    settings: Settings;
    accounts: Account[];
    updateSettings: (newSettings: Partial<Settings>) => Promise<void>;
    saveAccounts: (newAccounts: Account[]) => Promise<void>;
    reloadConfig: () => Promise<void>;
}

const DEFAULT_MIGRATE_SUFFIX = "{name}_云迁_接收于{datetime}";

const defaultSettings: Settings = {
    language: "zh-CN",
    theme: "system",
    auto_update: true,
    migrate_suffix: DEFAULT_MIGRATE_SUFFIX,
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

            // Use persisted ID from backend if available; generate only for legacy accounts missing an ID
            let needsSave = false;
            const loadedAccounts = config.accounts.map((a: any, idx: number) => {
                const hasId = a.id && a.id.trim() !== "";
                if (!hasId) needsSave = true;
                return {
                    id: hasId ? a.id : `acc_${Date.now()}_${idx}`,
                    name: a.name || `账号${idx + 1}`,
                    username: a.username,
                    password: a.password,
                };
            });

            setAccountsState(loadedAccounts);

            if (config.settings) {
                setSettings({
                    language: config.settings.language || "zh-CN",
                    theme: config.settings.theme || "system",
                    auto_update: config.settings.auto_update !== undefined ? config.settings.auto_update : true,
                    migrate_suffix: config.settings.migrate_suffix || DEFAULT_MIGRATE_SUFFIX,
                });
            }

            // If any account was missing an ID, save back to persist the generated IDs
            if (needsSave && loadedAccounts.length > 0) {
                const settingsToSave = config.settings ? {
                    language: config.settings.language || "zh-CN",
                    theme: config.settings.theme || "system",
                    auto_update: config.settings.auto_update !== undefined ? config.settings.auto_update : true,
                    migrate_suffix: config.settings.migrate_suffix || DEFAULT_MIGRATE_SUFFIX,
                } : defaultSettings;
                await saveConfigToBackend(loadedAccounts, settingsToSave);
            }
        } catch (e) {
            console.error("Failed to load config:", e);
            toast.error(t("config.load_failed", settings.language));
        }
    };

    const saveConfigToBackend = async (newAccounts: Account[], newSettings: Settings) => {
        try {
            // Convert frontend Account objects back to backend AccountConfig (now including id)
            const accountsForBackend = newAccounts.map(a => ({
                id: a.id,
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
        const previous = settings;
        const updated = { ...settings, ...newSettings };
        setSettings(updated);
        try {
            await saveConfigToBackend(accounts, updated);
        } catch (e) {
            setSettings(previous);
            toast.error(t("config.save_settings_failed", previous.language));
        }
    };

    const saveAccounts = async (newAccounts: Account[]) => {
        const previous = accounts;
        setAccountsState(newAccounts);
        try {
            await saveConfigToBackend(newAccounts, settings);
        } catch (e) {
            setAccountsState(previous);
            toast.error(t("config.save_accounts_failed", settings.language));
        }
    };

    return (
        <ConfigContext.Provider value={{
            settings,
            accounts,
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
