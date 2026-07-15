import { useEffect, useState } from "react";
import { Loader2, UserCircle } from "lucide-react";
import { get, put } from "@/lib/api";
import { Profile } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";

export function ProfilePage() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<Profile>("/users/profile")
      .then((p) => {
        setProfile(p);
        setName(p.name);
        setEmail(p.email);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar perfil"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (name.trim().length < 2) return toast.error(t("profile.nameRequired"));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return toast.error(t("profile.emailInvalid"));
    if (next || current || confirm) {
      if (next.length < 8) return toast.error(t("profile.passwordShort"));
      if (next !== confirm) return toast.error(t("profile.passwordMismatch"));
      if (!current) return toast.error(t("profile.currentRequired"));
    }
    setSaving(true);
    try {
      await put("/users/profile", {
        name: name.trim(),
        email: email.trim(),
        ...(next ? { current_password: current, new_password: next } : {}),
      });
      toast.success(t("profile.saved"));
      setCurrent("");
      setNext("");
      setConfirm("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <UserCircle className="h-6 w-6 text-primary" /> {t("profile.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("profile.subtitle")}</p>
      </div>

      {loading || !profile ? (
        <Card className="p-6"><Skeleton className="h-40 w-full" /></Card>
      ) : (
        <>
          <Card className="flex items-center gap-4 p-6">
            <Avatar name={profile.name || profile.username} seed={profile.username} className="h-16 w-16 text-xl" />
            <div>
              <div className="text-lg font-semibold">{profile.name || profile.username}</div>
              <div className="text-sm text-muted-foreground">@{profile.username}</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">{profile.role}</Badge>
                {profile.is_master && <Badge variant="muted">.env</Badge>}
              </div>
            </div>
          </Card>

          {profile.is_master ? (
            <Card className="p-6 text-sm text-muted-foreground">{t("profile.masterHint")}</Card>
          ) : (
            <>
              <Card className="space-y-4 p-6">
                <h2 className="font-medium">{t("profile.info")}</h2>
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">{t("profile.name")} *</Label>
                  <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-email">{t("profile.email")} *</Label>
                  <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </Card>

              <Card className="space-y-4 p-6">
                <div>
                  <h2 className="font-medium">{t("profile.changePassword")}</h2>
                  <p className="text-xs text-muted-foreground">{t("profile.changePasswordHint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-cur">{t("profile.current")}</Label>
                  <Input id="p-cur" type="password" value={current} autoComplete="current-password"
                    onChange={(e) => setCurrent(e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="p-new">{t("profile.new")}</Label>
                    <Input id="p-new" type="password" value={next} autoComplete="new-password"
                      onChange={(e) => setNext(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-conf">{t("profile.confirm")}</Label>
                    <Input id="p-conf" type="password" value={confirm} autoComplete="new-password"
                      onChange={(e) => setConfirm(e.target.value)} />
                  </div>
                </div>
              </Card>

              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t("profile.save")}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
