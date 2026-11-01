// The request table of the fake daemon: every `Request` kind gets an answer. Reads are answered in
// the same tick (the app drops terminal and transcript chunks while an attach is pending); anything
// that takes time returns a promise.

import type { CvAttachResult, CvTextResult, Request, Session, UploadResult } from "@neuralagent/protocol";
import { closeSession, createSession, restartSession, stopSession } from "../agents/spawn.ts";
import { COMMANDS, MODELS } from "../claude/cv.ts";
import { ApiErr, type Conn } from "../server.ts";
import type { Sim } from "../sim.ts";
import { basename, join, normalize } from "../vfs.ts";
import { catalog } from "../seed.ts";
import * as F from "./files.ts";
import * as M from "./misc.ts";

/** Requests that change something; non-desktop clients leave a line in the audit log. */
const AUDITED = new Set(["session_start", "session_stop", "session_close", "session_restart", "session_prompt", "workspace_add", "workspace_remove", "cv_action", "orch_send", "neural_team_start", "neural_team_pick", "neural_confirm", "swarm_start"]);

export function handle(sim: Sim, conn: Conn, req: Request): unknown {
  const r = dispatch(sim, conn, req);
  if (AUDITED.has(req.m) && conn.kind !== "desktop") {
    const p = (req as { p?: Record<string, unknown> }).p ?? {};
    const target = typeof p.id === "string" ? (sim.session(p.id)?.title ?? p.id) : typeof p.sid === "string" ? (sim.session(p.sid)?.title ?? undefined) : typeof p.text === "string" ? p.text.slice(0, 60) : undefined;
    sim.record(conn.kind, conn.name, req.m, target);
  }
  return r;
}

