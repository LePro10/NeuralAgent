import type { CallPreviewAudio, CallSettings, DiscordPresence, KeepAwake, LlmCheck, LlmProvider, LlmSettings, Settings } from "@neuralagent/protocol";
import { Button, Field, Input, List, Menu, Page, Pill, Row, Segmented, Switch, toast } from "@neuralagent/ui";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { playPreview } from "../lib/call";
import { setCallRoute, useBindCallAudio, useCallRoute, useCanPickRoute, type CallRoute } from "../lib/callaudio";
import { useClient, useDaemon, usePlatform } from "../lib/store";
import { ACCENTS, accentOf, SCHEMES, useTheme } from "../lib/theme";
import { HostUpdates, HostVoiceSettings, LocalUpdates, WorkspaceSettings } from "./HostSettings";

/** Settings of this device first, then everything of the computer the agents run on (also from a remote). */
export function SettingsPage() {
  const platform = usePlatform();
  const remote = platform.kind !== "desktop";
  const hostName = useDaemon((c) => c.host?.name ?? null);
  return (
    <Page title="Settings" eyebrow="NeuralAgent">
      <div className="flex flex-col gap-6 pb-8">
        {remote && <Section title="This device" note="Only affects this phone or browser." />}
        <Appearance />
        <CallAudio />
        {remote && <Section title={hostName ?? "Host computer"} note="These settings change the computer your agents run on." />}
        <NeuralSettings hostName={remote ? hostName : null} />
        <CallVoice hostName={remote ? hostName : null} />
        <HostVoiceSettings mac={!!platform.trafficLights} hostName={remote ? hostName : null} />
        <WorkspaceSettings hostName={remote ? hostName : null} />
        <GeneralSettings />
        {platform.updates ? <LocalUpdates api={platform.updates} /> : remote && <HostUpdates hostName={hostName ?? "the host"} />}
      </div>
    </Page>
  );
}

function Section({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-1 pt-2">
      <h2 className="text-title text-bright">{title}</h2>
      <p className="text-small text-dim">{note}</p>
    </div>
  );
}

/** Earpiece (quiet, default) or speaker for calls with Neural; phones, and browsers that can choose. */
function CallAudio() {
  useBindCallAudio();
  const can = useCanPickRoute();
  const { route, output } = useCallRoute();
  const platform = usePlatform();
  if (!can) {
    // Computers have no earpiece; a browser on a phone cannot choose, so say so.
    return platform.kind === "web" && /Android|iPhone|iPad/.test(navigator.userAgent) ? (
      <List label="Call audio" footer="This browser cannot pick the earpiece: calls play through the phone's current output. The NeuralAgent app for Android can."><Row title="Output" detail="Follows the phone" /></List>
    ) : null;
  }
  return (
    <List
      label="Call audio"
      footer={
        output === "headset"
          ? "A headset is connected and is used for calls."
          : "Earpiece is quiet, like a phone call: hold the phone to your ear. Speaker plays out loud. A connected headset is always used."
      }
    >
      <Row
        title="Neural's voice plays on"
        trailing={
          <Segmented<CallRoute>
            size="sm"
            label="Call audio"
            value={route}
            options={[
              { value: "earpiece", label: "Earpiece" },
              { value: "speaker", label: "Speaker" },
            ]}
            onChange={setCallRoute}
          />
        }
      />
    </List>
  );
}

/** Theme of this device: each card is drawn in its own scheme and accent. */
function Appearance() {
  const { scheme, accent, setScheme, setAccent } = useTheme();
  const current = accentOf(scheme, accent);
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow px-1">Appearance</div>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6" role="radiogroup" aria-label="Theme">
        {SCHEMES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === scheme}
            data-scheme={s.id}
            data-accent={accentOf(s.id, accent)}
            onClick={() => setScheme(s.id)}
            className="hoverable flex flex-col gap-2 rounded-stat bg-bg p-2 text-left shadow-edge"
          >
            <div className="flex h-12 flex-col justify-end gap-1 rounded-tile bg-chrome p-1.5">
              <div className="h-1.5 w-3/4 rounded-full bg-fill-4" />
              <div className="flex items-center gap-1">
                <div className="h-1.5 flex-1 rounded-full bg-card-3" />
                <div className="size-2.5 rounded-full bg-accent" />
              </div>
            </div>
            <div className="flex items-center justify-between px-0.5">
              <span className="text-detail text-ink">{s.name}</span>
              {s.id === scheme && <Check size={13} className="text-accent" />}
            </div>
          </button>
        ))}
      </div>
      <List footer="Saved on this device only.">
        <Row
          title="Accent"
          trailing={
            <Menu
              title="Accent"
              items={[
                { label: "Theme's own", checked: accent === null, onSelect: () => setAccent(null) },
                ...ACCENTS.map((a) => ({ label: a.name, checked: accent === a.id, onSelect: () => setAccent(a.id) })),
              ]}
              trigger={(show) => (
                <Button size="sm" variant="quiet" onClick={show}>
                  <span className="size-2.5 rounded-full bg-accent" />
                  {accent ? ACCENTS.find((a) => a.id === accent)?.name : `Theme's own (${ACCENTS.find((a) => a.id === current)?.name})`}
                  <ChevronDown size={12} />
                </Button>
              )}
            />
          }
        />
      </List>
    </div>
  );
}

