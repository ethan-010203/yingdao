import { useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { MigrateProgressPayload } from "@/types";
import { useTranslation } from "@/lib/i18n";

/// Subscribe to backend `migrate-progress` events and project them to a
/// human-readable loading-text string.
///
/// Returns a function that registers the listener and returns an unsubscribe.
export function useMigrateProgressListener(setLoadingText: (text: string) => void) {
    const { t } = useTranslation();

    return useCallback(async () => {
        return await listen<MigrateProgressPayload>("migrate-progress", (event) => {
            const { current, total, name } = event.payload;
            setLoadingText(
                t("migrate.progress")
                    .replace("{current}", String(current))
                    .replace("{total}", String(total))
                    .replace("{name}", name)
            );
        });
    }, [setLoadingText, t]);
}
