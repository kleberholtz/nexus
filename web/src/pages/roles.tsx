import { ShieldCheck } from "lucide-react";
import { RolesManager } from "@/components/roles-manager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

export function RolesPage() {
  const { t } = useI18n();

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="h-6 w-6 text-primary" /> {t("users.rolesTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("users.rolesSubtitle")}</p>
        </div>

        <RolesManager />
      </div>
    </TooltipProvider>
  );
}
