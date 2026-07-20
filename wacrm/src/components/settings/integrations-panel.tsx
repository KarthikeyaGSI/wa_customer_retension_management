"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, PlugZap } from "lucide-react";
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

const MASKED = "••••••••••••••••";

export function IntegrationsPanel() {
  const { accountId, accountRole } = useAuth();
  const canEdit = canEditSettings(accountRole ?? "viewer");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackUrl, setSlackUrl] = useState("");
  const [hasSlack, setHasSlack] = useState(false);
  const [showSlack, setShowSlack] = useState(false);

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailKey, setEmailKey] = useState("");
  const [hasEmail, setHasEmail] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [emailFrom, setEmailFrom] = useState("");

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await fetch("/api/integrations/config", { cache: "no-store" });
      const body = (await res.json()) as {
        data?: {
          slack_enabled: boolean;
          has_slack_webhook: boolean;
          has_email: boolean;
          email_enabled: boolean;
          email_from: string | null;
        };
      };
      const d = body.data;
      if (d) {
        setSlackEnabled(d.slack_enabled);
        setHasSlack(d.has_slack_webhook);
        setEmailEnabled(d.email_enabled);
        setHasEmail(d.has_email);
        setEmailFrom(d.email_from ?? "");
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!accountId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slack_enabled: slackEnabled,
          slack_webhook_url: slackEnabled ? slackUrl || undefined : undefined,
          email_enabled: emailEnabled,
          email_api_key: emailEnabled ? emailKey || undefined : undefined,
          email_from: emailFrom || null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(b.error || "Failed to save");
        return;
      }
      toast.success("Integration settings saved");
      // Reset secret inputs; a non-empty hidden value now exists server-side.
      setSlackUrl("");
      setEmailKey("");
      setHasSlack(slackEnabled ? true : false);
      setHasEmail(emailEnabled ? true : false);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PlugZap className="size-5 text-primary" /> Slack
          </CardTitle>
          <CardDescription>
            Post a message to a Slack channel when key events happen (new lead,
            appointment booked, etc.).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="slack-toggle">Enable Slack notifications</Label>
            <Switch
              id="slack-toggle"
              checked={slackEnabled}
              disabled={!canEdit}
              onCheckedChange={setSlackEnabled}
            />
          </div>
          {slackEnabled && (
            <div>
              <Label htmlFor="slack-url">Incoming webhook URL</Label>
              <div className="relative">
                <Input
                  id="slack-url"
                  type={showSlack ? "text" : "password"}
                  value={slackUrl || (hasSlack ? MASKED : "")}
                  placeholder="https://hooks.slack.com/services/…"
                  disabled={!canEdit}
                  onChange={(e) => setSlackUrl(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowSlack((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Toggle visibility"
                >
                  {showSlack ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {hasSlack && !slackUrl && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Saved webhook is configured. Enter a new URL to replace it.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Email (Resend)</CardTitle>
          <CardDescription>
            Send transactional email notifications via the Resend API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="email-toggle">Enable email notifications</Label>
            <Switch
              id="email-toggle"
              checked={emailEnabled}
              disabled={!canEdit}
              onCheckedChange={setEmailEnabled}
            />
          </div>
          {emailEnabled && (
            <>
              <div>
                <Label htmlFor="email-from">From address</Label>
                <Input
                  id="email-from"
                  value={emailFrom}
                  placeholder="CRM <you@yourdomain.com>"
                  disabled={!canEdit}
                  onChange={(e) => setEmailFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="email-key">Resend API key</Label>
                <div className="relative">
                  <Input
                    id="email-key"
                    type={showEmail ? "text" : "password"}
                    value={emailKey || (hasEmail ? MASKED : "")}
                    placeholder="re_…"
                    disabled={!canEdit}
                    onChange={(e) => setEmailKey(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmail((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label="Toggle visibility"
                  >
                    {showEmail ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {hasEmail && !emailKey && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Saved API key is configured. Enter a new key to replace it.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save integrations
          </Button>
        </div>
      )}
    </div>
  );
}
