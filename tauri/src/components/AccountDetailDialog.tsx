import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "@/components/ui/toaster"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, Trash2, RefreshCw, ChevronLeft, ChevronRight, Loader2, User, AlertTriangle } from "lucide-react"
import { useTranslation } from "@/lib/i18n"

interface Account {
    id: string
    name: string
    username: string
    password: string
}

interface CloudFlow {
    appId: string
    appName: string
    updateTime?: string
}

interface AccountDetailDialogProps {
    account: Account | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onDeleteAccount: (id: string) => void
    onTokenExpired: (account: Account) => void
}

export function AccountDetailDialog({
    account,
    open,
    onOpenChange,
    onDeleteAccount,
    onTokenExpired,
}: AccountDetailDialogProps) {
    const { t } = useTranslation()
    const [flows, setFlows] = useState<CloudFlow[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [token, setToken] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] = useState(false)
    const [deleting, setDeleting] = useState(false)

    // 登录并获取流程
    useEffect(() => {
        if (open && account) {
            loginAndFetchFlows()
        } else {
            // 关闭时重置状态
            setFlows([])
            setToken(null)
            setError(null)
            setSearchQuery("")
            setSelectedIds(new Set())
            setCurrentPage(1)
        }
    }, [open, account])

    const loginAndFetchFlows = async () => {
        if (!account) return

        setLoading(true)
        setError(null)

        try {
            // 登录获取 token
            const accessToken = await invoke<string>("login_account", {
                username: account.username,
                password: account.password,
                accountType: "source",
            })
            setToken(accessToken)

            // 获取流程列表
            const cloudFlows = await invoke<CloudFlow[]>("get_cloud_flows", {
                token: accessToken,
            })
            setFlows(cloudFlows)
        } catch (err) {
            const errorMsg = String(err)
            if (errorMsg.includes("TOKEN_EXPIRED")) {
                onTokenExpired(account)
                onOpenChange(false)
            } else {
                setError(errorMsg)
            }
        } finally {
            setLoading(false)
        }
    }

    // 过滤后的流程
    const filteredFlows = useMemo(() => {
        if (!searchQuery.trim()) return flows
        const query = searchQuery.toLowerCase()
        return flows.filter(flow =>
            flow.appName.toLowerCase().includes(query)
        )
    }, [flows, searchQuery])

    // 分页
    const totalPages = Math.ceil(filteredFlows.length / pageSize)
    const paginatedFlows = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredFlows.slice(start, start + pageSize)
    }, [filteredFlows, currentPage, pageSize])

    // 全选当前页
    const allCurrentSelected = paginatedFlows.length > 0 &&
        paginatedFlows.every(f => selectedIds.has(f.appId))

    const toggleSelectAll = () => {
        const newSelected = new Set(selectedIds)
        if (allCurrentSelected) {
            paginatedFlows.forEach(f => newSelected.delete(f.appId))
        } else {
            paginatedFlows.forEach(f => newSelected.add(f.appId))
        }
        setSelectedIds(newSelected)
    }

    const toggleSelect = (appId: string) => {
        const newSelected = new Set(selectedIds)
        if (newSelected.has(appId)) {
            newSelected.delete(appId)
        } else {
            newSelected.add(appId)
        }
        setSelectedIds(newSelected)
    }

    // 删除选中的流程
    const handleDeleteFlows = async () => {
        if (!token || selectedIds.size === 0) return

        setDeleting(true)
        try {
            const results = await invoke<Array<{ success: boolean; name: string; message: string }>>(
                "delete_cloud_flows",
                { request: { token, appIds: Array.from(selectedIds) } }
            )

            // 检查是否有 token 过期
            const tokenExpired = results.some(r => r.message === "TOKEN_EXPIRED")
            if (tokenExpired && account) {
                onTokenExpired(account)
                onOpenChange(false)
                return
            }

            // 移除已删除的流程
            const successCount = results.filter(r => r.success).length
            const deletedIds = new Set(results.filter(r => r.success).map(r => r.name))
            setFlows(prev => prev.filter(f => !deletedIds.has(f.appId)))
            setSelectedIds(new Set())
            setDeleteDialogOpen(false)

            if (successCount > 0) {
                toast.success(t("common.success").replace("{count}", String(successCount)))
            }
        } catch (err) {
            toast.error(`${t("common.error")}: ${String(err)}`)
            setError(String(err))
        } finally {
            setDeleting(false)
        }
    }

    // 删除账号
    const handleDeleteAccount = () => {
        if (account) {
            onDeleteAccount(account.id)
            onOpenChange(false)
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                    {/* 加载遮罩 */}
                    {loading && (
                        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center rounded-lg">
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
                            </div>
                        </div>
                    )}
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            {account?.name || t("accounts.detail")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("login.username")}: {account?.username} · {t("accounts.flow.total").replace("{count}", String(flows.length))}
                        </DialogDescription>
                    </DialogHeader>

                    {/* 工具栏 */}
                    <div className="flex items-center gap-2 py-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder={t("common.search")}
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value)
                                    setCurrentPage(1)
                                }}
                                className="pl-9"
                            />
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={loginAndFetchFlows}
                            disabled={loading}
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteDialogOpen(true)}
                            disabled={selectedIds.size === 0}
                        >
                            <Trash2 className="h-4 w-4 mr-1" />
                            {t("common.delete")} ({selectedIds.size})
                        </Button>
                    </div>

                    {/* 总数显示 */}
                    <div className="text-sm text-muted-foreground pb-2">
                        {t("accounts.flow.total").replace("{count}", String(flows.length))}{searchQuery && filteredFlows.length !== flows.length && `，${t("common.search")} ${filteredFlows.length}`}
                    </div>

                    {/* 流程列表 */}
                    <div className="flex-1 overflow-auto border rounded-md">
                        {loading ? (
                            <div className="flex items-center justify-center h-48">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : error ? (
                            <div className="flex items-center justify-center h-48 text-destructive">
                                <AlertTriangle className="h-5 w-5 mr-2" />
                                {error}
                            </div>
                        ) : filteredFlows.length === 0 ? (
                            <div className="flex items-center justify-center h-48 text-muted-foreground">
                                {searchQuery ? t("common.error") : t("common.loading")}
                            </div>
                        ) : (
                            <table className="w-full">
                                <thead className="bg-card sticky top-0 z-10 shadow-sm">
                                    <tr className="border-b bg-muted/50">
                                        <th className="w-12 p-3 text-left">
                                            <Checkbox
                                                checked={allCurrentSelected}
                                                onCheckedChange={toggleSelectAll}
                                            />
                                        </th>
                                        <th className="p-3 text-left font-medium">{t("accounts.flow.name")}</th>
                                        <th className="w-48 p-3 text-left font-medium">{t("accounts.flow.update_time")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedFlows.map((flow) => (
                                        <tr
                                            key={flow.appId}
                                            onClick={() => toggleSelect(flow.appId)}
                                            className={`border-t cursor-pointer transition-colors ${selectedIds.has(flow.appId)
                                                ? 'bg-primary/10 hover:bg-primary/15'
                                                : 'hover:bg-muted/30'
                                                }`}
                                        >
                                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={selectedIds.has(flow.appId)}
                                                    onCheckedChange={() => toggleSelect(flow.appId)}
                                                />
                                            </td>
                                            <td className="p-3">{flow.appName}</td>
                                            <td className="p-3 text-muted-foreground text-sm">
                                                {flow.updateTime?.slice(0, 19) || "-"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* 分页 */}
                    <div className="flex items-center justify-between pt-2 border-t">
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground">
                                {t("common.pagination.page").replace("{page}", String(currentPage)).replace("{total}", String(totalPages))}
                            </span>
                            <div className="flex items-center gap-1">
                                <span className="text-sm text-muted-foreground">{t("common.pagination.per_page")}</span>
                                <select
                                    value={pageSize}
                                    onChange={(e) => {
                                        setPageSize(Number(e.target.value))
                                        setCurrentPage(1)
                                    }}
                                    className="h-8 px-2 text-sm border rounded-md bg-background"
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                </select>
                                <span className="text-sm text-muted-foreground">{t("common.pagination.unit")}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages || totalPages === 0}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* 底部操作 */}
                    <div className="flex justify-end pt-4 border-t">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            {t("common.close")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 删除流程确认 */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("accounts.delete.flows.confirm").replace("{count}", String(selectedIds.size))}
                            <br />
                            <span className="text-muted-foreground">{t("accounts.delete.flows.desc")}</span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteFlows}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                            {t("common.confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* 删除账号确认 */}
            <AlertDialog open={deleteAccountDialogOpen} onOpenChange={setDeleteAccountDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("accounts.delete.confirm").replace("{name}", account?.name || "")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("accounts.delete.confirm").replace("{name}", account?.name || "")}
                            <br />
                            <span className="text-muted-foreground">{t("accounts.delete.desc")}</span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteAccount}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {t("common.confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
