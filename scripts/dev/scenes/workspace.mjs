// The workspace view: split panes (Gemini + Claude), the focused pane, the Chat/Terminal switch,
// the "New agent" menu (desktop) and the "+" sheet and agent chips (phones).
// Seed first (env.mjs up --seed). Usage: node scripts/dev/shot.mjs workspace
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async ({ p, shot, sleep, tap, phone, home }) => {
  const { W } = JSON.parse(readFileSync(join(home, "seed.json"), "utf8"));
  // Open the two-agent workspace directly (the sidebar may be collapsed).
  await p.evaluate((id) => {
    const key = "neuralagent.ui";
    const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
    cur.state = { ...cur.state, workspace: id };
    localStorage.setItem(key, JSON.stringify(cur));
  }, W["customer-portal-redesign-2026"]);
  await p.reload();
  await sleep(2500);
  if (phone) {
    await shot("01-workspace");
    await shot("01b-top", { clip: { x: 0, y: 0, width: 390, height: 150 } });
    const chip = p.locator('[role=tab]:has-text("Migrate")').first();
    if (await chip.count()) { await chip.scrollIntoViewIfNeeded(); await sleep(300); await tap(chip); await sleep(1200); await shot("02-other-agent"); }
    await tap(p.getByRole("button", { name: "New agent" }).first());
    await sleep(1000);
    await shot("03-new-agent");
    return;
  }
  const headers = p.locator('[draggable="true"]');
  if ((await headers.count()) > 1) {
    await headers.nth(0).click({ position: { x: 120, y: 20 } });
    await sleep(700);
    await shot("01-first-focused");
    await headers.nth(1).click({ position: { x: 120, y: 20 } });
    await sleep(700);
    await shot("02-second-focused");
    await shot("02b-bar", { clip: { x: 0, y: 0, width: 1440, height: 100 } });
    const chat = p.getByRole("tab", { name: "Chat" }).first();
    if (await chat.count()) {
      await chat.click();
      await sleep(1200);
      await shot("04-chat");
      await shot("04b-bar", { clip: { x: 0, y: 0, width: 1440, height: 100 } });
      await p.getByRole("tab", { name: "Terminal" }).first().click();
      await sleep(500);
    }
    // An empty pane is a launcher; close it again afterwards.
    await p.locator('[aria-label^="Split down"]').last().click();
    await sleep(900);
    await shot("05-launcher");
    await p.locator('[aria-label^="Close (⌘W)"]').last().click();
    await sleep(500);
  } else {
    await shot("01-workspace");
  }
  await p.getByRole("button", { name: "New agent" }).first().click();
  await sleep(700);
  await shot("03-new-agent");
};
