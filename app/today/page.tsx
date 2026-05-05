import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { listTodayEvents } from "@/lib/google";
import type { CalendarEvent } from "@/lib/types";
import TodayClient from "./TodayClient";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  let events: CalendarEvent[] = [];
  let error: string | null = null;
  try {
    events = await listTodayEvents(session.accessToken);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load calendar";
  }

  return (
    <div className="flex min-h-screen">
      <TodayClient events={events} loadError={error} />
      <form
        className="fixed top-3 right-4"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button className="text-xs text-ink/50 hover:text-ink underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
