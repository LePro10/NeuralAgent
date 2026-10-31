// Composer and controls logic of the Claude view: command catalogue, prompt kinds and keys, queue, rewind.
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, armRewind, inputMode, resolveInput, typedMode, isRewindable, type Keys, rewindDistance, rewindOption, rewindSteps, serverActions, shellSteps, takeRewind } from "../components/claude/actions.ts";
import { contextOf, money, shortTokens, span, tasksRunning } from "../components/claude/metaInfo.ts";
import { CATALOGUE, catalogued, commandLine, mergeCommands, opensDialog, paletteSections, pushRecent, scoreCommand, searchCommands } from "../components/claude/commands.ts";
import { checkState, currentQuestion, denyKeys, pickKeys, tabKeys, planChoices, planFeedbackKeys, promptKind, questionsOf, screenOptions } from "../components/claude/promptState.ts";
import { addQueued, expire, reconcile, shownQueue } from "../components/claude/queue.ts";

const opt = (n: string, label: string, selected = false) => ({ n, label, selected });

test("catalogue: unique names, every command has a known group and kind", () => {
  const names = CATALOGUE.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const c of CATALOGUE) {
    assert.ok(["native", "args", "run", "dialog", "prompt"].includes(c.kind), c.name);
    assert.ok(c.description.length > 0, c.name);
  }
  assert.equal(catalogued("checkpoint")?.name, "rewind");
  assert.equal(catalogued("cost")?.name, "usage");
  assert.equal(catalogued("rename")?.needsArgs, true);
  assert.equal(catalogued("compact")?.needsArgs, false);
  // Removed from the CLI: no longer offered.
  assert.equal(catalogued("vim"), undefined);
  assert.equal(catalogued("pr-comments"), undefined);
});

test("merge: daemon descriptions fill in, custom commands and skills get their own groups", () => {
  const all = mergeCommands([
    { name: "compact", description: "Daemon text", source: "builtin" },
    { name: "deploy", description: "Ship it", source: "project" },
    { name: "release", description: "Cut a release", source: "skill" },
    { name: "tool:do", description: "Plugin thing", source: "plugin" },
    { name: "brand-new", description: "A new CLI command", source: "builtin" },
  ]);
  const by = new Map(all.map((c) => [c.name, c]));
  assert.equal(by.get("compact")?.group, "Conversation");
  assert.equal(by.get("deploy")?.group, "Your commands");
  assert.equal(by.get("deploy")?.kind, "prompt");
  assert.equal(by.get("release")?.group, "Skills");
  assert.equal(by.get("tool:do")?.group, "Plugins");
  assert.equal(by.get("brand-new")?.kind, "run");
  // The daemon's richer fields (once I1 sends them) win.
  const rich = mergeCommands([{ name: "compact", description: "x", source: "builtin", group: "Context and cost", kind: "run", args: "[focus]" } as never]);
  const c = rich.find((x) => x.name === "compact")!;
  assert.equal(c.group, "Context and cost");
  assert.equal(c.kind, "run");
  assert.equal(c.args, "[focus]");
});

test("search ranks name prefix over alias over word parts over description", () => {
  const all = mergeCommands([]);
  assert.equal(searchCommands(all, "comp", false)[0]?.name, "compact");
  assert.equal(searchCommands(all, "/undo", false)[0]?.name, "rewind");
  assert.ok(searchCommands(all, "review", false).some((c) => c.name === "code-review"));
  assert.ok(searchCommands(all, "context window", false).some((c) => c.name === "context"));
  assert.equal(scoreCommand(catalogued("model")!, "zzz"), null);
  // Phone-hidden commands only when typed out.
  assert.ok(!searchCommands(all, "colour", true).some((c) => c.name === "theme"));
  assert.equal(searchCommands(all, "theme", true)[0]?.name, "theme");
});

test("palette sections: recent first, groups in order, phone-only extras under More", () => {
  const all = mergeCommands([{ name: "deploy", description: "Ship it", source: "project" }]);
  const s = paletteSections(all, "", ["compact", "gone", "model"], true);
  assert.equal(s[0]!.title, "Recent");
  assert.deepEqual(s[0]!.items.map((c) => c.name), ["compact", "model"]);
  assert.equal(s[1]!.title, "Conversation");
  assert.ok(s.some((x) => x.title === "Your commands"));
  assert.equal(s.at(-1)!.title, "More");
  assert.ok(s.at(-1)!.items.some((c) => c.name === "theme"));
  const q = paletteSections(all, "dep", [], true);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.items[0]!.name, "deploy");
  assert.deepEqual(paletteSections(all, "qqqqq", [], true), []);
});

