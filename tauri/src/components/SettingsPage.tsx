import * as React from "react"
import { User, Globe, Heart, Moon, Sun, Monitor, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
// @ts-ignore
import avatar from "@/assets/avatar.png"
import { useConfig } from "@/contexts/ConfigContext"
import { useTranslation } from "@/lib/i18n"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "@/components/ui/toaster"

interface UpdateInfo {
    hasUpdate: boolean
    currentVersion: string
    latestVersion: string
    downloadUrl: string | null
}

interface DownloadProgressPayload {
    downloaded: number
    total: number
    percentage: number
}

export function SettingsPage() {
    const { settings, updateSettings } = useConfig()
    const { t } = useTranslation()

    // Local state for UI
    const [activeTab, setActiveTab] = React.useState("general")
    const [isChecking, setIsChecking] = React.useState(false)
    const [isDownloading, setIsDownloading] = React.useState(false)
    const [downloadProgress, setDownloadProgress] = React.useState(0)

    const handleCheckUpdate = async () => {
        setIsChecking(true)
        try {
            const info = await invoke<UpdateInfo>("check_for_update")
            if (info.hasUpdate) {
                toast.success(
                    t("settings.check_update.found").replace("{version}", `v${info.latestVersion}`),
                    {
                        duration: 10000,
                        action: info.downloadUrl
                            ? {
                                label: t("settings.check_update.download"),
                                onClick: () => handleDownloadUpdate(info.downloadUrl!),
                            }
                            : undefined,
                    }
                )
            } else {
                toast.success(t("settings.check_update.latest"))
            }
        } catch (error) {
            console.error(error)
            toast.error(t("common.error") + ": " + String(error))
        } finally {
            setIsChecking(false)
        }
    }

    const handleDownloadUpdate = async (downloadUrl: string) => {
        setIsDownloading(true)
        setDownloadProgress(0)
        toast.info(t("settings.check_update.downloading"))

        // Listen for progress events
        const unlisten = await listen<DownloadProgressPayload>("download-progress", (event) => {
            setDownloadProgress(event.payload.percentage)
        })

        try {
            const filePath = await invoke<string>("download_update", { downloadUrl })
            setDownloadProgress(100)
            unlisten()

            // Show brief success message, then launch installer and exit
            toast.success(t("settings.check_update.installing"))

            // Short delay to let user see the 100% state
            await new Promise(resolve => setTimeout(resolve, 800))

            // Open installer and exit app
            await invoke("open_file_and_exit", { filePath })
        } catch (error) {
            unlisten()
            console.error(error)
            toast.error(t("settings.check_update.download_failed") + ": " + String(error))
            setDownloadProgress(0)
        } finally {
            setIsDownloading(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-background relative animate-in fade-in duration-300">
            {/* Header / Tabs */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-10 transition-colors">
                <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab("general")}
                        className={cn(
                            "px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                            activeTab === "general"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                        )}
                    >
                        {t("settings.general")}
                    </button>
                    <button
                        onClick={() => setActiveTab("about")}
                        className={cn(
                            "px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                            activeTab === "about"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                        )}
                    >
                        {t("settings.about")}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-8">
                <div className="max-w-4xl mx-auto space-y-8">

                    {/* General Tab */}
                    {activeTab === "general" && (
                        <div className="grid gap-6 animate-in slide-in-from-bottom-2 duration-300">
                            {/* Language */}
                            <Card>
                                <CardHeader>
                                    <div className="flex items-center gap-2">
                                        <Globe className="h-5 w-5 text-primary" />
                                        <CardTitle>{t("settings.language")}</CardTitle>
                                    </div>
                                    <CardDescription>
                                        {t("settings.language.desc")}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid gap-2 max-w-sm">
                                        <label htmlFor="language" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                            {t("settings.language.label")}
                                        </label>
                                        <select
                                            id="language"
                                            value={settings.language}
                                            onChange={(e) => updateSettings({ language: e.target.value })}
                                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <option value="zh-CN">简体中文</option>
                                            <option value="en-US">English</option>
                                        </select>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Theme */}
                            <Card>
                                <CardHeader>
                                    <div className="flex items-center gap-2">
                                        <Monitor className="h-5 w-5 text-primary" />
                                        <CardTitle>{t("settings.theme")}</CardTitle>
                                    </div>
                                    <CardDescription>
                                        {t("settings.theme.desc")}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid gap-2 max-w-sm">
                                        <label className="text-sm font-medium leading-none mb-2">
                                            {t("settings.theme.label")}
                                        </label>
                                        <div className="flex gap-4">
                                            <div
                                                className={cn(
                                                    "flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-all",
                                                    settings.theme === "light" ? "border-primary bg-primary/5" : "border-input"
                                                )}
                                                onClick={() => updateSettings({ theme: "light" })}
                                            >
                                                <Sun className="h-4 w-4" />
                                                <span className="text-sm">{t("settings.theme.light")}</span>
                                            </div>
                                            <div
                                                className={cn(
                                                    "flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-all",
                                                    settings.theme === "dark" ? "border-primary bg-primary/5" : "border-input"
                                                )}
                                                onClick={() => updateSettings({ theme: "dark" })}
                                            >
                                                <Moon className="h-4 w-4" />
                                                <span className="text-sm">{t("settings.theme.dark")}</span>
                                            </div>
                                            <div
                                                className={cn(
                                                    "flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-all",
                                                    settings.theme === "system" ? "border-primary bg-primary/5" : "border-input"
                                                )}
                                                onClick={() => updateSettings({ theme: "system" })}
                                            >
                                                <Monitor className="h-4 w-4" />
                                                <span className="text-sm">{t("settings.theme.system")}</span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                        </div>
                    )}

                    {/* About Tab */}
                    {activeTab === "about" && (
                        <div className="flex flex-col items-center justify-center py-12 animate-in slide-in-from-bottom-2 duration-300 text-center space-y-8">

                            {/* App Info */}
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative group">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-primary to-purple-600 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                                    <div className="relative h-24 w-24 rounded-2xl overflow-hidden shadow-xl border border-border/50 bg-background">
                                        <img src={avatar} alt="Logo" className="w-full h-full object-cover" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <h1 className="text-3xl font-bold tracking-tight">影刀账号管理工具</h1>
                                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                        <span className="text-sm">v1.1.4</span>
                                        <span>•</span>
                                        <span className="text-sm">Professional Account Management</span>
                                    </div>
                                </div>
                            </div>

                            {/* Info Cards */}
                            <div className="flex flex-wrap justify-center gap-4 w-full max-w-4xl px-4">
                                <Card className="bg-card/50 backdrop-blur-sm border-muted/60 hover:bg-card/80 transition-colors cursor-default group">
                                    <CardContent className="flex flex-col items-center justify-center p-6 gap-3">
                                        <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform duration-300">
                                            <User className="h-5 w-5" />
                                        </div>
                                        <div className="space-y-1 text-center">
                                            <p className="text-xs text-muted-foreground font-medium">{t("settings.app.author")}</p>
                                            <p className="font-semibold">Ethan</p>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="bg-card/50 backdrop-blur-sm border-muted/60 hover:bg-card/80 transition-colors cursor-default group">
                                    <CardContent className="flex flex-col items-center justify-center p-6 gap-3">
                                        <div className="h-10 w-10 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-500 group-hover:scale-110 transition-transform duration-300">
                                            <Heart className="h-5 w-5" />
                                        </div>
                                        <div className="space-y-1 text-center">
                                            <p className="text-xs text-muted-foreground font-medium">{t("settings.app.support")}</p>
                                            <p className="font-semibold">{t("settings.app.support_author")}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <Button
                                className="gap-2 mt-8"
                                variant="default"
                                size="default"
                                onClick={handleCheckUpdate}
                                disabled={isChecking || isDownloading}
                            >
                                {isDownloading ? (
                                    <Download className="h-4 w-4 animate-bounce" />
                                ) : (
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                                    </span>
                                )}
                                {isDownloading
                                    ? `${t("settings.check_update.downloading")} ${downloadProgress}%`
                                    : isChecking
                                        ? t("settings.check_update.checking")
                                        : t("settings.check_update")}
                            </Button>

                            {/* Download Progress Bar */}
                            {isDownloading && (
                                <div className="w-full max-w-md mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                                        <span>{t("settings.check_update.downloading")}</span>
                                        <span className="font-mono font-medium text-foreground">{downloadProgress}%</span>
                                    </div>
                                    <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-300 ease-out"
                                            style={{ width: `${downloadProgress}%` }}
                                        />
                                    </div>
                                    {downloadProgress === 100 && (
                                        <p className="text-xs text-green-500 mt-2 animate-in fade-in duration-300">
                                            {t("settings.check_update.installing")}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
