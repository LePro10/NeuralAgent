import { Avatar, Button, Callout, Empty, List, Pill, Row, Spinner, toast } from "@neuralagent/ui";
import { Check, Inbox, X } from "lucide-react";
import { useState } from "react";
import { api, type User } from "./api";
import { ago } from "./format";
import type { Polled } from "./hooks";

/** Runs a user action, reloads the list and reports errors as a toast. */
export function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  return {
    busy,
    run: async (key: string, fn: () => Promise<unknown>, done?: string) => {
      setBusy(key);
      try {
        await fn();
        if (done) toast(done);
        await reload();
      } catch (e) {
        toast((e as Error).message, { tone: "danger" });
      } finally {
        setBusy(null);
      }
    },
  };
}

export function Requests({ users }: { users: Polled<User[]> }) {
  const { busy, run } = useAction(users.reload);
  if (users.error && !users.data) return <Callout tone="danger" title="Could not load requests">{users.error}</Callout>;
  if (!users.data) return <div className="flex justify-center py-10"><Spinner label="Loading requests" /></div>;
  const pending = users.data.filter((u) => u.status === "pending").sort((a, b) => a.created_at - b.created_at);
  if (pending.length === 0) return <Empty Icon={Inbox} title="No open requests" detail="New access requests show up here." />;

  return (
    <List label={`Access requests · ${pending.length}`}>
      {pending.map((u) => (
        <Row
          key={u.id}
          wrap
          leading={<Avatar name={u.name || u.email} src={u.avatar ?? undefined} size={32} />}
          title={u.name || u.email}
          detail={
            <span className="flex flex-col gap-1">
              <span>{u.email} · {u.provider} · requested {ago(u.created_at)}</span>
              {u.message && <span className="text-ink">&ldquo;{u.message}&rdquo;</span>}
            </span>
          }
          trailing={
            <span className="flex gap-1.5">
              <Button size="sm" variant="danger" Icon={X} busy={busy === `deny${u.id}`} onClick={() => void run(`deny${u.id}`, () => api.userAction(u.id, "deny"), "Denied")}>Deny</Button>
              <Button size="sm" Icon={Check} busy={busy === `approve${u.id}`} onClick={() => void run(`approve${u.id}`, () => api.userAction(u.id, "approve"), "Approved")}>Approve</Button>
            </span>
          }
        />
      ))}
    </List>
  );
}

export const statusPill = (s: User["status"]) => (
  <Pill size="sm" tone={s === "approved" ? "success" : s === "pending" ? "warning" : "danger"}>{s}</Pill>
);