test("command line, dialogs, recents", () => {
  assert.equal(commandLine(catalogued("compact")!, "  keep the tests "), "/compact keep the tests");
  assert.equal(commandLine(catalogued("compact")!, ""), "/compact");
  assert.equal(opensDialog("/mcp"), true);
  assert.equal(opensDialog("/mcp reconnect github"), false);
  assert.equal(opensDialog("/export"), true);
  assert.equal(opensDialog("/export out.md"), false);
  assert.equal(opensDialog("/compact"), false);
  assert.equal(opensDialog("hello"), false);
  assert.deepEqual(pushRecent(["a", "b", "c"], "b", 3), ["b", "a", "c"]);
  assert.deepEqual(pushRecent(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
});

test("prompt kinds", () => {
  const perm = { title: "Bash command\n```\nrm -rf x\n```\nDo you want to proceed?", options: [opt("1", "Yes", true), opt("2", "Yes, and don't ask again for rm commands"), opt("3", "No, and tell Claude what to do differently (esc)")] };
  assert.equal(promptKind(perm), "permission");
  const plan = { title: "Ready to code?", options: [opt("1", "Yes, and auto-accept edits", true), opt("2", "Yes, and manually approve edits"), opt("3", "No, keep planning")] };
  assert.equal(promptKind(plan), "plan");
  assert.equal(promptKind({ title: "x", options: [opt("1", "Yes", true), opt("2", "No")] }, { name: "ExitPlanMode", input: {} }), "plan");
  const q = { title: "Which tests?", options: [opt("1", "Unit", true), opt("2", "E2E"), opt("3", "Type something.")] };
  assert.equal(promptKind(q), "question");
  assert.equal(promptKind({ title: "Pick", options: [opt("1", "A", true), opt("2", "B")] }, { name: "AskUserQuestion", input: {} }), "question");
  assert.equal(promptKind({ title: "Review your answers", options: [opt("1", "Submit answers", true), opt("2", "Cancel")] }, { name: "AskUserQuestion", input: {} }), "review");
  assert.equal(promptKind({ title: "Do you trust the files in this folder?", options: [opt("1", "Yes, proceed", true), opt("2", "No, exit")] }), "confirm");
  assert.equal(promptKind({ title: "Restore", options: [opt("1", "Restore code and conversation", true), opt("2", "Restore conversation"), opt("3", "Restore code"), opt("4", "Summarize from here"), opt("5", "Never mind")] }), "menu");
  // The daemon's own kind wins once it sends one.
  assert.equal(promptKind({ ...q, kind: "menu" } as never), "menu");
});

test("questions: input, tabs, checkboxes, free text", () => {
  const pending = {
    name: "AskUserQuestion",
    input: {
      questions: [
        { question: "Which framework?", header: "Framework", multiSelect: false, options: [{ label: "React", description: "UI library" }, { label: "Vue" }] },
        { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "Lint" }, { label: "Tests" }] },
      ],
    },
  };
  const qs = questionsOf(pending);
  assert.equal(qs.length, 2);
  assert.equal(qs[0]!.options[0]!.description, "UI library");
  assert.equal(qs[1]!.multiSelect, true);
  assert.deepEqual(questionsOf({ name: "Bash", input: {} }), []);
  const p2 = { title: "Which checks?", options: [opt("1", "[✔] Lint", true), opt("2", "[ ] Tests"), opt("3", "Type something")] };
  assert.equal(currentQuestion(qs, p2), 1);
  const so = screenOptions(p2);
  assert.equal(so[0]!.checked, true);
  assert.equal(so[0]!.label, "Lint");
  assert.equal(so[1]!.checked, false);
  assert.equal(so[2]!.free, true);
  assert.deepEqual(checkState("Plain"), { label: "Plain" });
});

test("keys: deny with a reason, plan feedback, plan choices", () => {
  assert.deepEqual(denyKeys("3", "", false), [{ write: "3" }]);
  assert.deepEqual(denyKeys("3", " use pnpm ", false), [{ write: "3" }, { wait: 450 }, { prompt: "use pnpm" }]);
  assert.deepEqual(denyKeys("3", "a\nb", true), [{ write: "3" }, { wait: 250 }, { write: "a b" }, { wait: 80 }, { write: "\r" }]);
  const plan = { title: "", options: [opt("1", "Yes, and auto-accept edits (shift+tab)", true), opt("2", "Yes, and manually approve edits"), opt("3", "No, keep planning"), opt("4", "Tell Claude what to change")] };
  assert.deepEqual(planFeedbackKeys(plan, "smaller steps")?.[0], { write: "4" });
  const plain = { title: "", options: [opt("1", "Yes", true), opt("2", "No, keep planning")] };
  assert.deepEqual(planFeedbackKeys(plain, "x"), [{ write: "2" }, { wait: 450 }, { prompt: "x" }]);
  const ch = planChoices(plan);
  assert.equal(ch.length, 3);
  assert.equal(ch[0]!.label, "Yes, and auto-accept edits");
  assert.equal(ch[0]!.primary, true);
  assert.equal(ch[2]!.reject, true);
});

