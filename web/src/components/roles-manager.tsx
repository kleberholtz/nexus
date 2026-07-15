import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { PermissionCatalogItem, RoleInfo, RolesResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Draft = { label: string; perms: string[] };

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function RolesManager() {
  const { t } = useI18n();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<RoleInfo | null>(null);

  const allPerms = useMemo(
    () => catalog.flatMap((c) => [c.read, c.write]),
    [catalog],
  );

  function load() {
    setLoading(true);
    get<RolesResponse>("/users/roles")
      .then((r) => {
        setRoles(r.roles);
        setCatalog(r.permissions);
        setDrafts(
          Object.fromEntries(
            r.roles.map((ro) => [ro.name, { label: ro.label, perms: [...ro.permissions] }]),
          ),
        );
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar papéis"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function draftOf(role: RoleInfo): Draft {
    return drafts[role.name] ?? { label: role.label, perms: [...role.permissions] };
  }
  function isWildcard(perms: string[]): boolean {
    return perms.includes("*");
  }
  function setDraft(name: string, next: Draft) {
    setDrafts((d) => ({ ...d, [name]: next }));
  }

  function togglePerm(role: RoleInfo, perm: string, on: boolean) {
    const d = draftOf(role);
    // Ao editar a partir de "*", expande para permissões explícitas primeiro.
    const base = isWildcard(d.perms) ? [...allPerms] : [...d.perms];
    const next = on ? [...new Set([...base, perm])] : base.filter((p) => p !== perm);
    setDraft(role.name, { ...d, perms: next });
  }
  function toggleWildcard(role: RoleInfo, on: boolean) {
    const d = draftOf(role);
    setDraft(role.name, { ...d, perms: on ? ["*"] : [...allPerms] });
  }
  function setLabel(role: RoleInfo, label: string) {
    setDraft(role.name, { ...draftOf(role), label });
  }

  function dirty(role: RoleInfo): boolean {
    const d = draftOf(role);
    return d.label !== role.label || !sameSet(d.perms, role.permissions);
  }

  async function save(role: RoleInfo) {
    const d = draftOf(role);
    setSaving(role.name);
    try {
      await put(`/users/roles/${encodeURIComponent(role.name)}`, {
        label: d.label,
        permissions: d.perms,
      });
      toast.success(t("users.roleSaved"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(null);
    }
  }

  async function remove(role: RoleInfo) {
    try {
      await del(`/users/roles/${encodeURIComponent(role.name)}`);
      toast.success(t("users.roleRemoved"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  if (loading && roles.length === 0) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("users.rolesHint")}</p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> {t("users.newRole")}
        </Button>
      </div>

      {roles.map((role) => {
        const d = draftOf(role);
        const wildcard = isWildcard(d.perms);
        const editable = role.editable && role.name !== "master";
        return (
          <Card key={role.name} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                {editable ? (
                  <Input
                    value={d.label}
                    onChange={(e) => setLabel(role, e.target.value)}
                    className="h-8 w-48"
                  />
                ) : (
                  <span className="font-medium">{role.label}</span>
                )}
                <Badge variant="secondary" className="font-mono">{role.name}</Badge>
                {role.builtin && <Badge variant="muted">{t("users.builtin")}</Badge>}
                {role.in_use > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {role.in_use} {t("users.inUse")}
                  </span>
                )}
              </div>
              {editable && (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => save(role)} disabled={!dirty(role) || saving === role.name}>
                    {saving === role.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t("users.save")}
                  </Button>
                  {!role.builtin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={role.in_use > 0 ? 0 : -1}>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setToDelete(role)}
                            disabled={role.in_use > 0}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {role.in_use > 0 ? t("users.roleInUse") : t("users.tipDelete")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            {!editable ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("users.masterAllPerms")}</p>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={wildcard}
                    onCheckedChange={(v) => toggleWildcard(role, v === true)}
                  />
                  <span className="font-medium">{t("users.fullAccess")}</span>
                  <span className="text-muted-foreground">(*)</span>
                </label>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pb-2 font-medium">{t("users.resource")}</th>
                        <th className="pb-2 w-24 text-center font-medium">{t("users.read")}</th>
                        <th className="pb-2 w-24 text-center font-medium">{t("users.write")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catalog.map((c) => (
                        <tr key={c.resource} className="border-t border-border/50">
                          <td className="py-1.5">{c.label}</td>
                          <td className="py-1.5 text-center">
                            <Checkbox
                              checked={wildcard || d.perms.includes(c.read)}
                              disabled={wildcard}
                              onCheckedChange={(v) => togglePerm(role, c.read, v === true)}
                            />
                          </td>
                          <td className="py-1.5 text-center">
                            <Checkbox
                              checked={wildcard || d.perms.includes(c.write)}
                              disabled={wildcard}
                              onCheckedChange={(v) => togglePerm(role, c.write, v === true)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {creating && (
        <CreateRoleDialog
          onOpenChange={(o) => !o && setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("users.deleteRoleTitle")}
        description={toDelete ? `${toDelete.label} (${toDelete.name})` : ""}
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </div>
  );
}

function CreateRoleDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(name.trim()))
      return toast.error(t("users.roleNameInvalid"));
    setBusy(true);
    try {
      await post("/users/roles", { name: name.trim(), label: label.trim(), permissions: [] });
      toast.success(t("users.roleCreated"));
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar papel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.newRole")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">{t("users.roleName")}</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="netops"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t("users.roleNameHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-label">{t("users.roleLabel")}</Label>
            <Input
              id="role-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Equipe de rede"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("users.roleCreateHint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={create} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("users.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
