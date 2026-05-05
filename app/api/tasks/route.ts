import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateTasks } from "@/lib/anthropic";
import type { CalendarEvent } from "@/lib/types";

type Body = {
  items?: { event: CalendarEvent; answers: Record<string, string> }[];
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = (await req.json()) as Body;
  if (!body.items?.length) {
    return NextResponse.json({ error: "missing items" }, { status: 400 });
  }
  try {
    const tasks = await generateTasks(body.items);
    return NextResponse.json({ tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
