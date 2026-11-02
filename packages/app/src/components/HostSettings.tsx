import type { DaemonClient, ModelInfo } from "@neuralagent/protocol";
import { Button, Callout, ConfirmSheet, Empty, Input, List, Meter, Pill, Row, Segmented, Switch, toast } from "@neuralagent/ui";
import { AudioLines, Check, Download, Ear, Folder, FolderGit2, GitBranch, Keyboard, Mic, Music, ShieldCheck, Trash2, Volume, Volume1 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { checkHostUpdate, installHostUpdate, useHostModels, useHostUpdate, useHostVoice, watchHostUpdate } from "../lib/host";
import { useClient, useDaemon, usePlatform } from "../lib/store";
import { DictationHistory } from "./settings/DictationHistory";
import { useSettingsNav } from "./settings/nav";
import { DUCK_LEVELS, HOTKEYS, megabytes, type DuckApp, type VoiceApi, type VoiceConfig, type VoiceStatus } from "../lib/voice";

const fail = (e: unknown) => toast((e as Error).message ?? String(e), { tone: "danger" });

/** Dictation, wake word and voice models of the host: the app's own or, from a remote, the host's. */
export function HostVoiceSettings({ mac, hostName }: { mac: boolean; hostName: string | null }) {
  const client = useClient();
  const platform = usePlatform();
  const models = useHostModels(client);
  const { api, appClosed } = useHostVoice(client, platform.voice);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    if (!api) return setStatus(null);
    api.status().then(setStatus, () => {});
    return api.onStatus(setStatus);
  }, [api]);
  const where = hostName ? ` on ${hostName}` : "";
  return (
    <>
      {appClosed && (
        <Callout tone="warning" title={`Dictation and wake word need the app open${where}`}>
          Voice models and calls work without it. Open NeuralAgent on the host computer to set the shortcut and the wake word.
        </Callout>
      )}
      {api && status && <VoiceControls api={api} status={status} models={models ?? []} mac={mac} hostName={hostName} />}
      <VoiceModels client={client} models={models} hostName={hostName} />
    </>
  );
}

/** Recordings one "Learn my voice" round asks for. */
const LEARN_TAKES = 3;

