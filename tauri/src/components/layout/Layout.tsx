import * as React from "react"
import Dock, { DockItemData } from "@/components/ui/Dock"
import {
    Home,
    FolderSync,
    Users,
    Settings,
    LogOut,
    Sun,
    Moon,
    User
} from "lucide-react"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import Galaxy from "@/components/ui/Galaxy"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Theme = "light" | "dark" | "system"
type Page = "home" | "migrate" | "accounts" | "local" | "cloud" | "settings"

interface LayoutProps {
    children: React.ReactNode
    currentPage: Page
    onNavigate: (page: Page) => void
    theme: Theme
    onThemeChange: (theme: Theme) => void
    accountsCount?: number
    onSignOut?: () => void
    username?: string | null
    isAdmin?: boolean
    language?: string
}

export function Layout({
    children,
    currentPage,
    onNavigate,
    theme,
    onThemeChange,
    onSignOut,
    username,
    isAdmin = false,
    language = "zh-CN",
}: LayoutProps) {
    const isPageActive = (navId: Page) => {
        if (navId === "home" && currentPage === "home") return true
        if (navId === "migrate" && ["migrate", "local", "cloud"].includes(currentPage)) return true
        if (navId === "accounts" && currentPage === "accounts") return true
        if (navId === "settings" && currentPage === "settings") return true
        return false
    }

    const navigationItems: DockItemData[] = [
        {
            id: "home",
            label: t("common.home", language as any),
            icon: <Home size={20} />,
            onClick: () => onNavigate("home"),
            isActive: isPageActive("home")
        },
        {
            id: "migrate",
            label: t("common.migrate", language as any),
            icon: <FolderSync size={20} />,
            onClick: () => onNavigate("migrate"),
            isActive: isPageActive("migrate")
        },
        {
            id: "accounts",
            label: t("common.accounts", language as any),
            icon: <Users size={20} />,
            onClick: () => onNavigate("accounts"),
            isActive: isPageActive("accounts")
        },
        {
            id: "settings",
            label: t("common.settings", language as any),
            icon: <Settings size={20} />,
            onClick: () => onNavigate("settings"),
            isActive: isPageActive("settings")
        }
    ]

    return (
        <div className="min-h-screen bg-background/30 text-foreground transition-colors duration-300">
            {/* 背景装饰 */}
            <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none opacity-50 dark:opacity-80">
                {theme === "dark" && (
                    <Galaxy
                        density={1}
                        glowIntensity={0.3}
                        saturation={0}
                        hueShift={140}
                        twinkleIntensity={0.3}
                        rotationSpeed={0.1}
                        repulsionStrength={2}
                        autoCenterRepulsion={0}
                        starSpeed={0.5}
                        speed={1}
                        mouseInteraction={true}
                        mouseRepulsion={true}
                    />
                )}
            </div>

            {/* 顶部浮动工具栏 */}
            <header className="fixed top-6 right-6 z-50 flex items-center gap-3">
                <Button
                    variant="outline"
                    size="icon"
                    className="rounded-full w-10 h-10 bg-background/50 backdrop-blur-md border-border/40 shadow-sm"
                    onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
                >
                    {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="pl-1 pr-3 py-1 h-10 rounded-full bg-background/50 backdrop-blur-md border-border/40 shadow-sm gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                                {username?.charAt(0).toUpperCase() || <User size={14} />}
                            </div>
                            <span className="text-sm font-medium">{username || t("sidebar.user", language as any)}</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">{username}</p>
                                <p className="text-xs leading-none text-muted-foreground">
                                    {isAdmin ? t("sidebar.admin", language as any) : t("sidebar.user", language as any)}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
                            <LogOut className="mr-2 h-4 w-4" />
                            <span>{t("sidebar.logout", language as any)}</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

            {/* 主内容区 */}
            <main className="min-h-screen pt-20 pb-32">
                <div className="max-w-6xl mx-auto px-6 lg:px-10">
                    <div className="animate-fade-in-up">
                        {children}
                    </div>
                </div>
            </main>

            {/* 底部导航 */}
            <Dock items={navigationItems} />
        </div>
    )
}
