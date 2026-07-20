"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Appointment,
  AppointmentAvailability,
  BookingLink,
} from "@/types";
import {
  CalendarDays,
  Loader2,
  Plus,
  Trash2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_LABEL: Record<Appointment["status"], string> = {
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

function toMin(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
function fromMin(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function AppointmentsPage() {
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole !== "viewer";

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [availability, setAvailability] = useState<AppointmentAvailability[]>([]);
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [avDay, setAvDay] = useState(1);
  const [avStart, setAvStart] = useState("09:00");
  const [avEnd, setAvEnd] = useState("17:00");
  const [avSlot, setAvSlot] = useState(30);
  const [avTz, setAvTz] = useState("UTC");

  const [linkTitle, setLinkTitle] = useState("");
  const [linkDesc, setLinkDesc] = useState("");

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [a, av, l] = await Promise.all([
      supabase
        .from("appointments")
        .select("*, contact:contacts (id, name, phone)")
        .eq("account_id", accountId)
        .order("scheduled_at", { ascending: true })
        .limit(200),
      supabase
        .from("appointment_availability")
        .select("*")
        .eq("account_id", accountId)
        .order("day_of_week", { ascending: true }),
      supabase
        .from("booking_links")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
    ]);
    setAppointments((a.data ?? []) as Appointment[]);
    setAvailability((av.data ?? []) as AppointmentAvailability[]);
    setLinks((l.data ?? []) as BookingLink[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function saveAvailability() {
    if (!accountId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("appointment_availability")
      .upsert(
        {
          account_id: accountId,
          day_of_week: avDay,
          start_minutes: toMin(avStart),
          end_minutes: toMin(avEnd),
          slot_minutes: avSlot,
          timezone: avTz,
        },
        { onConflict: "account_id,day_of_week" },
      );
    if (error) toast.error("Failed to save availability");
    else {
      toast.success("Availability saved");
      load();
    }
  }

  async function deleteAvailability(id: string) {
    if (!accountId) return;
    const supabase = createClient();
    await supabase
      .from("appointment_availability")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);
    load();
  }

  async function createLink() {
    if (!accountId || !linkTitle.trim()) {
      toast.error("Title required");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("booking_links")
      .insert({
        account_id: accountId,
        token: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        title: linkTitle.trim(),
        description: linkDesc.trim() || null,
      });
    if (error) toast.error("Failed to create link");
    else {
      toast.success("Booking link created");
      setLinkTitle("");
      setLinkDesc("");
      load();
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/book/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  async function cancelAppointment(id: string) {
    if (!accountId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("appointments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", accountId);
    if (error) toast.error("Failed to cancel");
    else {
      toast.success("Appointment cancelled");
      load();
    }
  }

  const avByDay = new Map(availability.map((a) => [a.day_of_week, a]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center gap-2">
        <CalendarDays className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">Appointments</h1>
      </div>

      <Tabs defaultValue="appointments">
        <TabsList className="mb-4">
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="links">Booking links</TabsTrigger>
        </TabsList>

        <TabsContent value="appointments">
          {loading ? (
            <div className="flex justify-center py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {(appointments ?? []).map((appt) => (
                <li key={appt.id}>
                  <Card className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {new Date(appt.scheduled_at).toLocaleString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            appt.status === "confirmed" &&
                              "border-primary/40 bg-primary/10 text-primary",
                            appt.status === "cancelled" &&
                              "border-red-500/40 bg-red-500/10 text-red-300",
                            appt.status === "completed" &&
                              "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {STATUS_LABEL[appt.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {appt.customer_name || "Unknown"}
                        {appt.customer_phone ? ` · ${appt.customer_phone}` : ""}
                        {appt.duration_minutes
                          ? ` · ${appt.duration_minutes} min`
                          : ""}
                      </p>
                    </div>
                    {canEdit && appt.status === "confirmed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300"
                        onClick={() => cancelAppointment(appt.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </Card>
                </li>
              ))}
              {(appointments ?? []).length === 0 && (
                <Card className="py-16 text-center text-sm text-muted-foreground">
                  No appointments yet.
                </Card>
              )}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="availability">
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-sm font-semibold">Add / update a day</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div>
                <Label>Day</Label>
                <select
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  value={avDay}
                  onChange={(e) => setAvDay(Number(e.target.value))}
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>From</Label>
                <Input type="time" value={avStart} onChange={(e) => setAvStart(e.target.value)} />
              </div>
              <div>
                <Label>To</Label>
                <Input type="time" value={avEnd} onChange={(e) => setAvEnd(e.target.value)} />
              </div>
              <div>
                <Label>Slot (min)</Label>
                <Input
                  type="number"
                  min={5}
                  max={480}
                  value={avSlot}
                  onChange={(e) => setAvSlot(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input value={avTz} onChange={(e) => setAvTz(e.target.value)} placeholder="UTC" />
              </div>
            </div>
            {canEdit && (
              <Button className="mt-3" size="sm" onClick={saveAvailability}>
                Save day
              </Button>
            )}
          </Card>

          <div className="flex flex-col gap-2">
            {DAYS.map((d, i) => {
              const av = avByDay.get(i);
              return (
                <Card key={d} className="flex items-center justify-between p-3">
                  <div>
                    <span className="font-medium">{d}</span>
                    {av ? (
                      <span className="ml-3 text-sm text-muted-foreground">
                        {fromMin(av.start_minutes)} – {fromMin(av.end_minutes)} ·{" "}
                        {av.slot_minutes} min slots · {av.timezone}
                      </span>
                    ) : (
                      <span className="ml-3 text-sm text-muted-foreground">
                        Closed
                      </span>
                    )}
                  </div>
                  {av && canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-red-400 hover:text-red-300"
                      onClick={() => deleteAvailability(av.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="links">
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-sm font-semibold">New booking link</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Title</Label>
                <Input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="Book a call"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={linkDesc}
                  onChange={(e) => setLinkDesc(e.target.value)}
                  rows={1}
                />
              </div>
            </div>
            {canEdit && (
              <Button className="mt-3" size="sm" onClick={createLink}>
                <Plus className="size-4" />
                Create link
              </Button>
            )}
          </Card>

          <div className="flex flex-col gap-2">
            {links.map((link) => (
              <Card key={link.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{link.title}</p>
                  {link.description && (
                    <p className="truncate text-sm text-muted-foreground">
                      {link.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    /book/{link.token}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => copyLink(link.token)}
                  >
                    <Copy className="size-4" />
                  </Button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-red-400 hover:text-red-300"
                      onClick={async () => {
                        await createClient()
                          .from("booking_links")
                          .delete()
                          .eq("id", link.id)
                          .eq("account_id", accountId!);
                        load();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
            {links.length === 0 && (
              <Card className="py-16 text-center text-sm text-muted-foreground">
                No booking links yet.
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