function dispatch(sim: Sim, conn: Conn, req: Request): unknown {
  switch (req.m) {
    // ── projects and layout ──
    case "workspace_add":
      return F.workspaceAdd(sim, req.p, conn);
    case "workspace_update": {
      const w = sim.state.workspaces.find((x) => x.id === req.p.id);
      if (!w) throw new ApiErr("not_found", "Unknown project");
      const { id: _id, ...rest } = req.p;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      sim.emit({ e: "workspace_upsert", workspace: { ...w, ...patch } });
      return null;
    }
    case "workspace_remove": {
      for (const s of Object.values(sim.state.sessions)) if (s.workspace_id === req.p.id) closeSession(sim, s.id);
      sim.emit({ e: "workspace_removed", id: req.p.id });
      return null;
    }
    case "layout_set":
      sim.emit({ e: "layout_set", workspace_id: req.p.workspace_id, layout: req.p.layout });
      return null;

    // ── sessions ──
    case "session_start":
      return startSession(sim, req.p);
    case "session_stop":
      need(sim, req.p.id);
      stopSession(sim, req.p.id);
      return null;
    case "session_close":
      need(sim, req.p.id);
      closeSession(sim, req.p.id);
      return null;
    case "session_restart":
      need(sim, req.p.id);
      return restartSession(sim, req.p.id);
    case "session_rename":
      need(sim, req.p.id);
      sim.patch(req.p.id, { title: req.p.title.trim() || "Untitled" });
      return null;
    case "session_prompt": {
      const s = need(sim, req.p.id);
      const run = sim.runs.get(s.id);
      if (run) run.submit(req.p.text);
      else sim.terms.get(s.id)?.input(req.p.text + "\r");
      return null;
    }

    // ── terminals ──
    case "term_attach": {
      const t = sim.terms.get(req.p.sid);
      if (!t) throw new ApiErr("not_found", "That terminal is gone");
      conn.attached.add(req.p.sid);
      return { cols: t.cols, rows: t.rows, seq: t.bytes, snapshot: t.snapshot() };
    }
    case "term_detach":
      conn.attached.delete(req.p.sid);
      return null;
    case "term_write": {
      // Arrow keys of a question dialog come as terminal input; the prompt takes them first.
      const run = sim.runs.get(req.p.sid);
      if (run?.gateKey(req.p.data, sim.actorOf(conn.view))) return null;
      sim.terms.get(req.p.sid)?.input(req.p.data);
      return null;
    }
    case "term_resize":
      sim.terms.get(req.p.sid)?.resize(req.p.cols, req.p.rows);
      return null;

    // ── Claude view ──
    case "cv_attach": {
      const key = req.p.agent ? `${req.p.sid}|${req.p.agent}` : req.p.sid;
      conn.cv.set(key, { sid: req.p.sid, ...(req.p.agent ? { agent: req.p.agent } : {}), tasks: !!req.p.features?.includes("tasks") });
      const cv = req.p.agent ? undefined : sim.cvs.get(req.p.sid);
      const out: CvAttachResult = req.p.agent ? (sim.cvs.get(req.p.sid)?.attachAgent(req.p.agent) ?? { messages: [], more: false, meta: { busy: false } }) : cv ? cv.attach() : { messages: [], more: false, meta: { actions: !!sim.runs.get(req.p.sid), busy: false } };
      conn.follow(req.p.sid, out, req.p.agent);
      return out;
    }
    case "cv_detach":
      conn.cv.delete(req.p.agent ? `${req.p.sid}|${req.p.agent}` : req.p.sid);
      return null;
    case "cv_history": {
      const cv = sim.cvs.get(req.p.sid);
      return cv && !req.p.agent ? cv.history(req.p.before) : { messages: [], more: false };
    }
    case "cv_image":
      throw new ApiErr("not_found", "No such image");
    case "cv_action":
      return cvAction(sim, conn, req.p);
    case "cv_task_output": {
      const text = sim.cvs.get(req.p.sid)?.outputs.get(req.p.task) ?? "";
      const max = req.p.max ?? 40_000;
      return { text: text.length > max ? text.slice(-max) : text, truncated: text.length > max, size: text.length } satisfies CvTextResult;
    }
    case "cv_file": {
      const s = need(sim, req.p.sid);
      const path = req.p.path.startsWith("/") ? normalize(req.p.path) : join(s.cwd, req.p.path);
      const text = sim.vfs.read(path);
      if (text === null) throw new ApiErr("not_found", "That file does not exist");
      return { text, truncated: false, size: text.length } satisfies CvTextResult;
    }
    case "cv_commands":
      return COMMANDS;
    case "cv_files": {
      const s = need(sim, req.p.sid);
      const q = req.p.query.toLowerCase();
      return sim.vfs.walk(s.cwd).filter((f) => !f.includes("node_modules/") && !f.split("/").some((x) => x.startsWith(".")) && f.toLowerCase().includes(q)).slice(0, 12);
    }
    case "upload": {
      const s = need(sim, req.p.sid);
      const path = join(s.cwd, `.neuralagent/uploads/${basename(req.p.name)}`);
      sim.vfs.write(path, atob(req.p.data).slice(0, 4000));
      return { path } satisfies UploadResult;
    }
    case "transcribe":
      return M.transcribe();

    // ── profiles, catalog, settings, tool servers ──
    case "profile_save":
      return M.profileSave(sim, req.p);
    case "profile_delete":
      return M.profileDelete(sim, req.p);
    case "catalog_refresh":
      return M.catalogRefresh(sim);
    case "settings_set":
      return M.settingsSet(sim, req.p);
    case "mcp_save":
      return M.mcpSave(sim, req.p);
    case "mcp_delete":
      return M.mcpDelete(sim, req.p);
    case "mcp_import":
      return M.mcpImport(sim);

    // ── folders, files, git ──
    case "fs_list":
      return F.fsList(sim, req.p);
    case "fs_roots":
      return F.fsRoots(sim);
    case "fs_mkdir":
      return F.fsMkdir(sim, req.p);
    case "file_list":
      return F.fileList(sim, req.p);
    case "file_read":
      return F.fileRead(sim, req.p);
    case "file_save":
      return F.fileSave(sim, req.p);
    case "file_upload":
      return F.fileUpload(sim, req.p);
    case "file_search":
      return F.fileSearch(sim, req.p);
    case "git_changes":
      return F.gitChanges(sim, req.p);
    case "git_diff":
      return F.gitDiff(sim, req.p);
    case "worktree_merge":
      return F.worktreeMerge(sim, req.p);
    case "worktree_discard":
      return F.worktreeDiscard(sim, req.p);

    // ── numbers, Discord, remote ──
    case "usage_report":
      return M.usageReport(sim, req.p);
    case "discord_preview":
      return M.discordPreview(sim, req.p);
    case "remote_sign_in":
      return M.remoteSignIn(sim, req.p);
    case "remote_sign_out":
    case "remote_sign_out_everywhere":
      return M.remoteSignOut(sim);
    case "remote_enable":
      return M.remoteEnable(sim, req.p);
    case "remote_pair":
      return M.remotePair(sim);
    case "remote_revoke":
      return M.remoteRevoke(sim, req.p);

    // ── Neural ──
    case "orch_send": {
      void sim.neural.send(req.p.text);
      return null;
    }
    case "orch_stop":
      sim.neural.stop();
      return null;
    case "orch_clear":
      sim.neural.clear();
      return null;
    case "llm_key_set":
      return M.llmKeySet(sim, req.p);
    case "llm_test":
      return M.llmTest(sim);
    case "neural_mode":
      sim.neural.setMode(req.p.mode);
      return null;
    case "neural_task_edit":
      sim.neural.editTask(req.p.id, { ...(req.p.status ? { status: req.p.status } : {}), remove: req.p.remove });
      return null;
    case "neural_note_add":
      sim.neural.addNote(req.p.text);
      return null;
    case "neural_note_remove":
      sim.neural.removeNote(req.p.id);
      return null;
    case "neural_confirm":
      sim.neural.confirm(req.p.id, req.p.allow);
      return null;
    case "neural_team_start": {
      const ws = sim.state.workspaces.find((w) => w.id === req.p.workspace_id);
      if (!ws) throw new ApiErr("not_found", "Unknown project");
      if (req.p.pattern !== "race" && req.p.pattern !== "review") throw new ApiErr("bad_request", "Unknown team pattern");
      return sim.neural.startTeam({ workspaceId: ws.id, goal: req.p.goal, pattern: req.p.pattern, profiles: req.p.profiles, ...(req.p.check ? { check: req.p.check } : {}) });
    }
    case "neural_team_pick":
      sim.neural.pick(req.p.task_id, req.p.session_id);
      return null;
    case "neural_team_cleanup":
      sim.neural.cleanup(req.p.task_id);
      return null;
    case "swarm_start":
      return M.swarmStart(sim, req.p, conn);
    case "swarm_send":
      return M.swarmSend(sim, req.p);
    case "swarm_stop":
      return M.swarmStop(sim, req.p);
    case "swarm_remove":
      return M.swarmRemove(sim, req.p);

    // ── voice (hidden in the demo) and the host ──
    case "call_preview":
      return M.callPreview();
    case "host_models":
      return M.hostModels(sim);
    case "host_model_download":
      return M.modelDownload(sim, req.p);
    case "host_model_delete":
      return M.modelDelete(sim, req.p);
    case "host_update_check":
      return M.hostUpdate();
    case "host_system":
      return M.hostSystem(sim);
    case "host_restart":
      return M.hostRestart(sim);
    case "host_ui":
    case "host_notice":
      return null;
    case "audit_list":
      return M.auditList(sim, req.p);
    case "history_search":
      return M.historySearch(sim, req.p);
    // ── privacy and support: the demo never sends anything ──
    case "diagnostics_preview": {
      const report = JSON.stringify(
        req.p.usage
          ? { install: "demo", app: "desktop", version: "demo", os: "macos", counts: { agents_started: 4, neural_turns: 7 } }
          : { app: { version: "demo" }, system: { os: "macos" }, note: "The live demo does not collect anything." },
        null,
        2,
      );
      return { report, bytes: report.length };
    }
    case "diagnostics_send":
      throw new ApiErr("bad_request", "The live demo does not send reports. Install NeuralAgent to report a problem.");
  }
  const never: never = req;
  throw new ApiErr("bad_request", `Unknown request ${(never as { m?: string }).m ?? ""}`);
}

