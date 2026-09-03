import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import type { MigrateResult } from "@/types";

interface ResultStepProps {
    results: MigrateResult[];
    onBackHome: () => void;
    compact?: boolean;
}

export function ResultStep({ results, onBackHome, compact = false }: ResultStepProps) {
    const { t } = useTranslation();
    const successCount = results.filter(r => r.success).length;

    return (
        <Card>
            <CardContent className={cn(compact ? "p-4 space-y-3" : "p-6 space-y-4")}>
                <h3 className="text-lg font-semibold text-center">{t("migrate.step.result")}</h3>
                <div className={cn(compact ? "space-y-1.5" : "max-h-[300px] overflow-y-auto space-y-2")}>
                    {results.map((r, idx) => (
                        <div
                            key={idx}
                            className={cn(
                                "flex items-center gap-3 rounded-xl",
                                compact ? "p-2.5" : "p-3.5",
                                r.success ? "bg-emerald-500/8" : "bg-red-500/8"
                            )}
                        >
                            {r.success ? (
                                <Check className={cn(compact ? "h-4 w-4" : "h-5 w-5", "text-emerald-500")} />
                            ) : (
                                <X className={cn(compact ? "h-4 w-4" : "h-5 w-5", "text-red-500")} />
                            )}
                            <span className={cn("font-medium", compact && "text-sm")}>{r.name}</span>
                        </div>
                    ))}
                </div>
                <div className={cn(
                    "text-center font-semibold text-emerald-600 dark:text-emerald-400",
                    compact ? "text-md" : "text-lg"
                )}>
                    {t("common.success")} {successCount} / {results.length} 个
                </div>
                <div className={cn("flex justify-center", compact ? "pt-2" : "pt-4")}>
                    <Button size={compact ? "sm" : "default"} onClick={onBackHome}>
                        {t("common.home")}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