test("queue: add, reconcile against the transcript, expire, daemon list wins", () => {
  let q = addQueued([], "also run the tests", 1000);
  q = addQueued(q, "  ", 1000);
  assert.equal(q.length, 1);
  assert.equal(reconcile(q, [{ text: "something else", ts: 2000 }]), q);
  assert.equal(reconcile(q, [{ text: "Also run the tests", ts: 2000 }]).length, 0);
  // Joined with another queued message by the CLI.
  assert.equal(reconcile(q, [{ text: "fix it\nalso run the tests", ts: 2000 }]).length, 0);
  // An old identical message does not count.
  assert.equal(reconcile(q, [{ text: "also run the tests", ts: -9000 }]).length, 1);
  assert.equal(expire(q, true, 0, 99_999).length, 1);
  assert.equal(expire(q, false, 1000, 3000).length, 1);
  assert.equal(expire(q, false, 1000, 8000).length, 0);
  assert.equal(shownQueue(q, undefined), q);
  assert.deepEqual(shownQueue(q, []), []);
  assert.equal(shownQueue(q, ["also run the tests"])[0]!.id, q[0]!.id);
});

const msg = (i: number, role: "user" | "assistant", text: string, kind?: string) => ({ i, id: `m${i}`, role, ts: i, kind, blocks: text ? [{ k: "text" as const, text }] : [] });

test("rewind: counts user prompts from the bottom, finds the restore option", () => {
  const ms = [msg(1, "user", "first"), msg(2, "assistant", "ok"), msg(3, "user", "/model", "command"), msg(4, "user", ""), msg(5, "user", "second"), msg(6, "assistant", "done")];
  assert.equal(isRewindable(ms[2]! as never), false);
  assert.equal(rewindDistance(ms as never, "m5"), 1);
  assert.equal(rewindDistance(ms as never, "m1"), 2);
  assert.equal(rewindDistance(ms as never, "m2"), null);
  const steps = rewindSteps(2);
  assert.deepEqual(steps[0], { prompt: "/rewind" });
  assert.equal(steps.filter((s) => "write" in s && s.write === "\x1b[A").length, 2);
  assert.deepEqual(steps.at(-1), { write: "\r" });
  const opts = [opt("1", "Restore code and conversation"), opt("2", "Restore conversation"), opt("3", "Restore code"), opt("4", "Summarize from here"), opt("5", "Never mind")];
  assert.equal(rewindOption(opts, "both"), "1");
  assert.equal(rewindOption(opts, "conversation"), "2");
  assert.equal(rewindOption(opts, "code"), "3");
  assert.equal(rewindOption(opts, "summarize"), "4");
  assert.equal(rewindOption([opt("1", "Never mind")], "code"), null);
});

test("input modes and shell keys", () => {
  assert.equal(inputMode("!ls -la"), "shell");
  assert.equal(inputMode("# use pnpm"), "memory");
  assert.equal(inputMode("#hashtag"), "prompt");
  assert.equal(inputMode("hello"), "prompt");
  assert.deepEqual(shellSteps(" ls "), [{ write: "!" }, { wait: 150 }, { prompt: "ls" }]);
});

test("meta: real context window wins over the guess, short numbers", () => {
  const base = { effort: null, hooks: false } as never;
  assert.equal(contextOf({ ...(base as object), model: "claude-opus-4-7" } as never), null);
  const guessed = contextOf({ ...(base as object), model: "claude-opus-4-7", context_tokens: 50_000 } as never)!;
  assert.deepEqual([guessed.window, guessed.pct, guessed.exact], [200_000, 25, false]);
  const big = contextOf({ ...(base as object), model: "claude-sonnet-4-6[1m]", context_tokens: 100_000 } as never)!;
  assert.equal(big.window, 1_000_000);
  const real = contextOf({ ...(base as object), model: "x", context_tokens: 90_000, context_window: 180_000, context_pct: 51.4 } as never)!;
  assert.deepEqual([real.window, real.pct, real.exact], [180_000, 51, true]);
  assert.equal(shortTokens(184_321), "184k");
  assert.equal(shortTokens(1_000_000), "1M");
  assert.equal(shortTokens(1_250), "1.3k");
  assert.equal(money(0.004), "<$0.01");
  assert.equal(money(12.3), "$12.30");
  assert.equal(money(undefined), null);
  assert.equal(span(45_000), "45s");
  assert.equal(span(80 * 60_000), "1h 20m");
  assert.equal(tasksRunning({ tasks_running: 2 } as never), 2);
  assert.equal(tasksRunning({} as never), 0);
});

