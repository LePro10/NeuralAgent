// Settings → Discord (D72): a privacy preset, what each part of the card shows, and a live preview
// of the card exactly as the daemon computes it (`discord_preview`). While no agent runs the daemon
// sends an example; the status under the card says what Discord shows right now.
import type { DiscordCard, DiscordOptions, DiscordPreview, DiscordStat } from "@neuralagent/protocol";
import { List, Menu, Row, Switch, cn, toast } from "@neuralagent/ui";
import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { currentOptions, customize, elapsed, partyText, PRESETS, STATS, statLabel } from "../../lib/discord";
import { useClient, useDaemon } from "../../lib/store";
import { BrandMark } from "../BrandMark";
import { Choice } from "./panels";

const fail = (e: unknown) => toast((e as Error).message ?? String(e), { tone: "danger" });
/** How often the preview asks the daemon again (the numbers move, Discord gets them every 15 s). */
const POLL_MS = 3000;

export function DiscordPanel({ hostName }: { hostName: string | null }) {
  const client = useClient();
  const settings = useDaemon((c) => c.state?.settings);
  if (!settings) return null;
  // Daemons before D72 know three presets and have no preview.
  const legacy = settings.discord === undefined;
  const level = settings.discord_presence;
  const opts = currentOptions(settings);
  const save = (patch: Partial<typeof settings>) => client.req({ m: "settings_set", p: { settings: { ...settings, ...patch } } }).catch(fail);
  const change = (patch: Partial<DiscordOptions>) => save(customize(settings, patch));
  const presets = legacy ? PRESETS.filter((p) => p.value === "off" || p.value === "general" || p.value === "detailed") : PRESETS;

  return (
    <div className="flex flex-col gap-7">
      {!legacy && <Preview hostName={hostName} />}
      <List label="Show on my profile" footer={legacy ? "Shown on your Discord profile while the Discord app runs on this computer." : undefined}>
        {presets.map((p) => (
          <Choice key={p.value} title={p.label} detail={p.detail} checked={level === p.value} onSelect={() => void save({ discord_presence: p.value })} />
        ))}
      </List>
      {!legacy && level !== "off" && (
        <>
          <List label="The card" footer="Changing a part switches to Custom. A part with nothing to say right now (no subagents, no tokens yet) is left out.">
            <StatRow title="First line" value={opts.details} onChange={(details) => void change({ details })} />
            <StatRow title="Second line" value={opts.state} onChange={(state) => void change({ state })} />
            <StatRow title="Image tooltip" value={opts.hover} onChange={(hover) => void change({ hover })} />
          </List>
          <List footer="Discord shows buttons to others, not on your own profile. Project names are workspace names; off, the card says “a project”.">
            <ToggleRow title="Party size" detail="“(2 of 5)”: agents working of running" checked={opts.party} onChange={(party) => void change({ party })} />
            <ToggleRow title="Elapsed time" detail="Since the first agent started" checked={opts.timer} onChange={(timer) => void change({ timer })} />
            <ToggleRow title="Get NeuralAgent button" checked={opts.button} onChange={(button) => void change({ button })} />
            <ToggleRow title="Project names" detail="Private unless you turn this on" checked={opts.project_names} onChange={(project_names) => void change({ project_names })} />
          </List>
        </>
      )}
    </div>
  );
}

function StatRow({ title, value, onChange }: { title: string; value: DiscordStat; onChange: (v: DiscordStat) => void }) {
  return (
    <Menu
      title={title}
      block
      width={300}
      items={STATS.map((s) => ({ id: s.value, label: s.label, detail: s.example, checked: s.value === value, onSelect: () => onChange(s.value) }))}
      trigger={(open) => <Row title={title} value={statLabel(value)} onClick={open} />}
    />
  );
}

