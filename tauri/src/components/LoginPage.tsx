import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster, toast } from '@/components/ui/toaster'
import { Loader2, User, Lock, LogIn, Eye, EyeOff } from 'lucide-react'

export function LoginPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const { signIn } = useAuth()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!username.trim() || !password.trim()) {
            toast.error('请输入用户名和密码')
            return
        }

        setLoading(true)

        try {
            await signIn(username, password)
            toast.success('登录成功！')
        } catch (error: any) {
            console.error('登录失败:', error)
            toast.error(error.message || '登录失败，请检查用户名和密码')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
            {/* 背景装饰 */}
            <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
                <div className="absolute -top-[40%] -right-[30%] w-[60%] h-[60%] bg-gradient-to-bl from-[hsl(0,0%,50%,0.04)] via-transparent to-transparent rounded-full blur-3xl" />
                <div className="absolute -bottom-[40%] -left-[30%] w-[60%] h-[60%] bg-gradient-to-tr from-[hsl(0,0%,40%,0.04)] via-transparent to-transparent rounded-full blur-3xl" />
            </div>

            <div className="animate-scale-in">
                <Card className="w-full max-w-md mx-4 bg-card/80 backdrop-blur-2xl border-border/30 shadow-xl shadow-black/[0.06] dark:shadow-black/[0.3]">
                    <CardHeader className="text-center pb-2">
                        {/* Logo / 标题区域 */}
                        <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/25">
                            <LogIn className="h-8 w-8" />
                        </div>
                        <CardTitle className="text-2xl font-bold">
                            影刀工具
                        </CardTitle>
                        <CardDescription className="text-muted-foreground/70">
                            请登录以继续使用
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="pt-6">
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* 用户名输入 */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground/80" htmlFor="username">
                                    用户名
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                                    <Input
                                        id="username"
                                        type="text"
                                        placeholder="请输入用户名"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="pl-10 h-11"
                                        disabled={loading}
                                        autoComplete="username"
                                    />
                                </div>
                            </div>

                            {/* 密码输入 */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground/80" htmlFor="password">
                                    密码
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                                    <Input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="请输入密码"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="pl-10 pr-10 h-11"
                                        disabled={loading}
                                        autoComplete="current-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* 登录按钮 */}
                            <Button
                                type="submit"
                                className="w-full h-11 text-base font-medium mt-8"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        登录中...
                                    </>
                                ) : (
                                    <>
                                        <LogIn className="mr-2 h-4 w-4" />
                                        登录
                                    </>
                                )}
                            </Button>
                        </form>

                        {/* 版权信息 */}
                        <p className="text-center text-xs text-muted-foreground/50 mt-8">
                            © 2026 影刀工具 · 安全登录
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* 提示通知 */}
            <Toaster />
        </div>
    )
}
