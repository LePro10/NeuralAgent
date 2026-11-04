// NeuralAgent Browser: the service worker. Keeps one WebSocket to the app on this computer
// (ws://127.0.0.1:<port>/browser) and runs the app's commands with chrome.tabs and
// chrome.scripting only (no debugger, no DevTools protocol), in a tab group "NeuralAgent".
// Bridge protocol: docs/notes/autopilot.md, section Browser.
import { COMMAND_TIMEOUT_MS, KeyedQueue, MAX_TEXT, backoff, browserLabel, parsePairCode, withTimeout } from "./protocol.js";
import { clickElement, listLinks, readPage, scrollPage, typeInto } from "./pagescripts.js";

const GROUP_TITLE = "NeuralAgent";
const KEEPALIVE_MS = 20_000;
const queue = new KeyedQueue();

let ws = null;
let attempt = 0;
let reconnectTimer = null;
let keepTimer = null;
let wantConnected = false;

// ---- persisted state ----
const getSaved = async () => (await chrome.storage.local.get(["port", "token"])) ?? {};
const setStatus = (status, detail = "") => chrome.storage.local.set({ status, detail, statusAt: Date.now() });

async function owned() {
  const s = await chrome.storage.session.get("owned");
  return new Set(s.owned ?? []);
}
async function remember(id) {
  const o = await owned();
  o.add(id);
  await chrome.storage.session.set({ owned: [...o] });
}
async function forget(id) {
  const o = await owned();
  o.delete(id);
  await chrome.storage.session.set({ owned: [...o] });
}

// ---- socket ----
function clearTimers() {
  clearTimeout(reconnectTimer);
  clearInterval(keepTimer);
  reconnectTimer = keepTimer = null;
}

function closeSocket() {
  clearTimers();
  const s = ws;
  ws = null;
  if (s) {
    s.onclose = s.onerror = s.onmessage = s.onopen = null;
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
}

async function connect() {
  const { port, token } = await getSaved();
  if (!port || !token) {
    wantConnected = false;
    await setStatus("unpaired");
    return;
  }
  wantConnected = true;
  closeSocket();
  await setStatus("connecting");
  let s;
  try {
    s = new WebSocket(`ws://127.0.0.1:${port}/browser`);
  } catch {
    return scheduleReconnect();
  }
  ws = s;
  s.onopen = () => s.send(JSON.stringify({ t: "hello", token, browser: browserLabel(navigator.userAgent) }));
  s.onmessage = (ev) => void onMessage(s, ev.data);
  s.onerror = () => {};
  s.onclose = () => {
    if (ws !== s) return;
    ws = null;
    clearInterval(keepTimer);
    void setStatus("offline", "NeuralAgent is not reachable. Is the app running?");
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!wantConnected) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => void connect(), backoff(attempt++));
}

async function onMessage(s, raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (m.t === "ok") {
    attempt = 0;
    await setStatus("connected");
    // Traffic on the socket keeps an MV3 service worker alive.
    clearInterval(keepTimer);
    keepTimer = setInterval(() => s.readyState === 1 && s.send(JSON.stringify({ t: "ping" })), KEEPALIVE_MS);
  } else if (m.t === "cmd") {
    const reply = await runCommand(m);
    if (s.readyState === 1) s.send(JSON.stringify({ t: "res", id: m.id, ...reply }));
  } else if (m.t === "error" || m.t === "denied") {
    // The app does not know this token any more (unpaired there): go back to "not paired".
    await chrome.storage.local.remove(["token"]);
    wantConnected = false;
    closeSocket();
    await setStatus("unpaired", m.error || "The app no longer knows this browser. Pair it again.");
  }
}

// ---- pairing ----
function pair(input) {
  const parsed = parsePairCode(input);
  if (!parsed) return Promise.resolve({ ok: false, error: "That code does not look right. It starts with NA- and is shown in the NeuralAgent app." });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        s.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    let s;
    try {
      s = new WebSocket(`ws://127.0.0.1:${parsed.port}/browser`);
    } catch {
      return resolve({ ok: false, error: "Could not open the connection to the app." });
    }
    const timer = setTimeout(() => finish({ ok: false, error: "The app did not answer. Is NeuralAgent running, and is the code still showing?" }), 10_000);
    s.onopen = () => s.send(JSON.stringify({ t: "pair", code: parsed.code, browser: browserLabel(navigator.userAgent) }));
    s.onerror = () => finish({ ok: false, error: "Could not reach the app on this computer. Is NeuralAgent running?" });
    s.onmessage = async (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "paired" && m.token) {
        await chrome.storage.local.set({ token: m.token, port: m.port || parsed.port });
        attempt = 0;
        finish({ ok: true });
        void connect();
      } else if (m.t === "error" || m.t === "denied") {
        finish({ ok: false, error: m.error || "The app refused this code. Codes work once; show a new one." });
      }
    };
  });
}

