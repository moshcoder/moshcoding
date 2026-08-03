function previousNonWhitespace(value: string, from: number): string | null {
  for (let index = from; index >= 0; index--) {
    if (!/\s/.test(value[index])) return value[index];
  }
  return null;
}

function nextNonWhitespace(value: string, from: number): string | null {
  for (let index = from; index < value.length; index++) {
    if (!/\s/.test(value[index])) return value[index];
  }
  return null;
}

const MAX_PRETTY_DEPTH = 32;
const MAX_FORMATTED_LENGTH = 64 * 1024;

/** Pretty-print valid JSON without reparsing number literals into JavaScript numbers. */
export function formatStoredWebhookPayload(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  try {
    JSON.parse(raw);
  } catch {
    return raw;
  }

  let formatted = "";
  let indent = 0;
  let inString = false;
  let escaped = false;
  const pad = () => "  ".repeat(indent);
  const outputLimit = Math.min(MAX_FORMATTED_LENGTH, Math.max(4096, raw.length * 4));
  const append = (text: string): boolean => {
    formatted += text;
    return formatted.length <= outputLimit;
  };

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (inString) {
      if (!append(char)) return raw;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      if (!append(char)) return raw;
    } else if (char === "{" || char === "[") {
      if (!append(char)) return raw;
      indent++;
      if (indent > MAX_PRETTY_DEPTH) return raw;
      const closing = char === "{" ? "}" : "]";
      if (nextNonWhitespace(raw, index + 1) !== closing && !append(`\n${pad()}`)) return raw;
    } else if (char === "}" || char === "]") {
      indent--;
      const opening = char === "}" ? "{" : "[";
      if (previousNonWhitespace(raw, index - 1) !== opening && !append(`\n${pad()}`)) return raw;
      if (!append(char)) return raw;
    } else if (char === ",") {
      if (!append(`,\n${pad()}`)) return raw;
    } else if (char === ":") {
      if (!append(": ")) return raw;
    } else if (!/\s/.test(char)) {
      if (!append(char)) return raw;
    }
  }

  return formatted;
}
