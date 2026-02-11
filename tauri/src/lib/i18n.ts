import { useConfig } from "@/contexts/ConfigContext";

const translations: Record<string, Record<string, string>> = {
    "zh-CN": {
        "common.home": "首页",
        "common.migrate": "迁移流程",
        "common.accounts": "账号管理",
        "common.settings": "设置",
        "sidebar.theme.light": "浅色",
        "sidebar.theme.dark": "深色",
        "sidebar.theme.system": "系统",
        "sidebar.logout": "退出登录",
        "sidebar.admin": "管理员",
        "sidebar.user": "普通用户",
        "settings.title": "设置",
        "settings.general": "通用",
        "settings.about": "关于",
        "settings.save": "保存设置",
        "settings.saving": "保存中...",
        "settings.language": "语言设置",
        "settings.language.desc": "选择软件显示的语言",
        "settings.language.label": "界面语言",
        "settings.theme": "主题设置",
        "settings.theme.desc": "选择软件显示的主题",
        "settings.theme.label": "界面主题",
        "settings.theme.light": "浅色",
        "settings.theme.dark": "深色",
        "settings.theme.system": "跟随系统",
        "settings.update": "自动更新",
        "settings.update.desc": "启动时自动检查更新",
        "settings.update.label": "启用自动更新",
        "settings.check_update": "检测更新",
        "settings.check_update.checking": "正在检测...",
        "settings.check_update.latest": "当前已是最新版",
        "settings.check_update.found": "发现新版本 {version}",
        "settings.check_update.download": "下载更新",
        "settings.check_update.downloading": "正在下载更新...",
        "settings.check_update.downloaded": "下载完成，安装包已保存到桌面",
        "settings.check_update.download_failed": "下载失败",
        "settings.check_update.installing": "下载完成，正在启动安装程序...",
        "settings.app.author": "作者",
        "settings.app.wechat": "微信公众号",
        "settings.app.source": "开源地址",
        "settings.app.support": "赞助支持",
        "settings.app.view_code": "查看代码",
        "settings.app.support_author": "支持作者",
        "common.success": "操作成功",
        "common.error": "操作失败",
    },
    "en-US": {
        "common.home": "Home",
        "common.migrate": "Migration",
        "common.accounts": "Accounts",
        "common.settings": "Settings",
        "sidebar.theme.light": "Light",
        "sidebar.theme.dark": "Dark",
        "sidebar.theme.system": "System",
        "sidebar.logout": "Sign Out",
        "sidebar.admin": "Admin",
        "sidebar.user": "User",
        "settings.title": "Settings",
        "settings.general": "General",
        "settings.about": "About",
        "settings.save": "Save Settings",
        "settings.saving": "Saving...",
        "settings.language": "Language",
        "settings.language.desc": "Select the language for the software",
        "settings.language.label": "Interface Language",
        "settings.theme": "Theme",
        "settings.theme.desc": "Select the theme for the software",
        "settings.theme.label": "Interface Theme",
        "settings.theme.light": "Light",
        "settings.theme.dark": "Dark",
        "settings.theme.system": "System",
        "settings.update": "Auto Update",
        "settings.update.desc": "Automatically check for updates on startup",
        "settings.update.label": "Enable Auto Update",
        "settings.check_update": "Check for Updates",
        "settings.check_update.checking": "Checking...",
        "settings.check_update.latest": "You are on the latest version",
        "settings.check_update.found": "New version {version} available",
        "settings.check_update.download": "Download",
        "settings.check_update.downloading": "Downloading update...",
        "settings.check_update.downloaded": "Download complete, installer saved to Desktop",
        "settings.check_update.download_failed": "Download failed",
        "settings.check_update.installing": "Download complete, launching installer...",
        "settings.app.author": "Author",
        "settings.app.wechat": "WeChat",
        "settings.app.source": "Source Code",
        "settings.app.support": "Support",
        "settings.app.view_code": "View Code",
        "settings.app.support_author": "Support Author",
        "common.success": "Success",
        "common.error": "Error",
    }
};

export type Language = keyof typeof translations;
export type TranslationKey = string;

// Standalone t function for non-hook usage (e.g., Sidebar which receives language via props)
export function t(key: string, language: string = "zh-CN"): string {
    const lang = language in translations ? language : "zh-CN";
    return translations[lang]?.[key] || key;
}

// Hook-based translation for React components
export function useTranslation() {
    const { settings } = useConfig();
    const language = (settings.language as Language) || "zh-CN";

    const translate = (key: string) => {
        return t(key, language);
    };

    return { t: translate, language };
}
