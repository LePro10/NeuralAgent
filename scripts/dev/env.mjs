// A throwaway test environment for UI work: a test daemon (own NEURALAGENT_HOME) + the desktop
// UI served by Vite (dev.html), optionally demo data and a fake LLM for Neural.
//
//   node scripts/dev/env.mjs up [--home /tmp/na-ui] [--port 1451] [--seed] [--llm] [--no-vite]
//   node scripts/dev/env.mjs status [--home …]
//   node scripts/dev/env.mjs down [--home …]
//
// Everything it starts is recorded in <home>/dev-env.json, and `down` stops only those pids.
// It never touches the installed app or its daemon (the real data dir is refused).
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_VITE_PORT, DEV, ROOT, connect, daemonBin, daemonInfo, httpUp, pidCommand, sleep,
  startDetached, stopPid, testHome, waitForFile,
} from "./lib.mjs";
import { seed } from "./seed.mjs";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    home: { type: "string" },
    port: { type: "string", default: String(DEFAULT_VITE_PORT) },
    seed: { type: "boolean", default: false },
    llm: { type: "boolean", default: false },
    "llm-port": { type: "string", default: "11499" },
    "no-vite": { type: "boolean", default: false },
  },
});
const cmd = positionals[0] ?? "status";
const home = testHome(o.home);
const envFile = join(home, "dev-env.json");
const load = () => (existsSync(envFile) ? JSON.parse(readFileSync(envFile, "utf8")) : {});
const save = (e) => writeFileSync(envFile, JSON.stringify(e, null, 2));
const alive = (x, expect) => !!x?.pid && (pidCommand(x.pid) ?? "").includes(expect);

async function daemonUp(env) {
  if (alive(env.daemon, "neuralagentd")) {
    if (env.daemon.origin !== `http://127.0.0.1:${o.port}`) console.log(`warning: the running daemon allows ${env.daemon.origin}; run \`down\` first to switch ports`);
    return console.log(`daemon: running (pid ${env.daemon.pid})`);
  }
  mkdirSync(home, { recursive: true });
  rmSync(join(home, "daemon.json"), { force: true });
  const bin = daemonBin();
  if (!existsSync(bin)) throw new Error(`${bin} missing: run \`cargo build -p na-daemon\``);
  // Debug daemons accept one extra Origin: the Vite server of this kit (server.rs).
  const origin = `http://127.0.0.1:${o.port}`;
  const pid = startDetached(bin, ["serve"], { env: { NEURALAGENT_HOME: home, RUST_LOG: "info", NEURALAGENT_DEV_ORIGIN: origin }, log: join(home, "daemon.log") });
  env.daemon = { pid, origin };
  save(env);
  try {
    await waitForFile(join(home, "daemon.json"));
  } catch {
    throw new Error(`daemon did not start; see ${join(home, "daemon.log")} (another daemon on this home?)`);
  }
  console.log(`daemon: started (pid ${pid}, port ${daemonInfo(home).port}, log ${join(home, "daemon.log")})`);
}

async function viteUp(env) {
  const port = Number(o.port);
  const url = `http://127.0.0.1:${port}/dev.html`;
  if (alive(env.vite, "vite") && (await httpUp(url))) return console.log(`vite: running on :${port}`);
  if (await httpUp(url)) {
    env.vite = { port, external: true };
    save(env);
    return console.log(`vite: something already serves :${port}, using it (not managed)`);
  }
  const bin = join(ROOT, "apps/desktop/node_modules/.bin/vite");
  if (!existsSync(bin)) throw new Error("vite missing: run `pnpm install`");
  const pid = startDetached(bin, ["--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: join(ROOT, "apps/desktop"),
    log: join(home, "vite.log"),
  });
  env.vite = { pid, port };
  save(env);
  for (let i = 0; i < 100 && !(await httpUp(url)); i++) await sleep(200);
  if (!(await httpUp(url))) throw new Error(`vite did not come up; see ${join(home, "vite.log")}`);
  console.log(`vite: started on :${port} (pid ${pid})`);
}

async function llmUp(env) {
  const port = Number(o["llm-port"]);
  if (!alive(env.llm, "fake-llm")) {
    const pid = startDetached(process.execPath, [join(DEV, "fake-llm.mjs")], { env: { FAKE_LLM_PORT: String(port) }, log: join(home, "fake-llm.log") });
    env.llm = { pid, port };
    save(env);
    await sleep(300);
    console.log(`fake LLM: started on :${port} (pid ${pid})`);
  }
  await seed(home, "llm", { llmPort: port });
}

if (cmd === "up") {
  const env = load();
  await daemonUp(env);
  if (!o["no-vite"]) await viteUp(env);
  if (o.seed) await seed(home, "base");
  if (o.llm) await llmUp(env);
  console.log(`ready: NEURALAGENT_HOME=${home}  (screenshots: node scripts/dev/shot.mjs --home ${home})`);
} else if (cmd === "down") {
  const env = load();
  for (const [k, expect] of [["vite", "vite"], ["llm", "fake-llm"], ["daemon", "neuralagentd"]]) {
    if (env[k]?.pid && (await stopPid(env[k].pid, expect))) console.log(`${k}: stopped (pid ${env[k].pid})`);
    delete env[k];
  }
  save(env);
} else if (cmd === "status") {
  const env = load();
  console.log(`home ${home}`);
  console.log(`daemon: ${alive(env.daemon, "neuralagentd") ? `running (pid ${env.daemon.pid})` : "stopped"}`);
  if (alive(env.daemon, "neuralagentd")) {
    const c = await connect(home, { subscribe: true });
    const st = c.state();
    console.log(`  workspaces ${st?.workspaces?.length ?? "?"}, live sessions ${Object.values(st?.sessions ?? {}).filter((s) => s.alive).length}`);
    c.close();
  }
  console.log(`vite: ${env.vite?.port && (await httpUp(`http://127.0.0.1:${env.vite.port}/dev.html`)) ? `up on :${env.vite.port}` : "stopped"}`);
  if (env.llm) console.log(`fake LLM: ${alive(env.llm, "fake-llm") ? `up on :${env.llm.port}` : "stopped"}`);
} else {
  console.error("usage: node scripts/dev/env.mjs up|status|down [--home dir] [--port n] [--seed] [--llm] [--no-vite]");
  process.exit(2);
}
process.exit(0);
