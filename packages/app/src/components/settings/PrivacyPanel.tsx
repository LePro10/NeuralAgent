// Settings → Privacy and support (docs/notes/insights.md): the anonymous usage ping (on unless
// turned off), what it sends, and "Report a problem": the user writes what happened, chooses
// what to attach, reads the exact JSON and sends it. Neural's recent requests are attached only
// when the user ticks that box. Both run on the computer (the daemon), also from a phone.
import type { Diagnostics, DiagnosticsSent } from "@neuralagent/protocol";
import { Button, Callout, Field, Input, List, Row, Switch, TextArea, toast } from "@neuralagent/ui";
import { Check, Copy, Eye, LifeBuoy, Send } from "lucide-react";
import { useState } from "react";
import { useClient, useDaemon, usePlatform } from "../../lib/store";

const fail = (e: unknown) => toast((e as Error).message ?? String(e), { tone: "danger" });
const SITE = "https://agent.neuralhub.dev";

export function privacySummary(on: boolean | undefined): string {
  return on === false ? "Usage stats off" : "Usage stats on";
}

export function PrivacyPanel() {
  const client = useClient();
  const platform = usePlatform();
  const settings = useDaemon((c) => c.state?.settings);
  const [shown, setShown] = useState<string | null>(null);
  if (!settings) return null;
  const on = settings.usage_stats !== false;
  const set = (usage_stats: boolean) => client.req({ m: "settings_set", p: { settings: { ...settings, usage_stats } } }).catch(fail);
  const showPing = () =>
    client
      .req<Diagnostics>({ m: "diagnostics_preview", p: { usage: true, include_logs: false, include_prompts: false } })
      .then((d) => setShown(shown ? null : d.report))
      .catch(fail);

  return (
    <div className="flex flex-col gap-7">
      <List
        label="Usage statistics"
        footer="Once a day: a random install id (not your account), the app version, operating system, language and country, and how often features were used (for example “4 agents started”). Never prompts, file names, code or terminal output."
      >
        <Row
          title="Share anonymous usage statistics"
          detail="Helps decide what to improve"
          trailing={<Switch label="Share anonymous usage statistics" checked={on} onChange={(v) => void set(v)} />}
        />
        <Row Icon={Eye} title={shown ? "Hide what is sent" : "Show what is sent"} onClick={() => void showPing()} />
      </List>
      {shown && <Code text={shown} />}
      <ReportForm />
      <List footer="Without an account nothing leaves this computer except the usage ping above and update checks.">
        <Row title="Privacy policy" onClick={() => platform.openExternal(`${SITE}/privacy`)} />
      </List>
    </div>
  );
}

function Code({ text }: { text: string }) {
  return (
    <pre className="well max-h-80 overflow-auto rounded-field p-3 font-mono text-footnote text-dim whitespace-pre-wrap break-all">{text}</pre>
  );
}

/** "Report a problem": write, choose what to attach, look at it, send. */
function ReportForm() {
  const client = useClient();
  const account = useDaemon((c) => c.state?.remote.account);
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [contact, setContact] = useState(account?.email ?? "");
  const [logs, setLogs] = useState(true);
  const [prompts, setPrompts] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const look = () =>
    client
      .req<Diagnostics>({ m: "diagnostics_preview", p: { include_logs: logs, include_prompts: prompts, usage: false } })
      .then((d) => setPreview(preview ? null : d.report))
      .catch(fail);
  const send = async () => {
    setBusy(true);
    try {
      const r = await client.req<DiagnosticsSent>({
        m: "diagnostics_send",
        p: { summary, details, contact: contact.trim() || undefined, include_logs: logs, include_prompts: prompts },
      });
      setSent(r.id);
      setSummary("");
      setDetails("");
      setPreview(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <Callout
        tone="success"
        Icon={Check}
        title={`Report ${sent} sent`}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="glass" Icon={Copy} onClick={() => void navigator.clipboard?.writeText(sent).then(() => toast("Copied"))}>
              Copy id
            </Button>
            <Button size="sm" variant="glass" onClick={() => setSent(null)}>
              New report
            </Button>
          </div>
        }
      >
        Thanks. Quote this id if you write to us. We answer at the address you gave.
      </Callout>
    );

  return (
    <div className="flex flex-col gap-4">
      <List label="Report a problem" footer="The report goes to the NeuralAgent team. Tokens, keys and your home folder name are removed from the log first.">
        <Row
          title="Attach the service log"
          detail="The last few hundred lines, cleaned"
          trailing={<Switch label="Attach the service log" checked={logs} onChange={setLogs} />}
        />
        <Row
          title="Attach my recent Neural requests"
          detail="Your last 20 messages to Neural, as typed or spoken"
          trailing={<Switch label="Attach my recent Neural requests" checked={prompts} onChange={setPrompts} />}
        />
      </List>
      <div className="flex flex-col gap-3 px-1">
        <Field label="What went wrong?">
          <Input value={summary} maxLength={200} placeholder="Agents do not start after the update" onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field label="Details (optional)" hint="What you did, what you expected, what happened instead.">
          <TextArea value={details} maxLength={8000} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <Field label="Email for an answer (optional)">
          <Input type="email" value={contact} placeholder="you@example.com" onChange={(e) => setContact(e.target.value)} />
        </Field>
        <p className="text-footnote text-dim">
          Always attached: app and service version, operating system, settings without keys, which agent CLIs are installed, how many agents
          run and their states.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" Icon={Eye} onClick={() => void look()}>
            {preview ? "Hide report" : "Look at the report"}
          </Button>
          <Button Icon={Send} busy={busy} disabled={!summary.trim()} onClick={() => void send()}>
            Send report
          </Button>
        </div>
      </div>
      {preview && <Code text={preview} />}
    </div>
  );
}

export const PrivacyIcon = LifeBuoy;
