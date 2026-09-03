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
    Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { t } from "@/lib/i18n"

type Theme = "light" | "dark" | "system"
type Page = "home" | "migrate" | "accounts" | "local" | "cloud" | "settings"

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
    language?: string
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
    language = "zh-CN",
}: SidebarProps) {
    const navItems: NavItem[] = [
        {
            id: "home",
            label: t("common.home", language as any),
            icon: <Home className="h-[18px] w-[18px]" />,
        },
        {
            id: "migrate",
            label: t("common.migrate", language as any),
            icon: <FolderSync className="h-[18px] w-[18px]" />,
        },
        {
            id: "accounts",
            label: t("common.accounts", language as any),
            icon: <Users className="h-[18px] w-[18px]" />,
            badge: accountsCount,
        },
        {
            id: "settings",
            label: t("common.settings", language as any),
            icon: <Settings className="h-[18px] w-[18px]" />,
        },
    ]

    const themeOptions: { value: Theme; icon: React.ReactNode; label: string }[] = [
        { value: "light", icon: <Sun className="h-3.5 w-3.5" />, label: t("sidebar.theme.light", language as any) },
        { value: "dark", icon: <Moon className="h-3.5 w-3.5" />, label: t("sidebar.theme.dark", language as any) },
        { value: "system", icon: <Monitor className="h-3.5 w-3.5" />, label: t("sidebar.theme.system", language as any) },
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
                "bg-card/70 backdrop-blur-2xl",
                "border-r border-border/30",
                "flex flex-col",
                "transition-all duration-300 ease-in-out",
                collapsed ? "w-[68px]" : "w-[240px]"
            )}
        >
            {/* Logo 区域 */}
            <div className="flex h-16 items-center justify-between px-4 border-b border-border/20">
                {!collapsed && (
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm shadow-primary/20">
                            {username ? username.charAt(0).toUpperCase() : '影'}
                        </div>
                        <div className="flex flex-col">
                            <span className="font-semibold text-sm">{username || '影刀工具'}</span>
                            {username && (
                                <span className={cn(
                                    "text-[10px] px-1.5 py-0.5 rounded-full w-fit mt-0.5 font-medium border",
                                    isAdmin
                                        ? "bg-[hsl(45,93%,47%,0.1)] text-[hsl(45,93%,35%)] border-[hsl(45,93%,47%,0.2)] dark:text-[hsl(45,93%,60%)]"
                                        : "bg-muted text-muted-foreground border-transparent"
                                )}>
                                    {isAdmin ? t("sidebar.admin", language as any) : t("sidebar.user", language as any)}
                                </span>
                            )}
                        </div>
                    </div>
                )}
                {collapsed && (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-semibold text-sm mx-auto shadow-sm shadow-primary/20">
                        {username ? username.charAt(0).toUpperCase() : '影'}
                    </div>
                )}
                {!collapsed && onCollapsedChange && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg"
                        onClick={() => onCollapsedChange(true)}
                    >
                        <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>

            {/* 导航区域 */}
            <ScrollArea className="flex-1 py-5">
                <nav className="space-y-1 px-3">
                    {navItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl",
                                "text-sm font-medium transition-all duration-200",
                                isActive(item.id)
                                    ? "bg-primary/10 text-primary shadow-sm shadow-primary/5"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
                                collapsed && "justify-center px-0"
                            )}
                        >
                            <span className={cn(
                                "flex-shrink-0",
                                isActive(item.id) && "text-foreground"
                            )}>
                                {item.icon}
                            </span>
                            {!collapsed && (
                                <>
                                    <span className="flex-1 text-left">{item.label}</span>
                                    {item.badge !== undefined && item.badge > 0 && (
                                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/8 text-[11px] text-foreground/70 px-1.5 font-medium">
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
            <div className="p-3 border-t border-border/20 space-y-2">
                {/* 主题切换 */}
                <div className={cn(
                    "flex items-center gap-0.5 p-1 rounded-xl bg-muted/40",
                    collapsed && "flex-col"
                )}>
                    {themeOptions.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => onThemeChange(option.value)}
                            className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs transition-all duration-200",
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
                            "w-full text-muted-foreground hover:text-destructive hover:bg-destructive/8 rounded-xl",
                            collapsed ? "justify-center px-0" : "justify-start"
                        )}
                        onClick={onSignOut}
                    >
                        <LogOut className="h-4 w-4" />
                        {!collapsed && <span className="ml-2">{t("sidebar.logout", language as any)}</span>}
                    </Button>
                )}

                {/* 折叠按钮（折叠状态下显示） */}
                {collapsed && onCollapsedChange && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="w-full h-8 rounded-xl"
                        onClick={() => onCollapsedChange(false)}
                    >
                        <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>
        </aside>
    )
}
