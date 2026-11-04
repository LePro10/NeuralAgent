// Autopilot → Inbox: what needs you first (OKs, drafts), then what is open or done. An item opens
// a sheet with the summary, the original text from outside, the steps and the draft.
import type { InboxItem, Pilot, PilotPending } from "@neuralagent/protocol";
import { Button, Callout, Chips, ConfirmCard, Empty, IconTile, List, Row, Sheet, TextArea, useLayoutMode } from "@neuralagent/ui";
import { Bot, Check, ExternalLink, Inbox as InboxIcon, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { KIND_LABEL, URGENCY_LABEL, agoLabel, inboxView, needsUser, pendingTitle, type ItemFilter } from "../../lib/autopilot";
import { useNow } from "../../lib/agentui";
import { useOpenAgent } from "../../lib/openAgent";
import { useDaemon } from "../../lib/store";
import { useOpenLink } from "./bits";
import { useApDo, useAutopilot, useConnectorName } from "./hooks";

export function Inbox({ pilot, onChat, onConnectors }: { pilot: Pilot; onChat: () => void; onConnectors: () => void }) {
  const state = useAutopilot();
  const [filter, setFilter] = useState<ItemFilter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const view = useMemo(() => inboxView(state, pilot.id, filter), [state, pilot.id, filter]);
  const now = useNow(30000);
  const item = openId ? state.items.find((i) => i.id === openId) : undefined;
  const nothing = view.pending.length + view.needs.length + view.rest.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          { value: "open", label: "Open", count: view.counts.open + view.pending.length },
          { value: "done", label: "Done", count: view.counts.done },
        ]}
      />
      {filter === "open" && view.pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-4 text-footnote text-dim uppercase tracking-wide">Needs your OK</h3>
          {view.pending.map((p) => (
            <PendingCard key={p.id} p={p} />
          ))}
        </section>
      )}
      {view.needs.length > 0 && (
        <List label="Needs you">
          {view.needs.map((i) => (
            <ItemRow key={i.id} item={i} now={now} onOpen={() => setOpenId(i.id)} />
          ))}
        </List>
      )}
      {view.rest.length > 0 && (
        <List label={filter === "open" ? (view.needs.length || view.pending.length ? "Open" : undefined) : undefined}>
          {view.rest.map((i) => (
            <ItemRow key={i.id} item={i} now={now} onOpen={() => setOpenId(i.id)} />
          ))}
        </List>
      )}
      {nothing && filter === "open" && pilot.playbook.sources.length === 0 ? (
        <Empty
          Icon={InboxIcon}
          title="Connect your first source"
          detail="The autopilot sorts what comes in from places like Discord, GitHub or Reddit. Connect one and it shows up here."
          action={
            <Button variant="accent" onClick={onConnectors} className="rounded-full">
              Connect a source
            </Button>
          }
        />
      ) : nothing && (
        <Empty
          Icon={InboxIcon}
          title={filter === "open" ? "Nothing waiting" : "Nothing done yet"}
          detail={filter === "open" ? "New posts, messages and issues from your sources show up here, sorted. Ask the autopilot to look now." : "Finished items stay here for a while."}
          action={
            filter === "open" ? (
              <Button variant="ghost" onClick={onChat} className="rounded-full">
                Ask in Chat
              </Button>
            ) : undefined
          }
        />
      )}
      <ItemSheet item={item} onClose={() => setOpenId(null)} />
    </div>
  );
}

const ITEM_ACTIVITY = { needs_you: "waiting", working: "working" } as const;

function ItemRow({ item, now, onOpen }: { item: InboxItem; now: number; onOpen: () => void }) {
  const name = useConnectorName();
  const sub = [KIND_LABEL[item.kind], name(item.source), item.author, agoLabel(item.updated, now)].filter(Boolean).join(" · ");
  const activity = needsUser(item) ? "waiting" : ITEM_ACTIVITY[item.status as keyof typeof ITEM_ACTIVITY];
  return (
    <Row
      Icon={item.session_id ? Bot : InboxIcon}
      title={item.title}
      detail={
        <>
          <span className="block truncate">{sub}</span>
          {item.summary && <span className="mt-0.5 line-clamp-2 block text-ink">{item.summary}</span>}
        </>
      }
      wrap
      activity={activity}
      chevron
      onClick={onOpen}
    />
  );
}

/** An action the pilot wants to take; says in words what happens. */
function PendingCard({ p }: { p: PilotPending }) {
  const connectors = useAutopilot().connectors;
  const run = useApDo();
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  return (
    <ConfirmCard
      title={pendingTitle(p, connectors)}
      detail="The autopilot asks before it does this."
      decision={decision}
      onDecide={(d) => {
        setDecision(d);
        void run({ op: "confirm", id: p.id, allow: d === "approved" });
      }}
    >
      <span className="block break-words whitespace-pre-wrap">{p.summary}</span>
    </ConfirmCard>
  );
}

const STATUS_WORD: Record<InboxItem["status"], string> = { new: "New", working: "In progress", needs_you: "Needs you", done: "Done", dismissed: "Dismissed" };

function ItemSheet({ item, onClose }: { item?: InboxItem; onClose: () => void }) {
  // Keep the last item while the sheet slides out.
  const [shown, setShown] = useState<InboxItem | undefined>(item);
  useEffect(() => {
    if (item) setShown(item);
  }, [item]);
  const phone = useLayoutMode() === "phone";
  return (
    <Sheet open={!!item} onClose={onClose} title={shown ? KIND_LABEL[shown.kind] : ""} eyebrow={shown ? STATUS_WORD[shown.status] : undefined} size="lg" snaps={phone ? [0.92] : undefined}>
      {shown && <ItemDetail item={shown} onClose={onClose} />}
    </Sheet>
  );
}

