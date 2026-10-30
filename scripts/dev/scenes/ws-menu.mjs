// Desktop sidebar workspaces: the right-click menu, renaming in place, and dragging into a new order.
// Usage: node scripts/dev/shot.mjs ws-menu --devices desk
export default async ({ p, shot, sleep, phone }) => {
  if (phone) return;
  await sleep(2200);
  const nav = p.locator("nav[aria-label=Main]");
  const ws = nav.locator('button[aria-label]').filter({ has: p.locator("svg") });
  const names = async () => (await nav.locator("li li button[aria-label]").evaluateAll((b) => b.map((x) => x.getAttribute("aria-label"))));
  console.log("order before", await names());
  const first = nav.locator("li li button[aria-label]").first();
  const b = await first.boundingBox();
  await p.mouse.move(b.x + 20, b.y + b.height / 2);
  await sleep(700);
  await first.click({ button: "right" });
  await sleep(500);
  await shot("01-menu", { clip: { x: 0, y: 0, width: 480, height: 600 } });
  await p.getByRole("menuitem", { name: "Rename" }).click();
  await sleep(400);
  await shot("02-renaming", { clip: { x: 0, y: 0, width: 300, height: 600 } });
  await p.keyboard.type("Renamed");
  await p.keyboard.press("Enter");
  await sleep(600);
  console.log("after rename", await names());
  // Drag the first workspace to the end.
  const rows = nav.locator("li li button[aria-label]");
  const a = await rows.nth(0).boundingBox();
  const c = await rows.nth(3).boundingBox();
  await p.mouse.move(a.x + 30, a.y + a.height / 2);
  await p.mouse.down();
  for (let y = a.y + a.height / 2; y <= c.y + c.height / 2 + 6; y += 4) { await p.mouse.move(a.x + 30, y); await sleep(30); if (process.env.DEBUG_DRAG) console.log(Math.round(y), (await names()).join(",")); }
  await shot("03-dragging", { clip: { x: 0, y: 0, width: 300, height: 600 } });
  await p.mouse.up();
  await sleep(1200);
  console.log("after drag", await names());
  await shot("04-after", { clip: { x: 0, y: 0, width: 300, height: 600 } });
};
