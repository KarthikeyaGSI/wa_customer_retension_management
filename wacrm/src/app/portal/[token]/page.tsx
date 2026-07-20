"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, CalendarDays, MessageSquare, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
}
interface Appointment {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
}
interface Message {
  id: string;
  direction: string;
  text: string | null;
  created_at: string;
}
interface Conversation {
  id: string;
  status: string;
  last_message_text: string | null;
  last_message_at: string | null;
  messages: Message[];
}
interface PortalData {
  title: string;
  contact: Contact | null;
  appointments: Appointment[];
  conversations: Conversation[];
}

const APPT_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export default function PortalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("This portal is not available.");
        return;
      }
      const body = (await res.json()) as { data: PortalData };
      setData(body.data);
    } catch {
      setError("Could not load your portal. Try again.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex items-center gap-2">
        <User className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">{data.title}</h1>
      </div>

      {data.contact && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {data.contact.name ?? "Contact"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {data.contact.phone && <p>Phone: {data.contact.phone}</p>}
            {data.contact.email && <p>Email: {data.contact.email}</p>}
            {data.contact.company && <p>Company: {data.contact.company}</p>}
          </CardContent>
        </Card>
      )}

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="size-4" /> Appointments
        </h2>
        <div className="space-y-2">
          {data.appointments.length === 0 && (
            <p className="text-sm text-muted-foreground">No appointments.</p>
          )}
          {data.appointments.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <p className="font-medium">
                    {new Date(a.scheduled_at).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  {a.notes && (
                    <p className="text-sm text-muted-foreground">{a.notes}</p>
                  )}
                </div>
                <Badge variant="outline">{APPT_LABEL[a.status] ?? a.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4" /> Conversations
        </h2>
        <div className="space-y-2">
          {data.conversations.length === 0 && (
            <p className="text-sm text-muted-foreground">No conversations.</p>
          )}
          {data.conversations.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-2 p-3">
                {c.messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      "max-w-[80%] rounded-lg px-3 py-2 text-sm " +
                      (m.direction === "outbound"
                        ? "ml-auto bg-primary/10 text-primary"
                        : "bg-muted text-foreground")
                    }
                  >
                    {m.text}
                    <div className="mt-0.5 text-[10px] opacity-60">
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
                {c.messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {c.last_message_text ?? "No messages yet."}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
