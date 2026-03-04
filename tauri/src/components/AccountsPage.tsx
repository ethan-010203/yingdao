import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { Account } from "@/contexts/ConfigContext";
import { ArrowLeft, Plus, Users, Trash2 } from "lucide-react";

interface AccountsPageProps {
    accounts: Account[];
    isAdmin: boolean;
    onNavigate: (page: "home" | "migrate" | "accounts" | "local" | "cloud" | "settings") => void;
    onAddAccount: () => void;
    onEditAccount: (acc: Account) => void;
    onDeleteAccount: (id: string) => void;
    onOpenDetail: (acc: Account) => void;
}

export function AccountsPage({
    accounts,
    isAdmin,
    onNavigate,
    onAddAccount,
    onEditAccount,
    onDeleteAccount,
    onOpenDetail,
}: AccountsPageProps) {
    const { t } = useTranslation();

    return (
        <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-10">
                <div>
                    <Button variant="ghost" onClick={() => onNavigate("home")} className="mb-4 -ml-3 text-muted-foreground/70">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        {t("common.back")}
                    </Button>
                    <h1 className="text-3xl font-bold text-gradient">{t("accounts.title")}</h1>
                </div>
                <Button onClick={onAddAccount}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t("accounts.add")}
                </Button>
            </div>

            {accounts.length === 0 ? (
                <Card className="text-center py-16">
                    <CardContent>
                        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-5">
                            <Users className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                        <p className="text-muted-foreground/70 mb-5">{t("accounts.list")}</p>
                        <Button onClick={onAddAccount}>
                            {t("accounts.add")}
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {accounts.map(acc => (
                        <Card
                            key={acc.id}
                            className={cn("transition-all duration-200", isAdmin && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3]")}
                            onClick={() => isAdmin && onOpenDetail(acc)}
                        >
                            <CardContent className="flex items-center justify-between p-5">
                                <div className="flex items-center gap-4">
                                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                                        {acc.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-semibold">{acc.name}</div>
                                        <div className="text-sm text-muted-foreground/60">{acc.username}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onEditAccount(acc);
                                        }}
                                    >
                                        {t("common.edit")}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/8"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm(t("accounts.delete.confirm").replace("{name}", acc.name))) {
                                                onDeleteAccount(acc.id);
                                            }
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
