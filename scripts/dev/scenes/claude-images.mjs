// Pictures in the Claude view: a Read of an image, an MCP screenshot, two reads folded into a
// group, a pasted image in a user message, and the full-screen viewer.
// The daemon must see a Claude config dir it may read transcripts from:
//   CLAUDE_CONFIG_DIR=/tmp/na-img-claude node scripts/dev/env.mjs up --home /tmp/na-img --port 1521 --seed
//   CLAUDE_CONFIG_DIR=/tmp/na-img-claude node scripts/dev/shot.mjs claude-images --home /tmp/na-img
// Images: args (paths) or the PNG/JPEG files in /tmp/na-img-assets (wide.png tall.png …).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { daemonBin } from "../lib.mjs";

const ASSETS = "/tmp/na-img-assets";

function transcript(path, images) {
  const b64 = (f) => readFileSync(f).toString("base64");
  const type = (f) => (/\.jpe?g$/i.test(f) ? "image/jpeg" : "image/png");
  const img = (f) => ({ type: "image", source: { type: "base64", media_type: type(f), data: b64(f) } });
  const [a, b, c, d] = images;
  let t = Date.parse("2026-10-30T10:00:00Z");
  const ts = () => new Date((t += 4000)).toISOString();
  const lines = [
    { type: "user", uuid: "u1", timestamp: ts(), message: { role: "user", content: [{ type: "text", text: "[Image #1] Why does the swarm page look cramped here?" }, img(d ?? a)] } },
    { type: "assistant", uuid: "a1", timestamp: ts(), message: { id: "m1", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Let me look at the screenshot you took earlier." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: a } }] } },
    { type: "user", uuid: "r1", timestamp: ts(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [img(a)] }] } },
    { type: "assistant", uuid: "a2", timestamp: ts(), message: { id: "m2", role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: b } }, { type: "tool_use", id: "t3", name: "Grep", input: { pattern: "gap-", path: "src" } }] } },
    { type: "user", uuid: "r2", timestamp: ts(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [img(b)] }] } },
    { type: "user", uuid: "r3", timestamp: ts(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: "src/Swarm.tsx:12: gap-2" }] } },
    { type: "assistant", uuid: "a3", timestamp: ts(), message: { id: "m3", role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t4", name: "mcp__browser__screenshot", input: { width: 1440 } }] } },
    { type: "user", uuid: "r4", timestamp: ts(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t4", content: [img(c ?? a), { type: "text", text: `[Image: source: ${c ?? a}]` }, { type: "text", text: "Captured the page at 1440 px." }] }] } },
    { type: "assistant", uuid: "a4", timestamp: ts(), message: { id: "m4", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "The member list uses `gap-2` where the feed uses `gap-4`, so the columns look **cramped**. I will align both to `gap-4`." }] } },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

export default async ({ p, shot, sleep, tap, phone, home, req, args }) => {
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (!cfg) throw new Error("set CLAUDE_CONFIG_DIR (the daemon's too)");
  const { W, S } = JSON.parse(readFileSync(join(home, "seed.json"), "utf8"));
  const images = args.length ? args : ["na-sw1.png", "phone.png", "photo.jpg", "tall.png"].map((f) => join(ASSETS, f)).filter((f) => readdirSync(ASSETS).includes(f.split("/").pop()));
  const dir = join(cfg, "projects", "na-img");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "images.jsonl");
  transcript(file, images);
  // Tell the daemon where the session's transcript is, like Claude's hooks do.
  await req("term_write", { sid: S.docs, data: `echo '${JSON.stringify({ transcript_path: file })}' | ${daemonBin()} hook Notification\r` });
  await p.evaluate(
    ([id]) => {
      const key = "neuralagent.ui";
      const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
      cur.state = { ...cur.state, workspace: id, claudeView: true };
      localStorage.setItem(key, JSON.stringify(cur));
    },
    [W["product-docs"]],
  );
  await p.reload();
  await sleep(3000);
  const chat = p.getByRole("tab", { name: "Chat" }).first();
  if (await chat.count()) await chat.click().catch(() => {});
  await sleep(2500);
  const scroller = p.locator(".cv-scroll").first();
  await scroller.evaluate((el) => el.scrollTo(0, 0)).catch(() => {});
  await sleep(1200);
  await shot("01-images");
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => {});
  await sleep(1200);
  await shot("02-end");
  const group = p.getByRole("button", { name: /^Read (a file|\d+ files)/ }).first();
  if (await group.count()) {
    await tap(group);
    await sleep(1500);
    await shot("03-group-open");
  }
  const open = p.getByRole("button", { name: /^Open photo/ }).first();
  if (await open.count()) {
    await open.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(500);
    await tap(open);
    await sleep(1500);
    await shot("04-viewer");
    if (!phone) {
      const box = { x: 0, y: 0, width: 1440, height: 900 };
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 4; i++) (await p.mouse.wheel(0, -240), await sleep(80));
      await sleep(600);
      await shot("05-zoomed");
      await p.keyboard.press("Escape");
      await sleep(500);
      console.log(`viewer closed by Esc: ${(await p.locator('[role=dialog][aria-label="photo.jpg"]').count()) === 0}`);
    }
  }
};
