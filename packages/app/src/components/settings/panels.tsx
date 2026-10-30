// The content of each Settings page (Appearance, Neural, Calls, Advanced, Discord, About). The
// shell in SettingsPage.tsx shows them as pushed pages on phones and as the right column on
// desktop. Choices are iOS check lists, not small segmented controls.
import type { CallPreviewAudio, CallSettings, DiscordPresence, KeepAwake, LlmCheck, LlmProvider, LlmSettings, Settings } from "@neuralagent/protocol";
import { Button, Field, Input, List, Pill, Row, Segmented, Switch, cn, haptic, toast } from "@neuralagent/ui";
import { Check, ExternalLink, Globe, Play, ScrollText, Shield } from "lucide-react";
import { useState, type ReactNode } from "react";
import { playPreview } from "../../lib/call";
import { setCallRoute, useBindCallAudio, useCallRoute, useCanPickRoute, type CallRoute } from "../../lib/callaudio";
import { useClient, useDaemon, usePlatform } from "../../lib/store";
import { ACCENTS, accentOf, APPEARANCES, resolvedAppearance, SCHEMES, useTheme } from "../../lib/theme";
import { openUpdateDialog, useUpdates } from "../../lib/updates";
import { BrandMark } from "../BrandMark";
import { CHANGELOG_URL } from "../ReleaseNotes";

const fail = (e: unknown) => toast((e as Error).message ?? String(e), { tone: "danger" });

/** One option of an iOS check list: the chosen row carries an accent check mark. */
export function Choice({ title, detail, checked, onSelect, Icon }: { title: string; detail?: string; checked: boolean; onSelect: () => void; Icon?: Parameters<typeof Row>[0]["Icon"] }) {
  return (
    <Row
      Icon={Icon}
      title={title}
      detail={detail}
      chevron={false}
      onClick={() => {
        if (checked) return;
        haptic("select");
        onSelect();
      }}
      trailing={checked ? <Check className="size-icon text-accent" strokeWidth={2.4} aria-label="Selected" /> : <span className="size-icon" />}
    />
  );
}

function useSettings() {
  const client = useClient();
  const settings = useDaemon((c) => c.state?.settings);
  const set = (patch: Partial<Settings>) => settings && client.req({ m: "settings_set", p: { settings: { ...settings, ...patch } } }).catch(fail);
  return { settings, set };
}

/* ── Appearance ─────────────────────────────────────────────────────────── */

/** A tiny app window: ground, a card, two lines and the accent. `mode` is drawn even when the
 *  app shows the other one: light via `data-appearance`, dark (inside light) via inverse tokens. */