function ToggleRow({ title, detail, checked, onChange }: { title: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Row title={title} detail={detail} trailing={<Switch label={title} checked={checked} onChange={onChange} />} />;
}

/** The daemon's card for the saved settings, refreshed every few seconds while Settings shows it. */
function usePreview(): DiscordPreview | null | "unsupported" {
  const client = useClient();
  const settings = useDaemon((c) => c.state?.settings);
  const [p, setP] = useState<DiscordPreview | null | "unsupported">(null);
  const key = JSON.stringify([settings?.discord_presence, settings?.discord]);
  useEffect(() => {
    let live = true;
    const ask = () =>
      client
        .req<DiscordPreview>({ m: "discord_preview", p: {} })
        .then((r) => live && setP(r))
        .catch(() => live && setP("unsupported"));
    void ask();
    const t = window.setInterval(ask, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [client, key]);
  return p;
}

/** Ticks once a second while the card has a timer. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

function Preview({ hostName }: { hostName: string | null }) {
  const p = usePreview();
  const card = p && p !== "unsupported" ? p.card : undefined;
  const now = useNow(card?.start !== undefined);
  if (p === "unsupported") return null;
  const where = hostName ?? "this computer";
  const same = !!card && !!p?.shown && JSON.stringify(card) === JSON.stringify(p.shown);
  const status: { tone: "live" | "wait" | "off"; text: string } = !p
    ? { tone: "off", text: "Loading…" }
    : !card
      ? { tone: "off", text: "Discord shows nothing." }
      : !p.connected
        ? { tone: "off", text: `Discord is not open on ${where}. The card appears once it is.` }
        : p.sample
          ? { tone: "off", text: "No agent runs right now, so Discord shows nothing. This is how it looks while agents work." }
          : same
            ? { tone: "live", text: "Live on Discord" }
            : { tone: "wait", text: p.next_in_ms ? `On Discord in ${Math.ceil(p.next_in_ms / 1000)} s (one update every 15 s)` : "Sending to Discord…" };
  return (
    <div className="flex flex-col gap-2">
      <ProfileCard card={card ?? null} now={now} sample={!!p && p.sample} />
      <p className="flex items-center gap-2 px-4 text-footnote text-dim" aria-live="polite">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", status.tone === "live" ? "bg-success" : status.tone === "wait" ? "bg-warning" : "bg-fill-4")} />
        {status.text}
      </p>
    </div>
  );
}

const BADGE: Record<string, string> = { working: "bg-accent", waiting: "bg-warning", idle: "bg-fill-4" };

/** A Discord profile with the activity block, drawn with the app's tokens. */
export function ProfileCard({ card, now, sample }: { card: DiscordCard | null; now: number; sample?: boolean }) {
  return (
    <figure aria-label="Preview of your Discord profile" className="surface overflow-hidden rounded-list">
      <div aria-hidden className="h-14 bg-linear-to-br from-accent/70 via-accent/30 to-fill-2" />
      <div className="px-4 pb-4">
        <div className="-mt-7 flex items-end justify-between">
          <span className="relative grid size-14 place-items-center rounded-full bg-fill-3 text-title-3 text-bright ring-4 ring-bg">
            Y
            <span aria-hidden className="absolute right-0 bottom-0 size-4 rounded-full bg-success ring-3 ring-bg" />
          </span>
          {sample && <span className="rounded-full bg-fill-2 px-2 py-0.5 text-caption text-dim">Example</span>}
        </div>
        <div className="mt-2 text-headline text-bright">You</div>
        {card ? (
          <div className="mt-3 rounded-tile bg-fill-1 p-3">
            <div className="text-caption font-medium text-dim uppercase tracking-wide">Playing</div>
            <div className="mt-2 flex items-center gap-3">
              <span className="relative shrink-0" title={card.large_text}>
                <span className="grid size-16 place-items-center rounded-tile bg-bright text-bg">
                  <BrandMark size={34} />
                </span>
                <span title={card.small_text} className={cn("absolute -right-1 -bottom-1 size-5 rounded-full ring-3 ring-card", BADGE[card.badge] ?? "bg-fill-4")} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-subhead font-medium text-bright">NeuralAgent</div>
                <div className="truncate text-footnote text-ink">{card.details}</div>
                {card.state && (
                  <div className="truncate text-footnote text-ink">
                    {card.state} {partyText(card.party)}
                  </div>
                )}
                {card.start !== undefined && (
                  <div className="mt-0.5 flex items-center gap-1 text-footnote text-success tabular-nums">
                    <Gamepad2 className="size-icon-sm" strokeWidth={2} aria-hidden />
                    {elapsed(card.start, now)}
                  </div>
                )}
              </div>
            </div>
            {card.buttons.map((b) => (
              <div key={b} className="mt-3 grid h-control-sm place-items-center rounded-field bg-fill-3 text-footnote font-medium text-bright">
                {b}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-tile bg-fill-1 p-3 text-footnote text-dim">No activity shown</div>
        )}
        {card && (
          <div className="mt-3 flex flex-col gap-0.5 text-caption">
            <div className="flex gap-2">
              <span className="w-24 shrink-0 text-faint">Image tooltip</span>
              <span className="min-w-0 truncate text-dim">{card.large_text}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-24 shrink-0 text-faint">Badge</span>
              <span className="min-w-0 truncate text-dim">{card.small_text}</span>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
