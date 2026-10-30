// Interface size (desktop): the setting in Settings → Appearance and the "120%" that shows while
// the shortcuts change it. The dev browser only runs the setting (dev-browser.tsx `zoom` is a stub);
// to see a zoomed window, shoot with a smaller viewport at a higher --dpr.
// Usage: node scripts/dev/shot.mjs zoom --devices desk
export default async ({ p, shot, sleep, more, phone }) => {
  if (phone) return;
  await sleep(2200);
  const dialog = p.getByRole("dialog").first();
  if (await dialog.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await p.keyboard.press("Escape");
    await sleep(600);
  }
  await more("Settings");
  await p.mouse.move(900, 450);
  const size = p.getByRole("tablist", { name: "Interface size" });
  await size.scrollIntoViewIfNeeded();
  await sleep(500);
  await shot("01-setting");
  await p.keyboard.press("Meta+Equal");
  await p.keyboard.press("Meta+Equal");
  await sleep(300);
  await shot("02-shortcut-hud");
  await p.mouse.move(900, 450);
  await p.keyboard.down("Meta");
  await p.mouse.wheel(0, 120);
  await p.keyboard.up("Meta");
  await sleep(300);
  await shot("03-wheel-down");
  await p.keyboard.press("Meta+0");
  await sleep(1600);
  await shot("04-reset");
};
