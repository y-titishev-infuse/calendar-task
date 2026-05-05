import Anthropic from "@anthropic-ai/sdk";
import type { CalendarEvent, Question, Task } from "./types";

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<\/(p|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const client = new Anthropic({
  baseURL: process.env.LLM_ORCHESTRATOR_BASE_URL,
  authToken: process.env.LLM_ORCHESTRATOR_API_KEY,
});

export const MODEL = "claude-opus-4-7";

const QUESTIONS_SYSTEM = `You help a busy professional prepare for the workday by asking SHORT, SPECIFIC clarifying questions about each calendar event.

For each event you receive, output 1 to 3 questions that, when answered, would let you build the user's prep task list. Focus on:
- "prep" — what artifact, doc, decision, or piece of information must exist BEFORE the meeting
- "contact" — which specific person needs to be reached, briefed, or confirmed before the meeting
- "outcome" — what concrete deliverable or follow-up should come AFTER the meeting

Rules:
- Each question must be answerable in one short sentence.
- Avoid generic questions. Use the event's title, description, and attendees.
- If the event is purely social or self-time (gym, lunch alone), return zero questions.
- Never ask about scheduling/rescheduling/calendar mechanics — this app is read-only.`;

const TASKS_SYSTEM = `You help a busy professional turn calendar events plus their answers to prep questions into a concrete, actionable task list for TODAY.

You will receive a list of today's events with the user's answers to prep questions for each. Produce a flat list of small, concrete tasks the user should do today.

Rules:
- Each task is one line, imperative ("Send agenda to Maria", "Print Q3 numbers", "Review PR #482").
- If a task should be done before a specific event, set dueBefore to that event's start time (ISO string) and reference its eventId.
- Skip tasks that are already implied "done" by the answers.
- Aim for 3-10 tasks total. Quality over quantity.
- Never invent attendees or facts not present in the input.
- Do not produce tasks that modify the calendar.`;

export async function generateQuestions(event: CalendarEvent): Promise<Question[]> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: QUESTIONS_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "submit_questions",
        description: "Return the prep questions for this event.",
        input_schema: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Short slug, e.g. q1, q2." },
                  text: { type: "string" },
                  kind: { type: "string", enum: ["prep", "contact", "outcome"] },
                },
                required: ["id", "text", "kind"],
              },
            },
          },
          required: ["questions"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_questions" },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          summary: event.summary,
          description: htmlToText(event.descriptionHtml ?? ""),
          start: event.start,
          end: event.end,
          attendees: event.attendees,
        }),
      },
    ],
  });

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "submit_questions") {
      const input = block.input as { questions: Question[] };
      return input.questions ?? [];
    }
  }
  return [];
}

type EventWithAnswers = {
  event: CalendarEvent;
  answers: Record<string, string>;
};

export async function generateTasks(items: EventWithAnswers[]): Promise<Task[]> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: TASKS_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "submit_tasks",
        description: "Return the task list for today.",
        input_schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  eventId: { type: "string" },
                  dueBefore: {
                    type: "string",
                    description: "ISO 8601 timestamp; omit if not time-bound.",
                  },
                },
                required: ["id", "title"],
              },
            },
          },
          required: ["tasks"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_tasks" },
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          items.map((i) => ({
            event: {
              id: i.event.id,
              summary: i.event.summary,
              description: htmlToText(i.event.descriptionHtml ?? ""),
              start: i.event.start,
              end: i.event.end,
              attendees: i.event.attendees,
            },
            answers: i.answers,
          })),
        ),
      },
    ],
  });

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "submit_tasks") {
      const input = block.input as {
        tasks: { id: string; title: string; eventId?: string; dueBefore?: string }[];
      };
      return (input.tasks ?? []).map((t) => ({
        ...t,
        done: false,
        status: "pending" as const,
        origin: "prep" as const,
      }));
    }
  }
  return [];
}