function VoiceControls({ api, status, models, mac, hostName }: { api: VoiceApi; status: VoiceStatus; models: ModelInfo[]; mac: boolean; hostName: string | null }) {
  const [learning, setLearning] = useState(false);
  const { config } = status;
  const installed = (id: string) => models.find((m) => m.id === id)?.installed ?? false;
  const set = (patch: Partial<VoiceConfig>) => api.set({ ...config, ...patch }).catch(fail);
  const mic = hostName ? `${hostName}'s microphone` : "your microphone";
  // Guided "Learn my voice": three takes in a row (more after a miss), started by the Record
  // button or when the wake word is switched on with fewer than three recordings learned.
  const [take, setTake] = useState(0);
  const stop = useRef(false);
  const learn = async () => {
    if (learning) {
      stop.current = true; // after the take that is running
      return;
    }
    stop.current = false;
    setLearning(true);
    let done = 0;
    let misses = 0;
    try {
      while (done < LEARN_TAKES && misses < 3 && !stop.current) {
        setTake(done + 1);
        try {
          await api.learn();
          done++;
        } catch (e) {
          misses++;
          if (misses >= 3) fail(e);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (done > 0) toast(done >= LEARN_TAKES ? "Neural knows your voice now." : `Learned ${done} of ${LEARN_TAKES}. Record again for the rest.`, { tone: "success" });
    } finally {
      setLearning(false);
      setTake(0);
    }
  };
  return (
    <>
      {status.error && <Callout tone="warning">{status.error}</Callout>}
      <List
        label="Dictation"
        footer={`Hold the shortcut, speak, let go: the text is typed wherever the cursor is, in any app${hostName ? ` on ${hostName}` : ""}. Speech never leaves that computer.`}
      >
        <Row
          Icon={Mic}
          title="Hold to dictate"
          detail={status.activity === "listening" ? "Listening…" : status.activity === "transcribing" ? "Writing…" : status.last_text ? `Last: ${status.last_text}` : undefined}
          trailing={<Switch label="Hold to dictate" checked={config.dictation} onChange={(dictation) => set({ dictation })} />}
        />
        <Row
          Icon={Keyboard}
          title="Shortcut"
          trailing={
            <Segmented
              size="sm"
              label="Shortcut"
              value={config.hotkey}
              options={HOTKEYS.map((h) => ({ value: h.value, label: mac ? h.mac : h.other }))}
              onChange={(hotkey) => set({ hotkey })}
            />
          }
        />
        <DictationHistory api={api} status={status} />
      </List>
      <List
        label="Wake word"
        footer="Say “Hey Neural” to start a call with Neural, the same as Call Neural: say what you want in the same breath or after a pause, and keep talking. The call hangs up by itself after a quiet while. If it does not react to your voice, use Learn my voice a few times."
      >
        <Row
          Icon={Ear}
          title="Listen for “Hey Neural”"
          detail={status.activity === "awake" ? "In a call with Neural…" : undefined}
          trailing={
            <Switch
              label="Listen for Hey Neural"
              checked={config.wake_word}
              disabled={!installed("wake") || !installed("vad") || !installed("parakeet")}
              onChange={(wake_word) => {
                void set({ wake_word });
                if (wake_word && config.learned.length < LEARN_TAKES && !learning) void learn();
              }}
            />
          }
        />
        <Row
          Icon={AudioLines}
          title="Learn my voice"
          detail={
            learning
              ? `Say “Hey Neural” into ${mic}, the way you usually would (${take} of ${LEARN_TAKES})…`
              : config.learned.length > 0
                ? `${config.learned.length} recordings learned. More help most: other rooms, near and far.`
                : `Say “Hey Neural” three times so it reacts to your voice the first time (${mic}).`
          }
          trailing={
            <span className="flex items-center gap-1">
              {config.learned.length > 0 && (
                <Button size="xs" variant="quiet" onClick={() => set({ learned: [] })}>
                  Forget
                </Button>
              )}
              <Button size="xs" variant="ghost" disabled={!installed("wake") || !installed("vad")} onClick={() => void learn()}>
                {learning ? "Stop" : "Record"}
              </Button>
            </span>
          }
        />
      </List>
      <OtherAudio api={api} config={config} set={set} mac={mac} />
    </>
  );
}

/**
 * "Lower other audio while I talk" (desktop `duck.rs`). Music keeps playing quietly while the user
 * dictates, after "Hey Neural" and in calls. The Music/Spotify row exists only on the Mac itself
 * (`duckApps`): its Allow button shows a macOS prompt, which must never pop up from a remote.
 */
function OtherAudio({ api, config, set, mac }: { api: VoiceApi; config: VoiceConfig; set: (p: Partial<VoiceConfig>) => void; mac: boolean }) {
  // Hosts before this setting do not send it: hide the block instead of a switch that does nothing.
  if (config.duck === undefined) return null;
  const on = config.duck;
  const level = String(config.duck_level ?? 20);
  return (
    <List
      label="Other audio"
      footer={
        mac
          ? "Music and videos keep playing quietly while you dictate or say “Hey Neural”, and come back when you are done. In calls Neural’s voice stays loud, so only Music and Spotify are lowered, once you allow it."
          : "Music, videos and other apps keep playing quietly while you dictate, say “Hey Neural” or are in a call, and come back when you are done."
      }
    >
      <Row Icon={Volume1} title="Lower other audio while I talk" trailing={<Switch label="Lower other audio while I talk" checked={on} onChange={(duck) => set({ duck })} />} />
      {on && (
        <Row
          Icon={Volume}
          title="Down to"
          trailing={
            <Segmented
              size="sm"
              label="Down to"
              value={level}
              options={DUCK_LEVELS.map((l) => ({ value: String(l), label: `${l} %` }))}
              onChange={(v) => set({ duck_level: Number(v) })}
            />
          }
        />
      )}
      {on && mac && api.duckApps && <CallPlayers api={api} />}
    </List>
  );
}

function CallPlayers({ api }: { api: VoiceApi }) {
  const [apps, setApps] = useState<DuckApp[] | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    api.duckApps?.().then(setApps, () => {});
  }, [api]);
  if (!apps) return null;
  const named = (access: DuckApp["access"]) => apps.filter((a) => a.access === access).map((a) => a.name);
  const [allowed, denied, closed] = [named("allowed"), named("denied"), named("closed")];
  const open = apps.some((a) => a.access === "ask" || a.access === "closed");
  const detail = [
    allowed.length > 0 && `Allowed for ${allowed.join(" and ")}.`,
    denied.length > 0 && `Turned off for ${denied.join(" and ")} in System Settings → Privacy & Security → Automation.`,
    apps.some((a) => a.access === "ask") ? "Press Allow and confirm in the macOS prompt." : open && `Open ${closed.join(" or ")}, then press Allow (macOS asks once per app).`,
  ]
    .filter(Boolean)
    .join(" ");
  // Also re-checks: a player opened since this page loaded can be asked now.
  const allow = async () => {
    setAsking(true);
    try {
      setApps((await api.allowDuckApps?.()) ?? apps);
    } catch (e) {
      fail(e);
    } finally {
      setAsking(false);
    }
  };
  return (
    <Row
      Icon={Music}
      title="Music and Spotify in calls"
      detail={detail}
      wrap
      trailing={
        open ? (
          <Button size="xs" variant="ghost" busy={asking} onClick={allow}>
            Allow
          </Button>
        ) : undefined
      }
    />
  );
}

