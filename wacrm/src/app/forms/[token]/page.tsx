"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  CheckCircle2,
  XCircle,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormField } from "@/types";

interface FormInfo {
  title: string;
  description: string | null;
  fields: FormField[];
}

export default function FormPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [info, setInfo] = useState<FormInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/forms/public/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("This form is not available.");
        return;
      }
      const body = (await res.json()) as { data: FormInfo };
      setInfo(body.data);
    } catch {
      setError("Could not load the form. Try again.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!token || !info) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/forms/public/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(b.error || "Submission failed");
        setSubmitting(false);
        return;
      }
      setDone(true);
      toast.success("Thanks — we received your submission!");
    } catch {
      toast.error("Could not reach the server");
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
              <XCircle className="h-6 w-6 text-red-400" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Form unavailable
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {error}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Submission received
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              We&apos;ll be in touch via WhatsApp shortly.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            {info?.title ?? "Loading…"}
          </CardTitle>
          {info?.description && (
            <CardDescription className="text-muted-foreground">
              {info.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!info ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <>
              {info.fields.map((field) => (
                <div key={field.name}>
                  <Label htmlFor={`f-${field.name}`}>
                    {field.label}
                    {field.required && <span className="text-red-400"> *</span>}
                  </Label>
                  {field.type === "textarea" ? (
                    <Textarea
                      id={`f-${field.name}`}
                      value={values[field.name] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.name]: e.target.value }))
                      }
                      rows={3}
                    />
                  ) : field.type === "select" ? (
                    <Select
                      value={values[field.name] ?? ""}
                      onValueChange={(val: string | null) =>
                        setValues((v) => ({ ...v, [field.name]: val ?? "" }))
                      }
                    >
                      <SelectTrigger id={`f-${field.name}`}>
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`f-${field.name}`}
                      type={
                        field.type === "email"
                          ? "email"
                          : field.type === "tel"
                            ? "tel"
                            : field.type === "number"
                              ? "number"
                              : "text"
                      }
                      value={values[field.name] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.name]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
              {info.fields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This form has no fields configured.
                </p>
              )}
              <Button
                onClick={submit}
                disabled={submitting || info.fields.length === 0}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Submit
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
