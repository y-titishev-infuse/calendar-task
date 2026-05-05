export type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees: string[];
};

export type Question = {
  id: string;
  text: string;
  kind: "prep" | "contact" | "outcome";
};

export type TaskStatus = "pending" | "approved";
export type TaskOrigin = "prep" | "followup";

export type Task = {
  id: string;
  title: string;
  eventId?: string;
  dueBefore?: string;
  done: boolean;
  status: TaskStatus;
  origin: TaskOrigin;
  jiraKey?: string;
  jiraUrl?: string;
};

export type DayState = {
  date: string;
  answers: Record<string, Record<string, string>>;
  tasks: Task[];
  addressedEventFollowups: string[];
};

export type JiraResult =
  | { ok: true; key: string; url: string }
  | { ok: false; error: string };
