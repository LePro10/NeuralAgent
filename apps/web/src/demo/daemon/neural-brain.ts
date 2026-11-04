// What a visitor means when they write to Neural. Pure (text and the project names in, an intent
// out), so it is tested without a world. neural.ts turns an intent into messages, actions and state.
//
// Neural never pretends to know more than the demo does: what it does not understand gets one honest
// line about what it can do, followed by the live summary of the agents.

export type Mode = "active" | "quiet" | "off";

export type NeuralIntent =
  | { k: "greeting" }
  | { k: "thanks" }
  | { k: "help" }
  | { k: "status" }
  | { k: "waiting" }
  | { k: "catchup" }
  | { k: "approve" }
  | { k: "deny" }
  | { k: "start"; engine: string | null; project: string | null; task: string }
  | { k: "stop"; engine: string | null; project: string | null }
  | { k: "summarise"; project: string | null }
  | { k: "tests"; project: string | null }
  | { k: "remember"; note: string }
  | { k: "forget" }
  | { k: "mode"; mode: Mode }
  | { k: "unknown" };

const ENGINES: [string, RegExp][] = [
  ["claude", /\bclaude\b/],
  ["codex", /\bcodex\b/],
  ["opencode", /\bopen ?code\b/],
  ["gemini", /\bgemini\b/],
];

const has = (t: string, re: RegExp) => re.test(t);

export function engineOf(t: string): string | null {
  return ENGINES.find(([, re]) => re.test(t.toLowerCase()))?.[0] ?? null;
}

/** The project a sentence is about: "billing-api", "billing api", or its first word on its own. */
export function projectOf(t: string, projects: string[]): string | null {
  const low = t.toLowerCase();
  for (const p of projects) if (low.includes(p.toLowerCase()) || low.includes(p.toLowerCase().replace(/-/g, " "))) return p;
  // A word of the name on its own ("the shop", "docs"), when only one project has it.
  const hits = projects.filter((p) => p.toLowerCase().split("-").some((seg) => seg.length > 3 && new RegExp(`\\b${seg}s?\\b`).test(low)));
  if (hits.length === 1) return hits[0]!;
  return null;
}

/** What to ask the agent: the words after "to" or a colon, if there are any. */
export function taskOf(raw: string): string {
  const m = raw.match(/\b(?:to|so that|and)\s+(?!start\b)(\w[\s\S]+)$/i) ?? raw.match(/:\s*([\s\S]+)$/);
  const task = m?.[1]?.trim().replace(/[.?!]+$/, "") ?? "";
  return task && task.split(/\s+/).length >= 2 ? task[0]!.toUpperCase() + task.slice(1) + "." : "";
}

export function matchNeural(raw: string, projects: string[]): NeuralIntent {
  const text = raw.trim();
  if (!text) return { k: "unknown" };
  const t = text.toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ");
  const words = t.split(/\W+/).filter(Boolean).length;
  const engine = engineOf(t);
  const project = projectOf(t, projects);

  if (has(t, /^(hi|hello|hey|hallo|moin|yo|good (morning|afternoon|evening))\b/) && words <= 4) return { k: "greeting" };
  if (has(t, /^(thanks|thank you|thx|cheers|great|perfect|nice|ok|okay|cool)\b/) && words <= 5) return { k: "thanks" };
  if (has(t, /^(help|\?|what can you do|what can i (do|ask)|how do i use|commands)\b/) && words <= 9) return { k: "help" };

  if (has(t, /\b(catch me up|while i was away|what did i miss|what happened)\b/)) return { k: "catchup" };
  if (has(t, /^(approve|allow|go ahead|do it|yes|yep|yes please|approve it|let it)\b/) && words <= 6) return { k: "approve" };
  if (has(t, /\b(approve|allow) (it|that|them|the)\b/)) return { k: "approve" };
  if (has(t, /^(deny|reject|no|nope|don'?t)\b/) && words <= 6) return { k: "deny" };

  if (has(t, /\b(remember|note that|keep in mind|don'?t forget)\b/)) return { k: "remember", note: text.replace(/^.*?\b(remember|note that|keep in mind|don'?t forget)\b(?: that)?[:,]?\s*/i, "").trim() };
  if (has(t, /\bforget\b/)) return { k: "forget" };

  if (has(t, /\b(be quiet|stay quiet|go quiet|quiet mode|mute|pause|stop talking|don'?t interrupt)\b/)) return { k: "mode", mode: "quiet" };
  if (has(t, /\b(turn (yourself )?off|switch (yourself )?off|disable (yourself|neural))\b/)) return { k: "mode", mode: "off" };
  if (has(t, /\b(on its own|go active|speak up|be active|resume|talk to me again)\b/)) return { k: "mode", mode: "active" };


  if (has(t, /\b(stop|cancel|kill|interrupt|halt|abort)\b/)) return { k: "stop", engine, project };
  if (has(t, /\b(run|rerun|re-run|execute)\b.*\b(tests?|suite)\b/) || has(t, /\bare the tests (passing|green|failing)\b/)) return { k: "tests", project };
  if (has(t, /\b(summari[sz]e|summary of|overview of|tell me about|give me an overview|what('| i)?s (new|up) (in|with)|status of|how is)\b/) && (project || has(t, /\bproject\b/))) return { k: "summarise", project };

  if (has(t, /\b(waiting|needs? me|blocked|permission|stuck|asking me)\b/) && !has(t, /\bstart\b/)) return { k: "waiting" };
  if (has(t, /\b(start|launch|spawn|kick off|fire up|open)\b/) && (engine || has(t, /\b(agent|session)\b/))) return { k: "start", engine, project, task: taskOf(text) };
  if (has(t, /\b(ask|tell|have|get|let)\b/) && engine) return { k: "start", engine, project, task: taskOf(text) };

  if (has(t, /\b(what|which|who|how)\b.*\b(agents?|doing|going on|happening|working|busy|idle|status|up to)\b/) || has(t, /^(status|update|summary|overview)\b/) || has(t, /\bgoing on\b/)) return { k: "status" };
  if (project && words <= 6) return { k: "summarise", project };
  return { k: "unknown" };
}
