import { App as AgentApp, bindCallAudio, DaemonProvider, HostUpdateWatcher, launch as launchScreen, LaunchNote, useClient, useDaemon, useLaunch, type Platform } from "@neuralagent/app";
import { DaemonClient } from "@neuralagent/protocol";
import { parsePairLink, type RelayDevice } from "@neuralagent/remote";
import { Avatar, Button, Callout, ConfirmSheet, List, Page, Pill, Row, Spinner, toast, Toaster } from "@neuralagent/ui";
import { Code, LayoutGrid, KeyRound, LogIn, LogOut, Monitor, PlugZap, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "../brand";
import { disablePush, doneOpening, enablePush, onOpenRequest, pushState, rememberNames, setPushSilent, startWorker, syncPush, takeLaunchRequest } from "./push";
import { account, deviceName, lastHost, link, native, REDIRECT, useLink } from "./session";
import { webUpdate } from "./webUpdate";

startWorker();
const launch = takeLaunchRequest();

/**
 * Centered column for everything before a computer is open, on the same ground as the launch
 * screen. Showing it lifts the launch screen (once `ready`, e.g. the sign-in buttons are known).
 */
function Screen({ children, ready = true }: { children: React.ReactNode; ready?: boolean }) {
  useEffect(() => {
    if (ready) launchScreen.done();
  }, [ready]);
  return (
    <div className="ground min-h-full">
      <main
        className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-7 px-4"
        style={{ paddingTop: "calc(var(--safe-top) + 40px)", paddingBottom: "calc(var(--safe-bottom) + 40px)" }}
      >
        <Brand />
        {children}
      </main>
    </div>
  );
}

const fail = (e: unknown) => toast((e as Error).message, { tone: "danger" });

interface Ask {
  title: string;
  message: string;
  label: string;
  run: () => Promise<unknown>;
}

/** Destructive steps (sign out, disconnect) ask first, in an iOS confirmation sheet. */
function useAsk(): [(a: Ask) => void, React.ReactNode] {
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

const SIGN_OUT: Omit<Ask, "run"> = { title: "Sign out on this device?", message: "You can sign in again any time; nothing changes on the computer.", label: "Sign out" };

/** "0.10.2" > "0.9.9"; pre-release tags are ignored (only stable APKs are offered). */
const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split("-")[0]!.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x![i] !== y![i]) return (x![i] ?? 0) > (y![i] ?? 0);
  return false;
};

/** The Android app offers a newer APK once per start (the relay keeps the newest release). */
function useApkUpdate() {
  useEffect(() => {
    if (!native) return;
    const latest = fetch("/api/releases/latest").then((r) => (r.ok ? (r.json() as Promise<{ version: string; downloads: Record<string, string> }>) : null));
    void Promise.all([native.apkVersion(), latest])
      .then(([have, l]) => {
        const url = l?.downloads.android;
        if (!url || !newer(l.version, have)) return;
        toast(`NeuralAgent ${l.version} for Android is available.`, {
          actionLabel: "Download",
          undo: () => void native!.openOutside(url),
          duration: 20000,
        });
      })
      .catch(() => {}); // offline: next start
  }, []);
}

