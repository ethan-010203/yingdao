import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n";
import { FolderSync, Users } from "lucide-react";
import ShinyText from "@/components/ui/ShinyText";

interface HomePageProps {
    accountsCount: number;
    onNavigate: (page: "home" | "migrate" | "accounts" | "local" | "cloud" | "settings") => void;
}

export function HomePage({ accountsCount, onNavigate }: HomePageProps) {
    const { t } = useTranslation();

    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-10">
                <h1 className="text-3xl font-bold">
                    <ShinyText text={t("home.welcome")} speed={3} color="#4f46e5" shineColor="#93c5fd" />
                </h1>
                <p className="text-muted-foreground/70 mt-2">{t("home.subtitle")}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card
                    variant="default"
                    className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
                    onClick={() => onNavigate("migrate")}
                >
                    <CardHeader className="p-7">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
                            <FolderSync className="h-7 w-7 text-primary" />
                        </div>
                        <CardTitle className="text-lg">{t("home.migrate.title")}</CardTitle>
                        <CardDescription>{t("home.migrate.desc")}</CardDescription>
                    </CardHeader>
                </Card>

                <Card
                    variant="default"
                    className="group cursor-pointer hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/[0.06] dark:hover:shadow-black/[0.3] transition-all duration-250"
                    onClick={() => onNavigate("accounts")}
                >
                    <CardHeader className="p-7">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-250">
                            <Users className="h-7 w-7 text-primary" />
                        </div>
                        <CardTitle className="text-lg">{t("accounts.title")}</CardTitle>
                        <CardDescription>
                            {t("home.accounts.desc")} ({accountsCount})
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        </div>
    );
}
