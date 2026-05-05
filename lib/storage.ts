import type { DayState, Task } from "./types";

const KEY = "infuse-tasks-v2";

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyState(): DayState {
  return {
    date: todayKey(),
    answers: {},
    tasks: [],
    addressedEventFollowups: [],
  };
}

export function loadDayState(): DayState {
  if (typeof window === "undefined") return emptyState();
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as DayState;
    if (parsed.date !== todayKey()) return emptyState();
    return {
      ...emptyState(),
      ...parsed,
      addressedEventFollowups: parsed.addressedEventFollowups ?? [],
    };
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

export function replaceTasks(
  state: DayState,
  pendingTasks: Task[],
  origin: "prep" | "followup",
): DayState {
  const others = state.tasks.filter(
    (t) => !(t.origin === origin && t.status === "pending"),
  );
  return { ...state, tasks: [...others, ...pendingTasks] };
}

export function appendTasks(state: DayState, tasks: Task[]): DayState {
  return { ...state, tasks: [...state.tasks, ...tasks] };
}

export function updateTask(
  state: DayState,
  taskId: string,
  patch: Partial<Task>,
): DayState {
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
  };
}

export function removeTask(state: DayState, taskId: string): DayState {
  return { ...state, tasks: state.tasks.filter((t) => t.id !== taskId) };
}

export function toggleTask(state: DayState, taskId: string): DayState {
  return updateTask(state, taskId, {
    done: !state.tasks.find((t) => t.id === taskId)?.done,
  });
}

export function setPriority(
  state: DayState,
  taskId: string,
  high: boolean,
): DayState {
  return updateTask(state, taskId, { priority: high ? "high" : undefined });
}

export function cleanupDone(state: DayState): DayState {
  return { ...state, tasks: state.tasks.filter((t) => !t.done) };
}

export function moveTaskBefore(
  state: DayState,
  fromId: string,
  beforeId: string | null,
): DayState {
  if (fromId === beforeId) return state;
  const fromIdx = state.tasks.findIndex((t) => t.id === fromId);
  if (fromIdx === -1) return state;
  const moving = state.tasks[fromIdx];
  const without = state.tasks.filter((t) => t.id !== fromId);
  if (beforeId === null) {
    return { ...state, tasks: [...without, moving] };
  }
  const targetIdx = without.findIndex((t) => t.id === beforeId);
  if (targetIdx === -1) return state;
  const next = [...without];
  next.splice(targetIdx, 0, moving);
  return { ...state, tasks: next };
}

export function markFollowupAddressed(state: DayState, eventId: string): DayState {
  if (state.addressedEventFollowups.includes(eventId)) return state;
  return {
    ...state,
    addressedEventFollowups: [...state.addressedEventFollowups, eventId],
  };
}