/** This app's version, update check and install. Agents keep running through an update. */
function GeneralSettings() {
  const client = useClient();
  const settings = useDaemon((c) => c.state?.settings);
  if (!settings) return null;
  const set = (patch: Partial<Settings>) =>
    client.req({ m: "settings_set", p: { settings: { ...settings, ...patch } } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
  return (
    <>
      <List label="While agents work" footer="Keeps the computer from sleeping so long tasks finish.">
        <Row
          title="Keep awake"
          trailing={
            <Segmented<KeepAwake>
              size="sm"
              label="Keep awake"
              value={settings.keep_awake}
              options={[
                { value: "off", label: "Off" },
                { value: "while_working", label: "Always" },
                { value: "while_working_on_power", label: "On power" },
              ]}
              onChange={(keep_awake) => set({ keep_awake })}
            />
          }
        />
        <Row
          title="Resume agents after a restart"
          trailing={<Switch label="Resume agents after a restart" checked={settings.resume_on_start} onChange={(resume_on_start) => set({ resume_on_start })} />}
        />
      </List>
      <List label="Discord" footer="General shows that you are using NeuralAgent. Detailed adds the workspace and how many agents run.">
        <Row
          title="Rich presence"
          trailing={
            <Segmented<DiscordPresence>
              size="sm"
              label="Discord rich presence"
              value={settings.discord_presence}
              options={[
                { value: "off", label: "Off" },
                { value: "general", label: "General" },
                { value: "detailed", label: "Detailed" },
              ]}
              onChange={(discord_presence) => set({ discord_presence })}
            />
          }
        />
      </List>
    </>
  );
}

const PROVIDERS: { value: LlmProvider; label: string; url: string; models: [string, string] }[] = [
  { value: "neuralhub", label: "NeuralHub", url: "https://api.neuralhub.dev/v1", models: ["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"] },
  { value: "anthropic", label: "Anthropic", url: "https://api.anthropic.com/v1", models: ["claude-sonnet-5-5", "claude-haiku-5-5"] },
  { value: "openai", label: "OpenAI", url: "https://api.openai.com/v1", models: ["", ""] },
  { value: "ollama", label: "Ollama", url: "http://127.0.0.1:11434/v1", models: ["", ""] },
];

/** Bring your own key: which model Neural uses. Keys go to the daemon and never come back. */
// Supertonic's voice styles: five higher (0–4) and five lower (5–9), measured by pitch.
const VOICE_KIND = [
  { value: "high", label: "Higher" },
  { value: "low", label: "Lower" },
] as const;
const VOICE_NUM = ["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n }));
const SPEEDS = [
  { value: "0.95", label: "Calm" },
  { value: "1.05", label: "Normal" },
  { value: "1.15", label: "Brisk" },
];

/** How Neural sounds in calls, with a preview. */
function CallVoice({ hostName }: { hostName: string | null }) {
  const client = useClient();
  const settings = useDaemon((c) => c.state?.settings);
  const [playing, setPlaying] = useState(false);
  if (!settings) return null;
  const call = settings.call;
  const kind = call.voice < 5 ? "high" : "low";
  const set = (patch: Partial<CallSettings>) => {
    const next = { ...call, ...patch };
    client.req({ m: "settings_set", p: { settings: { ...settings, call: next } } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
    void preview(next);
  };
  const preview = async (c: CallSettings) => {
    setPlaying(true);
    try {
      const lang = navigator.language.startsWith("de") ? "de" : "en";
      const r = (await client.req({ m: "call_preview", p: { voice: c.voice, speed: c.speed, lang } })) as CallPreviewAudio;
      await playPreview(r.d, r.rate);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setPlaying(false);
    }
  };
  return (
    <List label={hostName ? `Calls on ${hostName}` : "Calls"} footer={`Neural listens and speaks on ${hostName ?? "this computer"}; phones only send and play the audio.`}>
      <Row
        title="Voice"
        trailing={
          <div className="flex gap-2">
            <Segmented size="sm" label="Voice pitch" value={kind} options={[...VOICE_KIND]} onChange={(k) => set({ voice: (k === "high" ? 0 : 5) + (call.voice % 5) })} />
            <Segmented size="sm" label="Voice" value={String((call.voice % 5) + 1)} options={VOICE_NUM} onChange={(n) => set({ voice: (kind === "high" ? 0 : 5) + Number(n) - 1 })} />
          </div>
        }
      />
      <Row title="Pace" trailing={<Segmented size="sm" label="Speaking pace" value={SPEEDS.find((x) => Math.abs(Number(x.value) - call.speed) < 0.01)?.value ?? "1.05"} options={SPEEDS} onChange={(v) => set({ speed: Number(v) })} />} />
      <Row title="Hear it" trailing={<Button size="sm" variant="tint" busy={playing} onClick={() => void preview(call)}>Play</Button>} />
    </List>
  );
}

function NeuralSettings({ hostName }: { hostName: string | null }) {
  const client = useClient();
  const settings = useDaemon((c) => c.state?.settings);
  const keys = useDaemon((c) => c.state?.orchestrator.keys);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  if (!settings || !keys) return null;
  const llm = settings.llm;
  const provider = PROVIDERS.find((p) => p.value === llm.provider) ?? PROVIDERS[0]!;
  const hasKey = keys.includes(llm.provider);
  const fail = (e: unknown) => toast((e as Error).message, { tone: "danger" });
  const set = (patch: Partial<LlmSettings>) => client.req({ m: "settings_set", p: { settings: { ...settings, llm: { ...llm, ...patch } } } }).catch(fail);
  const switchTo = (p: LlmProvider) => {
    const next = PROVIDERS.find((x) => x.value === p)!;
    // Model names differ per provider; keep custom ones only when staying.
    set({ provider: p, base_url: "", model: next.models[0], call_model: next.models[1] });
    setKey("");
  };
  const saveKey = (value: string | null) =>
    client
      .req({ m: "llm_key_set", p: value ? { provider: llm.provider, key: value } : { provider: llm.provider } })
      .then(() => {
        setKey("");
        toast(value ? "Key saved" : "Key removed");
      }, fail);
  const test = async () => {
    setTesting(true);
    try {
      const r = (await client.req({ m: "llm_test" })) as LlmCheck;
      if (r.ok) toast(`${r.model} answered in ${r.ms} ms`);
      else toast(r.error ?? "No answer", { tone: "danger" });
    } catch (e) {
      fail(e);
    } finally {
      setTesting(false);
    }
  };
  const text = (k: "base_url" | "model" | "call_model", label: string, placeholder: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        key={`${llm.provider}-${k}`}
        defaultValue={llm[k]}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        onBlur={(e) => e.currentTarget.value.trim() !== llm[k] && set({ [k]: e.currentTarget.value.trim() })}
      />
    </Field>
  );
  return (
    <List label={hostName ? `Neural on ${hostName}` : "Neural"} footer={`Neural, the orchestrator, runs on your own model. Keys stay on ${hostName ?? "this computer"} (in the system keychain) and are never sent back.`}>
      {/* Stacked, so the providers get the full width on a phone. */}
      <div className="flex flex-col gap-2 p-3">
        <Field label="Provider">
          <Segmented<LlmProvider> size="sm" scroll label="Model provider" value={llm.provider} options={PROVIDERS} onChange={switchTo} />
        </Field>
        {llm.provider !== "ollama" && (
          <Field label="API key" hint={hasKey ? <Pill size="sm" tone="success">Saved</Pill> : undefined}>
            <div className="flex gap-2">
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.currentTarget.value)}
                placeholder={hasKey ? "Replace the saved key" : `${provider.label} API key`}
                autoComplete="off"
                spellCheck={false}
                className="flex-1"
              />
              <Button size="sm" disabled={!key.trim()} onClick={() => saveKey(key.trim())}>
                Save
              </Button>
              {hasKey && (
                <Button size="sm" variant="tint" onClick={() => saveKey(null)}>
                  Remove
                </Button>
              )}
            </div>
          </Field>
        )}
      </div>
      <div className="flex flex-col gap-3 p-3">
        {text("model", "Chat model", provider.models[0] || "Model name")}
        {text("call_model", "Call model", "Same as chat", "Used in calls, where a fast answer matters most.")}
        {text("base_url", "Address", provider.url)}
      </div>
      <Row title="Check the connection" trailing={<Button size="sm" variant="tint" busy={testing} onClick={test}>Test</Button>} />
    </List>
  );
}
