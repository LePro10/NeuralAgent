// Settings → System (D58-D60): permissions, the guided setup, autostart and the service.
// Desktop needs the fake OS side of dev-browser.tsx: --hash "&system=missing" (or "granted").
// Without it (phone/web) the page shows the remote view: the service from `host_system`.
// Usage: node scripts/dev/shot.mjs system --devices desk,phone --schemes dark --hash "&system=missing"
export default async ({ p, shot, sleep, go, tap, phone }) => {
  await sleep(2200);
  await go("Settings");
  await sleep(600);
  const all = p.getByRole("button", { name: /^System/ });
  const row = phone ? all.first() : all.last();
  await row.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await sleep(300);
  if (phone) await tap(row);
  else await row.click();
  await sleep(1500);
  await shot("01-system");
  const setup = p.getByRole("button", { name: /^Set up all permissions/ }).first();
  if (await setup.count()) {
    await setup.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await sleep(300);
    if (phone) await tap(setup);
    else await setup.click();
    await sleep(800);
    await shot("02-guide-step1");
    await sleep(4000);
    await shot("03-guide-step2");
  }
  await p.mouse.move(phone ? 195 : 900, 500);
  for (let i = 0; i < 6; i++) (await p.mouse.wheel(0, 600), await sleep(120));
  await sleep(500);
  await shot("04-autostart");
};
