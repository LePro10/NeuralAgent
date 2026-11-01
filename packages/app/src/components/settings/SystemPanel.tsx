// Settings → System (D58-D60): the computer's permissions, how the background service starts, and
// how it runs. On the desktop the app asks the OS itself (platform.system, src-tauri/src/system.rs);
// phones and browsers see the same through the daemon: `host_system` for the service and
// `host_ui` "system.status" (answered by the desktop app while it is open) for permissions.
import type { DaemonClient, HostSystem } from "@neuralagent/protocol";
import { Button, Callout, ConfirmSheet, List, Pill, Row, Switch, toast } from "@neuralagent/ui";
import { AlertTriangle, Check, RotateCw, ShieldCheck, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionState, ServiceStart, SystemApi, SystemAutostart, SystemPermission, SystemStatus } from "../../lib/platform";
import { useClient, usePlatform } from "../../lib/store";
import { ago } from "../../lib/time";
import { Choice } from "./panels";

const fail = (e: unknown) => toast((e as Error).message ?? String(e), { tone: "danger" });

const STATE: Record<PermissionState, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  granted: { label: "On", tone: "success" },
  missing: { label: "Off", tone: "warning" },
  denied: { label: "Denied", tone: "danger" },
  unknown: { label: "Check", tone: "neutral" },
};

/** The permissions still to switch on, in the order the guided setup walks them. */
export const toSetUp = (s: SystemStatus | null) => (s?.permissions ?? []).filter((p) => !p.optional && p.state !== "granted" && p.state !== "unknown");

/** Settings row value: "2 missing" or nothing. */
export function systemSummary(s: SystemStatus | null): string | undefined {
  const n = toSetUp(s).length;
  return n ? `${n} missing` : undefined;
}

/** The OS status, live: polled while the panel shows (and faster during the guided setup). */
function useSystemStatus(client: DaemonClient, local: SystemApi | undefined, fast: boolean) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [appClosed, setAppClosed] = useState(false);
  const load = useCallback(async () => {
    try {
      const s = local
        ? await local.status()
        : await client.req<SystemStatus>({
            m: "host_ui",
            p: { op: "system.status" },
          });
      setStatus(s);
      setAppClosed(false);
    } catch (e) {
      if (local) fail(e);
      else setAppClosed(true);
    }
  }, [client, local]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), fast ? 1500 : 6000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, fast]);
  return { status, setStatus, appClosed, reload: load };
}

