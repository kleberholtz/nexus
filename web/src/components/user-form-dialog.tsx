import { useState } from "react";
import { Loader2 } from "lucide-react";
import { post, put } from "@/lib/api";
import { PanelUser, RoleInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function UserFormDialog({
  user,
  roles,
  onOpenChange,
  onSaved,
}: {
  user: PanelUser | null; // null = criar
  roles: RoleInfo[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const isEdit = !!user;
  const assignable = roles.filter((r) => r.assignable);
  const [username, setUsername] = useState(user?.username ?? "");
  const [fullName, setFullName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role ?? assignable[0]?.name ?? "viewer");
  const [active, setActive] = useState(user?.active ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!isEdit && username.trim().length < 3)
      return toast.error("Usuário deve ter ao menos 3 caracteres");
    if (fullName.trim().length < 2) return toast.error(t("users.nameRequired"));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return toast.error(t("users.emailInvalid"));
    if (!isEdit && password.length < 8) return toast.error("Senha deve ter ao menos 8 caracteres");
    if (isEdit && password && password.length < 8)
      return toast.error("Senha deve ter ao menos 8 caracteres");
    setBusy(true);
    try {
      if (isEdit) {
        await put(`/users/${user!.id}`, {
          role,
          active,
          name: fullName.trim(),
          email: email.trim(),
          ...(password ? { password } : {}),
        });
        toast.success(t("users.updated"));
      } else {
        await post("/users", {
          username: username.trim(),
          password,
          role,
          name: fullName.trim(),
          email: email.trim(),
        });
        toast.success(t("users.created"));
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("users.edit") : t("users.new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">{t("users.username")}</Label>
            <Input
              id="u-name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isEdit}
              placeholder="joao"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-fullname">{t("users.name")} *</Label>
            <Input
              id="u-fullname"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="João Silva"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">{t("users.email")} *</Label>
            <Input
              id="u-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="joao@exemplo.com"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-pass">{isEdit ? t("users.passwordKeep") : t("users.password")}</Label>
            <Input
              id="u-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "••••••••" : ""}
              autoComplete="new-password"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("users.role")}</Label>
              <Select value={role} onChange={(e) => setRole(e.target.value)}>
                {assignable.map((r) => (
                  <option key={r.name} value={r.name}>{r.label}</option>
                ))}
              </Select>
            </div>
            {isEdit && (
              <div className="space-y-1.5">
                <Label>{t("users.status")}</Label>
                <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
                  <option value="1">{t("users.active")}</option>
                  <option value="0">{t("users.inactive")}</option>
                </Select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? t("users.save") : t("users.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
