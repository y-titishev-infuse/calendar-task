import type { DayState, Task } from "./types";

const KEY = "infuse-tasks-v1";

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyState(): DayState {
  return { date: todayKey(), answers: {}, tasks: [] };
}

export function loadDayState(): DayState {
  if (typeof window === "undefined") return emptyState();
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as DayState;
    if (parsed.date !== todayKey()) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

export function saveDayState(state: DayState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function setAnswer(
  state: DayState,
  eventId: string,
  questionId: string,
  value: string,
): DayState {
  const eventAnswers = { ...(state.answers[eventId] ?? {}), [questionId]: value };
  return { ...state, answers: { ...state.answers, [eventId]: eventAnswers } };
}

export function setTasks(state: DayState, tasks: Task[]): DayState {
  return { ...state, tasks };
}

export function toggleTask(state: DayState, taskId: string): DayState {
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)),
  };
}
