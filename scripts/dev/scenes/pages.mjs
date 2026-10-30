// Tour of the main pages. Seed first (env.mjs up --seed [--llm]).
// Usage: node scripts/dev/shot.mjs pages [neural agents workspaces swarm history usage mcp settings]
export default async ({ p, shot, sleep, go, more, tap, phone, args }) => {
  await sleep(2200);
  const want = (n) => args.length === 0 || args.includes(n);
  if (want("neural")) { await go("Neural"); await shot("01-neural"); }
  if (want("agents")) { await go("Agents"); await shot("02-agents"); }
  if (want("workspaces")) {
    if (phone) {
      await go("Workspaces");
      await shot("03-workspaces");
      const first = p.getByText("product-docs", { exact: true }).first();
      if (await first.count()) { await tap(first); await sleep(1500); await shot("04-workspace"); }
    } else {
      const ws = p.locator('nav [aria-label="product-docs"]').first();
      if (await ws.count()) { await ws.click(); await sleep(1500); await shot("04-workspace"); }
    }
  }
  if (want("swarm")) { await go("Swarm"); await shot("05-swarm"); }
  if (want("history")) { await more("History"); await sleep(800); await shot("06-history"); }
  if (want("usage")) { await more("Usage"); await sleep(800); await shot("07-usage"); }
  if (want("mcp")) { await more("MCP servers"); await shot("08-mcp"); }
  if (want("settings")) { await more("Settings"); await shot("09-settings"); }
};
