import * as React from "react"
import { cn } from "@/lib/utils"
import { Sidebar } from "./Sidebar"

type Theme = "light" | "dark" | "system"
type Page = "home" | "migrate" | "accounts" | "local" | "cloud"

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
    accountsCount = 0,
    onSignOut,
    username,
    isAdmin = false,
}: LayoutProps) {
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
            {/* 背景装饰 */}
            <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
                <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-primary/5 via-transparent to-transparent rounded-full blur-3xl" />
                <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-primary/5 via-transparent to-transparent rounded-full blur-3xl" />
            </div>

            {/* 侧边栏 */}
            <Sidebar
                currentPage={currentPage}
                onNavigate={onNavigate}
                theme={theme}
                onThemeChange={onThemeChange}
                accountsCount={accountsCount}
                collapsed={sidebarCollapsed}
                onCollapsedChange={setSidebarCollapsed}
                onSignOut={onSignOut}
                username={username}
                isAdmin={isAdmin}
            />

            {/* 主内容区 */}
            <main
                className={cn(
                    "min-h-screen transition-all duration-300 ease-in-out",
                    sidebarCollapsed ? "ml-[68px]" : "ml-[240px]"
                )}
            >
                <div className="p-6 lg:p-8">
                    {children}
                </div>
            </main>
        </div>
    )
}
