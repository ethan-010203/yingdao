import { Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface LoadingOverlayProps {
    text?: string;
}

export function LoadingOverlay({ text }: LoadingOverlayProps) {
    const { t } = useTranslation();
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/70 backdrop-blur-xl">
            <div className="flex flex-col items-center gap-5 animate-scale-in">
                <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
                    <Loader2 className="h-10 w-10 animate-spin text-primary relative" />
                </div>
                <p className="text-muted-foreground/80 font-medium">{text || t("common.loading")}</p>
            </div>
        </div>
    );
}