/** How the service runs (`host_system`); null for a daemon that does not know it. */
function useHostSystem(client: DaemonClient) {
  const [info, setInfo] = useState<HostSystem | null>(null);
  const load = useCallback(() => {
    if (!client.has("host_system")) return setInfo(null);
    client.req<HostSystem>({ m: "host_system" }).then(setInfo, () => setInfo(null));
  }, [client]);
  useEffect(() => {
    load();
    const off = client.onHello(load);
    const t = setInterval(load, 15_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [client, load]);
  return { info, reload: load };
}

export function SystemPanel({ hostName }: { hostName?: string }) {
  const platform = usePlatform();
  const client = useClient();
  const local = platform.system;
  const [guide, setGuide] = useState<string[] | null>(null);
  const { status, setStatus, appClosed } = useSystemStatus(client, local, !!guide);
  const { info, reload: reloadHost } = useHostSystem(client);
  const host = hostName ?? "this computer";

  return (
    <div className="flex flex-col gap-7">
      {/* Here the list below says it already; an older service's warning still matters. */}
      {(!local || !info?.host_mode) &&
        info?.warnings.map((w) => (
          <Callout key={w} tone="warning" Icon={AlertTriangle}>
            {w}
          </Callout>
        ))}
      {guide && local && status && (
        <Guide
          api={local}
          status={status}
          ids={guide}
          onDone={() => setGuide(null)}
          onRestart={() => restartService(client, reloadHost)}
          canRestart={!!info?.can_restart}
        />
      )}
      <Permissions status={status} api={local} host={host} appClosed={appClosed} onGuide={() => setGuide(toSetUp(status).map((p) => p.id))} guiding={!!guide} />
      {status && <AutostartList status={status} api={local} onChange={setStatus} />}
      <Service info={info} host={host} onRestart={() => restartService(client, reloadHost)} />
    </div>
  );
}

function Permissions({
  status,
  api,
  host,
  appClosed,
  onGuide,
  guiding,
}: {
  status: SystemStatus | null;
  api?: SystemApi;
  host: string;
  appClosed: boolean;
  onGuide: () => void;
  guiding: boolean;
}) {
  const [repair, setRepair] = useState<SystemPermission | null>(null);
  if (!status) {
    if (!api && appClosed)
      return (
        <List label="Permissions" footer={`Open NeuralAgent on ${host} to see which permissions are on.`}>
          <Row title="NeuralAgent is not open on the computer" chevron={false} />
        </List>
      );
    return null;
  }
  if (!status.permissions.length) return null;
  const missing = toSetUp(status);
  const remote = !api;
  return (
    <>
      <List
        label={`Permissions on ${host}`}
        footer={
          status.os === "macos"
            ? "Full Disk Access is the one that matters for remote work: without it, agents in Documents, Desktop or Downloads stop at a dialog on the Mac's screen that nobody can answer from the phone. You grant it once; updates keep it."
            : undefined
        }
      >
        {status.permissions.map((p) => {
          const st = STATE[p.state];
          return (
            <Row
              key={p.id}
              title={p.title}
              detail={p.detail}
              wrap
              onClick={remote ? undefined : () => void (p.state === "granted" ? api.open(p.id) : api.request(p.id)).catch(fail)}
              chevron={false}
              trailing={
                <Pill tone={st.tone} dot>
                  {st.label}
                </Pill>
              }
            />
          );
        })}
      </List>
      {remote ? (
        missing.length > 0 && (
          <Callout tone="warning" Icon={ShieldCheck} title={`${missing.length} permission${missing.length > 1 ? "s" : ""} missing`}>
            macOS only lets you switch these on at the computer itself: Settings → System → “Set up all permissions”.
          </Callout>
        )
      ) : (
        <List footer="“Repair” is for a permission that shows as on in System Settings but does not work (often after an update): it removes the old entry and asks again.">
          {missing.length > 0 && !guiding && (
            <Row Icon={ShieldCheck} tile="blue" title="Set up all permissions" detail={`${missing.length} to go, one step at a time`} onClick={onGuide} />
          )}
          {missing.length === 0 && <Row Icon={Check} tile="green" title="All needed permissions are on" chevron={false} />}
          {status.os === "macos" && <Row Icon={Wrench} title="Repair a permission" onClick={() => setRepair(status.permissions[0] ?? null)} />}
        </List>
      )}
      {repair && api && <RepairPicker api={api} permissions={status.permissions} onClose={() => setRepair(null)} />}
    </>
  );
}

function RepairPicker({ api, permissions, onClose }: { api: SystemApi; permissions: SystemPermission[]; onClose: () => void }) {
  const [pick, setPick] = useState<SystemPermission | null>(null);
  return (
    <>
      <List
        label="Which one does not work?"
        action={
          <Button size="xs" variant="quiet" onClick={onClose}>
            Done
          </Button>
        }
      >
        {permissions
          .filter((p) => p.id !== "automation")
          .map((p) => (
            <Row key={p.id} title={p.title} value={STATE[p.state].label} onClick={() => setPick(p)} />
          ))}
      </List>
      <ConfirmSheet
        open={!!pick}
        onClose={() => setPick(null)}
        title={`Repair ${pick?.title ?? ""}?`}
        message="NeuralAgent's entry is removed from System Settings and macOS asks again. Switch it on in the window that opens."
        confirmLabel="Repair"
        onConfirm={async () => {
          if (!pick) return;
          await api.repair(pick.id).catch(fail);
          setPick(null);
          onClose();
        }}
      />
    </>
  );
}

const HOW: Record<string, string> = {
  full_disk_access: "System Settings opens at Full Disk Access and Finder shows NeuralAgent. Switch NeuralAgent on (or drag it into the list), then come back.",
  accessibility: "Switch NeuralAgent on in the list (it may ask for your password). Dictation needs this to type for you.",
  microphone: "Click “Allow” in the dialog, or switch NeuralAgent on in the list.",
  screen_recording: "Switch NeuralAgent on in the list.",
};

/** One permission at a time: open its pane, wait until it is on, go on. */
function Guide({
  api,
  status,
  ids,
  onDone,
  onRestart,
  canRestart,
}: {
  api: SystemApi;
  status: SystemStatus;
  ids: string[];
  onDone: () => void;
  onRestart: () => void;
  canRestart: boolean;
}) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const asked = useRef<string | null>(null);
  const byId = new Map(status.permissions.map((p) => [p.id, p]));
  const left = ids.filter((id) => byId.get(id)?.state !== "granted" && !skipped.includes(id));
  const current = left[0] ? byId.get(left[0]) : undefined;
  const step = ids.length - left.length + 1;
  const fdaDone = ids.includes("full_disk_access") && byId.get("full_disk_access")?.state === "granted";
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.scrollIntoView({ block: "center", behavior: "smooth" }), []);
  useEffect(() => {
    if (!current || asked.current === current.id) return;
    asked.current = current.id;
    void api.request(current.id).catch(fail);
  }, [api, current]);
  if (!current)
    return (
      <div ref={box}>
        <Callout
          tone="success"
          Icon={Check}
          title="Done"
          action={
            <Button size="sm" variant="quiet" onClick={onDone}>
              Close
            </Button>
          }
        >
          {fdaDone && canRestart ? (
            <span className="flex flex-col items-start gap-2">
              Restart the background service once so it uses Full Disk Access (running agents stop and resume).
              <Button size="sm" Icon={RotateCw} onClick={onRestart}>
                Restart the service
              </Button>
            </span>
          ) : (
            "The permissions are set. Updates keep them."
          )}
        </Callout>
      </div>
    );
  return (
    <div ref={box}>
      <Callout
        tone="accent"
        Icon={ShieldCheck}
        title={`Step ${step} of ${ids.length}: ${current.title}`}
      >
        <span className="flex flex-col items-start gap-3">
          {HOW[current.id] ?? current.detail} This page goes on by itself once it is on.
          <span className="flex gap-2">
            <Button size="sm" onClick={() => void api.request(current.id).catch(fail)}>
              Open again
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setSkipped((s) => [...s, current.id])}>
              Skip
            </Button>
          </span>
        </span>
      </Callout>
    </div>
  );
}

