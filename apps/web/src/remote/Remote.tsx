import { App as AgentApp, DaemonProvider, useClient, useDaemon, type Platform } from "@neuralagent/app";
import { DaemonClient } from "@neuralagent/protocol";
import { parsePairLink, type RelayDevice } from "@neuralagent/remote";
import { Avatar, Button, Callout, ConfirmButton, List, Page, Pill, Row, Spinner, toast, Toaster } from "@neuralagent/ui";
import { Bell, Code, KeyRound, LogIn, LogOut, Monitor, PlugZap, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "../brand";
import { disablePush, doneOpening, enablePush, onOpenRequest, pushState, rememberNames, startWorker, syncPush, takeLaunchRequest, type PushState } from "./push";
import { account, deviceName, lastHost, link, REDIRECT, useLink } from "./session";

startWorker();
const launch = takeLaunchRequest();

/** Centered column for everything before a computer is open. */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Brand />
      {children}
    </main>
  );
}

const fail = (e: unknown) => toast((e as Error).message, { tone: "danger" });

export function Remote() {
  const l = useLink();
  const [pair, setPair] = useState(() => (location.pathname.startsWith("/app/pair") ? parsePairLink(location.hash) : null));
  const [signInError, setSignInError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(() => new URLSearchParams(location.search).has("state"));
  const [host, setHost] = useState<string | null>(() => launch?.host ?? lastHost.get());

  // Back from Google/GitHub with ?code&state.
  useEffect(() => {
    if (!finishing) return;
    const q = new URLSearchParams(location.search);
    history.replaceState(null, "", "/app/");
    account.finishSignIn(q).then(
      () => link.start(),
      (e) => setSignInError((e as Error).message),
    ).finally(() => setFinishing(false));
  }, [finishing]);

  useEffect(() => {
    link.start();
    return () => link.stop();
  }, []);

  // The relay pushes only to devices nobody is looking at.
  useEffect(() => {
    const seen = () => link.setVisible(document.visibilityState === "visible");
    seen();
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);
  useEffect(() => {
    if (l.status === "online") void syncPush();
  }, [l.status]);

  // A notification for another computer switches to it; Connected then opens the agent.
  useEffect(() => onOpenRequest((o) => o.host && choose(o.host)), []);

  const choose = (id: string | null) => {
    lastHost.set(id);
    setHost(id);
  };

  if (finishing) return <Loading label="Signing in…" />;
  if (pair) {
    return (
      <Pair
        pair={pair}
        onDone={(id) => {
          history.replaceState(null, "", "/app/");
          setPair(null);
          choose(id);
          link.start();
        }}
        onCancel={() => {
          history.replaceState(null, "", "/app/");
          setPair(null);
        }}
      />
    );
  }
  if (!account.signedIn) return <SignIn error={signInError} />;
  if (l.status === "connecting" && !l.devices.length) return <Loading label="Connecting…" />;
  if (l.status === "waiting" || l.status === "blocked") return <Waiting />;

  const hosts = l.hosts;
  const chosen = host && hosts.find((h) => h.id === host);
  if (chosen) return <Connected key={chosen.id} host={chosen} onSwitch={() => choose(null)} />;
  return <Hosts hosts={hosts} onPick={choose} />;
}

function Loading({ label }: { label: string }) {
  return (
    <Screen>
      <div className="flex items-center gap-3 text-meta text-dim">
        <Spinner /> {label}
      </div>
    </Screen>
  );
}

const LABEL: Record<string, string> = { google: "Continue with Google", github: "Continue with GitHub" };

function SignIn({ error }: { error: string | null }) {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setProviders(c.providers ?? []), () => setProviders([]));
  }, []);
  const go = async (provider: string, extra?: Record<string, string>) => {
    setBusy(true);
    try {
      location.href = await account.signInUrl(provider, REDIRECT, extra);
    } catch (e) {
      setBusy(false);
      fail(e);
    }
  };
  return (
    <Screen>
      <div className="flex flex-col gap-2">
        <h1 className="display text-display">Web remote</h1>
        <p className="text-body text-dim">See and steer the agents on your computer. Sign in with the account you use in NeuralAgent on the computer.</p>
      </div>
      {error && <Callout tone="danger" title="Sign-in failed">{error}</Callout>}
      {!providers && <Spinner label="Loading" />}
      <div className="flex flex-col gap-2">
        {providers?.filter((p) => p !== "test").map((p) => (
          <Button key={p} block variant={p === "google" ? "primary" : "glass"} Icon={p === "github" ? Code : LogIn} busy={busy} onClick={() => void go(p)}>
            {LABEL[p] ?? `Continue with ${p}`}
          </Button>
        ))}
        {providers?.includes("test") && (
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void go("test", { email, name: email.split("@")[0] ?? email });
            }}
          >
            <label className="px-1 text-detail text-dim" htmlFor="test-email">Test sign-in (development only)</label>
            <input
              id="test-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-11 rounded-field bg-fill-2 px-3 text-input text-bright outline-none placeholder:text-faint"
            />
            <Button type="submit" variant="tint" busy={busy}>Test sign-in</Button>
          </form>
        )}
      </div>
      <Callout Icon={ShieldCheck} title="Or scan a code">
        On your computer, open NeuralAgent → Remote → Add phone and scan the code with this device's camera. No password needed.
      </Callout>
    </Screen>
  );
}

