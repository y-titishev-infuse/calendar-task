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

export type Task = {
  id: string;
  title: string;
  eventId?: string;
  dueBefore?: string;
  done: boolean;
};

export type DayState = {
  date: string;
  answers: Record<string, Record<string, string>>;
  tasks: Task[];
};