const need = (sim: Sim, id: string): Session => {
  const s = sim.session(id);
  if (!s) throw new ApiErr("not_found", "Unknown agent");
  return s;
};

/** `session_start`: a normal agent, or the install shell of the catalog (`install:<engine>`). */
function startSession(sim: Sim, p: Extract<Request, { m: "session_start" }>["p"]): Session {
  const ws = sim.state.workspaces.find((w) => w.id === p.workspace_id);
  if (!ws) throw new ApiErr("not_found", "Unknown project");
  if (p.profile_id.startsWith("install:")) {
    const id = p.profile_id.slice("install:".length);
    const entry = sim.state.catalog.find((c) => c.id === id);
    if (!entry) throw new ApiErr("not_found", "Unknown agent type");
    const s = createSession(sim, { workspaceId: ws.id, profileId: "shell", title: `Install ${entry.name}`, cwd: sim.vfs.exists(ws.path) ? ws.path : undefined });
    const term = sim.terms.get(s.id)!;
    term.write(`\x1b[2m${entry.install ?? ""}\x1b[0m\r\n`);
    void sim.clock.sleep(2600, sim.scope).then(() => {
      term.lines(`Installed ${entry.name}.`);
      sim.emit({ e: "catalog_set", catalog: sim.state.catalog.map((c) => (c.id === id ? { ...c, installed: true, path: `/usr/local/bin/${c.command}`, version: catalog().find((x) => x.id === id)?.version ?? "1.0.0" } : c)) });
    }).catch(() => {});
    return s;
  }
  const profile = sim.state.profiles.find((x) => x.id === p.profile_id);
  if (!profile) throw new ApiErr("not_found", "Unknown agent type");
  const cwd = p.cwd ? normalize(p.cwd) : undefined;
  return createSession(sim, { workspaceId: ws.id, profileId: profile.id, ...(p.prompt ? { prompt: p.prompt } : {}), ...(p.pane_id ? { paneId: p.pane_id } : {}), ...(p.cols ? { cols: p.cols } : {}), ...(p.rows ? { rows: p.rows } : {}), ...(cwd ? { cwd } : {}) });
}

