import * as React from "react";
import { useConfig } from "@/contexts/ConfigContext";
import zhCN, { type TranslationKey } from "./zh-CN";
import enUS from "./en-US";

const translations = {
    "zh-CN": zhCN as Record<string, string>,
    "en-US": enUS as Record<string, string>,
} as const;

export type Language = keyof typeof translations;
export type { TranslationKey };

export function t(key: string, language: string = "zh-CN"): string {
    const lang = (language in translations ? language : "zh-CN") as Language;
    return translations[lang]?.[key] || key;
}

export function useTranslation() {
    const { settings } = useConfig();
    const language = (settings.language as Language) || "zh-CN";

    const translate = React.useCallback((key: string) => {
        return t(key, language);
    }, [language]);

    return { t: translate, language };
}
