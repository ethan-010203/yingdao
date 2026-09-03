import * as React from "react"
import { User, Globe, Heart, Moon, Sun, Monitor, Download, Search, ArrowLeft, ArrowRight, ScrollText, Loader2, FileText, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
// @ts-ignore
import avatar from "@/assets/avatar.png"
import { useConfig } from "@/contexts/ConfigContext"
import { useAuth } from "@/contexts/AuthContext"
import { useTranslation } from "@/lib/i18n"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { listen } from "@tauri-apps/api/event"
import { toast } from "@/components/ui/toaster"
import { fetchOperationLogs, type OperationLogEntry, type ActionType } from "@/lib/supabase"
import type { UpdateInfo, DownloadProgressPayload } from "@/types"

const ACTION_TYPES: ActionType[] = [
    'add_account', 'edit_account', 'delete_account',
    'migrate_local', 'migrate_cloud', 'delete_flow',
]

const LOGS_ROW_HEIGHT = 45

export function SettingsPage() {
    const { settings, updateSettings } = useConfig()
    const { isAdmin } = useAuth()
    const { t } = useTranslation()

    // Local state for UI
    const [activeTab, setActiveTab] = React.useState("general")
    const [appVersion, setAppVersion] = React.useState("...")
    const [isChecking, setIsChecking] = React.useState(false)
    const [isDownloading, setIsDownloading] = React.useState(false)
    const [downloadProgress, setDownloadProgress] = React.useState(0)

    // Logs state
    const [logs, setLogs] = React.useState<OperationLogEntry[]>([])
    const [logsTotal, setLogsTotal] = React.useState(0)
    const [logsPage, setLogsPage] = React.useState(1)
    const [logsLoading, setLogsLoading] = React.useState(false)
    const [filterAction, setFilterAction] = React.useState("all")
    const [filterUser, setFilterUser] = React.useState("")
    const [logsPageSize, setLogsPageSize] = React.useState(3)
    const logsTableRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        getVersion().then(v => setAppVersion(v)).catch(() => setAppVersion("1.2.0"))
    }, [])

    React.useLayoutEffect(() => {
        if (activeTab !== "logs" || !isAdmin) return

        let frameId = 0
        const tableEl = logsTableRef.current
        if (!tableEl) return

        const calculateLogsPageSize = () => {
            const nextPageSize = Math.max(3, Math.floor(tableEl.clientHeight / LOGS_ROW_HEIGHT))
            setLogsPageSize(prev => {
                if (prev === nextPageSize) return prev
                window.requestAnimationFrame(() => setLogsPage(1))
                return nextPageSize
            })
        }

        calculateLogsPageSize()
        frameId = window.requestAnimationFrame(calculateLogsPageSize)

        const observer = new ResizeObserver(calculateLogsPageSize)
        observer.observe(tableEl)

        return () => {
            observer.disconnect()
            window.cancelAnimationFrame(frameId)
        }
    }, [activeTab, isAdmin])

    React.useEffect(() => {
        if (activeTab !== "logs" || !isAdmin || logsPageSize < 1) return

        let cancelled = false

        const loadLogs = async () => {
            setLogsLoading(true)
            try {
                const result = await fetchOperationLogs({
                    page: logsPage,
                    pageSize: logsPageSize,
                    action: filterAction !== "all" ? filterAction : undefined,
                    username: filterUser || undefined,
                })

                if (cancelled) return
                setLogs(result.data)
                setLogsTotal(result.total)
            } catch {
                if (!cancelled) {
                    toast.error(t("common.error"))
                }
            } finally {
                if (!cancelled) {
                    setLogsLoading(false)
                }
            }
        }

        loadLogs()

        return () => {
            cancelled = true
        }
    }, [activeTab, isAdmin, logsPage, logsPageSize, filterAction, filterUser, t])

    const logsTotalPages = Math.max(1, Math.ceil(logsTotal / logsPageSize))

    const suffixPreview = React.useMemo(() => {
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const datetime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}时${pad(now.getMinutes())}分${pad(now.getSeconds())}秒`
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
        return settings.migrate_suffix
            .replace("{name}", "示例流程")
            .replace("{datetime}", datetime)
            .replace("{date}", date)
            .replace("{time}", time)
    }, [settings.migrate_suffix])

    const formatLogTime = (iso: string) => {
        try {
            return new Date(iso).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            })
        } catch {
            return iso
        }
    }

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
        <div className="flex flex-col h-full overflow-hidden bg-background relative animate-in fade-in duration-300">
            {/* Header / Tabs */}
            <div className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-border/40 bg-card/50 backdrop-blur-sm z-10 transition-colors">
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
                    {isAdmin && (
                        <button
                            onClick={() => setActiveTab("logs")}
                            className={cn(
                                "px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                                activeTab === "logs"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                            )}
                        >
                            {t("settings.logs")}
                        </button>
                    )}
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
            <div className="flex-1 min-h-0 p-6">
                <div className="h-full max-w-4xl mx-auto">

                    {/* General Tab */}
                    {activeTab === "general" && (
                        <div className="h-full overflow-y-auto grid gap-6 pb-4 content-start animate-in slide-in-from-bottom-2 duration-300">
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

                            {/* Migrate Suffix Template */}
                            <Card>
                                <CardHeader>
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-primary" />
                                        <CardTitle>{t("settings.migrate_suffix")}</CardTitle>
                                    </div>
                                    <CardDescription>
                                        {t("settings.migrate_suffix.desc")}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium leading-none">
                                            {t("settings.migrate_suffix.label")}
                                        </label>
                                        <div className="flex gap-2">
                                            <Input
                                                value={settings.migrate_suffix}
                                                onChange={e => updateSettings({ migrate_suffix: e.target.value })}
                                                className="font-mono text-sm"
                                                placeholder="{name}_云迁_接收于{datetime}"
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="shrink-0 gap-1.5"
                                                onClick={() => updateSettings({ migrate_suffix: "{name}_云迁_接收于{datetime}" })}
                                            >
                                                <RotateCcw className="h-3.5 w-3.5" />
                                                {t("settings.migrate_suffix.reset")}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground/70">
                                        {t("settings.migrate_suffix.variables")}
                                    </div>
                                    <div className="rounded-lg bg-muted/40 p-3 space-y-1">
                                        <div className="text-xs font-medium text-muted-foreground">{t("settings.migrate_suffix.preview")}</div>
                                        <div className="text-sm font-mono break-all">
                                            {suffixPreview}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                        </div>
                    )}

                    {/* Logs Tab (Admin only) */}
                    {activeTab === "logs" && isAdmin && (
                        <div className="h-full flex flex-col animate-in slide-in-from-bottom-2 duration-300">
                            {/* Filters */}
                            <div className="shrink-0 flex items-center gap-3 mb-3">
                                <div className="flex items-center gap-2">
                                    <ScrollText className="h-5 w-5 text-primary" />
                                    <span className="font-semibold">{t("settings.logs.title")}</span>
                                </div>
                                <select
                                    value={filterAction}
                                    onChange={e => { setFilterAction(e.target.value); setLogsPage(1); }}
                                    className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="all">{t("settings.logs.filter.all")}</option>
                                    {ACTION_TYPES.map(a => (
                                        <option key={a} value={a}>{t(`settings.logs.action.${a}`)}</option>
                                    ))}
                                </select>
                                <div className="relative flex-1 max-w-[240px]">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                                    <Input
                                        placeholder={t("settings.logs.filter.user")}
                                        value={filterUser}
                                        onChange={e => { setFilterUser(e.target.value); setLogsPage(1); }}
                                        className="pl-9 h-9 text-sm"
                                    />
                                </div>
                            </div>

                            {/* Table header */}
                            <div className="shrink-0 rounded-t-xl border border-b-0 border-border/30 bg-muted/30">
                                <div className="flex text-sm font-medium text-muted-foreground">
                                    <div className="px-4 py-2.5 w-[170px]">{t("settings.logs.time")}</div>
                                    <div className="px-4 py-2.5 w-[100px]">{t("settings.logs.user")}</div>
                                    <div className="px-4 py-2.5 w-[110px]">{t("settings.logs.action")}</div>
                                    <div className="px-4 py-2.5 flex-1">{t("settings.logs.detail")}</div>
                                </div>
                            </div>

                            {/* Table body — dynamic height */}
                            <div ref={logsTableRef} className="flex-1 min-h-0 rounded-b-xl border border-border/30 overflow-hidden">
                                {logsLoading ? (
                                    <div className="flex items-center justify-center h-full">
                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : logs.length === 0 ? (
                                    <div className="flex items-center justify-center h-full text-muted-foreground/60">
                                        {t("settings.logs.empty")}
                                    </div>
                                ) : (
                                    logs.map(log => (
                                        <div key={log.id} className="flex items-center border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors text-sm">
                                            <div className="px-4 py-2.5 w-[170px] text-muted-foreground/70 font-mono text-xs whitespace-nowrap">
                                                {formatLogTime(log.created_at)}
                                            </div>
                                            <div className="px-4 py-2.5 w-[100px] font-medium truncate">{log.username}</div>
                                            <div className="px-4 py-2.5 w-[110px]">
                                                <span className={cn(
                                                    "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium",
                                                    log.action.includes('delete') ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                                                    log.action.includes('migrate') ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" :
                                                    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                )}>
                                                    {t(`settings.logs.action.${log.action}`)}
                                                </span>
                                            </div>
                                            <div className="px-4 py-2.5 flex-1 text-muted-foreground truncate" title={log.detail}>
                                                {log.detail}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Pagination */}
                            <div className="shrink-0 flex items-center justify-between pt-2">
                                <span className="text-sm text-muted-foreground/70">
                                    {t("settings.logs.total").replace("{total}", String(logsTotal))}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <Button variant="ghost" size="sm" disabled={logsPage <= 1} onClick={() => setLogsPage(logsPage - 1)} className="rounded-lg h-8 w-8 p-0">
                                        <ArrowLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="text-sm text-muted-foreground/70 min-w-[60px] text-center font-medium">
                                        {logsPage} / {logsTotalPages}
                                    </span>
                                    <Button variant="ghost" size="sm" disabled={logsPage >= logsTotalPages} onClick={() => setLogsPage(logsPage + 1)} className="rounded-lg h-8 w-8 p-0">
                                        <ArrowRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* About Tab */}
                    {activeTab === "about" && (
                        <div className="h-full overflow-y-auto flex flex-col items-center py-8 pb-36 animate-in slide-in-from-bottom-2 duration-300 text-center space-y-8">

                            {/* App Info */}
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative group">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-primary to-purple-600 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                                    <div className="relative h-24 w-24 rounded-2xl overflow-hidden shadow-xl border border-border/50 bg-background">
                                        <img src={avatar} alt="Logo" className="w-full h-full object-cover" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <h1 className="text-3xl font-bold tracking-tight">{t("settings.app.title")}</h1>
                                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                        <span className="text-sm">v{appVersion}</span>
                                        <span>•</span>
                                        <span className="text-sm">{t("settings.app.subtitle")}</span>
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
