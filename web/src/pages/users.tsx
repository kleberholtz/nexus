import { useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2, Users as UsersIcon } from "lucide-react";
import { del, get } from "@/lib/api";
import { PanelUser, RoleInfo } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { UserFormDialog } from "@/components/user-form-dialog";

function roleVariant(role: string): "default" | "info" | "success" | "muted" {
  if (role === "master") return "default";
  if (role === "admin") return "info";
  if (role === "operator") return "success";
  return "muted";
}

export function UsersPage() {
  const { t } = useI18n();
  const { identity } = useAuth();
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PanelUser | "new" | null>(null);
  const [toDelete, setToDelete] = useState<PanelUser | null>(null);

  function load() {
    setLoading(true);
    get<PanelUser[]>("/users")
      .then(setUsers)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar usuários"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  useEffect(() => {
    get<{ roles: RoleInfo[] }>("/users/roles")
      .then((r) => setRoles(r.roles))
      .catch(() => {});
  }, []);

  const roleLabel = (name: string) => roles.find((r) => r.name === name)?.label ?? name;

  async function remove(u: PanelUser) {
    try {
      await del(`/users/${u.id}`);
      toast.success(t("users.removed"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <UsersIcon className="h-6 w-6 text-primary" /> {t("users.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
        </div>
      </div>

      <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={load}
                  disabled={loading}
                  aria-label="Recarregar"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Recarregar</TooltipContent>
            </Tooltip>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> {t("users.new")}
            </Button>
          </div>

          <Card>
            <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("users.user")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("users.email")}</TableHead>
                <TableHead className="w-40">{t("users.role")}</TableHead>
                <TableHead className="w-28">{t("users.status")}</TableHead>
                <TableHead className="w-44">{t("users.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && users.length === 0 ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : (
                users.map((u) => {
                  const isSelf = identity != null && u.username === identity.username && !u.master;
                  return (
                    <TableRow key={u.id ?? `master-${u.username}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name || u.username} seed={u.username} className="h-9 w-9 text-xs" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-medium">
                              <span className="truncate">{u.name || u.username}</span>
                              {u.master && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-muted-foreground">(.env)</span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("users.masterHint")}</TooltipContent>
                                </Tooltip>
                              )}
                              {isSelf && <span className="text-xs text-muted-foreground">(você)</span>}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">@{u.username}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {u.email || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={roleVariant(u.role)}>{roleLabel(u.role)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.active ? "success" : "muted"}>
                          {u.active ? t("users.active") : t("users.inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.editable ? (
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => setEditing(u)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t("users.tipEdit")}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={isSelf ? 0 : -1}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setToDelete(u)}
                                    disabled={isSelf}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isSelf ? t("users.cantDeleteSelf") : t("users.tipDelete")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("users.masterHint")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {editing && (
        <UserFormDialog
          user={editing === "new" ? null : editing}
          roles={roles}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("users.deleteTitle")}
        description={toDelete?.username ?? ""}
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </div>
    </TooltipProvider>
  );
}
