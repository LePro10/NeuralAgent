import type { AuditEntry, RemoteDevice, RemotePairCode, RemoteState } from "@neuralagent/protocol";
import { Avatar, Button, Callout, ConfirmSheet, Field, List, Page, Pill, Row, Spinner, Switch, TextArea, toast } from "@neuralagent/ui";
import { Bot, Globe, KeyRound, LogOut, Monitor, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useClient, useDaemon, usePlatform } from "../lib/store";
import { ago } from "../lib/time";

/** Remote access: invite-only sign-in, then this computer's devices and "Add phone". */
export function RemotePage() {
  const remote = useDaemon((c) => c.state?.remote);
  if (!remote) return null;
  return (
    <Page title="Remote" eyebrow="NeuralAgent">
      <div className="flex flex-col gap-6 pb-8">{remote.status === "signed_out" ? <SignIn remote={remote} /> : <Account remote={remote} />}</div>
    </Page>
  );
}

interface Ask {
  title: string;
  message: string;
  label: string;
  run: () => Promise<unknown>;
}

/** Destructive steps ask first, in an iOS confirmation sheet. */
function useAsk(): [(a: Ask) => void, ReactNode] {
  const [ask, setAsk] = useState<Ask | null>(null);
  const node = (
    <ConfirmSheet
      open={!!ask}
      onClose={() => setAsk(null)}
      onConfirm={async () => {
        await ask?.run();
      }}
      title={ask?.title ?? ""}
      message={ask?.message}
      confirmLabel={ask?.label ?? "OK"}
      destructive
    />
  );
  return [setAsk, node];
}

function useAct() {
  const client = useClient();
  return async <T,>(req: Parameters<typeof client.req>[0]): Promise<T | undefined> => {
    try {
      return (await client.req(req)) as T;
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
      return undefined;
    }
  };
}

function SignIn({ remote }: { remote: RemoteState }) {
  const act = useAct();
  const platform = usePlatform();
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const start = async (provider: "google" | "github") => {
    const r = await act<{ url: string }>({ m: "remote_sign_in", p: { provider, message: message.trim() || undefined } });
    if (!r) return;
    platform.openExternal(r.url);
    setWaiting(true);
  };
  return (
    <>
      <Callout Icon={ShieldCheck} title="Use your agents from your phone">
        Remote access is invite-only. Sign in to ask for it; once approved, your phone and any browser signed in to the same account can see and steer the agents on this computer. Everything between
        them is end-to-end encrypted: the relay only passes sealed messages along.
      </Callout>
      {remote.error && <Callout tone="warning">{remote.error}</Callout>}
      <List label="Request access" footer="Signing in opens your browser. Nothing on this computer changes until you are approved.">
        <div className="flex flex-col gap-3 p-3.5">
          <Field label="Why do you want access? (optional)">
            <TextArea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} rows={2} placeholder="A sentence helps us say yes." />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button Icon={Globe} onClick={() => void start("google")}>
              Continue with Google
            </Button>
            <Button Icon={KeyRound} variant="glass" onClick={() => void start("github")}>
              Continue with GitHub
            </Button>
          </div>
          {waiting && (
            <div className="flex items-center gap-2 text-meta text-dim">
              <Spinner size={14} /> Finish signing in in your browser…
            </div>
          )}
        </div>
      </List>
    </>
  );
}

const STATUS: Record<RemoteState["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  signed_out: { label: "Signed out", tone: "neutral" },
  pending: { label: "Waiting for approval", tone: "warning" },
  denied: { label: "Not approved", tone: "danger" },
  blocked: { label: "Blocked", tone: "danger" },
  off: { label: "Off", tone: "neutral" },
  connecting: { label: "Connecting", tone: "neutral" },
  online: { label: "Online", tone: "success" },
  offline: { label: "Relay unreachable", tone: "warning" },
};

function Account({ remote }: { remote: RemoteState }) {
  const act = useAct();
  const [ask, asking] = useAsk();
  const approved = !["pending", "denied", "blocked"].includes(remote.status);
  const s = STATUS[remote.status];
  return (
    <>
      <div className="surface flex flex-col items-center gap-2 rounded-list px-4 pt-6 pb-5 text-center">
        <Avatar name={remote.account?.name || remote.account?.email || "?"} src={remote.account?.avatar} size={64} />
        <div className="mt-1 text-title-3 text-bright">{remote.account?.name || "Signed in"}</div>
        {remote.account?.email && <div className="-mt-1.5 text-subhead text-dim">{remote.account.email}</div>}
        <Pill tone={s.tone} dot>
          {s.label}
        </Pill>
      </div>
      <List>
        {approved && (
          <Row
            Icon={Smartphone}
            tile="blue"
            title="Remote access"
            detail={remote.paused ? "Disconnected on this computer" : "Phones and browsers can reach this computer"}
            trailing={<Switch label="Remote access" checked={!remote.paused} onChange={(enabled) => void act({ m: "remote_enable", p: { enabled } })} />}
          />
        )}
      </List>

      {remote.status === "pending" && (
        <Callout tone="warning" title="Waiting for approval">
          Your request was sent. You'll get an email, and this page unlocks by itself, as soon as it is approved.
        </Callout>
      )}
      {remote.status === "denied" && (
        <Callout tone="danger" title="Not approved">
          This request was not approved. NeuralAgent keeps working on this computer as before.
        </Callout>
      )}
      {remote.status === "blocked" && (
        <Callout tone="danger" title="Blocked">
          This account can't use remote access.
        </Callout>
      )}
      {remote.error && approved && <Callout tone="warning">{remote.error}</Callout>}

      {approved && <AddPhone disabled={remote.status !== "online"} />}
      {approved && remote.devices.length > 0 && <Devices devices={remote.devices} />}
      {approved && <Activity />}

      <List label="Security" footer="Compare this code with the one shown when a phone connects for the first time.">
        {remote.fingerprint && <Row Icon={KeyRound} tile="gray" title="This computer's key" value={<span className="font-mono">{remote.fingerprint}</span>} />}
      </List>
      <List>
        <Row
          Icon={LogOut}
          danger
          title="Sign out on this computer"
          onClick={() =>
            ask({ title: "Sign out on this computer?", message: "Phones and browsers can no longer reach it until you sign in again.", label: "Sign out", run: () => act({ m: "remote_sign_out" }) })
          }
        />
        {approved && (
          <Row
            Icon={LogOut}
            danger
            title="Sign out everywhere"
            onClick={() =>
              ask({
                title: "Sign out everywhere?",
                message: "Every phone, browser and computer of this account has to sign in again.",
                label: "Sign out all",
                run: () => act({ m: "remote_sign_out_everywhere" }),
              })
            }
          />
        )}
      </List>
      {asking}
    </>
  );
}

