// Subagents and background work in the Claude view (D65): cards in the transcript, the
// running-work strip and its list, a fan-out group, a subagent's transcript, a nested one, the
// Tasks sheet, live updates and the fade of a finished item. Data: scripts/dev/subagent-fixture.mjs.
// The daemon must see a Claude config dir it may read transcripts from:
//   CLAUDE_CONFIG_DIR=/tmp/na-sub-claude node scripts/dev/env.mjs up --home /tmp/na-subagents --port 1463 --seed
//   CLAUDE_CONFIG_DIR=/tmp/na-sub-claude node scripts/dev/shot.mjs subagents --home /tmp/na-subagents
// Args: `live` also watches live updates and the fade (about a minute).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daemonBin } from "../lib.mjs";
import { live as goLive, writeFixture } from "../subagent-fixture.mjs";

export default async ({ p, shot, sleep, tap, phone, home, req, args }) => {
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (!cfg) throw new Error("set CLAUDE_CONFIG_DIR (the daemon's too)");
  const { W, S } = JSON.parse(readFileSync(join(home, "seed.json"), "utf8"));
  const { main } = writeFixture(join(cfg, "projects", "na-sub"));
  const stopLive = goLive(main, { finishAfter: args.includes("live") ? 8000 : 0 });
  const log = (...a) => console.log("subagents:", ...a);
  try {
    // Tell the daemon where the session's transcript is, like Claude's hooks do.
    await req("term_write", { sid: S.docs, data: `echo '${JSON.stringify({ transcript_path: main })}' | ${daemonBin()} hook Notification\r` });
    await sleep(800);
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
    if (phone) {
      // Phones: open the agent from the inbox (the router pushes its screen).
      await tap(p.locator("main button").filter({ hasText: "Rewrite the README intro" }).first());
      await sleep(2000);
    }
    const chat = p.getByRole("tab", { name: "Chat" }).first();
    if (await chat.count()) await chat.click().catch(() => {});
    await sleep(2500);
    const scroller = p.locator(".cv-scroll").first();
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => {});
    await sleep(1200);
    await shot("01-transcript");

    const pill = p.getByRole("button", { name: /Show the list/ }).first();
    log("strip pill:", await pill.count(), (await pill.count()) ? await pill.innerText() : "");
    await tap(pill);
    await sleep(900);
    await shot("02-strip-open");
    const group = p.getByRole("button", { name: /reviewer agents/ }).first();
    if (await group.count()) {
      await tap(group);
      await sleep(700);
      await shot("03-group-open");
    }
    // A row opens the subagent's transcript (the list closes in the same step).
    const row = p.locator('[role=dialog][aria-label="Background work"] button').filter({ hasText: "Trace the fake clock" }).first();
    await row.scrollIntoViewIfNeeded();
    await tap(row);
    await sleep(2200);
    await shot("04-subagent");
    log("subagent view:", await p.locator('[role=dialog][aria-label^="Subagent"]').count());
    // The nested agent's card inside it.
    const nested = p.getByRole("button", { name: /Open subagent: Check the other suites/ }).first();
    log("nested card:", await nested.count());
    if (await nested.count()) {
      await nested.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(400);
      await tap(nested);
      await sleep(2000);
      await shot("05-nested");
      await p.evaluate(() => history.back());
      await sleep(900);
      log("after back (nested -> parent):", await p.locator('[role=dialog][aria-label^="Subagent"]').getAttribute("aria-label").catch(() => "none"));
    }
    await p.evaluate(() => history.back());
    await sleep(900);
    log("after back (subagent -> conversation):", await p.locator('[role=dialog][aria-label^="Subagent"]').count(), "route:", await p.evaluate(() => location.hash.replace(/token=[^&]*/, "token=…")));

    // A card in the transcript opens the same view.
    const card = p.getByRole("button", { name: /Open subagent: Check the CI config/ }).first();
    log("running foreground card:", await card.count());
    if (await card.count()) {
      await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await tap(card);
      await sleep(1800);
      await shot("06-card-opened");
      await p.evaluate(() => history.back());
      await sleep(900);
    }

    // All tasks.
    await tap(p.getByRole("button", { name: /Show the list/ }).first());
    await sleep(700);
    await tap(p.getByRole("button", { name: /^All tasks/ }).first());
    await sleep(1000);
    await shot("07-tasks-sheet");
    await p.keyboard.press("Escape");
    await sleep(600);

    if (args.includes("live")) {
      // The third reviewer finishes ~8 s after the start; it stays in the strip, then fades.
      await sleep(4000);
      await tap(p.getByRole("button", { name: /Show the list/ }).first());
      await sleep(800);
      await shot("08-live-finished");
      log("rows now:", await p.locator('[role=dialog][aria-label="Background work"] li').count());
      await p.keyboard.press("Escape");
      await sleep(50_000);
      await tap(p.getByRole("button", { name: /Show the list/ }).first());
      await sleep(800);
      await shot("09-after-fade");
      log("rows after fade:", await p.locator('[role=dialog][aria-label="Background work"] li').count());
    }
  } finally {
    stopLive();
  }
};
