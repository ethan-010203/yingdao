import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { ArrowLeft, HardDrive, CloudDownload } from "lucide-react";

interface MigratePageProps {
    onNavigate: (page: "home" | "migrate" | "accounts" | "local" | "cloud" | "settings") => void;
    onStartLocal: () => void;
    onStartCloud: () => void;
}

export function MigratePage({ onNavigate, onStartLocal, onStartCloud }: MigratePageProps) {
    const { t } = useTranslation();

    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-10">
                <Button variant="ghost" onClick={() => onNavigate("home")} className="mb-4 -ml-3 text-muted-foreground/70">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t("common.back")}
                </Button>
                <h1 className="text-3xl font-bold text-gradient">{t("migrate.title")}</h1>
                <p className="text-muted-foreground/70 mt-1">{t("migrate.subtitle")}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card
                    className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
                    onClick={onStartLocal}
                >
                    <CardHeader className="p-7">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
                            <HardDrive className="h-7 w-7 text-primary" />
                        </div>
                        <CardTitle className="text-lg">{t("migrate.local")}</CardTitle>
                        <CardDescription>{t("migrate.local.desc")}</CardDescription>
                    </CardHeader>
                </Card>

                <Card
                    className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
                    onClick={onStartCloud}
                >
                    <CardHeader className="p-7">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
                            <CloudDownload className="h-7 w-7 text-primary" />
                        </div>
                        <CardTitle className="text-lg">{t("migrate.cloud")}</CardTitle>
                        <CardDescription>{t("migrate.cloud.desc")}</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        </div>
    );
}
