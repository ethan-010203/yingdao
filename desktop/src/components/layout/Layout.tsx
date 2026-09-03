import * as React from "react"
import Dock, { DockItemData } from "@/components/ui/Dock"
import {
    Home,
    FolderSync,
    Users,
    Settings,
    Sun,
    Moon,
} from "lucide-react"
import { useTranslation } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

import type { Theme, Page } from "@/types"

const Galaxy = React.lazy(() => import("@/components/ui/Galaxy"))

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
}

export function Layout({
    children,
    currentPage,
    onNavigate,
    theme,
    onThemeChange,
}: LayoutProps) {
    const { t } = useTranslation()
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
            label: t("common.home"),
            icon: <Home size={20} />,
            onClick: () => onNavigate("home"),
            isActive: isPageActive("home")
        },
        {
            id: "migrate",
            label: t("common.migrate"),
            icon: <FolderSync size={20} />,
            onClick: () => onNavigate("migrate"),
            isActive: isPageActive("migrate")
        },
        {
            id: "accounts",
            label: t("common.accounts"),
            icon: <Users size={20} />,
            onClick: () => onNavigate("accounts"),
            isActive: isPageActive("accounts")
        },
        {
            id: "settings",
            label: t("common.settings"),
            icon: <Settings size={20} />,
            onClick: () => onNavigate("settings"),
            isActive: isPageActive("settings")
        }
    ]

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-background/30 text-foreground transition-colors duration-300">
            {/* 背景装饰 */}
            <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none opacity-50 dark:opacity-80">
                {theme === "dark" && (
                    <React.Suspense fallback={null}>
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
                    </React.Suspense>
                )}
            </div>

            {/* 顶部浮动工具栏 */}
            <header className="shrink-0 h-16 flex items-center justify-end px-6 z-50">
                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        size="icon"
                        className="rounded-full w-10 h-10 bg-background/50 backdrop-blur-md border-border/40 shadow-sm"
                        onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
                    >
                        {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
                    </Button>
                </div>
            </header>

            {/* 主内容区 — flex-1 填充剩余空间，不滚动 */}
            <main className="flex-1 min-h-0 pb-24">
                <div className="h-full max-w-6xl mx-auto px-6 lg:px-10">
                    <div className="h-full animate-fade-in-up">
                        {children}
                    </div>
                </div>
            </main>

            {/* 底部导航 */}
            <Dock items={navigationItems} />
        </div>
    )
}
