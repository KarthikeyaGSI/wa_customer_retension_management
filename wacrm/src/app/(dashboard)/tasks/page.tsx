"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Task, TaskPriority, TaskStatus } from "@/types";
import {
  CheckSquare,
  Loader2,
  Plus,
  Trash2,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: "border-border bg-muted text-muted-foreground",
  medium: "border-primary/40 bg-primary/10 text-primary",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  urgent: "border-red-500/40 bg-red-500/10 text-red-300",
};

function formatDue(dueAt: string | null) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const overdue = d.getTime() < Date.now();
  return {
    text: d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    overdue,
  };
}

interface Member {
  id: string;
  full_name: string | null;
}

interface TaskRow extends Task {
  assignee?: { id: string; full_name: string | null } | null;
  contact?: { id: string; name: string | null; phone: string } | null;
  deal?: { id: string; title: string | null } | null;
}

export default function TasksPage() {
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole !== "viewer";

  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "todo" as TaskStatus,
    priority: "medium" as TaskPriority,
    assignee_id: "" as string | null,
    due_at: "",
    remind_at: "",
  });

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select(
        `*, assignee:profiles!tasks_assignee_id_fkey (id, full_name), contact:contacts (id, name, phone), deal:deals (id, title)`,
      )
      .eq("account_id", accountId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Failed to load tasks");
      setTasks([]);
    } else {
      setTasks((data ?? []) as unknown as TaskRow[]);
    }
    setLoading(false);
  }, [accountId]);

  const loadMembers = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("account_id", accountId)
      .limit(200);
    setMembers((data ?? []) as Member[]);
  }, [accountId]);

  useEffect(() => {
    setLoading(true);
    load();
    loadMembers();
  }, [load, loadMembers]);

  function openCreate() {
    setEditing(null);
    setForm({
      title: "",
      description: "",
      status: "todo",
      priority: "medium",
      assignee_id: "",
      due_at: "",
      remind_at: "",
    });
    setDialogOpen(true);
  }

  function openEdit(task: TaskRow) {
    setEditing(task);
    setForm({
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      priority: task.priority,
      assignee_id: task.assignee_id ?? "",
      due_at: task.due_at ? task.due_at.slice(0, 16) : "",
      remind_at: task.remind_at ? task.remind_at.slice(0, 16) : "",
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!accountId) return;
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      assignee_id: form.assignee_id || null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      remind_at: form.remind_at ? new Date(form.remind_at).toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    try {
      if (editing) {
        const { error } = await supabase
          .from("tasks")
          .update(payload)
          .eq("id", editing.id)
          .eq("account_id", accountId);
        if (error) throw error;
        toast.success("Task updated");
      } else {
        const { error } = await supabase
          .from("tasks")
          .insert({ ...payload, account_id: accountId });
        if (error) throw error;
        toast.success("Task created");
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error("Failed to save task");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(task: TaskRow) {
    if (!accountId || !canEdit) return;
    const next: TaskStatus =
      task.status === "done" ? "todo" : "done";
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        status: next,
        completed_at: next === "done" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("account_id", accountId);
    if (error) {
      toast.error("Failed to update task");
      return;
    }
    setTasks((prev) =>
      prev?.map((t) => (t.id === task.id ? { ...t, status: next } : t)) ?? prev,
    );
  }

  async function remove(task: TaskRow) {
    if (!accountId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", task.id)
      .eq("account_id", accountId);
    if (error) {
      toast.error("Failed to delete task");
      return;
    }
    setTasks((prev) => prev?.filter((t) => t.id !== task.id) ?? prev);
    toast.success("Task deleted");
  }

  const visible = (tasks ?? []).filter(
    (t) => filter === "all" || t.status === filter,
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">Tasks</h1>
        </div>
        {canEdit && (
          <Button onClick={openCreate} size="sm">
            <Plus className="size-4" />
            New task
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "todo", "in_progress", "done", "cancelled"] as const).map(
          (f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filter === f
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {f === "all" ? "All" : STATUS_LABEL[f]}
            </button>
          ),
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-16 text-center">
          <CheckSquare className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No tasks yet. {canEdit && "Create one to get started."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((task) => {
            const due = formatDue(task.due_at);
            return (
              <li key={task.id}>
                <Card
                  className={cn(
                    "flex items-start gap-3 p-3",
                    task.status === "done" && "opacity-60",
                  )}
                >
                  <button
                    onClick={() => toggleStatus(task)}
                    disabled={!canEdit}
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border",
                      task.status === "done"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary",
                    )}
                    aria-label="Toggle complete"
                  >
                    {task.status === "done" ? "✓" : ""}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "font-medium",
                          task.status === "done" && "line-through",
                        )}
                      >
                        {task.title}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          PRIORITY_CLASS[task.priority],
                        )}
                      >
                        {PRIORITY_LABEL[task.priority]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {STATUS_LABEL[task.status]}
                      </Badge>
                    </div>

                    {task.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {task.assignee?.full_name && (
                        <span>Assigned: {task.assignee.full_name}</span>
                      )}
                      {due && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            due.overdue &&
                              task.status !== "done" &&
                              "text-red-400",
                          )}
                        >
                          <CalendarClock className="size-3" />
                          {due.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(task)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-red-400 hover:text-red-300"
                        onClick={() => remove(task)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit task" : "New task"}
            </DialogTitle>
            <DialogDescription>
              Track follow-ups, deals, and team to-dos.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="Follow up with lead"
              />
            </div>

            <div>
              <Label htmlFor="task-desc">Description</Label>
              <Textarea
                id="task-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional details"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, status: v as TaskStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(STATUS_LABEL) as TaskStatus[]
                    ).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, priority: v as TaskPriority }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(PRIORITY_LABEL) as TaskPriority[]
                    ).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Assignee</Label>
                <Select
                  value={form.assignee_id || "unassigned"}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      assignee_id: v === "unassigned" ? "" : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name || "Member"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="task-due">Due</Label>
                <Input
                  id="task-due"
                  type="datetime-local"
                  value={form.due_at}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, due_at: e.target.value }))
                  }
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="task-remind">Remind at</Label>
                <Input
                  id="task-remind"
                  type="datetime-local"
                  value={form.remind_at}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, remind_at: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