const START: Record<string, { value: ServiceStart; title: string; detail: string }[]> = {
  macos: [
    {
      value: "off",
      title: "Off",
      detail: "The service starts when you open NeuralAgent",
    },
    {
      value: "login",
      title: "When you log in",
      detail: "Works without opening the window",
    },
    {
      value: "boot",
      title: "When the Mac starts",
      detail: "Even before login (admin password once)",
    },
  ],
  windows: [
    {
      value: "off",
      title: "Off",
      detail: "The service starts when you open NeuralAgent",
    },
    {
      value: "login",
      title: "When you sign in",
      detail: "Works without opening the window",
    },
    {
      value: "boot",
      title: "When Windows starts",
      detail: "Even before sign-in (administrator once)",
    },
  ],
  linux: [
    {
      value: "off",
      title: "Off",
      detail: "The service starts when you open NeuralAgent",
    },
    {
      value: "login",
      title: "When you log in",
      detail: "A systemd user service",
    },
    {
      value: "boot",
      title: "When the computer starts",
      detail: "Even before login (password once)",
    },
  ],
};

const CAVEAT: Record<string, string> = {
  macos:
    "Before login the keychain is still locked: Claude Code (it keeps its login there) and saved Neural keys work once you have logged in, and there is no microphone. Codex and other agents work; in Documents, Desktop or Downloads only with Full Disk Access (nobody is there to answer a dialog). With FileVault on, a restarted Mac waits at the password screen; use `sudo fdesetup authrestart` for planned restarts.",
  windows: "Before sign-in the service has no access to network drives or saved Windows credentials.",
  linux: "Before login there is no desktop session (no microphone, no keyring).",
};