function Mini({ mode, className }: { mode: "light" | "dark"; className?: string }) {
  const shown = resolvedAppearance(useTheme((t) => t.appearance) ?? "system");
  const inverse = mode === "dark" && shown === "light";
  return (
    <div data-appearance={mode === "light" && shown === "dark" ? "light" : undefined} className={cn("h-full", className)}>
      <div className={cn("flex h-full flex-col gap-1.5 p-2.5", inverse ? "bg-bright" : "bg-bg")}>
        <div className={cn("h-1.5 w-1/2 rounded-full", inverse ? "bg-on-bright/35" : "bg-fill-4")} />
        <div className={cn("flex flex-1 flex-col justify-end gap-1 rounded-item p-1.5", inverse ? "bg-on-bright/10" : "bg-card shadow-rim")}>
          <div className={cn("h-1 w-4/5 rounded-full", inverse ? "bg-on-bright/25" : "bg-fill-4")} />
          <div className="flex items-center gap-1">
            <div className={cn("h-1 flex-1 rounded-full", inverse ? "bg-on-bright/25" : "bg-fill-3")} />
            <div className="size-2.5 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearancePanel() {
  const { scheme, accent, appearance, setScheme, setAccent, setAppearance } = useTheme();
  const mode = appearance ?? "system";
  const own = accentOf(scheme, null);
  return (
    <div className="flex flex-col gap-7">
      <section>
        <div className="mb-2 px-4 text-footnote text-dim uppercase">Mode</div>
        <div className="surface grid grid-cols-3 gap-3 rounded-list p-4" role="radiogroup" aria-label="Appearance">
          {APPEARANCES.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={mode === a.id}
              onClick={() => {
                haptic("select");
                setAppearance(a.id);
              }}
              className="pressable flex flex-col items-center gap-2"
            >
              <div
                className={cn(
                  "flex aspect-3/4 w-full overflow-hidden rounded-tile transition-shadow md:aspect-4/3",
                  mode === a.id ? "ring-2 ring-accent" : "shadow-edge",
                )}
              >
                {a.id === "system" ? (
                  <>
                    <Mini mode="light" className="w-1/2" />
                    <Mini mode="dark" className="w-1/2" />
                  </>
                ) : (
                  <Mini mode={a.id} className="w-full" />
                )}
              </div>
              <span className={cn("text-subhead", mode === a.id ? "text-bright" : "text-dim")}>{a.name}</span>
              <span
                aria-hidden
                className={cn("grid size-5 place-items-center rounded-full transition-colors", mode === a.id ? "bg-accent text-on-color" : "bg-fill-3")}
              >
                {mode === a.id && <Check className="size-3" strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 px-4 text-footnote text-dim uppercase">Theme</div>
        <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Theme">
          {SCHEMES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === scheme}
              data-scheme={s.id}
              data-accent={accentOf(s.id, accent)}
              onClick={() => {
                haptic("select");
                setScheme(s.id);
              }}
              className={cn("pressable flex flex-col gap-2 rounded-list bg-bg p-2 text-left transition-shadow", s.id === scheme ? "ring-2 ring-accent" : "shadow-edge")}
            >
              <div className="flex h-14 flex-col justify-end gap-1 rounded-tile bg-chrome p-2">
                <div className="h-1.5 w-3/4 rounded-full bg-fill-4" />
                <div className="flex items-center gap-1">
                  <div className="h-1.5 flex-1 rounded-full bg-card-3" />
                  <div className="size-3 rounded-full bg-accent" />
                </div>
              </div>
              <div className="flex items-center justify-between px-1 pb-0.5">
                <span className="text-subhead text-ink">{s.name}</span>
                {s.id === scheme && <Check className="size-4 text-accent" strokeWidth={2.4} />}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 px-4 text-footnote text-dim uppercase">Accent</div>
        <div className="surface grid grid-cols-5 gap-y-4 rounded-list px-2 py-4" role="radiogroup" aria-label="Accent">
          {[null, ...ACCENTS.map((a) => a.id)].map((id) => {
            const on = accent === id;
            const name = id === null ? "Theme's own" : ACCENTS.find((a) => a.id === id)!.name;
            return (
              <button
                key={id ?? "own"}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={name}
                title={name}
                data-accent={id ?? own}
                onClick={() => {
                  haptic("select");
                  setAccent(id);
                }}
                className="pressable flex min-w-0 flex-col items-center gap-1.5"
              >
                <span className={cn("grid size-10 place-items-center rounded-full bg-accent transition-shadow", on && "ring-2 ring-accent ring-offset-2 ring-offset-card")}>
                  {on && <Check className="size-4 text-on-color" strokeWidth={3} />}
                </span>
                <span className={cn("max-w-full truncate text-caption", on ? "text-bright" : "text-dim")}>{id === null ? "Theme" : name}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-4 text-footnote text-dim">Saved on this device only.</p>
      </section>
    </div>
  );
}

export function appearanceSummary(): string {
  const t = useTheme.getState();
  const mode = APPEARANCES.find((a) => a.id === (t.appearance ?? "system"))?.name ?? "System";
  return `${mode} · ${SCHEMES.find((s) => s.id === t.scheme)?.name ?? ""}`;
}

/* ── Calls ──────────────────────────────────────────────────────────────── */

/** Earpiece (quiet, default) or speaker for calls with Neural; phones, and browsers that can choose. */
function CallAudio() {
  useBindCallAudio();
  const can = useCanPickRoute();
  const { route, output } = useCallRoute();
  const platform = usePlatform();
  if (!can) {
    // Computers have no earpiece; a browser on a phone cannot choose, so say so.
    return platform.kind === "web" && /Android|iPhone|iPad/.test(navigator.userAgent) ? (
      <List label="Call audio on this device" footer="This browser cannot pick the earpiece: calls play through the phone's current output. The NeuralAgent app for Android can.">
        <Row title="Output" value="Follows the phone" />
      </List>
    ) : null;
  }
  const pick = (r: CallRoute) => setCallRoute(r);
  return (
    <List
      label="Neural's voice plays on"
      footer={output === "headset" ? "A headset is connected and is used for calls." : "Earpiece is quiet, like a phone call. A connected headset is always used."}
    >
      <Choice title="Earpiece" detail="Hold the phone to your ear" checked={route === "earpiece"} onSelect={() => pick("earpiece")} />
      <Choice title="Speaker" detail="Plays out loud" checked={route === "speaker"} onSelect={() => pick("speaker")} />
    </List>
  );
}

const SPEEDS = [
  { value: 0.95, label: "Calm" },
  { value: 1.05, label: "Normal" },
  { value: 1.15, label: "Brisk" },
];

/** How Neural sounds in calls (Supertonic: five higher voices 0–4, five lower 5–9), with a preview. */
function CallVoice({ hostName }: { hostName: string | null }) {
  const client = useClient();
  const { settings } = useSettings();
  const [playing, setPlaying] = useState(false);
  if (!settings) return null;
  const call = settings.call;
  const kind = call.voice < 5 ? "high" : "low";
  const preview = async (c: CallSettings) => {
    setPlaying(true);
    try {
      const lang = navigator.language.startsWith("de") ? "de" : "en";
      const r = (await client.req({ m: "call_preview", p: { voice: c.voice, speed: c.speed, lang } })) as CallPreviewAudio;
      await playPreview(r.d, r.rate);
    } catch (e) {
      fail(e);
    } finally {
      setPlaying(false);
    }
  };
  const set = (patch: Partial<CallSettings>) => {
    const next = { ...call, ...patch };
    client.req({ m: "settings_set", p: { settings: { ...settings, call: next } } }).catch(fail);
    void preview(next);
  };
  const speed = SPEEDS.find((x) => Math.abs(x.value - call.speed) < 0.01)?.value ?? 1.05;
  return (
    <>
      <List label={hostName ? `Neural's voice on ${hostName}` : "Neural's voice"}>
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <Segmented
            label="Voice pitch"
            value={kind}
            options={[
              { value: "high", label: "Higher" },
              { value: "low", label: "Lower" },
            ]}
            onChange={(k) => set({ voice: (k === "high" ? 0 : 5) + (call.voice % 5) })}
          />
          <div className="flex justify-between gap-2" role="radiogroup" aria-label="Voice">
            {[0, 1, 2, 3, 4].map((n) => {
              const on = call.voice % 5 === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`Voice ${n + 1}`}
                  onClick={() => set({ voice: (kind === "high" ? 0 : 5) + n })}
                  className={cn(
                    "pressable grid size-12 place-items-center rounded-full text-headline tabular-nums transition-colors",
                    on ? "bg-accent text-on-color" : "bg-fill-2 text-ink",
                  )}
                >
                  {n + 1}
                </button>
              );
            })}
          </div>
        </div>
        <Row
          Icon={Play}
          title={playing ? "Playing…" : "Hear it"}
          onClick={() => !playing && void preview(call)}
          chevron={false}
        />
      </List>
      <List label="Pace" footer={`Neural listens and speaks on ${hostName ?? "this computer"}; phones only send and play the audio.`}>
        {SPEEDS.map((s) => (
          <Choice key={s.value} title={s.label} checked={speed === s.value} onSelect={() => set({ speed: s.value })} />
        ))}
      </List>
    </>
  );
}

export function CallsPanel({ hostName }: { hostName: string | null }) {
  return (
    <div className="flex flex-col gap-7">
      <CallAudio />
      <CallVoice hostName={hostName} />
    </div>
  );
}

/* ── Neural ─────────────────────────────────────────────────────────────── */

export const PROVIDERS: { value: LlmProvider; label: string; detail: string; url: string; models: [string, string] }[] = [
  { value: "neuralhub", label: "NeuralHub", detail: "One key for many models", url: "https://api.neuralhub.dev/v1", models: ["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"] },
  { value: "anthropic", label: "Anthropic", detail: "Claude models", url: "https://api.anthropic.com/v1", models: ["claude-sonnet-5-5", "claude-haiku-5-5"] },
  { value: "openai", label: "OpenAI", detail: "Or any OpenAI-compatible server", url: "https://api.openai.com/v1", models: ["", ""] },
  { value: "ollama", label: "Ollama", detail: "Local models, no key", url: "http://127.0.0.1:11434/v1", models: ["", ""] },
];

/** Bring your own key: which model Neural uses. Keys go to the daemon and never come back. */
export function NeuralPanel({ hostName }: { hostName: string | null }) {
  const client = useClient();
  const { settings } = useSettings();
  const keys = useDaemon((c) => c.state?.orchestrator.keys);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  if (!settings || !keys) return null;
  const llm = settings.llm;
  const provider = PROVIDERS.find((p) => p.value === llm.provider) ?? PROVIDERS[0]!;
  const hasKey = keys.includes(llm.provider);
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
      if (r.ok) toast(`${r.model} answered in ${r.ms} ms`, { tone: "success" });
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
    <div className="flex flex-col gap-7">
      <List label="Provider" footer={`Neural, the orchestrator, runs on your own model${hostName ? ` on ${hostName}` : ""}.`}>
        {PROVIDERS.map((p) => (
          <Choice key={p.value} title={p.label} detail={p.detail} checked={llm.provider === p.value} onSelect={() => switchTo(p.value)} />
        ))}
      </List>
      {llm.provider !== "ollama" && (
        <List label="API key" footer={`Keys stay on ${hostName ?? "this computer"} (in the system keychain) and are never sent back.`}>
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body text-bright">{provider.label} key</span>
              {hasKey ? <Pill tone="success" dot>Saved</Pill> : <Pill tone="warning">Not set</Pill>}
            </div>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              placeholder={hasKey ? "Paste a new key to replace it" : `Paste your ${provider.label} API key`}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex gap-2">
              <Button variant="primary" disabled={!key.trim()} onClick={() => saveKey(key.trim())} className="flex-1">
                Save key
              </Button>
              {hasKey && (
                <Button variant="quiet" onClick={() => saveKey(null)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </List>
      )}
      <List label="Models">
        <div className="flex flex-col gap-3 px-4 py-3.5">
          {text("model", "Chat model", provider.models[0] || "Model name")}
          {text("call_model", "Call model", "Same as chat", "Used in calls, where a fast answer matters most.")}
          {text("base_url", "Address", provider.url)}
        </div>
      </List>
      <List>
        <Row Icon={Shield} title={testing ? "Testing…" : "Test the connection"} onClick={() => !testing && void test()} chevron={false} />
      </List>
    </div>
  );
}

/* ── Advanced, Discord ──────────────────────────────────────────────────── */

const KEEP: { value: KeepAwake; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "The computer sleeps as usual" },
  { value: "while_working", label: "While agents work", detail: "Also on battery" },
  { value: "while_working_on_power", label: "While agents work, on power", detail: "Not on battery" },
];

export function AdvancedPanel() {
  const { settings, set } = useSettings();
  if (!settings) return null;
  return (
    <div className="flex flex-col gap-7">
      <List label="Keep the computer awake" footer="Keeps the computer from sleeping so long tasks finish.">
        {KEEP.map((k) => (
          <Choice key={k.value} title={k.label} detail={k.detail} checked={settings.keep_awake === k.value} onSelect={() => set({ keep_awake: k.value })} />
        ))}
      </List>
      <List footer="Agents that ran when the computer or the service stopped start again where they were.">
        <Row
          title="Resume agents after a restart"
          trailing={<Switch label="Resume agents after a restart" checked={settings.resume_on_start} onChange={(resume_on_start) => set({ resume_on_start })} />}
        />
      </List>
    </div>
  );
}

const PRESENCE: { value: DiscordPresence; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "Nothing is shown" },
  { value: "general", label: "General", detail: "Shows that you use NeuralAgent" },
  { value: "detailed", label: "Detailed", detail: "Adds the workspace and how many agents run" },
];

export function DiscordPanel() {
  const { settings, set } = useSettings();
  if (!settings) return null;
  return (
    <List label="Rich presence" footer="Shown on your Discord profile while the Discord app runs on this computer.">
      {PRESENCE.map((p) => (
        <Choice key={p.value} title={p.label} detail={p.detail} checked={settings.discord_presence === p.value} onSelect={() => set({ discord_presence: p.value })} />
      ))}
    </List>
  );
}

export const presenceLabel = (v: DiscordPresence | undefined) => PRESENCE.find((p) => p.value === v)?.label;
export const keepAwakeLabel = (v: KeepAwake | undefined) => (v === "off" ? "Off" : v ? "On" : undefined);

/* ── About ──────────────────────────────────────────────────────────────── */

export function AboutPanel({ children }: { children?: ReactNode }) {
  const platform = usePlatform();
  const u = useUpdates();
  const site = "https://agent.neuralhub.dev";
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <span className="grid size-16 place-items-center rounded-list bg-card text-bright shadow-edge">
          <BrandMark size={34} />
        </span>
        <div className="mt-2 text-title-3 text-bright">NeuralAgent</div>
        <div className="text-subhead text-dim tabular-nums">Version {u.current || "…"}</div>
      </div>
      <List>
        <Row Icon={ScrollText} title={`What's new in ${u.current || "this version"}`} onClick={() => openUpdateDialog("current")} />
        <Row Icon={ExternalLink} title="Full changelog" onClick={() => platform.openExternal(CHANGELOG_URL)} />
        <Row Icon={Globe} title="Website" onClick={() => platform.openExternal(site)} />
      </List>
      <List>
        <Row title="Privacy" onClick={() => platform.openExternal(`${site}/privacy`)} />
        <Row title="Terms" onClick={() => platform.openExternal(`${site}/terms`)} />
        <Row title="Imprint" onClick={() => platform.openExternal(`${site}/imprint`)} />
      </List>
      {children}
    </div>
  );
}
