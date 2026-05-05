import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LandingPage() {
  const session = await auth();
  if (session) redirect("/today");

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-3xl font-semibold">Daily Task Sidebar</h1>
        <p className="text-ink/70">
          Connect your Google Calendar (read-only). Answer a few quick prep
          questions for each event. Get a focused task list for today, with
          checkboxes.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/today" });
          }}
        >
          <button
            type="submit"
            className="px-5 py-2.5 rounded-md bg-ink text-paper hover:bg-ink/90 transition"
          >
            Sign in with Google
          </button>
        </form>
        <p className="text-xs text-ink/50">
          Read-only access to your calendar. We never write events or send mail.
        </p>
      </div>
    </main>
  );
}
