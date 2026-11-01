import { Avatar, Button, Callout, ConfirmButton, Pill, Row, SearchField, Segmented, Spinner, Switch, toast } from "@neuralagent/ui";
import { Ban, ChevronDown, Monitor, RotateCcw, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Device, type Report, type User } from "./api";
import { countryTag } from "./countries";
import type { Tab } from "./Dashboard";
import { ago, bytes } from "./format";
import type { Polled } from "./hooks";
import { statusPill, useAction } from "./Requests";

export function Devices({ userId, onChange }: { userId: string; onChange?: () => Promise<void> }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.devices(userId).then(setDevices, (e) => setError((e as Error).message));
  useEffect(() => void load(), [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Callout tone="danger">{error}</Callout>;
  if (!devices) return <div className="p-3"><Spinner label="Loading devices" /></div>;
  if (devices.length === 0) return <p className="px-3.5 py-3 text-detail text-dim">No devices.</p>;
  return (
    <div className="bg-fill-1">
      {devices.map((d) => (
        <Row
          key={d.id}
          wrap
          Icon={d.platform === "ios" || d.platform === "android" ? Smartphone : Monitor}
          title={
            <span className="flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${d.online ? "bg-success" : "bg-fill-4"}`} role="img" aria-label={d.online ? "online" : "offline"} />
              <span className="truncate">{d.name}</span>
            </span>
          }
          detail={[
            d.platform,
            d.kind,
            d.version && `v${d.version}`,
            d.os,
            countryTag(d.country),
            `${bytes(d.bytes ?? 0)} traffic`,
            d.online ? "online" : `seen ${ago(d.last_seen)}`,
          ].filter(Boolean).join(" · ")}
          trailing={
            <ConfirmButton
              size="sm"
              label="Remove"
              doneLabel="Removed"
              onConfirm={async () => {
                try {
                  await api.deleteDevice(d.id);
                  await load();
                  await onChange?.();
                } catch (e) {
                  toast((e as Error).message, { tone: "danger" });
                }
              }}
            />
          }
        />
      ))}
    </div>
  );
}

type Filter = "all" | User["status"];

export function Users({ users, reports, me, go }: { users: Polled<User[]>; reports: Report[]; me: string; go: (t: Tab, sub?: string) => void }) {
  const { busy, run } = useAction(users.reload);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  if (users.error && !users.data) return <Callout tone="danger" title="Could not load users">{users.error}</Callout>;
  if (!users.data) return <div className="flex justify-center py-10"><Spinner label="Loading users" /></div>;

  const needle = q.trim().toLowerCase();
  const rows = users.data.filter(
    (u) => (filter === "all" || u.status === filter) && (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField className="flex-1" value={q} onChange={setQ} placeholder="Search name or email" />
        <div className="min-w-0 overflow-x-auto">
          <Segmented
            scroll
            size="sm"
            label="Status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "approved", label: "Approved" },
              { value: "pending", label: "Pending" },
              { value: "blocked", label: "Blocked" },
              { value: "denied", label: "Denied" },
            ]}
          />
        </div>
      </div>
      {rows.length === 0 && <p className="px-1 text-detail text-dim">No users match.</p>}
      <div className="surface list-rows overflow-hidden rounded-list">
        {rows.map((u) => {
          const mine = reports.filter((r) => r.user_id === u.id);
          return (
            <div key={u.id}>
              <Row
                wrap
                onClick={() => setOpen(open === u.id ? null : u.id)}
                leading={<Avatar name={u.name || u.email} src={u.avatar ?? undefined} size={32} />}
                title={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate">{u.name || u.email}</span>
                    {statusPill(u.status)}
                    {u.is_admin && <Pill size="sm" tone="accent">admin</Pill>}
                    {u.id === me && <Pill size="sm">you</Pill>}
                  </span>
                }
                detail={`${u.email} · ${countryTag(u.country)} · ${(u.platforms ?? []).join(", ") || "no platform"} · ${u.devices} devices (${u.online} online) · ${bytes(u.bytes)} · seen ${ago(u.last_seen)}`}
                trailing={<ChevronDown size={16} className={open === u.id ? "rotate-180" : ""} />}
              />
              {open === u.id && (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-fill-1 px-3.5 py-3">
                    <label className="flex items-center gap-2 text-detail text-dim">
                      <Switch
                        label="Remote access"
                        checked={u.remote}
                        disabled={busy === `remote${u.id}`}
                        onChange={(v) => void run(`remote${u.id}`, () => api.userAction(u.id, v ? "remote_on" : "remote_off"))}
                      />
                      Remote access
                    </label>
                    {u.status === "blocked" ? (
                      <Button size="sm" variant="glass" Icon={RotateCcw} busy={busy === `block${u.id}`} onClick={() => void run(`block${u.id}`, () => api.userAction(u.id, "unblock"), "Unblocked")}>Unblock</Button>
                    ) : (
                      <Button size="sm" variant="glass" Icon={Ban} busy={busy === `block${u.id}`} onClick={() => void run(`block${u.id}`, () => api.userAction(u.id, "block"), "Blocked")}>Block</Button>
                    )}
                    <ConfirmButton size="sm" label="Delete user" doneLabel="Deleted" onConfirm={() => run(`del${u.id}`, () => api.deleteUser(u.id))} />
                  </div>
                  <Devices userId={u.id} onChange={users.reload} />
                  <div className="bg-fill-1 px-3.5 py-3">
                    <h4 className="text-footnote text-dim">Reports ({mine.length})</h4>
                    {mine.length === 0 ? (
                      <p className="mt-1 text-detail text-faint">None.</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1">
                        {mine.map((r) => (
                          <li key={r.id}>
                            <button type="button" className="text-left text-detail text-accent hover:underline" onClick={() => go("reports", r.id)}>
                              {r.id} · {r.summary || "(no summary)"} · {r.status} · {ago(r.created_at)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