function AutostartList({ status, api, onChange }: { status: SystemStatus; api?: SystemApi; onChange: (s: SystemStatus) => void }) {
  const [busy, setBusy] = useState(false);
  const options = START[status.os] ?? START.linux;
  const a = status.autostart;
  const set = async (next: SystemAutostart) => {
    if (!api || busy) return;
    setBusy(true);
    try {
      onChange(await api.setAutostart(next));
      toast(next.service === "off" ? "Starts with the app again" : "Saved");
    } catch (e) {
      if (String((e as Error).message ?? e) !== "Cancelled.") fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (!api)
    return (
      <List label="Start automatically" footer="Change this at the computer.">
        <Row title="Background service" value={options.find((o) => o.value === a.service)?.title ?? a.service} chevron={false} />
        <Row title="Open the window at login" value={a.window ? "On" : "Off"} chevron={false} />
      </List>
    );
  const blocked = status.blocked;
  return (
    <>
      <List
        label="Start the background service automatically"
        footer={
          a.service === "boot" ? CAVEAT[status.os] : "Stopping the service in the app does not change this; it only decides what happens after a restart."
        }
      >
        {options.map((o) => (
          <Choice
            key={o.value}
            title={o.title}
            detail={o.detail}
            checked={a.service === o.value}
            onSelect={() => !blocked && void set({ ...a, service: o.value })}
          />
        ))}
      </List>
      <List footer={blocked ?? (status.stale ? "Autostart pointed at another copy of NeuralAgent and now points at this one." : undefined)}>
        <Row
          title="Open the window at login"
          trailing={
            <Switch label="Open the window at login" checked={a.window} disabled={!!blocked || busy} onChange={(window) => void set({ ...a, window })} />
          }
        />
      </List>
    </>
  );
}

const MODE: Record<string, string> = {
  boot: "Starts with the computer",
  login: "Starts when you log in",
  app: "Started by the app",
};

function Service({ info, host, onRestart }: { info: HostSystem | null; host: string; onRestart: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!info) return null;
  return (
    <>
      <List
        label="Background service"
        footer={
          info.can_restart
            ? "If the service stops unexpectedly, it starts again by itself."
            : `This service was started by an older version. Quit NeuralAgent on ${host} and stop the agents once, then open it again.`
        }
      >
        <Row title="Running since" value={ago(info.started_at)} chevron={false} />
        {info.booted_at && <Row title="Computer started" value={ago(info.booted_at)} chevron={false} />}
        <Row title="Kept running by" value={info.host_mode ? (MODE[info.host_mode] ?? info.host_mode) : "Nothing (older version)"} chevron={false} />
        {info.restarts > 0 && <Row title="Restarted after a stop" value={`${info.restarts}×`} chevron={false} />}
        {info.before_login && (
          <Row title="Waiting for login" detail="Nobody is logged in yet: keychain and microphone come after login." wrap chevron={false} />
        )}
        {info.can_restart && (
          <Row
            Icon={RotateCw}
            title="Restart the service"
            detail="Starts the newest installed version; running agents stop and resume."
            wrap
            onClick={() => setConfirm(true)}
          />
        )}
      </List>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Restart the service?"
        message="Running agents stop for a few seconds and resume where they were."
        confirmLabel="Restart"
        onConfirm={() => {
          setConfirm(false);
          onRestart();
        }}
      />
    </>
  );
}

async function restartService(client: DaemonClient, reload: () => void) {
  try {
    await client.req({ m: "host_restart" });
    toast("Restarting the service…");
    setTimeout(reload, 6000);
  } catch (e) {
    fail(e);
  }
}
