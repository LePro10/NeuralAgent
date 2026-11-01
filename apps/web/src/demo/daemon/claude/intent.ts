// What a visitor means when they type into a demo agent. Pure: text in, an intent out, so it can be
// tested without a world. The skills (skills.ts) turn an intent into the steps the agent plays.
//
// The demo never pretends to understand everything: an unknown request is answered with what the
// demo can do (a question with chips), not with a guess dressed up as work.

export type Topic = "signature" | "money" | "refund" | "retry" | "schema" | "health" | "cart" | "products" | "docs" | "config";
export type Recipe = "log-webhooks" | "health-db" | "cart-max";
export type TestRecipe = "money-rounding" | "health";

export type Intent =
  | { k: "slash"; name: string; args: string }
  | { k: "shell"; cmd: string }
  | { k: "greeting" }
  | { k: "thanks" }
  | { k: "help" }
  | { k: "tests" }
  | { k: "writeTests"; recipe: TestRecipe | null }
  | { k: "explain"; topic: Topic | null }
  | { k: "explore" }
  | { k: "review" }
  | { k: "commit" }
  | { k: "background" }
  | { k: "plan"; recipe: Recipe | null }
  | { k: "change"; recipe: Recipe | null }
  | { k: "unknown" };

const has = (t: string, re: RegExp) => re.test(t);

/** The topic of a question about the code, if the demo project has something to say about it. */
export function topicOf(t: string): Topic | null {
  if (has(t, /\b(signature|hmac|x-signature|verify|verification|signed|secret)\b/)) return "signature";
  if (has(t, /\b(retry|retries|backoff|dead.?letter|webhook_dead|give up)\b/)) return "retry";
  if (has(t, /\b(refund|refunds|over-?refund)\b/)) return "refund";
  if (has(t, /\b(money|minor units?|cents?|currency|float|rounding|format ?money|tominor)\b/)) return "money";
  if (has(t, /\b(schema|table|tables|database|db|sql|postgres)\b/)) return "schema";
  if (has(t, /\b(health|healthcheck|health check|liveness)\b/)) return "health";
  if (has(t, /\b(cart|quantity|basket|line items?)\b/)) return "cart";
  if (has(t, /\b(product|products|catalog)\b/)) return "products";
  if (has(t, /\b(docs?|documentation|guide|getting started|readme|pages?)\b/)) return "docs";
  if (has(t, /\b(config\w*|settings?|env|environment|dotenv)\b/)) return "config";
  return null;
}

function recipeOf(t: string): Recipe | null {
  if (has(t, /\b(log|logs|logging)\b/) && has(t, /\b(webhook|webhooks|event|events|handler)\b/)) return "log-webhooks";
  if (has(t, /\bhealth\b/) && has(t, /\b(db|database|postgres)\b/)) return "health-db";
  if (has(t, /\b(max|maximum|upper limit|cap|limit)\b/) && has(t, /\b(quantity|cart)\b/)) return "cart-max";
  return null;
}

function testRecipeOf(t: string): TestRecipe | null {
  if (has(t, /\b(money|rounding|minor|cents?)\b/)) return "money-rounding";
  if (has(t, /\bhealth\b/)) return "health";
  return null;
}

/** The first meaningful reading of `raw`. `mode` is the permission mode of the session (`plan` turns changes into plans). */
export function matchIntent(raw: string, mode = "default"): Intent {
  const text = raw.trim();
  if (!text) return { k: "unknown" };
  if (text.startsWith("/")) {
    const [name = "", ...rest] = text.slice(1).split(/\s+/);
    return { k: "slash", name: name.toLowerCase(), args: rest.join(" ") };
  }
  if (text.startsWith("!")) return { k: "shell", cmd: text.slice(1).trim() };
  const t = text.toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ");
  const words = t.split(/\W+/).filter(Boolean).length;

  if (has(t, /^(hi|hello|hey|hallo|moin|yo|good (morning|afternoon|evening))\b/) && words <= 4) return { k: "greeting" };
  if (has(t, /^(thanks|thank you|thx|cheers|great|perfect|nice|ok|okay|cool)\b/) && words <= 5) return { k: "thanks" };
  if (has(t, /^(help|\?|what can you do|what can i (do|ask)|how do i use (this|you)|commands)\b/) && words <= 8) return { k: "help" };

  if (has(t, /\b(commit)\b/) && !has(t, /\b(explain|what|why|how)\b/)) return { k: "commit" };
  if (has(t, /\b(review|code review|look over)\b/) && has(t, /\b(change|changes|diff|branch|work|code|pr)\b/)) return { k: "review" };
  if (has(t, /\b(dev server|watch mode|in the background|background)\b/) || has(t, /\bstart (the )?(server|app)\b/) || has(t, /^(pnpm|npm) (run )?dev\b/)) return { k: "background" };
  if (has(t, /\b(explore|investigate|audit|survey|in parallel|subagents?|sub-agents?|across the (repo|codebase|project)|everywhere|find all)\b/)) return { k: "explore" };

  if (has(t, /\b(write|add|create)\b.*\b(test|tests|spec)\b/) || has(t, /\btests? for\b/)) return { k: "writeTests", recipe: testRecipeOf(t) };
  if (has(t, /\b(run|rerun|re-run|execute)\b.*\b(tests?|suite|vitest)\b/) || has(t, /^(pnpm|npm)( run)? test\b/) || has(t, /^tests?\??$/) || has(t, /\b(are|do|does) (the )?tests? (pass|passing|green|fail|failing)\b/)) return { k: "tests" };

  if (has(t, /\b(plan|approach|strategy|design)\b/) && has(t, /\b(make|write|draft|propose|give me|think|first|before)\b/)) return { k: "plan", recipe: recipeOf(t) };

  if (has(t, /^(explain|walk me through|describe|summari[sz]e|tell me|show me)\b/) || has(t, /^(how|what|why|where|which|when|who)\b/) || has(t, /\?$/)) {
    return { k: "explain", topic: topicOf(t) };
  }

  const recipe = recipeOf(t);
  if (has(t, /^(add|fix|change|implement|make|update|refactor|rename|remove|delete|write|create|build|improve|set|use|put|log|wire|handle|support)\b/) || recipe) {
    if (mode === "plan") return { k: "plan", recipe };
    return { k: "change", recipe };
  }
  const topic = topicOf(t);
  if (topic && words <= 8) return { k: "explain", topic };
  return { k: "unknown" };
}
