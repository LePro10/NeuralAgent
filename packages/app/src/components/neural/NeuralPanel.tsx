// What Neural knows and owns, beside the conversation: how proactive it is, its tasks, what it
// noticed about the agents, and what it remembers (D61–D63, docs/notes/neural-v2.md).
// Desktop: a rail beside the conversation (or a side panel); phones: a sheet.
import type { NeuralMode, NeuralTask, NeuralTaskStatus, Request } from "@neuralagent/protocol";
import { Empty, IconButton, List, Menu, Row, Segmented, cn, toast } from "@neuralagent/ui";
import { Brain, Check, CircleSlash, Eye, ListChecks, Plus, Trash2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { OBS_WORD, neuralOf, obsActivity, obsDetail, taskActivity, taskWord } from "../../lib/neural";
import { shortAgo, useNow } from "../../lib/agentui";
import { useOpenAgent } from "../../lib/openAgent";
import { useClient, useDaemon } from "../../lib/store";
import { EngineTile } from "../EngineTile";

const MODES: { value: NeuralMode; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "quiet", label: "Quiet" },
  { value: "off", label: "Off" },
];

const MODE_HELP: Record<NeuralMode, string> = {
  active: "Neural checks finished work, reports results, failures and questions, and notices stuck agents.",
  quiet: "Neural only speaks up when something needs you: failures, questions, finished tasks.",
  off: "Neural only answers when you write. It still keeps its tasks.",
};

export function NeuralPanel({ onOpenTask, className }: { onOpenTask?: (t: NeuralTask) => void; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <ModeBlock />
      <TasksBlock onOpenTask={onOpenTask} />
      <WatchingBlock />
      <MemoryBlock />
    </div>
  );
}

export function neuralReq(client: ReturnType<typeof useClient>, r: Request) {
  return client.req(r).catch((e) => {
    toast((e as Error).message, { tone: "danger" });
  });
}

function ModeBlock() {
  const client = useClient();
  const mode = useDaemon((c) => neuralOf(c.state).mode);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-4 text-footnote text-dim uppercase tracking-wide">On its own</h2>
      <Segmented label="How proactive Neural is" value={mode} options={MODES} onChange={(v) => void neuralReq(client, { m: "neural_mode", p: { mode: v } })} />
      <p className="px-1 text-footnote text-dim">{MODE_HELP[mode]}</p>
    </section>
  );
}

function TasksBlock({ onOpenTask }: { onOpenTask?: (t: NeuralTask) => void }) {
  const client = useClient();
  const open = useOpenAgent();
  const tasks = useDaemon((c) => neuralOf(c.state).tasks);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const now = useNow();
  const shown = useMemo(() => {
    const live = tasks.filter((t) => t.status !== "done" && t.status !== "failed");
    const recent = tasks.filter((t) => (t.status === "done" || t.status === "failed") && now - t.updated_at < 24 * 3_600_000);
    return [...live.reverse(), ...recent.reverse().slice(0, 4)];
  }, [tasks, now]);
  const edit = (id: string, status: NeuralTaskStatus | undefined, remove = false) => void neuralReq(client, { m: "neural_task_edit", p: { id, status, remove } });
  if (shown.length === 0)
    return (
      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-footnote text-dim uppercase tracking-wide">Tasks</h2>
        <Empty bare Icon={ListChecks} title="No tasks" detail="Tell Neural what should get done. It follows the work up until it is finished." className="py-6" />
      </section>
    );
  return (
    <List label="Tasks">
      {shown.map((t) => {
        const ws = workspaces?.find((w) => w.id === t.workspace_id)?.name;
        const sub = [taskWord(t), t.team ? (t.team.pattern === "race" ? "Race" : "Build + review") : null, ws].filter(Boolean).join(" · ");
        const finished = t.status === "done" || t.status === "failed";
        return (
          <Menu
            key={t.id}
            title={t.title}
            items={[
              ...(t.team && onOpenTask ? [{ label: "Show the team", Icon: Users, onSelect: () => onOpenTask(t) }] : []),
              ...(t.agents.length ? [{ label: "Open the agent", Icon: Eye, onSelect: () => open(t.agents.at(-1)!) }] : []),
              ...(!finished ? [{ label: "Mark done", Icon: Check, onSelect: () => edit(t.id, "done") }] : []),
              ...(!finished ? [{ label: "Drop it", Icon: CircleSlash, onSelect: () => edit(t.id, "failed") }] : []),
              { label: "Remove", Icon: Trash2, destructive: true, divider: true, onSelect: () => edit(t.id, undefined, true) },
            ]}
            trigger={(show) => (
              <Row Icon={t.team ? Users : ListChecks} title={t.title} detail={t.note ? `${sub} — ${t.note}` : sub} activity={taskActivity(t)} wrap onClick={show} chevron={false} />
            )}
          />
        );
      })}
    </List>
  );
}

function WatchingBlock() {
  const open = useOpenAgent();
  const obs = useDaemon((c) => neuralOf(c.state).observations);
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  const now = useNow();
  const recent = useMemo(() => [...obs].reverse().slice(0, 8), [obs]);
  if (recent.length === 0) return null;
  return (
    <List label="What Neural noticed" footer="Neural reads these instead of a log in the conversation.">
      {recent.map((o) => {
        const s = o.session_id ? sessions?.[o.session_id] : undefined;
        const engine = profiles?.find((p) => p.id === s?.profile_id)?.engine;
        const detail = obsDetail(o);
        const who = s?.title ?? "";
        const head = [OBS_WORD[o.kind], who].filter(Boolean).join(" · ");
        return (
          <Row
            key={o.id}
            leading={engine ? <EngineTile engine={engine} activity={obsActivity(o.kind)} /> : undefined}
            Icon={engine ? undefined : Eye}
            title={head}
            detail={detail || undefined}
            value={`${o.count && o.count > 1 ? `×${o.count} · ` : ""}${shortAgo(o.at, now)}`}
            onClick={s ? () => open(s.id) : undefined}
            chevron={false}
          />
        );
      })}
    </List>
  );
}

function MemoryBlock() {
  const client = useClient();
  const notes = useDaemon((c) => neuralOf(c.state).notes);
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    void neuralReq(client, { m: "neural_note_add", p: { text: t } });
  };
  return (
    <List label="Neural remembers" footer="Short notes Neural keeps across conversations. It adds them when you tell it something lasting; you can edit them here.">
      {notes.map((n) => (
        <Row
          key={n.id}
          Icon={Brain}
          title={n.text}
          wrap
          trailing={
            <IconButton label="Forget this" variant="ghost" size="sm" onClick={() => void neuralReq(client, { m: "neural_note_remove", p: { id: n.id } })}>
              <X />
            </IconButton>
          }
        />
      ))}
      <div data-lead="" className="flex min-h-row items-center gap-2 py-1 pr-2 pl-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          maxLength={300}
          aria-label="Something Neural should remember"
          placeholder="Something to remember…"
          className="h-tap min-w-0 flex-1 bg-transparent text-input text-bright outline-none placeholder:text-faint"
        />
        <IconButton label="Remember" variant="ghost" size="sm" onClick={add}>
          <Plus />
        </IconButton>
      </div>
    </List>
  );
}
