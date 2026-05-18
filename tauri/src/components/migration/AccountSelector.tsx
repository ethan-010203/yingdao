import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import type { Account } from "@/contexts/ConfigContext";

interface AccountSelectorProps {
    accounts: Account[];
    selectedId: string;
    onSelectedIdChange: (id: string) => void;
    manualUser: string;
    onManualUserChange: (u: string) => void;
    manualPwd: string;
    onManualPwdChange: (p: string) => void;
    title: string;
}

export function AccountSelector({
    accounts,
    selectedId,
    onSelectedIdChange,
    manualUser,
    onManualUserChange,
    manualPwd,
    onManualPwdChange,
    title,
}: AccountSelectorProps) {
    const { t } = useTranslation();

    return (
        <div className="space-y-3">
            <h3 className="text-base font-semibold">{title}</h3>
            <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                {accounts.map(acc => (
                    <div
                        key={acc.id}
                        onClick={() => onSelectedIdChange(acc.id)}
                        className={cn(
                            "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200",
                            selectedId === acc.id
                                ? "bg-primary/8 shadow-sm shadow-primary/10 ring-1 ring-primary/20"
                                : "bg-muted/30 hover:bg-muted/50"
                        )}
                    >
                        <div className={cn(
                            "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                            selectedId === acc.id ? "border-primary" : "border-muted-foreground/40"
                        )}>
                            {selectedId === acc.id && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <div className="flex-1">
                            <div className="font-medium text-sm">{acc.name}</div>
                            <div className="text-xs text-muted-foreground/70">{acc.username}</div>
                        </div>
                    </div>
                ))}

                <div
                    onClick={() => onSelectedIdChange("manual")}
                    className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border border-dashed cursor-pointer transition-all duration-200",
                        selectedId === "manual"
                            ? "border-primary/40 bg-primary/8"
                            : "border-border/50 hover:border-primary/30 hover:bg-muted/30"
                    )}
                >
                    <div className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                        selectedId === "manual" ? "border-primary" : "border-muted-foreground/40"
                    )}>
                        {selectedId === "manual" && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className="font-medium text-sm">{t("migrate.target.manual")}</span>
                </div>
            </div>

            {selectedId === "manual" && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-muted/30 animate-fade-in">
                    <Input
                        type="text"
                        placeholder={t("migrate.manual.username")}
                        value={manualUser}
                        onChange={e => onManualUserChange(e.target.value)}
                    />
                    <Input
                        type="password"
                        placeholder={t("migrate.manual.password")}
                        value={manualPwd}
                        onChange={e => onManualPwdChange(e.target.value)}
                    />
                </div>
            )}
        </div>
    );
}