function cvAction(sim: Sim, conn: Conn, p: Extract<Request, { m: "cv_action" }>["p"]) {
  const s = need(sim, p.sid);
  const run = sim.runs.get(s.id);
  const cv = sim.cvs.get(s.id);
  const a = p.action;
  const by = sim.actorOf(conn.view);
  const notice = (text: string) => cv?.push("user", [{ k: "text", text }], { kind: "output" });
  switch (a.k) {
    case "interrupt":
      run?.interrupt();
      return null;
    case "answer": {
      // A prompt that changed since the client drew it must not be answered by a stale tap.
      if (!run?.answer(a.n, by, a.prompt_id, a.text)) throw new ApiErr("bad_request", "That question was already answered");
      return null;
    }
    case "answer_question": {
      if (!run?.answerQuestion(a.answers, a.prompt_id, by)) throw new ApiErr("bad_request", "That question was already answered");
      return null;
    }
    case "set_mode":
      if (run) run.setMode(a.mode);
      else cv?.setMeta({ mode: a.mode });
      return null;
    case "model": {
      const key = a.model.toLowerCase();
      const hit = MODELS[key] ?? Object.values(MODELS).find((m) => m.id === a.model);
      if (!hit) throw new ApiErr("bad_request", "Unknown model");
      cv?.setMeta({ model: hit.id });
      notice(`Set model to ${hit.name} (${hit.id})`);
      return null;
    }
    case "effort":
      cv?.setMeta({ effort: a.level });
      notice(`Set effort level to ${a.level}`);
      return null;
    case "fast":
      cv?.setMeta({ fast: a.on });
      notice(a.on ? "Fast mode on" : "Fast mode off");
      return null;
    case "stop_agents":
      run?.stopAgents();
      return null;
    case "stop_task":
      if (!run?.stopTask(a.id)) throw new ApiErr("bad_request", "That task is not running any more");
      return null;
    case "send_queued_now":
      run?.sendQueuedNow();
      return null;
    case "shell":
      run?.submit("!" + a.command);
      return null;
    case "rewind":
      run?.interrupt();
      if (!cv?.rewind(a.message_id)) throw new ApiErr("not_found", "That message is gone");
      run?.rewound();
      return null;
    default:
      return null; // background: the demo's Bash calls finish by themselves
  }
}
