"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Provider {
  id: string;
  name: string;
  idp_type: "oidc" | "saml";
  active: boolean;
  issuer: string | null;
  client_id: string | null;
  redirect_uri: string | null;
  scopes: string;
  created_at: string;
}

export function SsoPanel() {
  const { accountId, accountRole } = useAuth();
  const canEdit = canEditSettings(accountRole ?? "viewer");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [scopes, setScopes] = useState("openid email profile");
  const [active, setActive] = useState(true);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sso/providers", { cache: "no-store" });
      const body = await res.json();
      setProviders(body.providers ?? []);
    } catch {
      toast.error("Failed to load SSO providers");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setIssuer("");
    setClientId("");
    setClientSecret("");
    setRedirectUri("");
    setScopes("openid email profile");
    setActive(true);
  }

  function startEdit(p: Provider) {
    setEditingId(p.id);
    setName(p.name);
    setIssuer(p.issuer ?? "");
    setClientId(p.client_id ?? "");
    setClientSecret("");
    setRedirectUri(p.redirect_uri ?? "");
    setScopes(p.scopes || "openid email profile");
    setActive(p.active);
  }

  async function save() {
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (!issuer || !clientId) {
      toast.error("Issuer and Client ID are required for OIDC");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        idp_type: "oidc",
        issuer,
        client_id: clientId,
        redirect_uri: redirectUri || `${origin}/api/sso/${editingId ?? "new"}/callback`,
        scopes,
        active,
      };
      if (clientSecret) payload.client_secret = clientSecret;

      const res = editingId
        ? await fetch(`/api/sso/providers/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/sso/providers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Save failed");
      }
      toast.success(editingId ? "SSO provider updated" : "SSO provider added");
      resetForm();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this SSO provider?")) return;
    try {
      const res = await fetch(`/api/sso/providers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("SSO provider deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Single sign-on (OIDC)
          </CardTitle>
          <CardDescription>
            Let your team log in through your identity provider (Keycloak,
            Authelia, Google Workspace, Azure AD, Okta, …). Users are matched
            by email; new users are created automatically in your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
            </div>
          ) : providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No SSO providers configured yet.
            </p>
          ) : (
            <ul className="divide-y">
              {providers.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          p.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {p.active ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.issuer}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.active && (
                      <a
                        href={`/api/sso/${p.id}/login`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Test login
                      </a>
                    )}
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(p)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() => remove(p.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingId ? "Edit OIDC provider" : "Add OIDC provider"}
            </CardTitle>
            <CardDescription>
              Use the Authorization Code flow with PKCE. Your redirect URI is
              auto-filled; register it in your IdP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="sso-name">Display name</Label>
              <Input
                id="sso-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Company SSO"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sso-issuer">Issuer URL</Label>
              <Input
                id="sso-issuer"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="https://login.company.com/realms/wacrm"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="sso-client">Client ID</Label>
                <Input
                  id="sso-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="wacrm-web"
                />
              </div>
              <div>
                <Label htmlFor="sso-secret">
                  Client secret{" "}
                  {editingId && (
                    <span className="text-xs text-muted-foreground">
                      (leave blank to keep)
                    </span>
                  )}
                </Label>
                <Input
                  id="sso-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sso-redirect">Redirect URI</Label>
              <Input
                id="sso-redirect"
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                placeholder={`${origin}/api/sso/<id>/callback`}
              />
              <p className="text-xs text-muted-foreground">
                Must be registered as a valid redirect URI in your IdP. Leave
                blank to use the auto value shown on save.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sso-scopes">Scopes</Label>
              <Input
                id="sso-scopes"
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={active}
                onCheckedChange={(v) => setActive(Boolean(v))}
              />
              <span className="text-sm">Enabled</span>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingId ? "Save changes" : "Add provider"}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
