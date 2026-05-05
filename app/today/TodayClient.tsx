"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CalendarEvent,
  DayState,
  JiraResult,
  Question,
  Task,
} from "@/lib/types";
import {
  appendTasks,
  loadDayState,
  markFollowupAddressed,
  removeTask,
  replaceTasks,
  saveDayState,
  setAnswer,
  todayKey,
  toggleTask,
  updateTask,
} from "@/lib/storage";

type Props = {
  events: CalendarEvent[];
  loadError: string | null;
};

export default function TodayClient({ events, loadError }: Props) {
  const [state, setState] = useState<DayState>({
    date: todayKey(),
    answers: {},
    tasks: [],
    addressedEventFollowups: [],
  });
  const [hydrated, setHydrated] = useState(false);
  const [questionsByEvent, setQuestionsByEvent] = useState<
    Record<string, Question[]>
  >({});
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setState(loadDayState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveDayState(state);
  }, [state, hydrated]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const eventsById = useMemo(
    () => Object.fromEntries(events.map((e) => [e.id, e])),
    [events],
  );

  const pendingTasks = state.tasks.filter((t) => t.status === "pending");
  const approvedTasks = state.tasks.filter((t) => t.status === "approved");

  async function fetchQuestions(event: CalendarEvent) {
    setLoadingFor(event.id);
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const data = (await res.json()) as { questions?: Question[] };
      if (data.questions) {
        setQuestionsByEvent((m) => ({ ...m, [event.id]: data.questions! }));
      }
    } finally {
      setLoadingFor(null);
    }
  }

  function onAnswer(eventId: string, questionId: string, value: string) {
    setState((s) => setAnswer(s, eventId, questionId, value));
  }

  async function generateTasks() {
    setGenerating(true);
    setGenError(null);
    try {
      const items = events
        .map((event) => ({ event, answers: state.answers[event.id] ?? {} }))
        .filter((item) => Object.keys(item.answers).length > 0);
      if (items.length === 0) {
        setGenError("Answer at least one event's questions first.");
        return;
      }
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json()) as { tasks?: Task[]; error?: string };
      if (data.tasks) {
        setState((s) => replaceTasks(s, data.tasks!, "prep"));
      } else {
        setGenError(data.error ?? "Failed to generate tasks.");
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }

  async function pushToJira(taskIds: string[]) {
    setPushing(true);
    setPushError(null);
    const tasksToPush = state.tasks.filter((t) => taskIds.includes(t.id));
    try {
      const payload = {
        tasks: tasksToPush.map((t) => {
          const event = t.eventId ? eventsById[t.eventId] : undefined;
          return {
            id: t.id,
            title: t.title,
            dueBefore: t.dueBefore,
            eventSummary: event?.summary,
            eventStart: event?.start,
          };
        }),
      };
      const res = await fetch("/api/jira", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        results?: Record<string, JiraResult>;
        error?: string;
      };
      if (!data.results) {
        setPushError(data.error ?? "Push failed.");
        return false;
      }
      let allOk = true;
      setState((s) => {
        let next = s;
        for (const [taskId, result] of Object.entries(data.results!)) {
          if (result.ok) {
            next = updateTask(next, taskId, {
              status: "approved",
              jiraKey: result.key,
              jiraUrl: result.url,
            });
          } else {
            allOk = false;
          }
        }
        return next;
      });
      if (!allOk) {
        const errors = Object.values(data.results)
          .filter((r): r is { ok: false; error: string } => !r.ok)
          .map((r) => r.error);
        setPushError(`Some tasks failed: ${errors.slice(0, 2).join("; ")}`);
      }
      return allOk;
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Network error");
      return false;
    } finally {
      setPushing(false);
    }
  }

  async function approvePending() {
    const pendingIds = pendingTasks.map((t) => t.id);
    if (pendingIds.length === 0) return;
    await pushToJira(pendingIds);
  }

  function discardPending() {
    setState((s) => ({
      ...s,
      tasks: s.tasks.filter((t) => t.status !== "pending"),
    }));
  }

  function editPendingTask(id: string, patch: Partial<Task>) {
    setState((s) => updateTask(s, id, patch));
  }

  function deletePendingTask(id: string) {
    setState((s) => removeTask(s, id));
  }

  async function submitFollowup(event: CalendarEvent, titles: string[]) {
    const cleanTitles = titles.map((t) => t.trim()).filter(Boolean);
    if (cleanTitles.length === 0) {
      setState((s) => markFollowupAddressed(s, event.id));
      return;
    }
    const newTasks: Task[] = cleanTitles.map((title) => ({
      id: `fu-${event.id}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      eventId: event.id,
      done: false,
      status: "pending",
      origin: "followup",
    }));
    setState((s) => appendTasks(s, newTasks));
    const ok = await pushToJira(newTasks.map((t) => t.id));
    if (ok) {
      setState((s) => markFollowupAddressed(s, event.id));
    }
  }

  function skipFollowup(eventId: string) {
    setState((s) => markFollowupAddressed(s, eventId));
  }

  return (
    <>
      <Sidebar tasks={approvedTasks} onToggle={(id) => setState((s) => toggleTask(s, id))} />

      <main className="flex-1 ml-[320px] px-8 py-10 max-w-3xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold">Today</h1>
          <p className="text-sm text-ink/60">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </header>

        {loadError && (
          <div className="mb-6 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-800">
            Could not load calendar: {loadError}
          </div>
        )}

        {!loadError && events.length === 0 && (
          <p className="text-ink/60">No events on your calendar today.</p>
        )}

        <ul className="space-y-4">
          {events.map((event) => {
            const eventEnded = new Date(event.end) < now;
            const followupAddressed = state.addressedEventFollowups.includes(event.id);
            return (
              <li key={event.id} className="space-y-2">
                <EventCard
                  event={event}
                  questions={questionsByEvent[event.id]}
                  answers={state.answers[event.id] ?? {}}
                  loading={loadingFor === event.id}
                  onLoadQuestions={() => fetchQuestions(event)}
                  onAnswer={(qid, val) => onAnswer(event.id, qid, val)}
                />
                {eventEnded && !followupAddressed && (
                  <FollowupPanel
                    event={event}
                    onSubmit={(titles) => submitFollowup(event, titles)}
                    onSkip={() => skipFollowup(event.id)}
                    pushing={pushing}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {events.length > 0 && pendingTasks.length === 0 && (
          <div className="mt-10 border-t border-ink/10 pt-6">
            <button
              onClick={generateTasks}
              disabled={generating}
              className="px-4 py-2 rounded-md bg-accent text-white disabled:bg-ink/20 disabled:text-ink/50 hover:opacity-90 transition"
            >
              {generating
                ? "Generating tasks…"
                : approvedTasks.some((t) => t.origin === "prep")
                  ? "Regenerate prep tasks"
                  : "Generate today's tasks"}
            </button>
            {genError && <p className="mt-2 text-sm text-red-700">{genError}</p>}
          </div>
        )}

        {pendingTasks.length > 0 && (
          <ReviewPane
            tasks={pendingTasks}
            eventsById={eventsById}
            pushing={pushing}
            pushError={pushError}
            onEdit={editPendingTask}
            onDelete={deletePendingTask}
            onApprove={approvePending}
            onDiscard={discardPending}
          />
        )}
      </main>
    </>
  );
}

function Sidebar({
  tasks,
  onToggle,
}: {
  tasks: Task[];
  onToggle: (id: string) => void;
}) {
  const done = tasks.filter((t) => t.done).length;

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[320px] bg-white border-r border-ink/10 overflow-y-auto">
      <div className="p-5 border-b border-ink/10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink/60">
          Today's Tasks
        </h2>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {done} <span className="text-ink/30">/ {tasks.length}</span>
        </p>
      </div>
      <ul className="p-3 space-y-1">
        {tasks.length === 0 && (
          <li className="px-2 py-3 text-sm text-ink/50">
            Approved tasks appear here. Generate, review, then approve.
          </li>
        )}
        {tasks.map((task) => {
          const dueLabel = task.dueBefore
            ? new Date(task.dueBefore).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : null;
          return (
            <li key={task.id}>
              <label className="flex items-start gap-2 px-2 py-2 rounded hover:bg-ink/5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => onToggle(task.id)}
                  className="mt-1 accent-accent"
                />
                <div className="flex-1 text-sm min-w-0">
                  <span className={task.done ? "line-through text-ink/40" : ""}>
                    {task.title}
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    {dueLabel && <span className="text-accent">before {dueLabel}</span>}
                    {task.jiraKey && task.jiraUrl && (
                      <a
                        href={task.jiraUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-700 hover:underline"
                      >
                        {task.jiraKey}
                      </a>
                    )}
                    {task.origin === "followup" && (
                      <span className="text-ink/40">follow-up</span>
                    )}
                  </div>
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function EventCard({
  event,
  questions,
  answers,
  loading,
  onLoadQuestions,
  onAnswer,
}: {
  event: CalendarEvent;
  questions: Question[] | undefined;
  answers: Record<string, string>;
  loading: boolean;
  onLoadQuestions: () => void;
  onAnswer: (qid: string, val: string) => void;
}) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="border border-ink/10 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{event.summary}</h3>
          <p className="text-xs text-ink/60 mt-0.5">
            {fmt(start)} – {fmt(end)}
            {event.attendees.length > 0 &&
              ` · ${event.attendees.length} attendee${event.attendees.length > 1 ? "s" : ""}`}
          </p>
          {event.description && (
            <p className="mt-2 text-sm text-ink/70 line-clamp-2">{event.description}</p>
          )}
        </div>
        {!questions && (
          <button
            onClick={onLoadQuestions}
            disabled={loading}
            className="shrink-0 text-xs px-3 py-1.5 rounded border border-ink/20 hover:bg-ink/5 disabled:opacity-50"
          >
            {loading ? "…" : "Get prep questions"}
          </button>
        )}
      </div>

      {questions && questions.length === 0 && (
        <p className="mt-3 text-xs text-ink/50">No prep needed for this one.</p>
      )}

      {questions && questions.length > 0 && (
        <div className="mt-4 space-y-3">
          {questions.map((q) => (
            <div key={q.id}>
              <label className="block text-sm text-ink/80">{q.text}</label>
              <input
                type="text"
                value={answers[q.id] ?? ""}
                onChange={(e) => onAnswer(q.id, e.target.value)}
                className="mt-1 w-full px-3 py-1.5 text-sm border border-ink/15 rounded focus:outline-none focus:border-accent"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewPane({
  tasks,
  eventsById,
  pushing,
  pushError,
  onEdit,
  onDelete,
  onApprove,
  onDiscard,
}: {
  tasks: Task[];
  eventsById: Record<string, CalendarEvent>;
  pushing: boolean;
  pushError: string | null;
  onEdit: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-10 border-2 border-accent/40 rounded-lg p-5 bg-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold">Review tasks</h2>
          <p className="text-xs text-ink/60">
            Edit, delete, or approve. Approved tasks are pushed to Jira.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {tasks.map((task) => {
          const event = task.eventId ? eventsById[task.eventId] : undefined;
          const dueValue = task.dueBefore
            ? new Date(task.dueBefore).toISOString().slice(0, 16)
            : "";
          return (
            <li key={task.id} className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <input
                  type="text"
                  value={task.title}
                  onChange={(e) => onEdit(task.id, { title: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm border border-ink/15 rounded focus:outline-none focus:border-accent"
                />
                <div className="flex items-center gap-2 text-xs text-ink/60">
                  {event && <span className="truncate">{event.summary}</span>}
                  <input
                    type="datetime-local"
                    value={dueValue}
                    onChange={(e) =>
                      onEdit(task.id, {
                        dueBefore: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : undefined,
                      })
                    }
                    className="px-2 py-0.5 border border-ink/15 rounded"
                  />
                </div>
              </div>
              <button
                onClick={() => onDelete(task.id)}
                className="text-ink/50 hover:text-red-700 px-2 py-1"
                aria-label="Delete task"
                title="Delete"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      {pushError && (
        <p className="mt-3 text-sm text-red-700">{pushError}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onApprove}
          disabled={pushing || tasks.length === 0}
          className="px-4 py-2 rounded-md bg-accent text-white disabled:bg-ink/20 disabled:text-ink/50 hover:opacity-90 transition"
        >
          {pushing ? "Pushing to Jira…" : `Approve & push to Jira (${tasks.length})`}
        </button>
        <button
          onClick={onDiscard}
          disabled={pushing}
          className="text-sm text-ink/60 hover:text-ink underline"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function FollowupPanel({
  event,
  onSubmit,
  onSkip,
  pushing,
}: {
  event: CalendarEvent;
  onSubmit: (titles: string[]) => void;
  onSkip: () => void;
  pushing: boolean;
}) {
  const [rows, setRows] = useState<string[]>([""]);

  return (
    <div className="ml-6 border-l-2 border-accent/40 pl-4 py-3 bg-accent/5 rounded-r">
      <p className="text-sm font-medium">
        Anything new from "{event.summary}"?
      </p>
      <p className="text-xs text-ink/60 mt-0.5">
        List any tasks that came up. They'll be pushed to Jira too.
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((value, i) => (
          <input
            key={i}
            type="text"
            value={value}
            placeholder={i === 0 ? "Follow-up task…" : "Another task…"}
            onChange={(e) => {
              const next = [...rows];
              next[i] = e.target.value;
              if (i === rows.length - 1 && e.target.value.trim()) next.push("");
              setRows(next);
            }}
            className="w-full px-3 py-1.5 text-sm border border-ink/15 rounded focus:outline-none focus:border-accent bg-white"
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => onSubmit(rows)}
          disabled={pushing || rows.every((r) => !r.trim())}
          className="px-3 py-1.5 text-sm rounded-md bg-accent text-white disabled:bg-ink/20 disabled:text-ink/50 hover:opacity-90"
        >
          {pushing ? "Pushing…" : "Push to Jira"}
        </button>
        <button
          onClick={onSkip}
          className="text-sm text-ink/60 hover:text-ink underline"
        >
          Nothing came up
        </button>
      </div>
    </div>
  );
}
