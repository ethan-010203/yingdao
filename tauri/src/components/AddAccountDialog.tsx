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
import { UserPlus, Eye, EyeOff, Loader2 } from "lucide-react"

interface AddAccountDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (account: { name: string; username: string; password: string }) => void
    editAccount?: { id: string; name: string; username: string; password: string } | null
}

export function AddAccountDialog({
    open,
    onOpenChange,
    onSave,
    editAccount,
}: AddAccountDialogProps) {
    const [name, setName] = useState("")
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [verifying, setVerifying] = useState(false)
    const [errors, setErrors] = useState<{ name?: string; username?: string; password?: string; general?: string }>({})

    // 编辑模式时填充数据
    useEffect(() => {
        if (open && editAccount) {
            setName(editAccount.name)
            setUsername(editAccount.username)
            setPassword(editAccount.password)
        } else if (open) {
            setName("")
            setUsername("")
            setPassword("")
        }
        setErrors({})
        setShowPassword(false)
        setVerifying(false)
    }, [open, editAccount])

    const validate = () => {
        const newErrors: typeof errors = {}
        if (!name.trim()) newErrors.name = "请输入账号名称"
        if (!username.trim()) newErrors.username = "请输入用户名"
        if (!password.trim()) newErrors.password = "请输入密码"
        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleSave = async () => {
        if (!validate()) return

        setVerifying(true)
        setErrors({})

        try {
            // 先验证账号密码是否正确
            await invoke<string>("login_account", {
                username: username.trim(),
                password: password,
                accountType: "verify"
            })

            // 验证成功，保存账号
            onSave({ name: name.trim(), username: username.trim(), password })
            onOpenChange(false)
        } catch (err) {
            // 验证失败，显示错误信息
            setErrors({ general: `账号验证失败: ${String(err)}` })
        } finally {
            setVerifying(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !verifying && onOpenChange(v)}>
            <DialogContent className="sm:max-w-md">
                {/* 验证中遮罩 */}
                {verifying && (
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center rounded-lg">
                        <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <span className="text-sm text-muted-foreground">正在验证账号...</span>
                        </div>
                    </div>
                )}

                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-5 w-5" />
                        {editAccount ? "编辑账号" : "添加账号"}
                    </DialogTitle>
                    <DialogDescription>
                        {editAccount ? "修改账号信息" : "添加一个新的影刀账号（将自动验证账号密码）"}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* 通用错误信息 */}
                    {errors.general && (
                        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                            <p className="text-sm text-destructive">{errors.general}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm font-medium">账号名称</label>
                        <Input
                            placeholder="例如：工作账号"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={errors.name ? "border-destructive" : ""}
                            disabled={verifying}
                        />
                        {errors.name && (
                            <p className="text-sm text-destructive">{errors.name}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">用户名</label>
                        <Input
                            placeholder="手机号/邮箱"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className={errors.username ? "border-destructive" : ""}
                            disabled={verifying}
                        />
                        {errors.username && (
                            <p className="text-sm text-destructive">{errors.username}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">密码</label>
                        <div className="relative">
                            <Input
                                type={showPassword ? "text" : "password"}
                                placeholder="账号密码"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={errors.password ? "border-destructive pr-10" : "pr-10"}
                                disabled={verifying}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                disabled={verifying}
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                        {errors.password && (
                            <p className="text-sm text-destructive">{errors.password}</p>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={verifying}>
                        取消
                    </Button>
                    <Button onClick={handleSave} disabled={verifying}>
                        {verifying ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                验证中...
                            </>
                        ) : (
                            editAccount ? "保存" : "添加"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
