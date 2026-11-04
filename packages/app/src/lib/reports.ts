// "Your reports" (D91): the signed-in account's own problem reports with the answers they got.
// The daemon fetches them from the relay (`GET /api/me/reports`). Request `reports_mine`
// (no params) needs the daemon feature "reports_mine"; an older daemon is never asked.
import type { DaemonClient } from "@neuralagent/protocol";

export interface ReportAnswer {
  /** Unix seconds. */
  at: number;
  text: string;
}

export interface MyReport {
  id: string;
  created_at: number;
  updated_at: number;
  status: "open" | "seen" | "solved";
  summary: string;
  answers: ReportAnswer[];
}

/** The daemon understands `reports_mine`. */
export const reportsSupported = (c: Pick<DaemonClient, "has">) => c.has("reports_mine");

/** Own reports, newest first. */
export async function reportsMine(client: Pick<DaemonClient, "req">): Promise<MyReport[]> {
  // `reports_mine` is not in the generated Request type until the protocol adds it.
  const r = await client.req<{ reports: MyReport[] }>({ m: "reports_mine" } as never);
  return r.reports ?? [];
}

/** "3 Nov 2026" from unix seconds. */
export function reportDate(at: number): string {
  return new Date(at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
