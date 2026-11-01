// Settings structure (D71) and Discord presence (D72): the section list, search, Agents, Profiles
// with the profile editor as a detail page, the MCP editor page, and the Discord card preview.
// Usage: node scripts/dev/shot.mjs settings [--devices phone,desk] [--schemes dark,light]
export default async ({ p, shot, sleep, go, tap, phone }) => {
  await sleep(2200);
  await go("Settings");
  await p.mouse.move(phone ? 195 : 900, 450);
  await sleep(700);
  await shot("01-settings");
  const open = async (name) => {
    // The row in the section list: the desktop rail (before it) and the phone dock (after it) have
    // buttons named "Agents" too. Centre it so the phone dock does not cover it.
    const all = p.getByRole("button", { name: new RegExp(`^${name}`) });
    const row = phone ? all.first() : all.last();
    await row.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await sleep(300);
    if (phone) await tap(row);
    else await row.click();
    await sleep(900);
  };
  const back = async () => {
    if (phone) await p.goBack();
    else await p.getByRole("button", { name: /^(Back|Profiles|MCP servers)/ }).first().click();
    await sleep(800);
  };
  // Search.
  const search = p.getByPlaceholder("Search settings").first();
  await search.fill("discord");
  await sleep(400);
  await shot("02-search");
  await search.fill("");
  await sleep(300);

  await open("Agents");
  await shot("03-agents");
  if (phone) await back();
  await open("Profiles");
  await shot("04-profiles");
  const create = p.getByRole("button", { name: "New profile" }).first();
  if (phone) await tap(create);
  else await create.click();
  await sleep(900);
  await shot("05-profile-new");
  await back();
  if (phone) await back();

  await open("MCP servers");
  const add = p.getByRole("button", { name: /^Add server/ }).first();
  if (phone) await tap(add);
  else await add.click();
  await sleep(900);
  await shot("06-mcp-new");
  await back();
  if (phone) await back();

  // Discord: whatever is saved (set a custom card first with daemon.mjs req settings_set).
  await open("Discord");
  await sleep(1200);
  await shot("07-discord");
  if (phone) {
    await p.mouse.move(195, 600);
    await p.mouse.wheel(0, 700);
    await sleep(600);
    await shot("08-discord-options");
  }
};