async function unpair() {
  wantConnected = false;
  closeSocket();
  await chrome.storage.local.remove(["token", "port"]);
  await setStatus("unpaired");
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.t === "pair") void pair(msg.code).then(send);
  else if (msg?.t === "unpair") void unpair().then(send);
  else if (msg?.t === "retry") {
    attempt = 0;
    void connect().then(() => send({ ok: true }));
  } else return false;
  return true;
});

// MV3 sleeps the worker; an alarm wakes it and reconnects when needed.
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "keepalive") return;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "ping" }));
  else void connect();
});
chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
chrome.tabs.onRemoved.addListener((id) => void forget(id));
void connect();

// ---- tab group ----
async function addToGroup(tabId) {
  try {
    const { groupId } = await chrome.storage.session.get("groupId");
    let id;
    if (groupId != null) {
      try {
        await chrome.tabGroups.get(groupId);
        id = await chrome.tabs.group({ tabIds: [tabId], groupId });
      } catch {
        id = undefined;
      }
    }
    if (id == null) {
      id = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(id, { title: GROUP_TITLE, color: "blue", collapsed: false });
      await chrome.storage.session.set({ groupId: id });
    }
  } catch {
    /* grouping is cosmetic; the tab still works */
  }
}

// ---- commands ----
const fail = (error) => ({ ok: false, error });
const ok = (data) => ({ ok: true, data });

async function ownTab(args) {
  const id = Number(args?.tab);
  if (!Number.isInteger(id)) throw new Error("Which tab? Open a page first and use the tab number it returned.");
  if (!(await owned()).has(id)) throw new Error("That tab was not opened by NeuralAgent, so it is not touched. Open the page with the open command.");
  try {
    return await chrome.tabs.get(id);
  } catch {
    await forget(id);
    throw new Error("That tab was closed.");
  }
}

function waitForLoad(tabId, ms = 20_000) {
  return new Promise((resolve) => {
    let t;
    const on = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    const done = () => {
      clearTimeout(t);
      chrome.tabs.onUpdated.removeListener(on);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(on);
    t = setTimeout(done, ms);
    chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done(), done);
  });
}

async function inject(tabId, func, args) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return r?.result;
  } catch (e) {
    const m = String(e?.message || e);
    if (/cannot be scripted|Cannot access|extensions gallery|chrome:\/\//i.test(m)) throw new Error("Chrome does not let extensions read this page (a browser page or the Web Store).");
    if (/No tab with id|closed/i.test(m)) throw new Error("That tab was closed.");
    throw new Error("Could not read the page: " + m);
  }
}

const summary = (tab) => ({ tab: tab.id, title: tab.title ?? "", url: tab.url ?? tab.pendingUrl ?? "" });

const commands = {
  async open({ url }) {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      throw new Error("That is not a web address. Use one that starts with https://.");
    }
    if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https pages can be opened.");
    const tab = await chrome.tabs.create({ url: u.href, active: false });
    await remember(tab.id);
    await addToGroup(tab.id);
    await waitForLoad(tab.id);
    return summary(await chrome.tabs.get(tab.id));
  },
  async read(args) {
    const tab = await ownTab(args);
    const r = await inject(tab.id, readPage, [MAX_TEXT]);
    return { title: r.title, url: r.url, text: r.text };
  },
  async links(args) {
    const tab = await ownTab(args);
    return { links: await inject(tab.id, listLinks, [200]) };
  },
  async click(args) {
    const tab = await ownTab(args);
    if (!args.selector && !args.text) throw new Error("Say what to click: a text or a selector.");
    const r = await inject(tab.id, clickElement, [args.selector ?? null, args.text ?? null]);
    if (r?.error) throw new Error(r.error);
    await new Promise((res) => setTimeout(res, 600));
    await waitForLoad(tab.id, 8000);
    return { ...r, ...summary(await chrome.tabs.get(tab.id)) };
  },
  async type(args) {
    const tab = await ownTab(args);
    if (!args.selector) throw new Error("Say which field: a selector is needed.");
    const r = await inject(tab.id, typeInto, [args.selector, String(args.text ?? ""), !!args.submit]);
    if (r?.error) throw new Error(r.error);
    return r;
  },
  async scroll(args) {
    const tab = await ownTab(args);
    return await inject(tab.id, scrollPage, [args.to ?? args.direction ?? "down"]);
  },
  async close(args) {
    const tab = await ownTab(args);
    await chrome.tabs.remove(tab.id);
    await forget(tab.id);
    return { closed: true };
  },
};

async function runCommand(m) {
  const fn = commands[m.cmd];
  if (!fn) return fail(`This extension does not know the command "${m.cmd}".`);
  const job = () => withTimeout(fn(m.args ?? {}), COMMAND_TIMEOUT_MS).then(ok, (e) => fail(String(e?.message || e)));
  // One command at a time per tab; commands for new tabs run side by side.
  return queue.run(m.args?.tab ?? `new-${m.id}`, job);
}
