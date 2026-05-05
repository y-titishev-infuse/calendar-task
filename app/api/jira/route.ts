import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createIssue, jiraConfigured } from "@/lib/jira";
import type { JiraResult } from "@/lib/types";

type Body = {
  tasks?: {
    id: string;
    title: string;
    dueBefore?: string;
    eventSummary?: string;
    eventStart?: string;
  }[];
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!jiraConfigured()) {
    return NextResponse.json(
      { error: "Jira is not configured on the server." },
      { status: 503 },
    );
  }
  const body = (await req.json()) as Body;
  if (!body.tasks?.length) {
    return NextResponse.json({ error: "no tasks" }, { status: 400 });
  }

  const results: Record<string, JiraResult> = {};
  for (const task of body.tasks) {
    const lines: string[] = [];
    if (task.eventSummary) lines.push(`Related event: ${task.eventSummary}`);
    if (task.eventStart) {
      lines.push(`Event start: ${new Date(task.eventStart).toISOString()}`);
    }
    if (task.dueBefore) {
      lines.push(`Do before: ${new Date(task.dueBefore).toISOString()}`);
    }
    lines.push("");
    lines.push("Created from Daily Task Sidebar after user approval.");
    results[task.id] = await createIssue({
      summary: task.title,
      description: lines.join("\n"),
      dueBefore: task.dueBefore,
    });
  }

  return NextResponse.json({ results });
}
