"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  Loader2,
  XCircle,
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

interface Slot {
  start: string;
  end: string;
}
interface BookingInfo {
  link: { title: string; description: string | null };
  timezone: string;
  slots: Slot[];
}

export default function BookPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<Slot | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(token)}?days=14`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("This booking link is not available.");
        return;
      }
      const body = (await res.json()) as { data: BookingInfo };
      setInfo(body.data);
    } catch {
      setError("Could not load availability. Try again.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!token || !selected) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scheduled_at: selected,
          customer_name: name,
          customer_phone: phone,
          notes,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(b.error || "Booking failed");
        setSubmitting(false);
        return;
      }
      setBooked(info?.slots.find((s) => s.start === selected) ?? null);
      toast.success("Appointment booked!");
    } catch {
      toast.error("Could not reach the server");
      setSubmitting(false);
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
              <XCircle className="h-6 w-6 text-red-400" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Booking unavailable
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {error}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (booked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              You&apos;re booked!
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {fmt(booked.start)} – {fmt(booked.end)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-xs text-muted-foreground">
              We&apos;ll send a WhatsApp reminder before your appointment.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <CalendarDays className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            {info?.link.title ?? "Book an appointment"}
          </CardTitle>
          {info?.link.description && (
            <CardDescription className="text-muted-foreground">
              {info.link.description}
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="bk-name">Your name</Label>
                  <Input
                    id="bk-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <Label htmlFor="bk-phone">WhatsApp number</Label>
                  <Input
                    id="bk-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+14155550123"
                  />
                </div>
              </div>

              <div>
                <Label>Pick a time</Label>
                {info.slots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No open slots in the next 14 days.
                  </p>
                ) : (
                  <div className="mt-2 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto">
                    {info.slots.map((s) => (
                      <button
                        key={s.start}
                        onClick={() => setSelected(s.start)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm transition-colors " +
                          (selected === s.start
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-foreground hover:bg-muted")
                        }
                      >
                        {fmt(s.start)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="bk-notes">Notes (optional)</Label>
                <Textarea
                  id="bk-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>

              <Button
                onClick={submit}
                disabled={!selected || !phone || submitting}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Booking…
                  </>
                ) : (
                  "Confirm booking"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
