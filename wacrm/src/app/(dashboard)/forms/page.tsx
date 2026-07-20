"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Form, FormField, PortalLink } from "@/types";
import {
  FileText,
  Loader2,
  Plus,
  Trash2,
  Copy,
  Link2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const FIELD_TYPES: FormField["type"][] = [
  "text",
  "email",
  "tel",
  "textarea",
  "select",
  "number",
];

export default function FormsPage() {
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole !== "viewer";

  const [forms, setForms] = useState<Form[] | null>(null);
  const [portals, setPortals] = useState<PortalLink[]>([]);
  const [contacts, setContacts] = useState<{ id: string; name: string | null; phone: string }[]>([]);

  // Form builder state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [newField, setNewField] = useState<FormField>({
    name: "",
    label: "",
    type: "text",
    required: false,
  });

  // Portal state
  const [portalContact, setPortalContact] = useState("");

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [f, p, c] = await Promise.all([
      supabase
        .from("forms")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase
        .from("portal_links")
        .select("*, contact:contacts (id, name, phone)")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase
        .from("contacts")
        .select("id, name, phone")
        .eq("account_id", accountId)
        .limit(200),
    ]);
    setForms((f.data ?? []) as Form[]);
    setPortals((p.data ?? []) as unknown as PortalLink[]);
    setContacts((c.data ?? []) as { id: string; name: string | null; phone: string }[]);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  function addField() {
    if (!newField.name.trim() || !newField.label.trim()) {
      toast.error("Field name and label required");
      return;
    }
    setFields((prev) => [
      ...prev,
      { ...newField, name: newField.name.trim(), label: newField.label.trim() },
    ]);
    setNewField({ name: "", label: "", type: "text", required: false });
  }

  async function createForm() {
    if (!accountId || !title.trim()) {
      toast.error("Title required");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("forms").insert({
      account_id: accountId,
      token: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      title: title.trim(),
      description: description.trim() || null,
      fields,
      trigger_automations: true,
    });
    if (error) toast.error("Failed to create form");
    else {
      toast.success("Form created");
      setTitle("");
      setDescription("");
      setFields([]);
      load();
    }
  }

  async function copyForm(token: string) {
    await navigator.clipboard.writeText(
      `${window.location.origin}/forms/${token}`,
    );
    toast.success("Form link copied");
  }

  async function deleteForm(id: string) {
    if (!accountId) return;
    await createClient().from("forms").delete().eq("id", id).eq("account_id", accountId);
    load();
  }

  async function createPortal() {
    if (!accountId || !portalContact) {
      toast.error("Pick a contact");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("portal_links").insert({
      account_id: accountId,
      token: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      contact_id: portalContact,
      title: "My account",
    });
    if (error) toast.error("Failed to create portal");
    else {
      toast.success("Portal link created");
      setPortalContact("");
      load();
    }
  }

  async function copyPortal(token: string) {
    await navigator.clipboard.writeText(
      `${window.location.origin}/portal/${token}`,
    );
    toast.success("Portal link copied");
  }

  async function deletePortal(id: string) {
    if (!accountId) return;
    await createClient()
      .from("portal_links")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);
    load();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center gap-2">
        <FileText className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">Forms &amp; Portals</h1>
      </div>

      <Tabs defaultValue="forms">
        <TabsList className="mb-4">
          <TabsTrigger value="forms">Intake forms</TabsTrigger>
          <TabsTrigger value="portals">Customer portals</TabsTrigger>
        </TabsList>

        <TabsContent value="forms">
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-sm font-semibold">New form</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={1}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <Label>Field name</Label>
                <Input
                  value={newField.name}
                  onChange={(e) =>
                    setNewField((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="phone"
                />
              </div>
              <div>
                <Label>Label</Label>
                <Input
                  value={newField.label}
                  onChange={(e) =>
                    setNewField((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder="WhatsApp number"
                />
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={newField.type}
                  onValueChange={(v) =>
                    setNewField((f) => ({ ...f, type: v as FormField["type"] }))
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={newField.required}
                  onChange={(e) =>
                    setNewField((f) => ({ ...f, required: e.target.checked }))
                  }
                />
                Required
              </label>
              <Button variant="outline" size="sm" onClick={addField}>
                <Plus className="size-4" /> Add field
              </Button>
            </div>

            {fields.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {fields.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs"
                  >
                    {f.label}
                    {f.required && <span className="text-red-400">*</span>}
                    <button
                      onClick={() =>
                        setFields((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Remove field"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {canEdit && (
              <Button className="mt-3" size="sm" onClick={createForm}>
                Create form
              </Button>
            )}
          </Card>

          <div className="space-y-2">
            {forms === null ? (
              <div className="flex justify-center py-16 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : (
              forms.map((form) => (
                <Card key={form.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">{form.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {form.fields.length} field(s) · /forms/{form.token}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => copyForm(form.token)}
                    >
                      <Copy className="size-4" />
                    </Button>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-red-400 hover:text-red-300"
                        onClick={() => deleteForm(form.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="portals">
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-sm font-semibold">New portal link</h2>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1">
                <Label>Contact</Label>
                <Select
                  value={portalContact || undefined}
                  onValueChange={(v: string | null) => setPortalContact(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name || c.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canEdit && (
                <Button size="sm" onClick={createPortal}>
                  <Plus className="size-4" /> Create portal
                </Button>
              )}
            </div>
          </Card>

          <div className="space-y-2">
            {portals.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {(p as unknown as { contact?: { name: string | null; phone: string } })
                      .contact?.name ?? "Contact"}{" "}
                    · /portal/{p.token}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => copyPortal(p.token)}
                  >
                    <Link2 className="size-4" />
                  </Button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-red-400 hover:text-red-300"
                      onClick={() => deletePortal(p.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
            {portals.length === 0 && (
              <Card className="py-16 text-center text-sm text-muted-foreground">
                No portal links yet.
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