function ItemDetail({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const run = useApDo();
  const openAgent = useOpenAgent();
  const open = useOpenLink();
  const name = useConnectorName();
  const agent = useDaemon((c) => (item.session_id ? c.state?.sessions[item.session_id] : undefined));
  const now = useNow(30000);
  const done = item.status === "done" || item.status === "dismissed";
  return (
    <div className="flex flex-col gap-5 pb-4">
      <div>
        <h2 className="text-title-3 text-bright">{item.title}</h2>
        <p className="mt-1 text-footnote text-dim">
          {[name(item.source), item.author, URGENCY_LABEL[Math.min(3, item.urgency)] + " urgency", agoLabel(item.created, now)].filter(Boolean).join(" · ")}
        </p>
        {item.url && (
          <Button size="sm" variant="quiet" IconEnd={ExternalLink} onClick={() => open(item.url!)} className="mt-1 -ml-3">
            Open the original
          </Button>
        )}
      </div>
      {item.summary && <p className="text-body text-ink">{item.summary}</p>}

      {item.draft && <DraftEditor item={item} onDone={onClose} />}

      {item.original && (
        <section>
          <h3 className="mb-1.5 px-1 text-footnote text-dim uppercase tracking-wide">From outside{item.author ? `, by ${item.author}` : ""}</h3>
          <blockquote className="selectable max-h-64 overflow-y-auto rounded-field border-l-2 border-line-2 bg-fill-2 px-3.5 py-3 font-mono text-footnote leading-relaxed break-words whitespace-pre-wrap text-ink">{item.original}</blockquote>
          <p className="mt-1.5 px-1 text-caption text-faint">Written by someone else. The autopilot reads it as information, never as an order.</p>
        </section>
      )}

      {item.session_id && (
        <List label="Agent working on it">
          <Row Icon={Bot} title={agent?.title ?? "Coding agent"} detail={agent ? (agent.alive ? "Running" : "Finished") : "Not running any more"} chevron={!!agent} onClick={agent ? () => (onClose(), openAgent(agent.id)) : undefined} />
        </List>
      )}

      {item.steps.length > 0 && (
        <section>
          <h3 className="mb-1.5 px-1 text-footnote text-dim uppercase tracking-wide">What the autopilot did</h3>
          <ol className="flex flex-col gap-2.5 px-1">
            {item.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-subhead">
                <span className={"mt-0.5 grid size-5 shrink-0 place-items-center rounded-full " + (s.ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>{s.ok ? <Check size={12} strokeWidth={2.4} /> : <X size={12} strokeWidth={2.4} />}</span>
                <span className="min-w-0 flex-1 text-ink">{s.text}</span>
                <span className="shrink-0 text-caption text-faint tabular">{agoLabel(s.at, now)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex gap-2">
        {done ? (
          <Button variant="ghost" size="lg" block onClick={() => void run({ op: "item_update", id: item.id, status: "new" })}>
            Reopen
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="lg" block Icon={Check} onClick={() => (void run({ op: "item_update", id: item.id, status: "done" }), onClose())}>
              Mark done
            </Button>
            <Button variant="quiet" size="lg" block onClick={() => (void run({ op: "item_update", id: item.id, status: "dismissed" }), onClose())}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** The drafted answer: editable until it is sent. Send goes through the connector as the user's OK. */
function DraftEditor({ item, onDone }: { item: InboxItem; onDone: () => void }) {
  const run = useApDo();
  const name = useConnectorName();
  const draft = item.draft!;
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  // A new draft from the pilot replaces what was there, unless the user is editing.
  const [base, setBase] = useState(draft.text);
  useEffect(() => {
    if (draft.text !== base) {
      setBase(draft.text);
      setText(draft.text);
    }
  }, [draft.text, base]);
  const dirty = text !== draft.text;
  const send = async () => {
    setBusy(true);
    if (dirty) await run({ op: "item_update", id: item.id, draft: text });
    const r = await run({ op: "item_send", id: item.id }, `Sent to ${name(draft.connector_id)}`);
    setBusy(false);
    if (r !== undefined) onDone();
  };
  return (
    <section className="flex flex-col gap-2.5 rounded-list bg-accent/[.08] p-3.5">
      <div className="flex items-center gap-2">
        <IconTile Icon={Send} color="blue" />
        <div className="min-w-0 flex-1">
          <h3 className="text-headline text-bright">Draft answer</h3>
          <p className="truncate text-footnote text-dim">Goes out through {name(draft.connector_id)} once you press Send.</p>
        </div>
      </div>
      <TextArea value={text} onChange={(e) => setText(e.target.value)} maxRows={10} aria-label="Draft answer" />
      <div className="flex gap-2">
        <Button variant="accent" Icon={Send} busy={busy} disabled={!text.trim()} onClick={() => void send()} className="flex-1">
          Send
        </Button>
        <Button
          variant="ghost"
          Icon={Trash2}
          onClick={() => {
            void run({ op: "item_update", id: item.id, status: "dismissed" });
            onDone();
          }}
        >
          Discard
        </Button>
      </div>
      {needsUser(item) && !draft.text.trim() && <Callout tone="warning">The draft is empty. Write an answer or discard it.</Callout>}
    </section>
  );
}
