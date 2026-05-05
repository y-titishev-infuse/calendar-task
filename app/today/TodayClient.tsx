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

  async function pushToJira(taskIds: string[]): Promise<boolean> {
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
    const ids = pendingTasks.map((t) => t.id);
    if (ids.length === 0) return;
    await pushToJira(ids);
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
    if (ok) setState((s) => markFollowupAddressed(s, event.id));
  }

  function skipFollowup(eventId: string) {
    setState((s) => markFollowupAddressed(s, eventId));
  }

  return (
    <>
      <Sidebar
        pendingTasks={pendingTasks}
        approvedTasks={approvedTasks}
        eventsById={eventsById}
        pushing={pushing}
        pushError={pushError}
        onApprove={approvePending}
        onEditPending={(id, patch) => setState((s) => updateTask(s, id, patch))}
        onDeletePending={(id) => setState((s) => removeTask(s, id))}
        onToggleApproved={(id) => setState((s) => toggleTask(s, id))}
      />

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
      </main>
    </>
  );
}

function Sidebar({
  pendingTasks,
  approvedTasks,
  eventsById,
  pushing,
  pushError,
  onApprove,
  onEditPending,
  onDeletePending,
  onToggleApproved,
}: {
  pendingTasks: Task[];
  approvedTasks: Task[];
  eventsById: Record<string, CalendarEvent>;
  pushing: boolean;
  pushError: string | null;
  onApprove: () => void;
  onEditPending: (id: string, patch: Partial<Task>) => void;
  onDeletePending: (id: string) => void;
  onToggleApproved: (id: string) => void;
}) {
  const done = approvedTasks.filter((t) => t.done).length;
  const hasPending = pendingTasks.length > 0;

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[320px] bg-white border-r border-ink/10 overflow-y-auto flex flex-col">
      <div className="p-5 border-b border-ink/10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink/60">
          Today's Tasks
        </h2>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {done} <span className="text-ink/30">/ {approvedTasks.length}</span>
        </p>
      </div>

      {hasPending && (
        <div className="p-4 border-b border-ink/10 bg-accent/5">
          <button
            onClick={onApprove}
            disabled={pushing}
            className="w-full px-3 py-2 rounded-md bg-accent text-white text-sm font-medium disabled:bg-ink/20 disabled:text-ink/50 hover:opacity-90 transition"
          >
            {pushing
              ? "Pushing to Jira…"
              : `Approve & push to Jira (${pendingTasks.length})`}
          </button>
          {pushError && (
            <p className="mt-2 text-xs text-red-700">{pushError}</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {hasPending && (
          <section>
            <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">
              Pending review · {pendingTasks.length}
            </h3>
            <ul className="px-2 pb-2 space-y-1">
              {pendingTasks.map((task) => (
                <PendingRow
                  key={task.id}
                  task={task}
                  event={task.eventId ? eventsById[task.eventId] : undefined}
                  onEdit={(patch) => onEditPending(task.id, patch)}
                  onDelete={() => onDeletePending(task.id)}
                />
              ))}
            </ul>
          </section>
        )}

        <section>
          {hasPending && (
            <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">
              Approved · {approvedTasks.length}
            </h3>
          )}
          <ul className="px-2 pb-3 space-y-1">
            {approvedTasks.length === 0 && !hasPending && (
              <li className="px-2 py-3 text-sm text-ink/50">
                Answer prep questions on the right, then generate tasks.
              </li>
            )}
            {approvedTasks.map((task) => (
              <ApprovedRow
                key={task.id}
                task={task}
                onToggle={() => onToggleApproved(task.id)}
              />
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

function PendingRow({
  task,
  event,
  onEdit,
  onDelete,
}: {
  task: Task;
  event: CalendarEvent | undefined;
  onEdit: (patch: Partial<Task>) => void;
  onDelete: () => void;
}) {
  return (
    <li className="px-2 py-2 rounded border border-dashed border-accent/40 bg-white">
      <div className="flex items-start gap-1">
        <input
          type="text"
          value={task.title}
          onChange={(e) => onEdit({ title: e.target.value })}
          className="flex-1 min-w-0 text-sm bg-transparent border-0 px-1 py-0.5 focus:outline-none focus:bg-ink/5 rounded"
        />
        <button
          onClick={onDelete}
          className="text-ink/40 hover:text-red-700 px-1 leading-none"
          aria-label="Remove task"
          title="Remove"
        >
          ×
        </button>
      </div>
      {(event || task.dueBefore) && (
        <div className="mt-0.5 px-1 text-[11px] text-ink/50 truncate">
          {event && <span className="truncate">{event.summary}</span>}
          {task.dueBefore && (
            <span className="ml-1 text-accent">
              before{" "}
              {new Date(task.dueBefore).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {task.origin === "followup" && (
            <span className="ml-1">· follow-up</span>
          )}
        </div>
      )}
    </li>
  );
}

function ApprovedRow({
  task,
  onToggle,
}: {
  task: Task;
  onToggle: () => void;
}) {
  const dueLabel = task.dueBefore
    ? new Date(task.dueBefore).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <li>
      <label className="flex items-start gap-2 px-2 py-2 rounded hover:bg-ink/5 cursor-pointer">
        <input
          type="checkbox"
          checked={task.done}
          onChange={onToggle}
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
          {event.descriptionHtml && (
            <div
              className="event-description mt-2 text-sm text-ink/70"
              dangerouslySetInnerHTML={{ __html: event.descriptionHtml }}
            />
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