test("keys: options without numbers, question tabs", () => {
  assert.deepEqual(pickKeys({ n: "2" }), [{ write: "2" }]);
  assert.deepEqual(pickKeys({ n: "", nav: 2 }), [{ write: "\x1b[B" }, { wait: 40 }, { write: "\x1b[B" }, { wait: 40 }, { write: "\r" }]);
  assert.deepEqual(pickKeys({ n: "", nav: -1 }), [{ write: "\x1b[A" }, { wait: 40 }, { write: "\r" }]);
  assert.deepEqual(tabKeys(0, 2).filter((s) => "write" in s), [{ write: "\x1b[C" }, { write: "\x1b[C" }]);
  assert.deepEqual(tabKeys(2, 1).filter((s) => "write" in s), [{ write: "\x1b[D" }]);
});

test("actions: the daemon plays them once it says so, else the client keys", async () => {
  const wrote: string[] = [];
  const sent: unknown[] = [];
  const k: Keys = { write: (_s, d) => void wrote.push(d), req: async () => null as never, cvAction: async (_s, a) => void sent.push(a) };
  await act(k, "s", false, { k: "interrupt" }, [{ write: "\x1b" }]);
  assert.deepEqual([wrote, sent], [["\x1b"], []]);
  await act(k, "s", true, { k: "interrupt" }, [{ write: "\x1b" }]);
  assert.deepEqual(sent, [{ k: "interrupt" }]);
  assert.equal(serverActions({ actions: true }), true);
  assert.equal(serverActions({}), false);
  assert.equal(serverActions(undefined), false);
});

test("rewind: an armed choice answers the restore menu once, then expires", () => {
  const menu = [opt("1", "Restore code and conversation"), opt("2", "Restore conversation"), opt("3", "Never mind")];
  assert.equal(takeRewind("s", menu), null);
  armRewind("s", "conversation", 1_000);
  assert.equal(takeRewind("s", [opt("1", "Yes"), opt("2", "No")], 2_000), null, "unrelated menu: stays armed");
  assert.equal(takeRewind("s", menu, 3_000), "2");
  assert.equal(takeRewind("s", menu, 3_100), null, "only once");
  armRewind("s", "both", 0);
  assert.equal(takeRewind("s", menu, 9_000), null, "expired");
});

test("commands: daemon group ids, native screens and values", () => {
  const all = mergeCommands([
    { name: "model", description: "", source: "builtin", group: "model", kind: "native", native: "model", values: ["opus", "fable"] },
    { name: "deploy", description: "Ship it", source: "project", group: "custom", kind: "prompt" },
    { name: "doctor", description: "", source: "builtin", kind: "output" },
  ]);
  const model = all.find((c) => c.name === "model")!;
  assert.deepEqual([model.group, model.native, model.values], ["Model and modes", "model", ["opus", "fable"]]);
  assert.equal(all.find((c) => c.name === "deploy")!.group, "Your commands");
  assert.equal(all.find((c) => c.name === "doctor")!.kind, "run");
});

test("typed ! at an empty composer arms shell mode", () => {
  const armed = typedMode("", "!", "insertText");
  assert.equal(armed, "shell");
  assert.deepEqual(resolveInput(armed, " ls -la "), { mode: "shell", body: "ls -la" });
});

test("typed # then space arms memory mode", () => {
  assert.equal(typedMode("#", "# ", "insertText"), "memory");
  assert.equal(typedMode("", "#", "insertText"), null);
});

test("pasted markdown starting with # stays a plain prompt", () => {
  const armed = typedMode("", "# Title\ntext", "insertFromPaste");
  assert.equal(armed, null);
  assert.deepEqual(resolveInput(armed, "# Title\ntext"), { mode: "prompt", body: "# Title\ntext" });
});

test("pasted or non-empty ! text is plain", () => {
  assert.equal(typedMode("", "!important", "insertFromPaste"), null);
  assert.equal(typedMode("", "!", "insertFromPaste"), null);
  assert.equal(typedMode("a", "a!", "insertText"), null);
  assert.equal(typedMode("", "!x", "insertText"), null);
  assert.deepEqual(resolveInput(null, "!important"), { mode: "prompt", body: "!important" });
});

test("leaving the mode chip makes the text plain again", () => {
  let armed = typedMode("", "!", "insertText");
  armed = null;
  assert.equal(resolveInput(armed, "ls").mode, "prompt");
});