function VoiceModels({ client, models, hostName }: { client: DaemonClient; models: ModelInfo[] | null; hostName: string | null }) {
  if (!models) return null;
  return (
    <List
      label="Voice models"
      footer={`Downloaded once from the sherpa-onnx releases and checked against a fixed checksum. They run on ${hostName ?? "this computer"}, for dictation and for calls with Neural.`}
    >
      {models.map((m) => (
        <Row
          key={m.id}
          title={m.name}
          detail={m.error ?? `${m.purpose} · ${megabytes(m.size)}`}
          trailing={
            m.progress != null ? (
              <Meter value={m.progress} size="sm" variant="mono" className="w-24" label={`${Math.round(m.progress * 100)} %`} />
            ) : m.installed ? (
              <span className="flex items-center gap-2">
                <Pill size="sm" tone="success">
                  Installed
                </Pill>
                <DeleteModel name={m.name} onDelete={() => void client.req({ m: "host_model_delete", p: { id: m.id } }).catch(fail)} />
              </span>
            ) : (
              <Button size="xs" variant="ghost" Icon={Download} onClick={() => client.req({ m: "host_model_download", p: { id: m.id } }).catch(fail)}>
                {m.error ? "Retry" : "Download"}
              </Button>
            )
          }
        />
      ))}
    </List>
  );
}

function DeleteModel({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button size="sm" variant="quiet" Icon={Trash2} aria-label={`Delete ${name}`} onClick={() => setAsking(true)} />
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={onDelete}
        title={`Delete ${name}?`}
        message="You can download it again any time."
        confirmLabel="Delete"
        destructive
        Icon={Trash2}
      />
    </>
  );
}