export function Remote() {
  const l = useLink();
  // While the launch screen is up and within its grace time, in-between states (connecting, the
  // computer list not known yet, the computer just reconnecting) keep it up instead of showing.
  const { settling } = useLaunch();
  const [pair, setPair] = useState(() => (location.pathname.startsWith("/app/pair") ? parsePairLink(location.hash) : null));
  const [signInError, setSignInError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(() => new URLSearchParams(location.search).has("state"));
  const [host, setHost] = useState<string | null>(() => launch?.host ?? lastHost.get());
  useApkUpdate();

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

  // The relay pushes only to devices nobody is looking at. Coming back (or a new network)
  // checks the relay socket at once: it may have died while the phone slept.
  useEffect(() => {
    const seen = () => {
      const v = document.visibilityState === "visible";
      link.setVisible(v);
      if (v) link.wake();
    };
    const online = () => link.wake();
    seen();
    document.addEventListener("visibilitychange", seen);
    window.addEventListener("online", online);
    native?.onActive((active) => {
      link.setVisible(active);
      if (active) link.wake();
    });
    return () => {
      document.removeEventListener("visibilitychange", seen);
      window.removeEventListener("online", online);
    };
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

  if (finishing) return settling ? null : <LaunchNote title="Signing in…" />;
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
  if (l.status === "waiting" || l.status === "blocked") return <Waiting />;
  // Devices arrive with the relay's first presence message.
  if (!l.devices.length && l.status !== "online") {
    if (settling) return null;
    if (l.status === "connecting") {
      return (
        <LaunchNote title="Still connecting…" detail="Check this device's internet connection. NeuralAgent keeps trying by itself.">
          <Button variant="glass" Icon={RefreshCw} onClick={() => link.wake()}>
            Try again
          </Button>
        </LaunchNote>
      );
    }
  }
  if (!l.devices.length && settling) return null;

  const hosts = l.hosts;
  const chosen = host && hosts.find((h) => h.id === host);
  if (chosen) return <Connected key={chosen.id} host={chosen} onSwitch={() => choose(null)} />;
  return <Hosts hosts={hosts} onPick={choose} />;
}

const LABEL: Record<string, string> = { google: "Continue with Google", github: "Continue with GitHub" };

function SignIn({ error }: { error: string | null }) {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // The launch screen waits for the sign-in options, so the buttons do not pop in after it.
  const { late } = useLaunch();
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setProviders(c.providers ?? []), () => setProviders([]));
  }, []);
  const go = async (provider: string, extra?: Record<string, string>) => {
    setBusy(true);
    try {
      const url = await account.signInUrl(provider, REDIRECT, extra);
      if (native) await native.signIn(url);
      else location.href = url;
    } catch (e) {
      setBusy(false);
      fail(e);
    }
  };
  return (
    <Screen ready={!!providers || late}>
      <div className="flex flex-col gap-2">
        <h1 className="display text-display">{native ? "NeuralAgent" : "Web remote"}</h1>
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
  const [ask, asking] = useAsk();
  return (
    <List>
      <Row leading={<Avatar name={user?.name || user?.email || "?"} src={user?.avatar ?? undefined} size={32} />} title={user?.name || "Signed in"} detail={user?.email} />
      <Row Icon={LogOut} danger title="Sign out" onClick={() => ask({ ...SIGN_OUT, run: () => account.signOut().catch(fail) })} />
      {asking}
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
              tile={h.online ? "green" : "gray"}
              title={h.name}
              detail={h.online ? "Online" : "Offline · NeuralAgent is closed, asleep or disconnected"}
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
  // A computer that is just reconnecting to the relay gets the launch screen's grace time.
  const { settling } = useLaunch();
  useEffect(() => () => client.close(), [client]);
  // Come back quickly when the computer reappears or the tab is shown again.
  useEffect(() => {
    if (host.online) client.poke();
  }, [host.online, client]);
  useEffect(() => {
    const wake = () => document.visibilityState === "visible" && client.poke();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    const offActive = native?.onActive((active) => active && client.poke());
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      offActive?.();
    };
  }, [client]);

  // Agent names for notification titles, kept on this device only.
  useEffect(() => {
    let last = "";
    let counts = "";
    const off = client.subscribe(() => {
      const st = client.state;
      const names = JSON.stringify(Object.fromEntries(Object.values(st?.sessions ?? {}).map((s) => [s.id, s.title])));
      if (names !== last) rememberNames((last = names));
      // The Android widget and tile show what the agents were doing when the app last looked.
      if (!native || !st) return;
      const engine = (id: string) => st.profiles.find((p) => p.id === id)?.engine ?? "shell";
      const agents = Object.values(st.sessions).filter((s) => s.alive && engine(s.profile_id) !== "shell" && !s.profile_id.startsWith("install:"));
      const next = [agents.length, agents.filter((s) => s.status === "working").length, agents.filter((s) => s.status === "waiting").length];
      if (next.join() === counts) return;
      counts = next.join();
      void native.plugin.setStatus({ computer: host.name, running: next[0]!, working: next[1]!, waiting: next[2]! }).catch(() => {});
    });
    return () => void off();
  }, [client, host.name]);

  const platform = useMemo<Platform>(
    () => ({
      kind: native ? "android" : "web",
      clientName: deviceName,
      webUpdate,
      connect,
      openExternal: (url) => void window.open(url, "_blank", "noopener"),
      readClipboardImage: native ? () => native!.clipboardImage() : undefined,
      copyText: native ? (text) => native!.copyText(text) : undefined,
      focused: () => document.visibilityState === "visible" && document.hasFocus(),
      // Notifications come as pushes from the relay (also while the page is closed).
      push: { state: pushState, enable: enablePush, disable: disablePush, silent: setPushSilent },
      call: native
        ? {
            active: (on) => void native?.plugin.callActive({ on }).catch(() => {}),
            // Earpiece or speaker: the phone's audio route, kept natively too so the quick tile
            // and the notification start calls the same way.
            audio: { set: (route) => native!.plugin.callRoute({ route }).then((r) => r.output) },
            onDial: (cb) => {
              const h = native!.plugin.addListener("dial", (o) => cb(o.start));
              return () => void h.then((x) => x.remove());
            },
          }
        : undefined,
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

  // Tell the Android side which route this device chose, before any call starts.
  useEffect(() => bindCallAudio(platform.call?.audio), [platform]);

  return (
    <DaemonProvider client={client} platform={platform}>
      {!host.online && !client.state ? (
        settling ? null : <Offline host={host} onSwitch={onSwitch} />
      ) : (
        <>
          <AgentApp />
          <HostUpdateWatcher />
        </>
      )}
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
  const [ask, asking] = useAsk();
  return (
    <Page title="This device" eyebrow={native ? "Android app" : "Web remote"}>
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
        {native && (
          <List label="Home screen" footer="Shows what the agents were doing when the app last looked. The Agents tile is in Quick Settings → Edit.">
            <Row
              Icon={LayoutGrid}
              title="Agents widget"
              trailing={
                <Button size="sm" variant="glass" onClick={() => void native!.plugin.pinWidget().then((r) => r.ok || toast("Long-press the home screen → Widgets → NeuralAgent."), fail)}>
                  Add
                </Button>
              }
            />
          </List>
        )}
        <List label="Emergency" footer="Cuts every phone and browser off this computer. Turn it back on at the computer.">
          <Row
            Icon={PlugZap}
            title="Disconnect remote"
            danger
            onClick={() =>
              ask({
                title: "Disconnect remote access?",
                message: "Every phone and browser loses this computer until you turn remote access back on there.",
                label: "Disconnect",
                run: () => client.req({ m: "remote_enable", p: { enabled: false } }).then(() => toast("Remote access is off on that computer."), fail),
              })
            }
          />
        </List>
        <List label="Account">
          <Row leading={<Avatar name={user?.name || user?.email || "?"} src={user?.avatar ?? undefined} size={26} />} title={user?.name || "Signed in"} detail={user?.email} />
          <Row Icon={Smartphone} title={deviceName} detail="This device" />
          <Row Icon={LogOut} danger title="Sign out on this device" onClick={() => ask({ ...SIGN_OUT, run: () => account.signOut().catch(fail) })} />
        </List>
        {asking}
      </div>
    </Page>
  );
}

