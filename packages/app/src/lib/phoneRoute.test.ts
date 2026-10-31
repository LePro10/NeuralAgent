import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { PhoneRouter, canGoBackInPage, entriesOf, hashOf, parseHash, usePhoneNav, type Nav, type RouterWindow } from "./phoneRoute.ts";

/** A browser history in memory: pushState/replaceState are instant, go/back land later (as in browsers). */
class FakeWindow implements RouterWindow {
  entries: { state: unknown; hash: string }[] = [{ state: null, hash: "" }];
  at = 0;
  pops: (() => void)[] = [];
  store = new Map<string, string>();
  queue: number[] = [];
  history = {
    get state() {
      return self.entries[self.at]!.state;
    },
    pushState: (state: unknown, _t: string, url?: string | URL | null) => {
      this.entries = this.entries.slice(0, this.at + 1);
      this.entries.push({ state, hash: String(url ?? this.entries[this.at]!.hash) });
      this.at++;
    },
    replaceState: (state: unknown, _t: string, url?: string | URL | null) => {
      this.entries[this.at] = { state, hash: String(url ?? this.entries[this.at]!.hash) };
    },
    go: (n?: number) => void this.queue.push(n ?? 0),
    back: () => void this.queue.push(-1),
  } as unknown as RouterWindow["history"];
  location = {
    get hash() {
      return self.entries[self.at]!.hash;
    },
  } as RouterWindow["location"];
  localStorage = { getItem: (k: string) => this.store.get(k) ?? null, setItem: (k: string, v: string) => void this.store.set(k, v) };
  addEventListener = (_t: "popstate", cb: () => void) => void this.pops.push(cb);
  removeEventListener = (_t: "popstate", cb: () => void) => void (this.pops = this.pops.filter((p) => p !== cb));
  /** Runs queued traversals (and the pushes they trigger) until the history is still. */
  flush() {
    for (let guard = 0; this.queue.length && guard < 20; guard++) {
      const n = this.queue.shift()!;
      const to = Math.max(0, Math.min(this.entries.length - 1, this.at + n));
      if (to === this.at) continue;
      this.at = to;
      for (const p of [...this.pops]) p();
    }
  }
  /** A user (or a link) changes the hash: a new entry without state. */
  navigateHash(hash: string) {
    this.entries = this.entries.slice(0, this.at + 1);
    this.entries.push({ state: null, hash });
    this.at++;
    for (const p of [...this.pops]) p();
  }
  constructor(hash = "") {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    self = this;
    this.entries[0]!.hash = hash;
  }
}
let self: FakeWindow;

const nav = (): Nav => ({ tab: usePhoneNav.getState().tab, stack: usePhoneNav.getState().stack });
const hashes = (w: FakeWindow) => w.entries.slice(0, w.at + 1).map((e) => e.hash);

beforeEach(() => {
  usePhoneNav.setState({ tab: "agents", stack: [], stacks: { agents: [], neural: [], projects: [], settings: [] }, retap: 0 });
});

test("links parse to their tab and print back", () => {
  assert.deepEqual(parseHash("#/agent/abc"), { tab: "agents", stack: [{ k: "agent", sid: "abc" }] });
  assert.deepEqual(parseHash("#/project/p1"), { tab: "projects", stack: [{ k: "project", id: "p1" }] });
  assert.deepEqual(parseHash("#/settings/remote"), { tab: "settings", stack: [{ k: "section", id: "remote" }] });
  assert.deepEqual(parseHash("#/neural"), { tab: "neural", stack: [] });
  assert.equal(parseHash("#/nonsense/x"), null);
  assert.equal(parseHash(""), null);
  for (const h of ["#/agent/a%2Fb", "#/project/p1", "#/swarm/s", "#/swarms", "#/usage", "#/settings/mcp", "#/history", "#/projects"]) {
    assert.equal(hashOf(parseHash(h)!), h);
  }
});

test("history entries: Agents root, then the other tab's root, then each page", () => {
  assert.deepEqual(entriesOf({ tab: "agents", stack: [] }).length, 1);
  const e = entriesOf({ tab: "projects", stack: [{ k: "project", id: "p" }, { k: "agent", sid: "s" }] });
  assert.deepEqual(e.map(hashOf), ["#/agents", "#/projects", "#/project/p", "#/agent/s"]);
});

test("push and back walk the history", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  assert.deepEqual(hashes(w), ["#/agents"]);
  r.openAgent("s1");
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/s1"]);
  assert.equal(canGoBackInPage(w.history.state), true);
  assert.equal(r.back(), true);
  w.flush();
  assert.deepEqual(nav(), { tab: "agents", stack: [] });
  assert.equal(canGoBackInPage(w.history.state), false);
  // Nothing left: the caller minimises.
  assert.equal(r.back(), false);
});

test("a deep link builds the history under it, so back reaches the inbox", () => {
  const w = new FakeWindow("#/agent/s9");
  const r = new PhoneRouter(w);
  r.start();
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/s9"]);
  assert.deepEqual(nav(), { tab: "agents", stack: [{ k: "agent", sid: "s9" }] });
  r.back();
  w.flush();
  assert.deepEqual(nav().stack, []);
});

