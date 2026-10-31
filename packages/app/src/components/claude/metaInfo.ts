/**
 * Readers for `CvMeta`, including the fields the daemon adds from the statusline payload
 * (A2 §3: real context window, cost, fast mode, queue, running tasks). Older daemons do not
 * send them; every reader falls back. Pure so it can be tested.
 */
import type { CvMeta } from "@neuralagent/protocol";

/** `CvMeta` with the statusline fields (all optional until the daemon sends them). */
export type MetaX = CvMeta & {
  context_window?: number | null;
  context_pct?: number | null;
  cost_usd?: number | null;
  duration_ms?: number | null;
  api_duration_ms?: number | null;
  lines_added?: number | null;
  lines_removed?: number | null;
  fast?: boolean | null;
  thinking?: boolean | null;
  output_style?: string | null;
  session_name?: string | null;
  version?: string | null;
  plan_file?: string | null;
  queued?: ({ text: string; ts?: number } | string)[] | null;
  tasks_running?: number | null;
  busy?: boolean | null;
};

/** Context window of a model id, when the statusline has not told us. */
export const guessWindow = (model?: string | null) => (/\[1m\]|1m/i.test(model ?? "") ? 1_000_000 : 200_000);

export interface ContextInfo {
  tokens: number;
  window: number;
  /** 0 to 100. */
  pct: number;
  /** The window size came from Claude Code itself (not guessed from the model name). */
  exact: boolean;
}

export function contextOf(meta: CvMeta): ContextInfo | null {
  const m = meta as MetaX;
  const window = m.context_window && m.context_window > 0 ? m.context_window : guessWindow(m.model);
  const tokens = m.context_tokens ?? 0;
  const raw = typeof m.context_pct === "number" ? m.context_pct : tokens ? (tokens / window) * 100 : 0;
  if (!raw && !tokens) return null;
  const pct = Math.max(0, Math.min(100, Math.round(raw)));
  return { tokens: tokens || Math.round((window * raw) / 100), window, pct, exact: !!m.context_window };
}

/** "184k", "1.2M", "950". */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** "$0.42", "$12.30", "<$0.01". */
export function money(usd?: number | null): string | null {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return null;
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** "45s", "12m", "1h 20m". */
export function span(ms?: number | null): string | null {
  if (typeof ms !== "number" || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const tasksRunning = (meta: CvMeta) => Math.max(0, (meta as MetaX).tasks_running ?? 0);
export const fastOf = (meta: CvMeta): boolean | null => (meta as MetaX).fast ?? null;
export const queuedOf = (meta: CvMeta) => (meta as MetaX).queued;
