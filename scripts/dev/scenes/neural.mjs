// Neural v2 (D61–D64): the conversation with proactive reports and an Allow / Deny card, the
// tasks-and-memory panel (desktop rail, or a sheet), a team's detail, and the Teams page.
// Seed first: NEURALAGENT_HOME=<home> node scripts/dev/neural-e2e.mjs (tasks, notes, a report),
// then start a race team and a pending confirmation if those should show as well.
// Usage: node scripts/dev/shot.mjs neural [chat|panel|team|teams] …
export default async ({ p, shot, sleep, go, more, tap, phone, args }) => {
  const want = (n) => args.length === 0 || args.includes(n);
  const click = (loc) => (phone ? tap(loc) : loc.click());
  const step = async (name, fn) => {
    if (!want(name)) return;
    try {
      await fn();
    } catch (e) {
      console.log(`  step ${name}: ${e.message.split("\n")[0]}`);
      await p.keyboard.press("Escape").catch(() => {});
      await sleep(500);
    }
  };
  // The panel: a rail on wide desktops, otherwise "Tasks · N" (desktop) or the list icon (phone).
  const openPanel = async () => {
    const rail = p.locator("aside", { hasText: "Neural remembers" }).first();
    if (!phone && (await rail.isVisible().catch(() => false))) return false;
    await click(p.getByRole("button", { name: phone ? /Tasks and memory/ : /^Tasks/ }).first());
    await sleep(900);
    return true;
  };

  await sleep(2200);
  await go("Neural");
  await sleep(800);
  await step("chat", async () => shot("01-chat"));
  await step("panel", async () => {
    const sheet = await openPanel();
    await shot("02-panel");
    if (sheet) {
      await p.keyboard.press("Escape");
      await sleep(600);
    }
  });
  await step("team", async () => {
    const sheet = await openPanel();
    await click(p.getByRole("button", { name: /Add a dark mode toggle/ }).first());
    await sleep(500);
    await click(p.getByText("Show the team", { exact: true }).first());
    await sleep(1000);
    await shot("03-team");
    await p.keyboard.press("Escape");
    await sleep(600);
    if (sheet) await p.keyboard.press("Escape").catch(() => {});
    await sleep(400);
  });
  await step("teams", async () => {
    await more("Swarm");
    await sleep(900);
    await shot("04-teams");
  });
};
