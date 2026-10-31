// Readable status lines for agent rows (Agents inbox, Neural, the dashboard): a failed agent says
// *why* in a few words ("Claude is overloaded right now") instead of a raw terminal line such as
// "…/neuralagentd hook StopFailure". The raw text is kept as the detail, so nothing is hidden.

const HOOKS = ["Stop", "StopFailure", "Notification", "PermissionRequest", "PreToolUse", "PostToolUse", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "UserPromptSubmit", "PreCompact"];

/** Terminal lines that say nothing to a person: hook calls, shell echo plumbing, bare paths. */
export function isNoiseLine(line: string | null | undefined): boolean {
  const t = (line ?? "").trim();
  if (!t) return true;
  if (/\bneuralagentd(\.exe)?\s+hook\b/.test(t) || new RegExp(`\\bhook\\s+(${HOOKS.join("|")})\\b`).test(t)) return true;
  // The wrapped tail of a hook call ("ptSubmit" from "… hook UserPromptSubmit").
  if (/^[a-z][A-Za-z]{2,}$/.test(t) && HOOKS.some((h) => h.endsWith(t))) return true;
  if (/^echo\s+['"]?\{/.test(t) || /\|\s*\S*neuralagentd/.test(t)) return true;
  if (/^[$%#❯›>]\s/.test(t)) return true;
  // Mostly one long path (a cut-off command line).
  const path = /(?:^|\s)(?:~|\.{0,2})?\/[^\s]{12,}/.exec(t);
  if (path && path[0].trim().length > t.length * 0.5) return true;
  return false;
}

const RULES: [RegExp, string][] = [
  [/overloaded|\b529\b/i, "Claude is overloaded right now"],
  [/\b401\b|unauthori[sz]ed|invalid (x-)?api[ -]?key|authentication[_ ]error|not logged in|please run \/login|oauth token (has )?expired/i, "Not signed in: log in to the agent again"],
  [/credit balance|billing|payment required|\b402\b/i, "Out of credit on the agent's account"],
  [/prompt is too long|context (length|window)|too many tokens|max(imum)? context/i, "The conversation is too long: compact it or start fresh"],
  [/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|fetch failed|network error|getaddrinfo|socket hang up/i, "No connection to the model"],
  [/\b(500|502|503|504)\b|internal server error|bad gateway|service unavailable/i, "The model service had an error"],
  [/command not found|no such file or directory|ENOENT/i, "The agent's program was not found"],
];

/** The whole text when short, else its first sentence, at most `max` characters. */
function short(t: string, max = 110): string {
  const one = t.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const dot = /^(.{12,}?[.!?])\s/.exec(one);
  const s = dot ? dot[1]! : one;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** A JSON error body's message ('API Error: 529 {"error":{"message":"Overloaded"}}' → "Overloaded"). */
function jsonMessage(t: string): string | null {
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(t);
  return m ? m[1]!.replace(/\\(.)/g, "$1") : null;
}

/**
 * A failure in plain words. `text` is short and readable; `detail` is the raw text when it says
 * more (shown on tap). Empty input gives the generic "Stopped with an error".
 */
export function humanError(raw: string | null | undefined): { text: string; detail?: string } {
  const r = (raw ?? "").trim();
  if (!r || isNoiseLine(r)) return { text: "Stopped with an error", detail: r || undefined };
  for (const [re, text] of RULES) if (re.test(r)) return { text, detail: r };
  const exit = /exit(?:ed)?(?: with)?(?: code| status)?\s*:?\s*(-?\d+)/i.exec(r);
  if (exit && r.length > 60) return { text: `Stopped with exit code ${exit[1]}`, detail: r };
  const msg = jsonMessage(r);
  const text = short(msg ?? (r.replace(/^(api )?error:\s*(\d{3}\s*)?/i, "") || r));
  return { text, detail: text === r ? undefined : r };
}
