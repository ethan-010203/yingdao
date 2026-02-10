import * as React from "react"
import { cn } from "@/lib/utils"
import { Sidebar } from "./Sidebar"

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
    accountsCount = 0,
    onSignOut,
    username,
    isAdmin = false,
    language = "zh-CN",
}: LayoutProps) {
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)

    return (
        <div className="min-h-screen bg-background">
            {/* 背景装饰 — 轻微灰色光晕 */}
            <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
                <div className="absolute -top-[40%] -right-[30%] w-[70%] h-[70%] bg-gradient-to-bl from-[hsl(0,0%,50%,0.03)] via-transparent to-transparent rounded-full blur-3xl" />
                <div className="absolute -bottom-[40%] -left-[30%] w-[70%] h-[70%] bg-gradient-to-tr from-[hsl(0,0%,40%,0.03)] via-transparent to-transparent rounded-full blur-3xl" />
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
                language={language}
            />

            {/* 主内容区 */}
            <main
                className={cn(
                    "min-h-screen transition-all duration-300 ease-in-out",
                    sidebarCollapsed ? "ml-[68px]" : "ml-[240px]"
                )}
            >
                <div className="p-8 lg:p-10 animate-fade-in-up">
                    {children}
                </div>
            </main>
        </div>
    )
}