test("tab switches rewrite the history; each tab remembers its page", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.tab("projects");
  r.push({ k: "project", id: "p" });
  assert.deepEqual(hashes(w), ["#/agents", "#/projects", "#/project/p"]);
  r.tab("settings");
  assert.deepEqual(nav(), { tab: "settings", stack: [] });
  w.flush();
  assert.deepEqual(hashes(w), ["#/agents", "#/settings"]);
  r.tab("projects");
  w.flush();
  assert.deepEqual(nav(), { tab: "projects", stack: [{ k: "project", id: "p" }] });
  assert.deepEqual(hashes(w), ["#/agents", "#/projects", "#/project/p"]);
  // Tapping the shown tab pops to its root; again scrolls to the top.
  r.tab("projects");
  w.flush();
  assert.deepEqual(nav(), { tab: "projects", stack: [] });
  assert.deepEqual(hashes(w), ["#/agents", "#/projects"]);
  r.tab("projects");
  assert.equal(usePhoneNav.getState().retap, 1);
  // Back from another tab's root goes home.
  r.back();
  w.flush();
  assert.deepEqual(nav(), { tab: "agents", stack: [] });
});

test("a notification opens the agent over the inbox from anywhere", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.tab("settings");
  r.push({ k: "section", id: "remote" });
  r.openAgentFresh("s2");
  assert.deepEqual(nav(), { tab: "agents", stack: [{ k: "agent", sid: "s2" }] });
  w.flush();
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/s2"]);
});

test("closing an overlay with back leaves the page alone", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.openAgent("s1");
  // useLayer: a sheet opens and copies the route into its entry.
  w.history.pushState({ ...(w.history.state as object), layer: "k" }, "");
  w.history.back();
  w.flush();
  assert.deepEqual(nav(), { tab: "agents", stack: [{ k: "agent", sid: "s1" }] });
});

test("a page opened from an open sheet takes over the sheet's entry", () => {
  const w = new FakeWindow();
  let layers = 0;
  const r = new PhoneRouter(w, () => layers);
  r.start();
  layers = 1;
  w.history.pushState({ ...(w.history.state as object), layer: "k" }, "");
  r.openAgent("s3");
  layers = 0;
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/s3"]);
  r.back();
  w.flush();
  assert.deepEqual(nav().stack, []);
});

test("a page opened right after a sheet closed itself waits for the sheet's back", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w, () => 0);
  r.start();
  w.history.pushState({ ...(w.history.state as object), layer: "k" }, "");
  // The sheet's cleanup already called back (not landed yet), then the page opens.
  w.history.back();
  r.openAgent("s4");
  assert.deepEqual(nav().stack, [{ k: "agent", sid: "s4" }]);
  w.flush();
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/s4"]);
});

test("a reload keeps the place from the history", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.openAgent("s5");
  r.stop();
  usePhoneNav.setState({ tab: "agents", stack: [] });
  const again = new PhoneRouter(w);
  again.start();
  assert.deepEqual(nav().stack, [{ k: "agent", sid: "s5" }]);
  assert.equal(again.idx, 1);
});

test("a typed link rebuilds the history", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.openAgent("s1");
  w.navigateHash("#/project/p7");
  w.flush();
  assert.deepEqual(nav(), { tab: "projects", stack: [{ k: "project", id: "p7" }] });
  assert.deepEqual(hashes(w), ["#/agents", "#/projects", "#/project/p7"]);
});

test("another agent replaces the shown agent instead of stacking", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.openAgent("a");
  r.openAgent("b");
  w.flush();
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/b"]);
});

test("an agent opened before the router started is where it starts", () => {
  const w = new FakeWindow("#/projects");
  const r = new PhoneRouter(w);
  r.openAgentFresh("s7");
  r.start();
  assert.deepEqual(nav(), { tab: "agents", stack: [{ k: "agent", sid: "s7" }] });
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/s7"]);
});

test("after a reload an early agent still opens", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.tab("projects");
  r.stop();
  const again = new PhoneRouter(w);
  again.openAgentFresh("s8");
  again.start();
  w.flush();
  assert.deepEqual(nav(), { tab: "agents", stack: [{ k: "agent", sid: "s8" }] });
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/s8"]);
});

test("two quick agent switches end on the last agent, back goes to the page under it", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.openAgent("a");
  r.openAgent("b");
  r.openAgent("c");
  w.flush();
  assert.deepEqual(nav().stack, [{ k: "agent", sid: "c" }]);
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/c"]);
  r.back();
  w.flush();
  assert.deepEqual(nav(), { tab: "agents", stack: [] });
});

test("replacing the top page adds no history entry", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.openAgent("a");
  const len = w.entries.length;
  r.openAgent("b");
  assert.equal(w.entries.length, len);
  assert.equal(w.queue.length, 0);
  assert.deepEqual(hashes(w), ["#/agents", "#/agent/b"]);
});

test("a move while a traversal is pending is made after it landed", () => {
  const w = new FakeWindow();
  const r = new PhoneRouter(w);
  r.start();
  r.tab("projects");
  r.openAgent("a");
  r.tab("settings");
  r.tab("neural");
  w.flush();
  assert.deepEqual(nav().tab, "neural");
  assert.deepEqual(hashes(w), ["#/agents", "#/neural"]);
});

test("moving with two open layers lands on the target", () => {
  const w = new FakeWindow();
  let layers = 0;
  const r = new PhoneRouter(w, () => layers);
  r.start();
  r.openAgent("s1");
  layers = 2;
  w.history.pushState({ ...(w.history.state as object), layer: "k1" }, "");
  w.history.pushState({ ...(w.history.state as object), layer: "k2" }, "");
  r.tab("projects");
  layers = 0;
  w.flush();
  assert.deepEqual(nav().tab, "projects");
  assert.deepEqual(hashes(w), ["#/agents", "#/projects"]);
});
