// Discord connector: Gateway WebSocket (events) + REST (tools). No npm packages.
import { pathToFileURL } from "node:url";
import { ConnectorError, config, secret, createServer, fetchJson, clip, log, options } from "../_lib/connector.mjs";

const API = "https://discord.com/api/v10";
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
// GUILDS | GUILD_MESSAGE_REACTIONS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
export const INTENTS = 1 | 1024 | 512 | 4096 | 32768;
// Privileged, only asked for when the member_joined event is on.
export const INTENT_MEMBERS = 2;
// View channels, send messages, send in threads, create public threads, read history, add reactions, manage messages (pin). No Administrator.
export const INVITE_PERMISSIONS = 1024 + 2048 + 274877906944 + 34359738368 + 65536 + 64 + 8192;
export const EVENT_KINDS = ["messages", "threads", "dms", "member_joined", "reaction_added"];
const DEFAULT_EVENTS = ["messages", "threads", "dms", "reaction_added"];

export function build({ env = process.env, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, retryScale = 1, output = process.stdout } = {}) {
  const token = () => secret("bot_token", env);
  const channelsChosen = () => (Array.isArray(config(env).channels) ? config(env).channels.map(String) : []);
  const eventsOn = () => {
    const e = config(env).events;
    return new Set(Array.isArray(e) ? e.map(String) : DEFAULT_EVENTS);
  };
  const logChannel = () => {
    const l = config(env).log_channel;
    const v = Array.isArray(l) ? l[0] : l;
    return v ? String(v) : "";
  };
  const reasonHeaders = (reason) => (reason ? { "X-Audit-Log-Reason": encodeURIComponent(String(reason).slice(0, 400)) } : {});
  const REASON = { reason: { type: "string", description: "Optional: why you do this. Shown in the action log." } };

  async function api(path, init = {}) {
    if (!token()) throw new ConnectorError("No bot token yet. Paste it in the setup form first.");
    return fetchJson(API + path, {
      ...init,
      fetchImpl,
      retryScale,
      retries: 4,
      headers: { Authorization: `Bot ${token()}`, "Content-Type": "application/json", "User-Agent": "NeuralAgent (https://agent.neuralhub.dev, 1)", ...(init.headers || {}) },
    });
  }

  const simplify = (m) => ({
    id: m.id,
    channel_id: m.channel_id,
    author: m.author?.global_name || m.author?.username,
    author_id: m.author?.id,
    bot: !!m.author?.bot,
    text: m.content,
    time: m.timestamp,
    reply_to: m.message_reference?.message_id,
  });

  const tools = {
    whoami: {
      description: "Check the bot token. Returns the bot name and the link that invites it to a server.",
      run: async () => {
        const me = await api("/users/@me");
        let invite_url;
        try {
          const app = await api("/oauth2/applications/@me");
          invite_url = `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
        } catch {}
        return { text: `Signed in as ${me.username}`, name: me.username, id: me.id, invite_url };
      },
    },
    list_channels: {
      description: "Text channels of every server the bot is in, as [{value,label}].",
      run: async () => {
        const guilds = await api("/users/@me/guilds");
        const out = [];
        for (const g of guilds) {
          const chans = await api(`/guilds/${g.id}/channels`);
          for (const c of chans.filter((c) => c.type === 0 || c.type === 5)) out.push({ g, c });
        }
        return options(out, (x) => x.c.id, (x) => `${x.g.name} / #${x.c.name}`);
      },
    },
    read_messages: {
      description: "Recent messages of a channel, newest last.",
      schema: { channel_id: { type: "string" }, limit: { type: "number", description: "1-100, default 20" }, before: { type: "string", description: "message id to page back from" } },
      required: ["channel_id"],
      run: async ({ channel_id, limit = 20, before }) => {
        const q = new URLSearchParams({ limit: String(Math.min(Math.max(+limit || 20, 1), 100)) });
        if (before) q.set("before", before);
        const msgs = await api(`/channels/${encodeURIComponent(channel_id)}/messages?${q}`);
        return msgs.reverse().map(simplify).map((m) => ({ ...m, text: clip(m.text) }));
      },
    },
    reply: {
      description: "Reply to a message in its channel (shown as a reply). Speaks publicly as the bot.",
      schema: { channel_id: { type: "string" }, message_id: { type: "string" }, text: { type: "string" }, ...REASON },
      required: ["channel_id", "message_id", "text"],
      run: async ({ channel_id, message_id, text }) => {
        const m = await api(`/channels/${encodeURIComponent(channel_id)}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: String(text).slice(0, 2000), message_reference: { message_id }, allowed_mentions: { replied_user: true, parse: [] } }),
        });
        return { sent: true, id: m.id };
      },
    },
    send_message: {
      description: "Post a new message in a channel. Speaks publicly as the bot.",
      schema: { channel_id: { type: "string" }, text: { type: "string" }, ...REASON },
      required: ["channel_id", "text"],
      run: async ({ channel_id, text }) => {
        const m = await api(`/channels/${encodeURIComponent(channel_id)}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: String(text).slice(0, 2000), allowed_mentions: { parse: [] } }),
        });
        return { sent: true, id: m.id };
      },
    },
    add_reaction: {
      description: "React to a message with an emoji (a unicode emoji such as 👍).",
      schema: { channel_id: { type: "string" }, message_id: { type: "string" }, emoji: { type: "string" }, ...REASON },
      required: ["channel_id", "message_id", "emoji"],
      run: async ({ channel_id, message_id, emoji }) => {
        await api(`/channels/${encodeURIComponent(channel_id)}/messages/${encodeURIComponent(message_id)}/reactions/${encodeURIComponent(emoji)}/@me`, { method: "PUT" });
        return { reacted: true };
      },
    },
    list_roles: {
      description: "Roles of a server (or of every server the bot is in when guild_id is empty).",
      schema: { guild_id: { type: "string" } },
      run: async ({ guild_id } = {}) => {
        const guilds = guild_id ? [{ id: guild_id }] : await api("/users/@me/guilds");
        const out = [];
        for (const g of guilds) for (const r of await api(`/guilds/${encodeURIComponent(g.id)}/roles`)) out.push({ id: r.id, name: r.name, guild_id: g.id, managed: !!r.managed, position: r.position });
        return out;
      },
    },
    list_members: {
      description: "Members of a server, paged by id. Needs the Server Members intent. Pass the last id as after for the next page.",
      schema: { guild_id: { type: "string" }, limit: { type: "number", description: "1-100, default 50" }, after: { type: "string" } },
      required: ["guild_id"],
      run: async ({ guild_id, limit = 50, after }) => {
        const q = new URLSearchParams({ limit: String(Math.min(Math.max(+limit || 50, 1), 100)) });
        if (after) q.set("after", after);
        const ms = await api(`/guilds/${encodeURIComponent(guild_id)}/members?${q}`);
        return ms.map((m) => ({ id: m.user?.id, name: m.nick || m.user?.global_name || m.user?.username, username: m.user?.username, bot: !!m.user?.bot, roles: m.roles, joined: m.joined_at }));
      },
    },
    get_message: {
      description: "One message by id.",
      schema: { channel_id: { type: "string" }, message_id: { type: "string" } },
      required: ["channel_id", "message_id"],
      run: async ({ channel_id, message_id }) => {
        const m = await api(`/channels/${encodeURIComponent(channel_id)}/messages/${encodeURIComponent(message_id)}`);
        return { ...simplify(m), text: clip(m.content) };
      },
    },
    search_messages: {
      description: "Find messages containing a text in a channel by scanning its recent history (up to 500 messages). Newest first.",
      schema: { channel_id: { type: "string" }, query: { type: "string" }, limit: { type: "number", description: "max hits, 1-50, default 10" } },
      required: ["channel_id", "query"],
      run: async ({ channel_id, query, limit = 10 }) => {
        const want = Math.min(Math.max(+limit || 10, 1), 50);
        const needle = String(query).toLowerCase();
        const hits = [];
        let before;
        for (let page = 0; page < 5 && hits.length < want; page++) {
          const q = new URLSearchParams({ limit: "100" });
          if (before) q.set("before", before);
          const msgs = await api(`/channels/${encodeURIComponent(channel_id)}/messages?${q}`);
          for (const m of msgs) if (String(m.content || "").toLowerCase().includes(needle) && hits.length < want) hits.push({ ...simplify(m), text: clip(m.content, 1000) });
          if (msgs.length < 100) break;
          before = msgs[msgs.length - 1].id;
        }
        return hits;
      },
    },
    create_thread: {
      description: "Start a public thread, on a message (message_id) or free in the channel.",
      schema: { channel_id: { type: "string" }, name: { type: "string" }, message_id: { type: "string" }, ...REASON },
      required: ["channel_id", "name"],
      run: async ({ channel_id, name, message_id, reason }) => {
        const base = `/channels/${encodeURIComponent(channel_id)}`;
        const body = { name: String(name).slice(0, 100), auto_archive_duration: 1440 };
        const t = message_id
          ? await api(`${base}/messages/${encodeURIComponent(message_id)}/threads`, { method: "POST", body: JSON.stringify(body), headers: reasonHeaders(reason) })
          : await api(`${base}/threads`, { method: "POST", body: JSON.stringify({ ...body, type: 11 }), headers: reasonHeaders(reason) });
        return { created: true, thread_id: t.id };
      },
    },
    pin_message: {
      description: "Pin a message in its channel.",
      schema: { channel_id: { type: "string" }, message_id: { type: "string" }, ...REASON },
      required: ["channel_id", "message_id"],
      run: async ({ channel_id, message_id, reason }) => {
        await api(`/channels/${encodeURIComponent(channel_id)}/pins/${encodeURIComponent(message_id)}`, { method: "PUT", headers: reasonHeaders(reason) });
        return { pinned: true };
      },
    },
  };

  // ---- Action log: every write/external action leaves one short line in the log channel ----
  const ACTIONS = {
    reply: (a) => `replied to message ${a.message_id} in <#${a.channel_id}>`,
    send_message: (a) => `posted a message in <#${a.channel_id}>`,
    add_reaction: (a) => `reacted ${a.emoji} to message ${a.message_id} in <#${a.channel_id}>`,
    create_thread: (a) => `created thread "${String(a.name).slice(0, 60)}" in <#${a.channel_id}>`,
    pin_message: (a) => `pinned message ${a.message_id} in <#${a.channel_id}>`,
  };
  for (const [name, describe] of Object.entries(ACTIONS)) {
    const inner = tools[name].run;
    tools[name].run = async (args = {}) => {
      const result = await inner(args);
      const ch = logChannel();
      if (ch) {
        try {
          const why = args.reason ? ` Reason: ${String(args.reason).slice(0, 300)}` : " No reason given.";
          await api(`/channels/${encodeURIComponent(ch)}/messages`, {
            method: "POST",
            body: JSON.stringify({ content: `NeuralAgent ${describe(args)}.${why}`.slice(0, 2000), allowed_mentions: { parse: [] } }),
          });
        } catch (e) {
          log(`Discord: could not write to the log channel: ${e?.message || e}`);
        }
      }
      return result;
    };
  }

  const server = createServer({ name: "discord", version: "1.1.0", tools, output });

  // ---- Gateway ----
  const gw = { ws: null, seq: null, session: null, resumeUrl: null, timer: null, acked: true, closed: false, selfId: null, tries: 0 };

  const parents = new Map(); // thread id -> parent channel id (or "" when not a thread)
  async function parentOf(id) {
    id = String(id);
    if (parents.has(id)) return parents.get(id);
    let p = "";
    try {
      const ch = await api(`/channels/${encodeURIComponent(id)}`);
      if ([10, 11, 12].includes(ch.type)) p = String(ch.parent_id || "");
    } catch {}
    parents.set(id, p);
    return p;
  }

  // Which chosen channel does this channel id belong to (itself, or as a thread)? Returns {chosen, thread}.
  async function scope(channelId) {
    const on = eventsOn();
    const chosen = channelsChosen();
    channelId = String(channelId);
    if (chosen.includes(channelId)) return on.has("messages") ? { thread: false } : null;
    if (!on.has("threads") || !chosen.length) return null;
    const parent = await parentOf(channelId);
    return parent && chosen.includes(parent) ? { thread: true, parent } : null;
  }

  async function toEvent(m) {
    if (m.author?.bot) return null;
    if (gw.selfId && m.author?.id === gw.selfId) return null;
    const dm = !m.guild_id;
    let sc = null;
    if (dm) {
      if (!eventsOn().has("dms")) return null;
    } else {
      sc = await scope(m.channel_id);
      if (!sc) return null;
    }
    return {
      type: "message",
      id: `discord:${m.id}`,
      text: m.content || "",
      author: m.author?.global_name || m.author?.username,
      url: `https://discord.com/channels/${m.guild_id || "@me"}/${m.channel_id}/${m.id}`,
      meta: { channel_id: m.channel_id, message_id: m.id, guild_id: m.guild_id, author_id: m.author?.id, dm, thread: !!sc?.thread, parent_id: sc?.parent },
    };
  }

  async function memberEvent(m) {
    if (!eventsOn().has("member_joined") || m.user?.bot) return null;
    const name = m.nick || m.user?.global_name || m.user?.username;
    return {
      type: "member_joined",
      id: `discord:join:${m.guild_id}:${m.user?.id}:${m.joined_at || ""}`,
      text: `${name} joined the server`,
      author: name,
      url: `https://discord.com/channels/${m.guild_id}`,
      meta: { guild_id: m.guild_id, author_id: m.user?.id },
    };
  }

  async function reactionEvent(r) {
    if (!eventsOn().has("reaction_added")) return null;
    if (r.member?.user?.bot || (gw.selfId && r.user_id === gw.selfId) || !r.guild_id) return null;
    if (!(await scope(r.channel_id)) && !channelsChosen().includes(String(r.channel_id))) return null;
    const emoji = r.emoji?.id ? `:${r.emoji.name}:` : r.emoji?.name;
    const who = r.member?.nick || r.member?.user?.global_name || r.member?.user?.username || r.user_id;
    return {
      type: "reaction_added",
      id: `discord:react:${r.message_id}:${r.user_id}:${r.emoji?.id || r.emoji?.name}`,
      text: `${who} reacted ${emoji} to a message`,
      author: who,
      url: `https://discord.com/channels/${r.guild_id}/${r.channel_id}/${r.message_id}`,
      meta: { channel_id: r.channel_id, message_id: r.message_id, guild_id: r.guild_id, author_id: r.user_id, emoji },
    };
  }

  const dispatch = (fn, d) => fn(d).then((e) => e && server.emit(e)).catch(() => {});

  function connect() {
    if (gw.closed || !token()) return;
    const ws = new WebSocketImpl(gw.session && gw.resumeUrl ? `${gw.resumeUrl}/?v=10&encoding=json` : GATEWAY);
    gw.ws = ws;
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    gw.send = send;
    ws.onmessage = (ev) => {
      let p;
      try {
        p = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (p.s != null) gw.seq = p.s;
      switch (p.op) {
        case 10: {
          clearInterval(gw.timer);
          gw.acked = true;
          gw.timer = setInterval(() => {
            if (!gw.acked) return ws.close(4000, "no heartbeat ack");
            gw.acked = false;
            send({ op: 1, d: gw.seq });
          }, p.d.heartbeat_interval);
          if (gw.session) send({ op: 6, d: { token: token(), session_id: gw.session, seq: gw.seq } });
          else send({ op: 2, d: { token: token(), intents: INTENTS | (eventsOn().has("member_joined") ? INTENT_MEMBERS : 0), properties: { os: process.platform, browser: "neuralagent", device: "neuralagent" } } });
          break;
        }
        case 1:
          send({ op: 1, d: gw.seq });
          break;
        case 11:
          gw.acked = true;
          break;
        case 7:
          ws.close(4000, "reconnect");
          break;
        case 9:
          if (!p.d) {
            gw.session = null;
            gw.seq = null;
          }
          setTimeout(() => ws.close(4000, "invalid session"), 1000 * retryScale);
          break;
        case 0:
          if (p.t === "READY") {
            gw.session = p.d.session_id;
            gw.resumeUrl = p.d.resume_gateway_url;
            gw.selfId = p.d.user?.id;
            gw.tries = 0;
            log("Discord gateway ready");
          } else if (p.t === "MESSAGE_CREATE") dispatch(toEvent, p.d);
          else if (p.t === "GUILD_MEMBER_ADD") dispatch(memberEvent, p.d);
          else if (p.t === "MESSAGE_REACTION_ADD") dispatch(reactionEvent, p.d);
          else if (p.t === "THREAD_CREATE" && p.d.parent_id) parents.set(String(p.d.id), String(p.d.parent_id));
          else if (p.t === "GUILD_CREATE" || p.t === "THREAD_LIST_SYNC") for (const t of p.d.threads || []) if (t.parent_id) parents.set(String(t.id), String(t.parent_id));
          break;
      }
    };
    ws.onclose = (ev) => {
      clearInterval(gw.timer);
      if (gw.closed) return;
      const code = ev?.code;
      if (code === 4004) return log("Discord refused the bot token (4004). Check the token in the setup form.");
      if (code === 4014) return log("Discord says a privileged intent is off (4014). In the Developer Portal, Bot page, switch on Message Content Intent and Server Members Intent, or turn off the member_joined event.");
      if (code === 4013 || code === 4010 || code === 4011 || code === 4012) return log(`Discord closed the connection for good (${code}).`);
      if (code === 4007 || code === 4009 || code === 4003) { gw.session = null; gw.seq = null; }
      const wait = Math.min(1000 * 2 ** gw.tries++, 60000) * retryScale;
      log(`Discord connection lost (${code ?? "?"}), reconnecting in ${Math.round(wait / 1000)} s`);
      setTimeout(connect, wait);
    };
    ws.onerror = () => {};
  }

  return {
    server,
    tools,
    gateway: gw,
    start() {
      server.serve();
      if (token() && (channelsChosen().length || eventsOn().has("dms") || eventsOn().has("member_joined"))) connect();
      else log("Discord: waiting for a token and chosen channels before connecting to the gateway.");
    },
    stop() {
      gw.closed = true;
      clearInterval(gw.timer);
      gw.ws?.close?.();
    },
    connect,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().start();
