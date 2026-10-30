// Navigation chrome: the More page, Settings (with Remote access and MCP servers inside), and on
// desktop the sidebar collapsed, mid-peek and open, with its version / Update button.
// Usage: node scripts/dev/shot.mjs nav [--hash "&update=0.3.1"]
export default async ({ p, shot, sleep, go, more, tap, phone }) => {
  await sleep(2200);
  // With a fake update (--hash "&update=…") the update dialog opens once by itself.
  const dialog = p.getByRole("dialog").first();
  if (await dialog.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await p.keyboard.press("Escape");
    await sleep(600);
  }
  if (phone) {
    await go("More");
    await shot("01-more");
    await tap(p.getByText("Settings", { exact: true }).first());
    await sleep(1300);
    await shot("02-settings");
    await p.mouse.move(195, 500);
    await p.mouse.wheel(0, 900);
    await sleep(600);
    await shot("03-settings-end");
    for (const [name, file] of [["Remote access", "04-remote"], ["MCP servers", "05-mcp"]]) {
      await more(name);
      await shot(file);
    }
    return;
  }
  await go("Neural");
  await p.mouse.move(900, 450, { steps: 4 });
  await sleep(800);
  await shot("01-rail");
  const nav = await p.locator("nav[aria-label=Main]").boundingBox();
  // The foot of the island: collapsed it floats mid-height, open it reaches the bottom.
  const foot = async () => {
    const b = await p.locator("nav[aria-label=Main]").boundingBox();
    const y = Math.max(0, b.y + b.height - 220);
    return { clip: { x: 0, y, width: 240, height: Math.min(260, 900 - y) } };
  };
  await shot("01-rail-foot", await foot());
  // Rest on the rail: it opens after 600 ms. Catch it halfway, then open.
  await p.mouse.move(nav.x + nav.width / 2, nav.y + nav.height - 30, { steps: 6 });
  await sleep(700);
  await shot("02-peek-mid-foot", await foot());
  await sleep(800);
  await shot("03-open");
  await shot("03-open-foot", await foot());
  await p.mouse.move(900, 450);
  await sleep(900);
  await more("Settings");
  await p.mouse.move(900, 450);
  await sleep(500);
  await shot("04-settings");
  await shot("04-settings-list", { clip: { x: 0, y: 0, width: 440, height: 900 } });
  for (const [name, file] of [["Remote access", "05-remote"], ["MCP servers", "06-mcp"]]) {
    await more(name);
    await p.mouse.move(900, 450);
    await sleep(500);
    await shot(file);
  }
};
