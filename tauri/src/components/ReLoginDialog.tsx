"use client"

import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertTriangle, Loader2, Eye, EyeOff } from "lucide-react"
import { useTranslation } from "@/lib/i18n"

interface Account {
    id: string
    name: string
    username: string
    password: string
}

interface ReLoginDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    account: Account | null
    onSuccess: (token: string) => void
    onUpdatePassword: (accountId: string, newPassword: string) => void
}

export function ReLoginDialog({
    open,
    onOpenChange,
    account,
    onSuccess,
    onUpdatePassword,
}: ReLoginDialogProps) {
    const { t } = useTranslation()
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (open) {
            setPassword(account?.password || "")
            setError(null)
            setShowPassword(false)
        }
    }, [open, account])

    const handleLogin = async () => {
        if (!account || !password.trim()) return

        setLoading(true)
        setError(null)

        try {
            const token = await invoke<string>("login_account", {
                username: account.username,
                password: password,
                accountType: "source",
            })

            // 更新密码（如果有变化）
            if (password !== account.password) {
                onUpdatePassword(account.id, password)
            }

            onSuccess(token)
            onOpenChange(false)
        } catch (err) {
            setError(String(err))
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-amber-600">
                        <AlertTriangle className="h-5 w-5" />
                        {t("accounts.expired.title")}
                    </DialogTitle>
                    <DialogDescription>
                        {t("accounts.expired.desc").replace("{name}", account?.name || "")}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("accounts.username")}</label>
                        <Input
                            value={account?.username || ""}
                            disabled
                            className="bg-muted"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">{t("accounts.password")}</label>
                        <div className="relative">
                            <Input
                                type={showPassword ? "text" : "password"}
                                placeholder={t("accounts.password")}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                                className="pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                            {error}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.cancel")}
                    </Button>
                    <Button onClick={handleLogin} disabled={loading || !password.trim()}>
                        {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                        {t("accounts.relogin")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
