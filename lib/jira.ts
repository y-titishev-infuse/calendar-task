import type { JiraResult } from "./types";

type Config = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
};

function readConfig(): Config | null {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const issueType = process.env.JIRA_ISSUE_TYPE || "Task";
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  return { baseUrl, email, apiToken, projectKey, issueType };
}

export function jiraConfigured(): boolean {
  return readConfig() !== null;
}

function authHeader(cfg: Config): string {
  const token = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
  return `Basic ${token}`;
}

function adfDoc(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      })),
  };
}

function dueDateForJira(dueBefore?: string): string {
  const d = dueBefore ? new Date(dueBefore) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function createIssue(args: {
  summary: string;
  description: string;
  dueBefore?: string;
}): Promise<JiraResult> {
  const cfg = readConfig();
  if (!cfg) {
    return {
      ok: false,
      error: "Jira not configured (JIRA_BASE_URL/EMAIL/API_TOKEN/PROJECT_KEY).",
    };
  }

  const body = {
    fields: {
      project: { key: cfg.projectKey },
      summary: args.summary.slice(0, 254),
      issuetype: { name: cfg.issueType },
      description: adfDoc(args.description),
      duedate: dueDateForJira(args.dueBefore),
    },
  };

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: authHeader(cfg),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Jira ${res.status}: ${text.slice(0, 300)}` };
  }

  const data = (await res.json()) as { key?: string };
  if (!data.key) {
    return { ok: false, error: "Jira response missing issue key" };
  }
  return {
    ok: true,
    key: data.key,
    url: `${cfg.baseUrl}/browse/${data.key}`,
  };
}
