import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTodayEvents } from "@/lib/google";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    const events = await listTodayEvents(session.accessToken);
    return NextResponse.json({ events });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
