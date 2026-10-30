// Settings → Notifications: sound, notification, both or nothing for this device.
// Usage: node scripts/dev/shot.mjs alerts
export default async ({ p, shot, sleep, go, more, tap, phone }) => {
  await sleep(2200);
  if (phone) {
    await go("More");
    await tap(p.getByText("Settings", { exact: true }).first());
    await sleep(1200);
    await tap(p.getByText("Notifications", { exact: true }).first());
  } else {
    await more("Settings");
    await p.mouse.move(900, 450);
    await sleep(500);
    await p.getByText("Notifications", { exact: true }).first().click();
  }
  await sleep(900);
  await shot("01-notifications");
  await p.getByText("Sound only", { exact: true }).first().click();
  await sleep(500);
  await shot("02-sound-only");
};