/** Updates of the host computer, from a remote: check, install, follow the restart. */
export function HostUpdates({ hostName }: { hostName: string }) {
  const client = useClient();
  const { info, checking, installing, error } = useHostUpdate();
  useEffect(() => {
    void checkHostUpdate(client);
    return watchHostUpdate(client);
  }, [client]);
  const behind = info && info.service !== info.current;
  return (
    <List
      label={`Updates on ${hostName}`}
      footer={
        `Installing updates the NeuralAgent app on ${hostName} and restarts it; agents keep running. This page reloads by itself once the host runs the new version.` +
        (behind ? ` The service still runs ${info.service} and switches over once no agent works.` : "")
      }
    >
      <Row title="Version" trailing={<span className="text-small text-dim">{info?.current ?? "…"}</span>} />
      {error && (
        <Row title="Update problem" detail={error} />
      )}
      {installing ? (
        <Row
          title={`Installing ${installing.version}`}
          detail={installing.progress === null ? `Restarting NeuralAgent on ${hostName}…` : "Downloading…"}
          trailing={
            <Meter
              value={installing.progress ?? 1}
              size="sm"
              variant="mono"
              className="w-24"
              label={installing.progress === null ? "Restarting" : `${Math.round(installing.progress * 100)} %`}
            />
          }
        />
      ) : info?.available ? (
        <Row
          Icon={Check}
          title={`Version ${info.available} is available`}
          detail={info.app_running ? info.notes ?? undefined : `Open NeuralAgent on ${hostName} to install it.`}
          trailing={
            <Button size="sm" variant="tint" disabled={!info.app_running} onClick={() => void installHostUpdate(client)}>
              Install and restart
            </Button>
          }
        />
      ) : (
        <Row
          title={info ? "Up to date" : "Check for updates"}
          trailing={
            <Button size="sm" variant="tint" busy={checking} onClick={() => void checkHostUpdate(client)}>
              Check
            </Button>
          }
        />
      )}
    </List>
  );
}

/** Rename, approve and remove workspaces; from any client (phones too). Each row opens its page. */
export function WorkspaceSettings({ hostName }: { hostName: string | null }) {
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const sessions = useDaemon((c) => c.state?.sessions);
  const nav = useSettingsNav();
  if (!workspaces || workspaces.length === 0) return <Empty Icon={Folder} title="No workspaces yet" detail="Add a project folder from the Workspaces tab." />;
  return (
    <List
      label={hostName ? `On ${hostName}` : undefined}
      footer="Approved workspaces let phones, browsers and Neural start and control agents there without asking."
    >
      {workspaces.map((w) => {
        const running = Object.values(sessions ?? {}).filter((x) => x.workspace_id === w.id && x.alive).length;
        return (
          <Row
            key={w.id}
            Icon={w.git ? FolderGit2 : Folder}
            title={w.name}
            detail={w.path}
            value={running ? `${running} running` : w.approved ? "Approved" : undefined}
            onClick={() => nav.push(`ws-${w.id}`, w.name, <WorkspaceDetail id={w.id} />)}
          />
        );
      })}
    </List>
  );
}

/** One workspace: name, approval, and removing it (the folder and its files stay). */
export function WorkspaceDetail({ id }: { id: string }) {
  const client = useClient();
  const nav = useSettingsNav();
  const w = useDaemon((c) => c.state?.workspaces.find((x) => x.id === id));
  const [name, setName] = useState(w?.name ?? "");
  const [asking, setAsking] = useState(false);
  useEffect(() => setName(w?.name ?? ""), [w?.name]);
  if (!w) return <Empty Icon={Folder} title="Workspace removed" detail="The folder and its files are still on the computer." />;
  const update = (p: object) => client.req({ m: "workspace_update", p: { id: w.id, ...p } }).catch(fail);
  return (
    <div className="flex flex-col gap-7">
      <List label="Name">
        <div className="px-4 py-3">
          <Input
            value={name}
            aria-label="Workspace name"
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={() => name.trim() && name.trim() !== w.name && void update({ name: name.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
      </List>
      <List footer="Phones, browsers and Neural may start and control agents here without asking.">
        <Row Icon={ShieldCheck} title="Approved" trailing={<Switch label="Approved" checked={w.approved} onChange={(approved) => void update({ approved })} />} />
        <Row Icon={w.git ? FolderGit2 : Folder} title="Folder" detail={w.path} wrap />
        {w.git && <Row Icon={GitBranch} title="Branch" value={w.git.branch} />}
      </List>
      <Button variant="danger" size="lg" Icon={Trash2} className="w-full" onClick={() => setAsking(true)}>
        Remove workspace
      </Button>
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={async () => {
          try {
            await client.req({ m: "workspace_remove", p: { id: w.id } });
            nav.back();
          } catch (e) {
            fail(e);
          }
        }}
        title={`Remove ${w.name}?`}
        message="It leaves NeuralAgent; the folder and its files stay on the computer."
        confirmLabel="Remove"
        destructive
        Icon={Trash2}
      />
    </div>
  );
}
