// Phone shell (components/phone): the four tabs and the pages the phone router pushes.
// Usage: node scripts/dev/shot.mjs phone --devices phone,small --schemes light,dark
//   [agents neural projects project settings section history agent new]
// History shows the machine's real past conversations: keep those shots private.
export default async ({ p, shot, sleep, go, tap, phone, args }) => {
  if (!phone) return;
  await sleep(2400);
  const want = (n) => args.length === 0 || args.includes(n);
  const back = async () => {
    await p.evaluate(() => history.back());
    await sleep(900);
  };
  const row = (text) => p.getByRole("button", { name: new RegExp(text, "i") }).first();

  if (want("agents")) { await go("Agents"); await shot("01-agents"); }
  if (want("new")) {
    await go("Agents");
    await tap(p.getByRole("button", { name: "New agent" }).first());
    await sleep(900);
    await shot("02-new-agent");
    await back();
  }
  if (want("agent")) {
    await go("Agents");
    const first = p.locator("main button.press-row").first();
    if (await first.count()) { await tap(first); await sleep(1600); await shot("03-agent"); await back(); }
  }
  if (want("neural")) { await go("Neural"); await shot("06-neural"); }
  if (want("projects") || want("project")) {
    await go("Projects");
    if (want("projects")) await shot("07-projects");
    if (want("project")) {
      const first = p.locator("main [data-lead], main button").filter({ hasText: /product-docs|api|web/i }).first();
      if (await first.count()) { await tap(first); await sleep(1300); await shot("08-project"); await back(); }
    }
  }
  if (want("settings") || want("section")) {
    await go("Settings");
    if (want("settings")) await shot("09-settings");
    if (want("section")) { await tap(row("^Appearance")); await sleep(1100); await shot("10-section"); await back(); }
  }
  if (want("history")) {
    await go("Settings");
    await p.mouse.move(195, 500);
    await p.mouse.wheel(0, 3000);
    await sleep(500);
    await tap(row("^History"));
    await sleep(1600);
    await shot("11-history-private");
  }
};
