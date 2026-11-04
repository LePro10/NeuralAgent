// Discord connector: Gateway WebSocket (events) + REST (tools). No npm packages.
import { pathToFileURL } from "node:url";
import { ConnectorError, config, secret, createServer, fetchJson, clip, log, options } from "../_lib/connector.mjs";

const API = "https://discord.com/api/v10";
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
// GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
export const INTENTS = 1 | 512 | 4096 | 32768;
// View channels, send messages, add reactions, read history
const INVITE_PERMISSIONS = 1024 + 2048 + 64 + 65536;

export function build({ env = process.env, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, retryScale = 1, output = process.stdout } = {}) {
  const token = () => secret("bot_token", env);
  const channelsChosen = () => (Array.isArray(config(env).channels) ? config(env).channels.map(String) : []);

  async function api(path, init = {}) {
    if (!token()) throw new ConnectorError("No bot token yet. Paste it in the setup form first.");
    return fetchJson(API + path, {
      ...init,
      fetchImpl,
      retryScale,
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
      schema: { channel_id: { type: "string" }, message_id: { type: "string" }, text: { type: "string" } },
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
      schema: { channel_id: { type: "string" }, text: { type: "string" } },
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
      schema: { channel_id: { type: "string" }, message_id: { type: "string" }, emoji: { type: "string" } },
      required: ["channel_id", "message_id", "emoji"],
      run: async ({ channel_id, message_id, emoji }) => {
        await api(`/channels/${encodeURIComponent(channel_id)}/messages/${encodeURIComponent(message_id)}/reactions/${encodeURIComponent(emoji)}/@me`, { method: "PUT" });
        return { reacted: true };
      },
    },
  };

  const server = createServer({ name: "discord", version: "1.0.0", tools, output });

  // ---- Gateway ----
  const gw = { ws: null, seq: null, session: null, resumeUrl: null, timer: null, acked: true, closed: false, selfId: null, tries: 0 };

  function toEvent(m) {
    if (m.author?.bot) return null;
    if (!channelsChosen().includes(String(m.channel_id))) return null;
    if (gw.selfId && m.author?.id === gw.selfId) return null;
    return {
      type: "message",
      id: `discord:${m.id}`,
      text: m.content || "",
      author: m.author?.global_name || m.author?.username,
      url: `https://discord.com/channels/${m.guild_id || "@me"}/${m.channel_id}/${m.id}`,
      meta: { channel_id: m.channel_id, message_id: m.id, guild_id: m.guild_id, author_id: m.author?.id },
    };
  }

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
          else send({ op: 2, d: { token: token(), intents: INTENTS, properties: { os: process.platform, browser: "neuralagent", device: "neuralagent" } } });
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
          } else if (p.t === "MESSAGE_CREATE") {
            const e = toEvent(p.d);
            if (e) server.emit(e);
          }
          break;
      }
    };
    ws.onclose = (ev) => {
      clearInterval(gw.timer);
      if (gw.closed) return;
      const code = ev?.code;
      if (code === 4004) return log("Discord refused the bot token (4004). Check the token in the setup form.");
      if (code === 4014) return log("Discord says the Message Content Intent is off (4014). Switch it on in the Developer Portal, Bot page.");
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
      if (token() && channelsChosen().length) connect();
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
