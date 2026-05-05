// Server-side HTML sanitizer for Google Calendar event descriptions.
// Google Calendar only allows a small set of formatting tags. We parse the
// input with a tiny tokenizer and re-emit only an explicit allow-list of
// tags/attributes, escaping everything else. The resulting string is safe to
// render with dangerouslySetInnerHTML.

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "br",
  "hr",
  "p",
  "ul",
  "ol",
  "li",
  "span",
  "div",
]);

const VOID_TAGS = new Set(["br", "hr"]);

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function sanitizeHref(raw: string): string | null {
  const v = raw.trim();
  // Strip control chars that could confuse the URL parser.
  // eslint-disable-next-line no-control-regex
  const cleaned = v.replace(/[\u0000-\u001f\u007f]/g, "");
  if (/^(https?:|mailto:)/i.test(cleaned)) return cleaned;
  return null;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

export function sanitizeDescriptionHtml(input: string): string {
  if (!input) return "";

  let out = "";
  let i = 0;
  const stack: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  tagRe.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(input))) {
    if (match.index > i) {
      out += escapeText(input.slice(i, match.index));
    }
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    const rest = match[3] ?? "";

    if (!ALLOWED_TAGS.has(name)) {
      // Drop the tag entirely (don't escape it — Google often includes
      // wrapper <html>/<body> noise; emitting &lt;html&gt; would be ugly).
      i = tagRe.lastIndex;
      continue;
    }

    if (closing) {
      if (VOID_TAGS.has(name)) {
        // Ignore stray closing tags for void elements.
      } else {
        // Close only if we have a matching open tag on the stack.
        const idx = stack.lastIndexOf(name);
        if (idx !== -1) {
          // Close any tags opened after it too, to keep nesting valid.
          while (stack.length > idx) {
            const t = stack.pop()!;
            out += `</${t}>`;
          }
        }
      }
    } else if (name === "a") {
      const attrs = parseAttrs(rest);
      const href = attrs.href ? sanitizeHref(attrs.href) : null;
      if (href) {
        out += `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`;
        stack.push("a");
      } else {
        // Anchor without a safe href: render as plain span so inner text survives.
        out += "<span>";
        stack.push("span");
      }
    } else if (VOID_TAGS.has(name)) {
      out += `<${name} />`;
    } else {
      out += `<${name}>`;
      stack.push(name);
    }

    i = tagRe.lastIndex;
  }

  if (i < input.length) {
    out += escapeText(input.slice(i));
  }

  // Close anything still open.
  while (stack.length) {
    out += `</${stack.pop()}>`;
  }

  return out;
}
