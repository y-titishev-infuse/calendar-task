import { sanitizeDescriptionHtml } from "./sanitizeHtml";
import type { CalendarEvent } from "./types";

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; responseStatus?: string; self?: boolean }[];
  status?: string;
};

export async function listTodayEvents(accessToken: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Calendar API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { items?: GoogleEvent[] };
  const items = data.items ?? [];

  return items
    .filter((e) => e.status !== "cancelled")
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .filter((e) => {
      const me = e.attendees?.find((a) => a.self);
      return !me || me.responseStatus !== "declined";
    })
    .map((e) => ({
      id: e.id,
      summary: e.summary ?? "(no title)",
      descriptionHtml: e.description
        ? sanitizeDescriptionHtml(e.description)
        : undefined,
      start: e.start!.dateTime!,
      end: e.end!.dateTime!,
      attendees:
        e.attendees
          ?.filter((a) => !a.self && a.email)
          .map((a) => a.email as string) ?? [],
    }));
}
