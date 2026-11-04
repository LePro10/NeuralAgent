// Autopilot against a real test daemon: empty state, setup chat (no model key), Instructions,
// Connectors, Feed, Browser pairing, New connector dialog. Seed first (env.mjs up --seed).
// Usage: node scripts/dev/shot.mjs autopilot
export default async ({ p, shot, sleep, tap, go, phone }) => {
  const click = async (loc) => { if (await loc.count()) { phone ? await tap(loc.first()) : await loc.first().click(); await sleep(900); return true; } console.log("missing", String(loc)); return false; };
  const btn = (n) => p.getByRole("button", { name: n });
  await sleep(2200);
  if (phone) {
    await go("Agents");
    const row = btn(/^Autopilot/);
    await row.first().evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(300);
    await click(row);
  } else {
    await p.evaluate(() => { const k = "neuralagent.ui"; const c = JSON.parse(localStorage.getItem(k) ?? '{"state":{},"version":0}'); c.state = { ...c.state, workspace: "__autopilot" }; localStorage.setItem(k, JSON.stringify(c)); });
    await p.reload(); await sleep(2500);
  }
  await shot("01-empty");
  await click(btn(/Set up autopilot/));
  await sleep(1200);
  await shot("02-setup-chat");
  const tab = (n) => p.getByRole("tab", { name: n }).or(p.getByRole("radio", { name: n }));
  await click(tab(/Chat/));
  await click(btn(/^Run now/));
  await sleep(1500);
  await shot("02b-chat-error");
  await click(tab(/Instructions/));
  await shot("03-instructions");
  const tas = p.locator("textarea");
  if (await tas.count() >= 3) {
    await tas.nth(0).fill("Landing page for a small SaaS. Public site.");
    await tas.nth(1).fill("Bug reports: let an agent look. Questions: draft an answer.");
    await tas.nth(2).fill("Friendly and short.");
  }
  await p.getByText("Add a routine").first().scrollIntoViewIfNeeded().catch(() => {});
  await shot("03b-routines");
  await click(btn(/Add a routine/));
  await shot("04-routine");
  const ta = p.getByRole("dialog").locator("textarea").first();
  if (await ta.count()) await ta.fill("Read the new posts of the GitHub blog");
  await shot("04b-routine-filled");
  await click(p.getByRole("dialog").getByRole("button", { name: /^(Add routine|Add|Save)/ }));
  await sleep(500);
  await shot("04c-after-routine");
  await btn(/^Save instructions/).first().scrollIntoViewIfNeeded().catch(() => {});
  await click(btn(/^Save instructions/));
  await sleep(800);
  await shot("04d-saved");
  await click(tab(/Inbox/)); await shot("05-inbox");
  await click(btn(/Connectors/));
  await sleep(1000);
  await shot("06-connectors");
  await p.locator("button", { hasText: "Feed" }).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(300);
  await click(p.locator("button", { hasText: "Feed" }));
  await sleep(800);
  await shot("07-feed");
  const feed = p.locator("textarea").first();
  await feed.fill("https://github.blog/feed/");
  await shot("07b-feed-filled");
  await click(btn(/Save and test/));
  await sleep(6000);
  await shot("08-feed-tested");
  const sw = p.getByRole("switch").first();
  if (await sw.count() && (await sw.getAttribute("aria-checked")) !== "true") { await click(sw); await sleep(1500); }
  await shot("09-feed-on");
  const back = async () => { if (phone) { await p.goBack(); await sleep(800); } else await click(p.getByText("Connectors", { exact: true }).first()); };
  await back();
  await p.locator("button", { hasText: "Browser" }).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(300);
  await click(p.locator("button", { hasText: "Browser" }).first());
  await sleep(800);
  await shot("10-browser");
  await click(btn(/pairing code|Pair/i));
  await sleep(1200);
  await shot("11-browser-code");
  await back();
  await click(phone ? btn("Add a connector") : btn(/^Add$/));
  await shot("12-add-menu");
  await click(p.getByText("New connector…"));
  await sleep(900);
  await shot("13-new-connector");
  await p.getByRole("dialog").locator("input").first().fill("My app").catch(() => {});
  await p.keyboard.press("Escape");
};
