import * as React from "react"
import { cn } from "@/lib/utils"
import {
    Home,
    FolderSync,
    Users,
    Sun,
    Moon,
    Monitor,
    ChevronLeft,
    ChevronRight,
    LogOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

type Theme = "light" | "dark" | "system"
type Page = "home" | "migrate" | "accounts" | "local" | "cloud"

interface SidebarProps {
    currentPage: Page
    onNavigate: (page: Page) => void
    theme: Theme
    onThemeChange: (theme: Theme) => void
    accountsCount?: number
    collapsed?: boolean
    onCollapsedChange?: (collapsed: boolean) => void
    onSignOut?: () => void
    username?: string | null
    isAdmin?: boolean
}

interface NavItem {
    id: Page
    label: string
    icon: React.ReactNode
    badge?: number
}

export function Sidebar({
    currentPage,
    onNavigate,
    theme,
    onThemeChange,
    accountsCount = 0,
    collapsed = false,
    onCollapsedChange,
    onSignOut,
    username,
    isAdmin = false,
}: SidebarProps) {
    const navItems: NavItem[] = [
        {
            id: "home",
            label: "首页",
            icon: <Home className="h-5 w-5" />,
        },
        {
            id: "migrate",
            label: "迁移流程",
            icon: <FolderSync className="h-5 w-5" />,
        },
        {
            id: "accounts",
            label: "账号管理",
            icon: <Users className="h-5 w-5" />,
            badge: accountsCount,
        },
    ]

    const themeOptions: { value: Theme; icon: React.ReactNode; label: string }[] = [
        { value: "light", icon: <Sun className="h-4 w-4" />, label: "浅色" },
        { value: "dark", icon: <Moon className="h-4 w-4" />, label: "深色" },
        { value: "system", icon: <Monitor className="h-4 w-4" />, label: "系统" },
    ]

    // 判断当前页面是否属于某个导航项（处理子页面）
    const isActive = (navId: Page) => {
        if (navId === "home" && currentPage === "home") return true
        if (navId === "migrate" && ["migrate", "local", "cloud"].includes(currentPage)) return true
        if (navId === "accounts" && currentPage === "accounts") return true
        return false
    }

    return (
        <aside
            className={cn(
                "fixed left-0 top-0 z-40 h-screen",
                "bg-background/80 backdrop-blur-xl",
                "border-r border-border/50",
                "flex flex-col",
                "transition-all duration-300 ease-in-out",
                collapsed ? "w-[68px]" : "w-[240px]"
            )}
        >
            {/* Logo 区域 */}
            <div className="flex h-16 items-center justify-between px-4 border-b border-border/50">
                {!collapsed && (
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-bold text-lg">
                            {username ? username.charAt(0).toUpperCase() : '影'}
                        </div>
                        <div className="flex flex-col">
                            <span className="font-semibold text-sm">{username || '影刀工具'}</span>
                            {username && (
                                <span className={cn(
                                    "text-xs px-1.5 py-0.5 rounded-full w-fit",
                                    isAdmin
                                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                        : "bg-muted text-muted-foreground"
                                )}>
                                    {isAdmin ? '管理员' : '普通用户'}
                                </span>
                            )}
                        </div>
                    </div>
                )}
                {collapsed && (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground font-bold text-lg mx-auto">
                        影
                    </div>
                )}
                {!collapsed && onCollapsedChange && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onCollapsedChange(true)}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* 导航区域 */}
            <ScrollArea className="flex-1 py-4">
                <nav className="space-y-1 px-3">
                    {navItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
                                "text-sm font-medium transition-all duration-200",
                                "hover:bg-accent/50",
                                isActive(item.id)
                                    ? "bg-primary/10 text-primary shadow-sm"
                                    : "text-muted-foreground hover:text-foreground",
                                collapsed && "justify-center px-0"
                            )}
                        >
                            <span className={cn(
                                "flex-shrink-0",
                                isActive(item.id) && "text-primary"
                            )}>
                                {item.icon}
                            </span>
                            {!collapsed && (
                                <>
                                    <span className="flex-1 text-left">{item.label}</span>
                                    {item.badge !== undefined && item.badge > 0 && (
                                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary px-1.5">
                                            {item.badge}
                                        </span>
                                    )}
                                </>
                            )}
                        </button>
                    ))}
                </nav>
            </ScrollArea>

            {/* 底部区域 */}
            <div className="p-3 border-t border-border/50 space-y-2">
                {/* 主题切换 */}
                <div className={cn(
                    "flex items-center gap-1 p-1 rounded-lg bg-muted/50",
                    collapsed && "flex-col"
                )}>
                    {themeOptions.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => onThemeChange(option.value)}
                            className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs transition-all",
                                theme === option.value
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                                collapsed && "w-full"
                            )}
                            title={option.label}
                        >
                            {option.icon}
                            {!collapsed && <span>{option.label}</span>}
                        </button>
                    ))}
                </div>

                {/* 登出按钮 */}
                {onSignOut && (
                    <Button
                        variant="ghost"
                        className={cn(
                            "w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10",
                            collapsed ? "justify-center px-0" : "justify-start"
                        )}
                        onClick={onSignOut}
                    >
                        <LogOut className="h-4 w-4" />
                        {!collapsed && <span className="ml-2">退出登录</span>}
                    </Button>
                )}

                {/* 折叠按钮（折叠状态下显示） */}
                {collapsed && onCollapsedChange && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="w-full h-8"
                        onClick={() => onCollapsedChange(false)}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </aside>
    )
}
