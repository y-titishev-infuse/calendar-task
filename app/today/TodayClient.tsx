"use client";

import { useEffect, useState } from "react";
import type { CalendarEvent, DayState, Question, Task } from "@/lib/types";
import {
  loadDayState,
  saveDayState,
  setAnswer,
  setTasks,
  toggleTask,
  todayKey,
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
  });
  const [hydrated, setHydrated] = useState(false);
  const [questionsByEvent, setQuestionsByEvent] = useState<
    Record<string, Question[]>
  >({});
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    setState(loadDayState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveDayState(state);
  }, [state, hydrated]);

  async function fetchQuestions(event: CalendarEvent) {
    setLoadingFor(event.id);
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const data = (await res.json()) as { questions?: Question[]; error?: string };
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
        setState((s) => setTasks(s, data.tasks!));
      } else {
        setGenError(data.error ?? "Failed to generate tasks.");
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }

  const totalAnswered = Object.keys(state.answers).length;
  const canGenerate = totalAnswered > 0 && !generating;

  return (
    <>
      <Sidebar
        tasks={state.tasks}
        onToggle={(id) => setState((s) => toggleTask(s, id))}
        eventsById={Object.fromEntries(events.map((e) => [e.id, e]))}
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
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              questions={questionsByEvent[event.id]}
              answers={state.answers[event.id] ?? {}}
              loading={loadingFor === event.id}
              onLoadQuestions={() => fetchQuestions(event)}
              onAnswer={(qid, val) => onAnswer(event.id, qid, val)}
            />
          ))}
        </ul>

        {events.length > 0 && (
          <div className="mt-10 border-t border-ink/10 pt-6">
            <button
              onClick={generateTasks}
              disabled={!canGenerate}
              className="px-4 py-2 rounded-md bg-accent text-white disabled:bg-ink/20 disabled:text-ink/50 hover:opacity-90 transition"
            >
              {generating
                ? "Generating tasks…"
                : state.tasks.length > 0
                  ? "Regenerate today's tasks"
                  : "Generate today's tasks"}
            </button>
            {genError && (
              <p className="mt-2 text-sm text-red-700">{genError}</p>
            )}
          </div>
        )}
      </main>
    </>
  );
}

function Sidebar({
  tasks,
  onToggle,
  eventsById,
}: {
  tasks: Task[];
  onToggle: (id: string) => void;
  eventsById: Record<string, CalendarEvent>;
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
            Answer prep questions on the right, then generate tasks.
          </li>
        )}
        {tasks.map((task) => {
          const event = task.eventId ? eventsById[task.eventId] : undefined;
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
                <div className="flex-1 text-sm">
                  <span className={task.done ? "line-through text-ink/40" : ""}>
                    {task.title}
                  </span>
                  {dueLabel && (
                    <span className="ml-2 text-xs text-accent">
                      before {dueLabel}
                    </span>
                  )}
                  {event && (
                    <div className="text-xs text-ink/40 truncate">
                      {event.summary}
                    </div>
                  )}
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
    <li className="border border-ink/10 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{event.summary}</h3>
          <p className="text-xs text-ink/60 mt-0.5">
            {fmt(start)} – {fmt(end)}
            {event.attendees.length > 0 &&
              ` · ${event.attendees.length} attendee${event.attendees.length > 1 ? "s" : ""}`}
          </p>
          {event.description && (
            <p className="mt-2 text-sm text-ink/70 line-clamp-2">
              {event.description}
            </p>
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
        <p className="mt-3 text-xs text-ink/50">
          No prep needed for this one.
        </p>
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
    </li>
  );
}
