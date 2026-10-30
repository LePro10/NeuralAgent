// The Swarm page, clicked through: list, each swarm, the feed scrolled, a member, the actions,
// stop confirm, the new-swarm sheet, and (desktop) narrow windows.
// Seed first: env.mjs up --seed, then `NEURALAGENT_HOME=<home> node scripts/dev/seed.mjs swarms`.
// Usage: node scripts/dev/shot.mjs swarm [list|busy|greeting|ended|member|actions|send|new|narrow] …
export default async ({ p, shot, sleep, go, tap, phone, args }) => {
  const want = (n) => args.length === 0 || args.includes(n);
  const step = async (name, fn) => {
    if (!want(name)) return;
    try {
      await fn();
    } catch (e) {
      console.log(`  step ${name}: ${e.message.split("\n")[0]}`);
      await p.keyboard.press("Escape").catch(() => {});
    }
  };
  const swarm = async () => {
    await go("Swarm");
    await sleep(600);
  };
  const row = (text) => p.getByRole("button", { name: new RegExp(text) }).first();
  // Phones: the detail is a pushed page; go back to the list by the back button.
  const back = async () => {
    if (!phone) return;
    const b = p.getByRole("button", { name: /^Back to Swarm/ }).first();
    if (await b.count()) await tap(b);
    await sleep(700);
  };
  const feedTop = () =>
    p.evaluate(() => {
      const el = document.querySelector("[data-swarm-feed]") ?? [...document.querySelectorAll(".scroller")].pop();
      if (el) el.scrollTop = 0;
    });

  await sleep(2200);
  await swarm();
  await step("list", async () => shot("01-list"));
  await step("busy", async () => {
    if (phone) await tap(row("Migrate the checkout"));
    else await row("Migrate the checkout").click();
    await sleep(900);
    await shot("02-busy-bottom");
    await feedTop();
    await sleep(400);
    await shot("03-busy-top");
    await back();
  });
  await step("greeting", async () => {
    if (phone) await tap(row("Change the greeting"));
    else await row("Change the greeting").click();
    await sleep(900);
    await shot("04-greeting");
    await back();
  });
  await step("ended", async () => {
    if (phone) await tap(row("release notes"));
    else await row("release notes").click();
    await sleep(900);
    await shot("05-ended");
    await back();
  });
  await step("actions", async () => {
    if (phone) await tap(row("Change the greeting"));
    else await row("Change the greeting").click();
    await sleep(700);
    // Phones: the actions menu; desktop: Stop sits in the swarm's header.
    if (phone) {
      await tap(p.getByRole("button", { name: "Swarm actions" }).first());
      await sleep(600);
      await shot("06-actions");
      await tap(p.getByText("Stop swarm", { exact: true }).first());
    } else {
      await p.getByRole("button", { name: "Stop", exact: true }).first().click();
    }
    await sleep(700);
    await shot("07-stop-confirm");
    await p.keyboard.press("Escape");
    await sleep(600);
    await back();
  });
  await step("member", async () => {
    if (phone) await tap(row("Change the greeting"));
    else await row("Change the greeting").click();
    await sleep(700);
    const m = p.getByRole("button", { name: /^Scout/ }).first();
    if (phone) await tap(m);
    else await m.click();
    await sleep(1200);
    await shot("08-member");
    await swarm();
    await back();
  });
  await step("send", async () => {
    if (phone) await tap(row("Change the greeting"));
    else await row("Change the greeting").click();
    await sleep(700);
    const box = p.getByPlaceholder(/^Message the/).first();
    if (phone) await tap(box);
    else await box.click();
    await box.fill("Please also update the README greeting.");
    await p.keyboard.press("Enter");
    await sleep(1200);
    await shot("12-sent");
    await back();
  });
  await step("new", async () => {
    const add = p.getByRole("button", { name: "New swarm" }).first();
    if (phone) await tap(add);
    else await add.click();
    await sleep(900);
    await shot("09-new");
    const goal = p.getByLabel("Goal").first();
    await goal.fill("Migrate the checkout form to the new design tokens, rebuild the address and payment steps and add regression tests");
    const addM = p.getByText("Add member", { exact: true }).first();
    for (let i = 0; i < 3; i++) {
      if (phone) await tap(addM);
      else await addM.click();
      await sleep(150);
    }
    await sleep(400);
    await shot("10-new-filled");
    await p.keyboard.press("Escape");
    await sleep(700);
  });
  await step("narrow", async () => {
    if (phone) return;
    const vp = p.viewportSize();
    for (const w of [1024, 860, 720]) {
      await p.setViewportSize({ width: w, height: 720 });
      await sleep(800);
      await shot(`11-narrow-${w}`);
    }
    await p.setViewportSize(vp);
  });
};
