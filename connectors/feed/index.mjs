// Feed connector: RSS 2.0, Atom and JSON Feed, polled for new entries. No npm packages.
import { pathToFileURL } from "node:url";
import { ConnectorError, config, createServer, fetchJson, clip, getState, setState } from "../_lib/connector.mjs";

const decode = (s) =>
  String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
const plain = (html) => decode(String(html ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]).trim() : "";
};

/** Parse a feed body into { title, entries: [{id,title,text,author,url,date}] }. */
export function parseFeed(body) {
  const src = String(body).trim();
  if (src.startsWith("{")) {
    let j;
    try { j = JSON.parse(src); } catch { throw new ConnectorError("That address does not contain a readable feed."); }
    return {
      title: j.title || "",
      entries: (j.items || []).map((i) => ({
        id: String(i.id || i.url), title: i.title || "", text: plain(i.content_text || i.content_html || i.summary || ""),
        author: i.author?.name || i.authors?.[0]?.name || "", url: i.url || "", date: i.date_published || "",
      })),
    };
  }
  const atom = /<feed[\s>]/i.test(src) && !/<rss[\s>]/i.test(src);
  const parts = src.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi);
  if (!parts && !/<(rss|feed|rdf:RDF)[\s>]/i.test(src)) throw new ConnectorError("That address does not contain a readable feed.");
  const head = src.split(atom ? /<entry[\s>]/i : /<item[\s>]/i)[0];
  const entries = (parts || []).map((p) => {
    const link = atom ? (p.match(/<link[^>]*?href="([^"]+)"[^>]*?(?:rel="alternate")?[^>]*>/i) || [])[1] || "" : tag(p, "link");
    const url = decode(link);
    return {
      id: tag(p, atom ? "id" : "guid") || url || tag(p, "title"),
      title: plain(tag(p, "title")),
      text: plain(tag(p, atom ? "content" : "content:encoded") || tag(p, atom ? "summary" : "description")),
      author: plain(atom ? tag(tag(p, "author"), "name") : tag(p, "dc:creator") || tag(p, "author")),
      url,
      date: tag(p, atom ? "updated" : "pubDate") || tag(p, "published"),
    };
  });
  return { title: plain(tag(head, "title")), entries };
}

export function build({ env = process.env, fetchImpl = globalThis.fetch, retryScale = 1, output = process.stdout } = {}) {
  const urls = () => (Array.isArray(config(env).urls) ? config(env).urls.map((u) => String(u).trim()).filter(Boolean) : []);

  async function load(url) {
    if (!/^https?:\/\//i.test(url)) throw new ConnectorError(`"${url}" is not a web address (it must start with http:// or https://).`);
    const body = await fetchJson(url, { fetchImpl, retryScale, text: true, headers: { "User-Agent": "NeuralAgent", Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*" } });
    return parseFeed(body);
  }

  const out = (url, e, text = 2000) => ({ ...e, text: clip(e.text, text), feed: url });

  const tools = {
    check_feeds: {
      description: "Read every configured feed once and report how many entries each has.",
      run: async () => {
        if (!urls().length) throw new ConnectorError("No feed addresses yet. Add at least one in the setup form.");
        const lines = [];
        for (const u of urls()) {
          const f = await load(u);
          lines.push(`${f.title || u}: ${f.entries.length} entries`);
        }
        return { text: lines.join("; ") };
      },
    },
    fetch: {
      description: "Read one feed (a configured one by default) and return its latest entries.",
      schema: { url: { type: "string" }, limit: { type: "number", description: "default 20" } },
      run: async ({ url, limit = 20 }) => {
        const targets = url ? [url] : urls();
        if (!targets.length) throw new ConnectorError("No feed addresses yet. Add at least one in the setup form.");
        const res = [];
        for (const u of targets) res.push(...(await load(u)).entries.slice(0, +limit || 20).map((e) => out(u, e)));
        return res;
      },
    },
    poll: {
      description: "Returns { events } with entries not seen before. The first call only remembers what exists.",
      run: async () => {
        const seen = getState("seen", null, env);
        const next = new Set(seen || []);
        const events = [];
        for (const u of urls()) {
          let feed;
          try { feed = await load(u); } catch (e) { process.stderr.write(`feed ${u}: ${e.message}\n`); continue; }
          for (const e of feed.entries) {
            const key = `${u}|${e.id}`;
            if (next.has(key)) continue;
            next.add(key);
            if (seen) events.push({ type: "entry", id: `feed:${key}`, title: e.title, text: clip(e.text, 4000), author: e.author || undefined, url: e.url || undefined, meta: { feed: feed.title || u, date: e.date } });
          }
        }
        setState("seen", [...next].slice(-5000), env);
        return { events };
      },
    },
  };

  const server = createServer({ name: "feed", version: "1.0.0", tools, output });
  return { server, tools, start: () => server.serve() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().start();