function AddPhone({ disabled }: { disabled: boolean }) {
  const act = useAct();
  const [code, setCode] = useState<{ pair: RemotePairCode; until: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);
  const left = code ? Math.max(0, Math.round((code.until - now) / 1000)) : 0;
  const create = async () => {
    const pair = await act<RemotePairCode>({ m: "remote_pair" });
    if (pair) {
      setNow(Date.now());
      setCode({ pair, until: Date.now() + pair.expires_in * 1000 });
    }
  };
  return (
    <List label="Add phone" footer="The code works once, for two minutes, and only for this account. Or sign in on the phone with the same account.">
      {code && left > 0 ? (
        <div className="flex flex-col items-center gap-3 p-4">
          {/* The daemon renders the QR (black on white, readable in any theme). */}
          <div className="w-60 overflow-hidden rounded-tile" dangerouslySetInnerHTML={{ __html: code.pair.svg }} />
          <p className="text-meta text-dim">Scan with your phone's camera · {left}s left</p>
          <Button size="sm" variant="quiet" onClick={() => setCode(null)}>
            Done
          </Button>
        </div>
      ) : (
        <Row
          Icon={QrCode}
          title="Show a code to scan"
          detail={code ? "That code expired." : disabled ? "Available while remote access is online." : undefined}
          trailing={
            <Button size="sm" variant="glass" disabled={disabled} onClick={() => void create()}>
              {code ? "New code" : "Show code"}
            </Button>
          }
        />
      )}
    </List>
  );
}

function Devices({ devices }: { devices: RemoteDevice[] }) {
  const act = useAct();
  const [ask, asking] = useAsk();
  const seen = (d: RemoteDevice) => (d.online ? "Online" : d.last_seen ? `Last seen ${new Date(d.last_seen * 1000).toLocaleDateString()}` : "Never connected");
  return (
    <>
      <List label="Devices" footer="Tap a device to remove it; it has to be paired again.">
        {devices.map((d) => (
          <Row
            key={d.id}
            Icon={["macos", "windows", "linux"].includes(d.platform) ? Monitor : Smartphone}
            tile={d.online ? "green" : "gray"}
            title={d.this ? `${d.name} (this computer)` : d.name}
            detail={seen(d)}
            chevron={!d.this}
            onClick={
              d.this
                ? undefined
                : () =>
                    ask({
                      title: `Remove ${d.name}?`,
                      message: "It can no longer reach this computer until you pair it again.",
                      label: "Remove",
                      run: () => act({ m: "remote_revoke", p: { device_id: d.id } }),
                    })
            }
          />
        ))}
      </List>
      {asking}
    </>
  );
}

const ACTIONS: Record<string, string> = {
  session_start: "Started an agent",
  session_prompt: "Prompted",
  session_stop: "Stopped",
  session_restart: "Restarted",
  session_close: "Closed",
  session_rename: "Renamed",
  term_write: "Typed into",
  layout_set: "Changed the layout",
  worktree_merge: "Merged",
  worktree_discard: "Discarded",
  workspace_add: "Added a workspace",
  workspace_update: "Changed a workspace",
  remote_enable: "Disconnected remote",
};

/** The audit log: what phones, browsers and the orchestrator did here. */
function Activity() {
  const client = useClient();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      void client.req({ m: "audit_list", p: { limit: 100 } }).then(
        (r) => live && setEntries(r as AuditEntry[]),
        () => {},
      );
    load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [client]);
  if (!entries) return null;
  const shown = all ? entries : entries.slice(0, 8);
  return (
    <List
      label="Activity"
      footer={entries.length ? "What phones, browsers and Neural did on this computer. Refused actions are listed too." : "Nothing yet. Actions from phones, browsers and Neural show up here."}
    >
      {shown.map((a, i) => (
        <Row
          key={`${a.at}-${i}`}
          Icon={a.client === "orchestrator" ? Bot : a.client === "web" ? Globe : Smartphone}
          title={`${ACTIONS[a.action] ?? a.action.replaceAll("_", " ")}${a.target ? ` · ${a.target}` : ""}`}
          detail={`${a.client === "orchestrator" ? "Neural" : a.device} · ${ago(a.at)}${a.ok ? "" : ` · refused: ${a.error ?? "error"}`}`}
          trailing={a.ok ? undefined : <Pill tone="danger">Refused</Pill>}
        />
      ))}
      {entries.length > 8 && !all && <Row title={`Show all ${entries.length}`} onClick={() => setAll(true)} />}
    </List>
  );
}
