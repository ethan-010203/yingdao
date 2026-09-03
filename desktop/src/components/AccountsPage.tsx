import { useRef, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { Account } from "@/contexts/ConfigContext";
import { useAutoPageSize } from "@/hooks/useAutoPageSize";
import { ArrowLeft, ArrowRight, Plus, Users, Trash2 } from "lucide-react";

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
    const listRef = useRef<HTMLDivElement>(null);
    const pageSize = useAutoPageSize(listRef, 96);
    const [currentPage, setCurrentPage] = useState(1);
    const [pendingDeleteAcc, setPendingDeleteAcc] = useState<Account | null>(null);

    const totalPages = Math.max(1, Math.ceil(accounts.length / pageSize));
    const paginatedAccounts = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return accounts.slice(start, start + pageSize);
    }, [accounts, currentPage, pageSize]);

    return (
        <div className="h-full flex flex-col max-w-4xl mx-auto">
            <div className="shrink-0 flex items-center justify-between mb-4">
                <div>
                    <Button variant="ghost" onClick={() => onNavigate("home")} className="mb-2 -ml-3 text-muted-foreground/70">
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
                <>
                    <div ref={listRef} className="flex-1 min-h-0 space-y-3">
                        {paginatedAccounts.map(acc => (
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
                                                setPendingDeleteAcc(acc);
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                    {totalPages > 1 && (
                        <div className="shrink-0 flex items-center justify-end py-2">
                            <div className="flex items-center gap-1.5">
                                <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)} className="rounded-lg h-8 w-8 p-0">
                                    <ArrowLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm text-muted-foreground/70 min-w-[60px] text-center font-medium">
                                    {currentPage} / {totalPages}
                                </span>
                                <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(currentPage + 1)} className="rounded-lg h-8 w-8 p-0">
                                    <ArrowRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
            <AlertDialog open={!!pendingDeleteAcc} onOpenChange={(open) => { if (!open) setPendingDeleteAcc(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("accounts.delete.confirm").replace("{name}", pendingDeleteAcc?.name || "")}</AlertDialogTitle>
                        <AlertDialogDescription>{t("accounts.delete.desc")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => { if (pendingDeleteAcc) onDeleteAccount(pendingDeleteAcc.id); setPendingDeleteAcc(null); }}
                        >
                            {t("common.delete")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
