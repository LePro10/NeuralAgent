// One swarm: header (goal, status, time, actions), conversation with composer, and the team.
import type { Swarm } from "@neuralagent/protocol";
import {
  BackButton,
  Button,
  Composer,
  ConfirmSheet,
  IconButton,
  Menu,
  Pill,
  cn,
  toast,
  useKeyboardInset,
  useKeyboardOpen,
  useLayoutMode,
  usePortalTarget,
  useStackNav,
  type MenuEntry,
} from "@neuralagent/ui";
import { ChevronsUpDown, Ellipsis, Folder, Square, SquareTerminal, Trash2, Users } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { clock, useNow } from "../../lib/agentui";
import { useClient, useDaemon } from "../../lib/store";
import { elapsed } from "../../lib/swarmFeed";
import { useOpenSession } from "../NeuralPage";
import { MemberButton, RoleMark, useMembers, type MemberView } from "./members";
import { SwarmFeed } from "./SwarmFeed";

/**
 * One swarm. Desktop: a card with a header (goal, status, time, actions), the conversation with
 * the composer under it, and the team in a rail on the right (a row of chips when the card is
 * narrow). Phones: a pushed page; the goal and team scroll above the conversation.
 */
export function SwarmDetail({ id }: { id: string }) {
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const swarm = useDaemon((c) => c.state?.swarms.find((w) => w.id === id));
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === swarm?.workspace_id)?.name ?? "");
  const all = useDaemon((c) => c.state?.swarm_messages);
  const messages = useMemo(() => (all ?? []).filter((m) => m.swarm_id === id), [all, id]);
  const members = useMembers(swarm);
  const openSession = useOpenSession();
  const [confirm, setConfirm] = useState<"stop" | "remove" | null>(null);

  if (!swarm) return phone ? <PhoneBar title="" /> : null;
  const act = (p: Promise<unknown>) => p.then(() => {}, (e) => void toast((e as Error).message, { tone: "danger" }));
  const openTeam = () => swarm.members[0] && openSession(swarm.members[0].session_id);
  const confirmSheet = (
    <ConfirmSheet
      open={confirm !== null}
      onClose={() => setConfirm(null)}
      title={confirm === "stop" ? "Stop this swarm?" : "Remove this swarm?"}
      message={confirm === "stop" ? "Every member stops. Their conversation stays here." : "The swarm and its conversation are removed from the list. The agents' terminals stay in the workspace."}
      confirmLabel={confirm === "stop" ? "Stop swarm" : "Remove"}
      destructive
      Icon={confirm === "stop" ? Square : Trash2}
      onConfirm={() => act(client.req(confirm === "stop" ? { m: "swarm_stop", p: { swarm_id: swarm.id } } : { m: "swarm_remove", p: { swarm_id: swarm.id } }))}
    />
  );
  const feed = (top?: ReactNode) => <SwarmFeed key={swarm.id} messages={messages} ended={swarm.ended} startedAt={swarm.started_at} top={top} />;
  const composer = !swarm.ended && <SwarmComposer swarm={swarm} members={members} />;

  if (phone) {
    const menu: MenuEntry[] = [
      { label: "Open terminals", Icon: SquareTerminal, onSelect: openTeam },
      swarm.ended
        ? { label: "Remove swarm", Icon: Trash2, destructive: true, divider: true, onSelect: () => setConfirm("remove") }
        : { label: "Stop swarm", Icon: Square, destructive: true, divider: true, onSelect: () => setConfirm("stop") },
    ];
    return (
      <PhoneFrame ended={swarm.ended}>
        <PhoneBar
          title={swarm.goal}
          actions={
            <Menu
              title="Swarm"
              items={menu}
              trigger={(show) => (
                <IconButton label="Swarm actions" variant="ghost" onClick={show}>
                  <Ellipsis />
                </IconButton>
              )}
            />
          }
        />
        {feed(
          <div className="pb-4">
            <h1 className="text-title-2 text-bright">{swarm.goal}</h1>
            <Meta swarm={swarm} ws={ws} className="mt-2" />
            <div data-no-swipe className="scroll-x -mx-4 mt-4 flex gap-2 px-4 py-1" style={EDGE_X}>
              {members.map((m) => (
                <MemberButton key={m.sid} m={m} onOpen={openSession} />
              ))}
            </div>
          </div>,
        )}
        {composer && <div className="shrink-0 px-4 pt-2">{composer}</div>}
        {confirmSheet}
      </PhoneFrame>
    );
  }

  return (
    <div className="@container card flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-start gap-4 border-b-hair border-line px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <Goal text={swarm.goal} />
          <Meta swarm={swarm} ws={ws} className="mt-2" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="quiet" Icon={SquareTerminal} onClick={openTeam}>
            Terminals
          </Button>
          {swarm.ended ? (
            <Button size="sm" variant="ghost" Icon={Trash2} onClick={() => setConfirm("remove")}>
              Remove
            </Button>
          ) : (
            <Button size="sm" variant="ghost" Icon={Square} onClick={() => setConfirm("stop")}>
              Stop
            </Button>
          )}
        </div>
      </header>
      {/* Narrow card: the team as a row of chips above the conversation. */}
      <div data-no-swipe className="scroll-x flex shrink-0 gap-2 border-b-hair border-line px-6 py-3 @3xl:hidden" style={EDGE_X}>
        {members.map((m) => (
          <MemberButton key={m.sid} m={m} onOpen={openSession} />
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {feed()}
          {composer && <div className="shrink-0 px-4 pt-1 pb-4 @2xl:px-8">{composer}</div>}
        </div>
        <aside className="hidden w-64 shrink-0 flex-col border-l-hair border-line @3xl:flex">
          <div className="eyebrow px-5 pt-4 pb-2">Team · {members.length}</div>
          <div className="scroller flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
            {members.map((m) => (
              <MemberButton key={m.sid} m={m} onOpen={openSession} rail />
            ))}
          </div>
        </aside>
      </div>
      {confirmSheet}
    </div>
  );
}

/** Chips that scroll sideways fade out at the edges instead of being cut. */
const EDGE_X: CSSProperties = {
  maskImage: "linear-gradient(90deg, transparent, black 16px, black calc(100% - 24px), transparent)",
  WebkitMaskImage: "linear-gradient(90deg, transparent, black 16px, black calc(100% - 24px), transparent)",
};

/** The goal as the title: two lines, the rest on click. */
function Goal({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 110;
  return (
    <h2
      className={cn("text-title-3 text-bright", !open && "line-clamp-2", long && "cursor-pointer")}
      title={long && !open ? text : undefined}
      aria-expanded={long ? open : undefined}
      onClick={long ? () => setOpen((o) => !o) : undefined}
    >
      {text}
    </h2>
  );
}

/** Running/Ended, the workspace, when it started and for how long it has run. */
function Meta({ swarm, ws, className }: { swarm: Swarm; ws: string; className?: string }) {
  const now = useNow(15000);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 text-footnote text-dim", className)}>
      <Pill size="sm" tone={swarm.ended ? "neutral" : "success"} dot={!swarm.ended}>
        {swarm.ended ? "Ended" : "Running"}
      </Pill>
      {ws && (
        <span className="flex min-w-0 items-center gap-1">
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{ws}</span>
        </span>
      )}
      <span className="tabular">
        Started {clock(swarm.started_at)}
        {!swarm.ended && ` · ${elapsed(now - swarm.started_at)}`}
      </span>
      <span>{swarm.members.length} agents</span>
    </div>
  );
}

/** Message the team: who to (everyone or one member), then the text. */
function SwarmComposer({ swarm, members }: { swarm: Swarm; members: MemberView[] }) {
  const client = useClient();
  const [to, setTo] = useState("all");
  const send = (text: string) => {
    if (!text.trim()) return false;
    client.req({ m: "swarm_send", p: { swarm_id: swarm.id, to, text } }).catch((e) => void toast((e as Error).message, { tone: "danger" }));
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      <Menu
        title="Send to"
        align="start"
        items={[
          { label: "Everyone", Icon: Users, checked: to === "all", onSelect: () => setTo("all") },
          ...members.map((m) => ({ label: m.role, detail: m.label, glyph: <RoleMark role={m.role} size={24} />, checked: to === m.role, onSelect: () => setTo(m.role) })),
        ]}
        trigger={(show) => (
          <button type="button" onClick={show} className="pressable flex h-control-sm items-center gap-1.5 self-start rounded-full bg-fill-2 pr-2.5 pl-1 text-footnote text-ink hover:bg-fill-3">
            {to === "all" ? (
              <span className="grid size-6 place-items-center rounded-full bg-fill-3">
                <Users className="size-3.5" />
              </span>
            ) : (
              <RoleMark role={to} size={24} />
            )}
            To {to === "all" ? "everyone" : to}
            <ChevronsUpDown className="size-3.5 text-dim" />
          </button>
        )}
      />
      <Composer key={swarm.id} onSend={send} placeholder={to === "all" ? "Message the team…" : `Message the ${to}…`} attachments={false} dictation={false} compact />
    </div>
  );
}

/** Phones: the detail is a level of the swarm Stack, full height above the tab bar. */
function PhoneFrame({ ended, children }: { ended: boolean; children: ReactNode }) {
  const kbOpen = useKeyboardOpen();
  const kb = useKeyboardInset(usePortalTarget());
  const bottom = kb ? `${kb.bottom + 8}px` : kbOpen ? "calc(var(--safe-bottom) + 8px)" : ended ? "var(--tabbar-space)" : "calc(var(--tabbar-space) + 4px)";
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ paddingTop: "var(--safe-top)", paddingBottom: bottom }}>
      {children}
    </div>
  );
}

/** Phones: back to the list, the goal as the inline title, the actions. */
function PhoneBar({ title, actions }: { title: string; actions?: ReactNode }) {
  const { pop } = useStackNav();
  return (
    <header className="flex h-navbar shrink-0 items-center gap-1 px-2">
      <BackButton label="Swarm" onBack={pop} compact />
      <span className="min-w-0 flex-1 truncate text-center text-headline text-bright">{title}</span>
      <span className="flex min-w-tap justify-end">{actions}</span>
    </header>
  );
}
