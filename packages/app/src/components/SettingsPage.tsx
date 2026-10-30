import type { DiscordPresence, KeepAwake, LlmCheck, LlmProvider, LlmSettings, Settings } from "@neuralagent/protocol";
import { Button, Callout, Field, Input, List, Meter, Page, Pill, Row, Segmented, Switch, toast } from "@neuralagent/ui";
import { AudioLines, Download, Ear, Keyboard, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { useClient, useDaemon, usePlatform } from "../lib/store";
import { HOTKEYS, megabytes, type VoiceApi, type VoiceConfig, type VoiceStatus } from "../lib/voice";

export function SettingsPage() {
  const platform = usePlatform();
  return (
    <Page title="Settings" eyebrow="NeuralAgent">
      <div className="flex flex-col gap-6 pb-8">
        {platform.kind === "desktop" && <NeuralSettings />}
        {platform.voice && <VoiceSettings voice={platform.voice} mac={!!platform.trafficLights} />}
        <GeneralSettings />
      </div>
    </Page>
  );
}

/** Live voice status from the desktop shell. */
function useVoice(voice: VoiceApi) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    voice.status().then(setStatus, () => {});
    return voice.onStatus(setStatus);
  }, [voice]);
  return status;
}

function VoiceSettings({ voice, mac }: { voice: VoiceApi; mac: boolean }) {
  const status = useVoice(voice);
  const [learning, setLearning] = useState(false);
  if (!status) return null;
  const { config } = status;
  const installed = (id: string) => status.models.find((m) => m.id === id)?.installed ?? false;
  const set = (patch: Partial<VoiceConfig>) => voice.set({ ...config, ...patch }).catch((e) => toast(String(e), { tone: "danger" }));

  const learn = async () => {
    setLearning(true);
    try {
      await voice.learn();
      toast("Learned. Say it a few more times in different ways for best results.", { tone: "success" });
    } catch (e) {
      toast(String(e), { tone: "danger" });
    } finally {
      setLearning(false);
    }
  };

  return (
    <>
      {status.error && <Callout tone="warning">{status.error}</Callout>}
      <List label="Dictation" footer="Hold the shortcut, speak, let go: the text is typed wherever your cursor is, in any app. Speech never leaves this computer.">
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
      </List>
      <List
        label="Wake word"
        footer="Say “Hey Neural” and then what you want, in one breath or after a pause. If it does not react to your voice, use Learn my voice a few times."
      >
        <Row
          Icon={Ear}
          title="Listen for “Hey Neural”"
          detail={status.activity === "awake" ? "Listening for your command…" : undefined}
          trailing={
            <Switch
              label="Listen for Hey Neural"
              checked={config.wake_word}
              disabled={!installed("wake") || !installed("vad") || !installed("parakeet")}
              onChange={(wake_word) => set({ wake_word })}
            />
          }
        />
        <Row
          Icon={AudioLines}
          title="Learn my voice"
          detail={learning ? "Say “Hey Neural” now…" : config.learned.length > 0 ? `${config.learned.length} recordings learned` : "Record yourself saying “Hey Neural”."}
          trailing={
            <span className="flex items-center gap-1">
              {config.learned.length > 0 && (
                <Button size="xs" variant="quiet" onClick={() => set({ learned: [] })}>
                  Forget
                </Button>
              )}
              <Button size="xs" variant="ghost" busy={learning} disabled={!installed("wake") || !installed("vad")} onClick={learn}>
                Record
              </Button>
            </span>
          }
        />
      </List>
      <List label="Voice models" footer="Downloaded once from the sherpa-onnx releases and checked against a fixed checksum. Everything runs on this computer.">
        {status.models.map((m) => (
          <Row
            key={m.id}
            title={m.name}
            detail={m.error ?? `${m.purpose} · ${megabytes(m.size)}`}
            trailing={
              m.installed ? (
                <Pill size="sm" tone="success">
                  Installed
                </Pill>
              ) : m.progress !== undefined ? (
                <Meter value={m.progress} size="sm" variant="mono" className="w-24" label={`${Math.round(m.progress * 100)} %`} />
              ) : (
                <Button size="xs" variant="ghost" Icon={Download} onClick={() => voice.download(m.id).catch((e) => toast(String(e), { tone: "danger" }))}>
                  {m.error ? "Retry" : "Download"}
                </Button>
              )
            }
          />
        ))}
      </List>
    </>
  );
}

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
function NeuralSettings() {
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
    <List label="Neural" footer="Neural, the orchestrator, runs on your own model. Keys stay on this computer (in the system keychain).">
      <Row
        title="Provider"
        trailing={<Segmented<LlmProvider> size="sm" scroll label="Model provider" value={llm.provider} options={PROVIDERS} onChange={switchTo} />}
      />
      {llm.provider !== "ollama" && (
        <div className="flex flex-col gap-2 p-3">
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
        </div>
      )}
      <div className="flex flex-col gap-3 p-3">
        {text("model", "Chat model", provider.models[0] || "Model name")}
        {text("call_model", "Call model", "Same as chat", "Used in calls, where a fast answer matters most.")}
        {text("base_url", "Address", provider.url)}
      </div>
      <Row title="Check the connection" trailing={<Button size="sm" variant="tint" busy={testing} onClick={test}>Test</Button>} />
    </List>
  );
}
