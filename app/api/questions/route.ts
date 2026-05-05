import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateQuestions } from "@/lib/anthropic";
import type { CalendarEvent } from "@/lib/types";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = (await req.json()) as { event?: CalendarEvent };
  if (!body.event) {
    return NextResponse.json({ error: "missing event" }, { status: 400 });
  }
  try {
    const questions = await generateQuestions(body.event);
    return NextResponse.json({ questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
