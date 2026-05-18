import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, Check, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import Stepper, { Step } from "@/components/ui/Stepper";

import { AccountSelector } from "@/components/migration/AccountSelector";
import { LoadingOverlay } from "@/components/migration/LoadingOverlay";
import { PaginationControl } from "@/components/migration/PaginationControl";
import { ResultStep } from "@/components/migration/ResultStep";

import { useAutoPageSize } from "@/hooks/useAutoPageSize";
import { useMigrateProgressListener } from "@/hooks/useMigrateProgressListener";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { Account } from "@/contexts/ConfigContext";
import type { LocalFlow, MigrateResult } from "@/types";

type LocalStep = "list" | "target" | "migrating" | "result";

interface LocalMigrationPageProps {
    accounts: Account[];
    migrateSuffix: string;
    onBackHome: () => void;
    isAdmin?: boolean;
}

export function LocalMigrationPage({
    accounts,
    migrateSuffix,
    onBackHome,
    isAdmin = true,
}: LocalMigrationPageProps) {
    const { t } = useTranslation();

    const [step, setStep] = useState<LocalStep>("list");
    const [flows, setFlows] = useState<LocalFlow[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    const [targetAccountId, setTargetAccountId] = useState("");
    const [targetManualUser, setTargetManualUser] = useState("");
    const [targetManualPwd, setTargetManualPwd] = useState("");

    const [loading, setLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("");
    const [results, setResults] = useState<MigrateResult[]>([]);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    const listRef = useRef<HTMLDivElement>(null);
    const pageSize = useAutoPageSize(listRef, 48);
    const subscribeProgress = useMigrateProgressListener(setLoadingText);

    useEffect(() => {
        refreshFlows();
        // 仅挂载时扫描一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshFlows = async () => {
        setLoading(true);
        setLoadingText(t("migrate.local.scanning"));
        try {
            const result: LocalFlow[] = await invoke("get_local_flows");
            setFlows(result);
        } catch (e) {
            toast.error(`${t("common.error")}: ${e}`);
        }
        setLoading(false);
        setLoadingText("");
    };

    const filteredFlows = useMemo(() => {
        if (!search.trim()) return flows;
        const q = search.toLowerCase();
        return flows.filter(f => f.name.toLowerCase().includes(q));
    }, [flows, search]);

    const totalPages = Math.ceil(filteredFlows.length / pageSize);
    const paginatedFlows = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredFlows.slice(start, start + pageSize);
    }, [filteredFlows, currentPage, pageSize]);

    const nextToTarget = () => {
        if (selectedIds.size === 0) {
            toast.error(t("migrate.no_selection"));
            return;
        }
        setStep("target");
        setTargetAccountId("");
        setTargetManualUser("");
        setTargetManualPwd("");
    };

    const getTargetCredentials = () => {
        if (targetAccountId === "manual") {
            return {
                username: targetManualUser,
                password: targetManualPwd,
                name: targetManualUser,
            };
        }
        const acc = accounts.find(a => a.id === targetAccountId);
        return acc ? { username: acc.username, password: acc.password, name: acc.username } : null;
    };

    const doMigrate = async () => {
        const creds = getTargetCredentials();
        if (!creds || !creds.username || !creds.password) {
            toast.error(t("migrate.select_account"));
            return;
        }

        setStep("migrating");
        setLoadingText(t("migrate.logging_in_target"));

        const unlistenProgress = await subscribeProgress();

        try {
            const token: string = await invoke("login_account", {
                username: creds.username,
                password: creds.password,
            });

            const selectedFlows = flows.filter(f => selectedIds.has(f.uuid));
            setLoadingText(
                t("migrate.migrating_flows").replace("{count}", String(selectedFlows.length))
            );

            const migrationResults: MigrateResult[] = await invoke("migrate_flows", {
                request: {
                    flow_type: "local",
                    flows: selectedFlows,
                    target_token: token,
                    suffix_template: migrateSuffix,
                },
            });

            setResults(migrationResults);
            setStep("result");
        } catch (e) {
            toast.error(`${t("common.error")}: ${e}`);
            setStep("target");
        } finally {
            unlistenProgress();
        }
        setLoadingText("");
    };

    const executeDelete = async () => {
        setDeleteConfirmOpen(false);
        const selectedFlows = flows.filter(f => selectedIds.has(f.uuid));
        setLoading(true);
        setLoadingText(t("common.loading"));
        try {
            await invoke("delete_local_flows", { request: { flows: selectedFlows } });
            await refreshFlows();
            setSelectedIds(new Set());
            toast.success(t("common.success"));
        } catch (e) {
            toast.error(`${t("common.error")}: ${e}`);
        }
        setLoading(false);
        setLoadingText("");
    };

    const stepNumber = ((): number => {
        switch (step) {
            case "list": return 1;
            case "target": return 2;
            case "result":
            case "migrating": return 3;
        }
    })();

    return (
        <div className="h-full flex flex-col max-w-4xl mx-auto">
            {(loading || step === "migrating") && <LoadingOverlay text={loadingText} />}

            <div className="shrink-0 flex items-center gap-3 mb-2">
                <Button variant="ghost" size="sm" onClick={onBackHome} className="-ml-2 text-muted-foreground/70">
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    {t("common.back")}
                </Button>
                <div className="h-5 w-px bg-border/40" />
                <h1 className="text-xl font-bold text-gradient">{t("migrate.local")}</h1>
            </div>

            <div className="flex-1 min-h-0">
                <Stepper
                    currentStep={stepNumber}
                    steps={[t("migrate.step.list"), t("migrate.step.target"), t("migrate.step.result")]}
                    disableStepIndicators
                    showFooter={false}
                    stepCircleContainerClassName="border-0 shadow-none bg-transparent"
                    stepContainerClassName="px-0 pb-2"
                >
                    {/* Step 1: 选择流程 */}
                    <Step>
                        <Card className="h-full flex flex-col">
                            <CardContent className="p-4 flex flex-col flex-1 min-h-0 gap-3">
                                <div className="shrink-0 flex items-center gap-4">
                                    <h3 className="text-lg font-semibold">{t("migrate.step.list")}</h3>
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                                        <Input
                                            placeholder={t("common.search")}
                                            value={search}
                                            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                                            className="pl-10 h-9 text-sm"
                                        />
                                    </div>
                                    <span className="text-xs text-muted-foreground/60 whitespace-nowrap">
                                        {t("accounts.flow.selected").replace("{count}", String(selectedIds.size))} / {filteredFlows.length}
                                    </span>
                                </div>
                                <div ref={listRef} className="flex-1 min-h-0 rounded-xl border border-border/30 overflow-hidden bg-muted/5">
                                    {paginatedFlows.length === 0 ? (
                                        <div className="p-8 text-center text-muted-foreground/70">
                                            {search ? t("migrate.search.empty") : t("migrate.empty")}
                                        </div>
                                    ) : (
                                        paginatedFlows.map(flow => (
                                            <div
                                                key={flow.uuid}
                                                onClick={() => {
                                                    const next = new Set(selectedIds);
                                                    if (next.has(flow.uuid)) next.delete(flow.uuid);
                                                    else next.add(flow.uuid);
                                                    setSelectedIds(next);
                                                }}
                                                className={cn(
                                                    "flex items-center gap-3 p-3 border-b border-border/20 last:border-0 cursor-pointer transition-all duration-200",
                                                    selectedIds.has(flow.uuid) ? "bg-primary/6" : "hover:bg-muted/40"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                                                    selectedIds.has(flow.uuid) ? "bg-primary border-primary" : "border-muted-foreground/30"
                                                )}>
                                                    {selectedIds.has(flow.uuid) && <Check className="h-3 w-3 text-primary-foreground" />}
                                                </div>
                                                <span className="flex-1 font-medium truncate">{flow.name}</span>
                                                <span className="text-sm text-muted-foreground/50">{flow.update_time}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="shrink-0 flex items-center justify-between pt-2 border-t border-border/20">
                                    <div className="flex gap-2 items-center">
                                        <Button variant="outline" size="sm" onClick={() => {
                                            if (selectedIds.size > 0) {
                                                setSelectedIds(new Set());
                                            } else {
                                                setSelectedIds(new Set(filteredFlows.map(f => f.uuid)));
                                            }
                                        }}>
                                            {selectedIds.size > 0 ? t("common.deselect_all") : t("common.select_all")}
                                        </Button>
                                        {isAdmin && (
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => selectedIds.size > 0 && setDeleteConfirmOpen(true)}
                                                disabled={selectedIds.size === 0}
                                            >
                                                <Trash2 className="h-4 w-4 mr-1" />
                                                {t("common.delete")}
                                            </Button>
                                        )}
                                        <PaginationControl
                                            currentPage={currentPage}
                                            totalPages={totalPages}
                                            onPageChange={setCurrentPage}
                                        />
                                    </div>
                                    <Button onClick={nextToTarget} disabled={selectedIds.size === 0}>
                                        {t("common.confirm")}
                                        <ArrowRight className="h-4 w-4 ml-2" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </Step>

                    {/* Step 2: 目标账号 */}
                    <Step>
                        <Card>
                            <CardContent className="p-4 space-y-4">
                                <AccountSelector
                                    accounts={accounts}
                                    selectedId={targetAccountId}
                                    onSelectedIdChange={setTargetAccountId}
                                    manualUser={targetManualUser}
                                    onManualUserChange={setTargetManualUser}
                                    manualPwd={targetManualPwd}
                                    onManualPwdChange={setTargetManualPwd}
                                    title={t("migrate.target.select")}
                                />
                                <div className="p-3 rounded-xl bg-primary/6 text-center">
                                    <span className="text-primary text-sm font-medium">
                                        {t("accounts.flow.selected").replace("{count}", String(selectedIds.size))}
                                    </span>
                                </div>
                                <div className="flex justify-between pt-3 border-t border-border/20">
                                    <Button variant="outline" size="sm" onClick={() => setStep("list")}>
                                        <ArrowLeft className="h-4 w-4 mr-2" />
                                        {t("common.prev_step")}
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={doMigrate}
                                        disabled={
                                            !targetAccountId ||
                                            (targetAccountId === "manual" && (!targetManualUser || !targetManualPwd))
                                        }
                                    >
                                        {t("migrate.start")}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </Step>

                    {/* Step 3: 结果 */}
                    <Step>
                        <ResultStep results={results} onBackHome={onBackHome} />
                    </Step>
                </Stepper>
            </div>

            {/* 删除确认弹窗 */}
            {deleteConfirmOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirmOpen(false)}>
                    <div className="bg-background rounded-2xl shadow-xl border border-border/40 p-6 max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold">
                            {t("accounts.delete.flows.confirm").replace("{count}", String(selectedIds.size))}
                        </h3>
                        <p className="text-sm text-muted-foreground">{t("accounts.delete.flows.desc")}</p>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button variant="destructive" onClick={executeDelete}>
                                {t("common.delete")}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