function Pair({ pair, onDone, onCancel }: { pair: { code: string; host: string; fp: string }; onDone: (host: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pairing waits for a tap: link previews and prefetchers must not use up the one-time code.
  const go = async () => {
    setBusy(true);
    try {
      const h = await account.pair(pair.code, pair.host, pair.fp);
      toast(`Connected to ${h.name}`);
      onDone(h.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Screen>
      <div className="flex flex-col gap-2">
        <h1 className="display text-display">Add this device</h1>
        <p className="text-body text-dim">
          This {deviceName.split(" on ")[1] ?? "device"} joins your account and can reach the computer that showed the code.
        </p>
      </div>
      <List label="Computer's key" footer="It should match the key under Remote → Security on your computer.">
        <Row Icon={KeyRound} title={<span className="font-mono">{pair.fp}</span>} />
      </List>
      {error && <Callout tone="danger" title="Could not add this device">{error} Show a new code on your computer and scan it again.</Callout>}
      <div className="flex flex-col gap-2">
        <Button block Icon={PlugZap} busy={busy} onClick={() => void go()}>
          Connect
        </Button>
        <Button block variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Screen>
  );
}

function Waiting() {
  const l = useLink();
  const user = account.user;
  const pending = user?.status === "pending";
  return (
    <Screen>
      {pending ? (
        <Callout tone="warning" title="Waiting for approval">
          Your request was sent. You'll get an email, and this page unlocks by itself, as soon as it is approved.
        </Callout>
      ) : (
        <Callout tone="danger" title={l.status === "blocked" ? "No access" : "Remote access is off"}>
          {l.error ?? "This account can't use remote access."}
        </Callout>
      )}
      <SignedInAs />
    </Screen>
  );
}

function SignedInAs() {
  const user = account.user;
  return (
    <List>
      <Row
        leading={<Avatar name={user?.name || user?.email || "?"} src={user?.avatar ?? undefined} size={26} />}
        title={user?.name || "Signed in"}
        detail={user?.email}
        trailing={<ConfirmButton label="Sign out" size="sm" onConfirm={() => void account.signOut().catch(fail)} />}
      />
    </List>
  );
}

function Hosts({ hosts, onPick }: { hosts: RelayDevice[]; onPick: (id: string) => void }) {
  const l = useLink();
  return (
    <Screen>
      <div className="flex flex-col gap-2">
        <h1 className="display text-display">Your computers</h1>
        <p className="text-body text-dim">Pick the computer whose agents you want to see.</p>
      </div>
      {l.status === "offline" && <Callout tone="warning">{l.error ?? "The relay is not reachable."} Retrying…</Callout>}
      {hosts.length === 0 ? (
        <Callout Icon={Monitor} title="No computer yet">
          On your computer, open NeuralAgent → Remote and sign in with the same account. It shows up here right away.
        </Callout>
      ) : (
        <List>
          {hosts.map((h) => (
            <Row
              key={h.id}
              Icon={Monitor}
              title={h.name}
              detail={h.online ? "Online" : "Offline: NeuralAgent is closed, asleep or disconnected"}
              trailing={<Pill tone={h.online ? "success" : "neutral"} dot>{h.online ? "Online" : "Offline"}</Pill>}
              onClick={() => onPick(h.id)}
            />
          ))}
        </List>
      )}
      <SignedInAs />
    </Screen>
  );
}

function Connected({ host, onSwitch }: { host: RelayDevice; onSwitch: () => void }) {
  const connect = useMemo(() => {
    const open = link.transport(host.id);
    return () =>
      open().catch((e: Error) => {
        console.warn(`remote: ${e.message}`);
        throw e;
      });
  }, [host.id]);
  const client = useMemo(() => new DaemonClient(connect, { kind: "web", name: deviceName }), [connect]);
  useEffect(() => () => client.close(), [client]);
  // Come back quickly when the computer reappears or the tab is shown again.
  useEffect(() => {
    if (host.online) client.poke();
  }, [host.online, client]);
  useEffect(() => {
    const wake = () => document.visibilityState === "visible" && client.poke();
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, [client]);

  // Agent names for notification titles, kept on this device only.
  useEffect(() => {
    let last = "";
    const off = client.subscribe(() => {
      const names = JSON.stringify(Object.fromEntries(Object.values(client.state?.sessions ?? {}).map((s) => [s.id, s.title])));
      if (names !== last) rememberNames((last = names));
    });
    return () => void off();
  }, [client]);

  const platform = useMemo<Platform>(
    () => ({
      kind: "web",
      clientName: deviceName,
      connect,
      openExternal: (url) => void window.open(url, "_blank", "noopener"),
      focused: () => document.visibilityState === "visible" && document.hasFocus(),
      notify: (title, body) => {
        if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, icon: "/logo.png" });
      },
      account: { label: "This device", render: () => <DevicePage host={host} onSwitch={onSwitch} /> },
      onOpenSession: (cb) =>
        onOpenRequest((o) => {
          if (o.host && o.host !== host.id) return;
          cb(o.sid);
          doneOpening(o.sid);
        }),
    }),
    [host, onSwitch, connect],
  );

  return (
    <DaemonProvider client={client} platform={platform}>
      {!host.online && !client.state ? <Offline host={host} onSwitch={onSwitch} /> : <AgentApp />}
    </DaemonProvider>
  );
}

function Offline({ host, onSwitch }: { host: RelayDevice; onSwitch: () => void }) {
  return (
    <Screen>
      <Callout tone="warning" title={`${host.name} is offline`}>
        NeuralAgent on that computer is closed, asleep or disconnected from remote. This page connects by itself when it is back.
      </Callout>
      <Button variant="glass" Icon={RefreshCw} onClick={onSwitch}>
        Other computer
      </Button>
      <Toaster />
    </Screen>
  );
}

/** "This device" inside the agent UI: which computer, switching, the emergency switch, sign out. */
function DevicePage({ host, onSwitch }: { host: RelayDevice; onSwitch: () => void }) {
  const client = useClient();
  const status = useDaemon((c) => c.status);
  const user = account.user;
  return (
    <Page title="This device" eyebrow="Web remote">
      <div className="flex flex-col gap-6 pb-8">
        <List label="Computer">
          <Row
            Icon={Monitor}
            title={host.name}
            detail="End-to-end encrypted through the relay"
            trailing={<Pill tone={status === "open" ? "success" : "warning"} dot>{status === "open" ? "Connected" : "Reconnecting"}</Pill>}
          />
          <Row Icon={RefreshCw} title="Switch computer" onClick={onSwitch} />
        </List>
        <Notifications />
        <List label="Emergency" footer="Cuts every phone and browser off this computer. Turn it back on at the computer.">
          <Row
            Icon={PlugZap}
            title="Disconnect remote"
            danger
            trailing={
              <ConfirmButton
                label="Disconnect"
                size="sm"
                onConfirm={() =>
                  void client.req({ m: "remote_enable", p: { enabled: false } }).then(() => toast("Remote access is off on that computer."), fail)
                }
              />
            }
          />
        </List>
        <List label="Account">
          <Row leading={<Avatar name={user?.name || user?.email || "?"} src={user?.avatar ?? undefined} size={26} />} title={user?.name || "Signed in"} detail={user?.email} />
          <Row Icon={Smartphone} title={deviceName} detail="This device" />
          <Row Icon={LogOut} title="Sign out on this device" trailing={<ConfirmButton label="Sign out" size="sm" onConfirm={() => void account.signOut().catch(fail)} />} />
        </List>
      </div>
    </Page>
  );
}

const PUSH_NOTE: Record<PushState, string> = {
  on: "A notification when an agent finishes, fails or needs your input while this page is closed.",
  off: "Get a notification when an agent finishes, fails or needs your input while this page is closed.",
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings.",
  install: "On iPhone and iPad, notifications only work after Share → Add to Home Screen. Open NeuralAgent from the Home Screen, then turn them on here.",
  unsupported: "This browser cannot show notifications from a closed page.",
};

function Notifications() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void pushState().then(setState), []);
  if (!state) return null;
  const change = (f: () => Promise<PushState>) => {
    setBusy(true);
    f().then(setState, fail).finally(() => setBusy(false));
  };
  return (
    <List label="Notifications" footer={PUSH_NOTE[state]}>
      <Row
        Icon={Bell}
        title="Agent notifications"
        trailing={
          state === "on" ? (
            <Button size="sm" variant="glass" busy={busy} onClick={() => change(disablePush)}>Turn off</Button>
          ) : state === "off" ? (
            <Button size="sm" variant="tint" busy={busy} onClick={() => change(enablePush)}>Turn on</Button>
          ) : (
            <Pill tone="warning">{state === "install" ? "Add to Home Screen" : state === "denied" ? "Blocked" : "Not available"}</Pill>
          )
        }
      />
    </List>
  );
}
