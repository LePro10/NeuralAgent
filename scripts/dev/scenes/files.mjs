// Files explorer (components/files): a project's folder, code, Markdown, a big log, a picture and
// a binary, on phones (router pages) and on the desktop (the Files pane next to the agents).
// Seed first (env.mjs up --seed), then put demo files into the api-server workspace:
//   node scripts/dev/scenes/files.mjs --make <home>
// Usage: node scripts/dev/shot.mjs files [folder code md big image binary pdf search home]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const ROOT = new URL("../../..", import.meta.url).pathname;

/** Demo files: a git repo with a change, code, Markdown, a 4.7 MB log, a PNG, a PDF and a binary. */
function make(home) {
  const w = realpathSync(`${home}-ws/api-server`);
  for (const d of ["src/routes", "docs", "assets"]) mkdirSync(join(w, d), { recursive: true });
  const copy = (from, to) => writeFileSync(join(w, to), readFileSync(join(ROOT, from)));
  copy("crates/na-daemon/src/files.rs", "src/files.rs");
  copy("packages/app/src/components/files/model.ts", "src/routes/model.ts");
  copy("packages/app/src/components/files/FolderView.tsx", "src/routes/FolderView.tsx");
  writeFileSync(
    join(w, "README.md"),
    "# api-server\n\nA small **demo** service. It answers `GET /health` and keeps a few routes.\n\n## Run\n\n```sh\npnpm install\npnpm dev\n```\n\n- Routes live in `src/routes`\n- Docs in `docs/`\n\n| Route | Purpose |\n| --- | --- |\n| `/health` | liveness |\n| `/v1/items` | items |\n",
  );
  writeFileSync(join(w, "package.json"), '{\n  "name": "api-server",\n  "version": "0.1.0",\n  "private": true\n}\n');
  writeFileSync(join(w, ".env.example"), "PORT=8080\n");
  let log = "";
  for (let i = 0; i < 60000; i++) log += `2026-10-31T12:${String(i % 60).padStart(2, "0")}:00Z INFO request id=${i} path=/v1/items status=200 took=${i % 97}ms\n`;
  writeFileSync(join(w, "logs.txt"), log);
  writeFileSync(join(w, "assets/blob.bin"), Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7919) % 256)));
  writeFileSync(join(w, "assets/cover.png"), png(480, 300));
  try {
    writeFileSync(join(w, "docs/guide.pdf"), execFileSync("cupsfilter", ["-m", "application/pdf", join(w, "README.md")], { stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    writeFileSync(join(w, "docs/guide.pdf"), "%PDF-1.4\n");
  }
  const git = (...a) => {
    try {
      execFileSync("git", ["-C", w, ...a], { stdio: "ignore" });
    } catch {
      // nothing to commit (made before)
    }
  };
  git("init", "-q");
  git("-c", "user.email=t@example.com", "-c", "user.name=T", "add", "-A");
  git("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "init");
  writeFileSync(join(w, "src/files.rs"), `${readFileSync(join(w, "src/files.rs"), "utf8")}// changed\n`);
  writeFileSync(join(w, "docs/notes.txt"), "new\n");
  console.log(`files: demo files in ${w}`);
}

function png(width, height) {
  const crc = (b) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set([(x * 255) / width, (y * 255) / height, 200], 1 + x * 3);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

if (process.argv[2] === "--make") make(process.argv[3] ?? "/tmp/na-ui");

export default async ({ p, shot, sleep, tap, phone, home, args }) => {
  const { W } = JSON.parse(readFileSync(join(home, "seed.json"), "utf8"));
  const ws = W["api-server"];
  const dir = realpathSync(`${home}-ws/api-server`);
  const want = (n) => args.length === 0 || args.includes(n);
  const hash = async (h, wait = 1400) => {
    await p.evaluate((x) => (location.hash = x), h);
    await sleep(wait);
  };
  const file = (rel) => `#/file/${ws}/${encodeURIComponent(`${dir}/${rel}`)}`;

  if (phone) {
    await sleep(2000);
    if (want("folder")) {
      await hash(`#/project/${ws}`);
      await shot("01-project");
      await hash(`#/files/${ws}`);
      await shot("02-folder");
      await hash(`#/files/${ws}/${encodeURIComponent(`${dir}/src`)}`);
      await shot("03-subfolder");
    }
    if (want("search")) {
      await hash(`#/files/${ws}`);
      await p.getByPlaceholder("Search files").fill("model");
      await sleep(1200);
      await shot("04-search");
    }
    if (want("code")) { await hash(file("src/files.rs"), 1800); await shot("05-code"); }
    if (want("md")) { await hash(file("README.md")); await shot("06-markdown"); }
    if (want("big")) { await hash(file("logs.txt"), 2200); await shot("07-big"); }
    if (want("image")) { await hash(file("assets/cover.png")); await shot("08-image"); }
    if (want("binary")) { await hash(file("assets/blob.bin")); await shot("09-binary"); }
    if (want("pdf")) { await hash(file("docs/guide.pdf")); await shot("10-pdf"); }
    // Home folder (only when asked: needs Settings.remote_files_home on and `--hash "&web=1"`).
    if (args.includes("home")) {
      await hash("#/projects");
      await shot("12-projects-home");
      await hash(`#/files/home/${encodeURIComponent("~")}`, 1800);
      await shot("13-home");
    }
    if (want("code")) {
      await hash(file("src/files.rs"), 1800);
      const more = p.getByRole("button", { name: /^More for/ }).first();
      if (await more.count()) { await tap(more); await sleep(800); await shot("11-file-menu"); }
    }
    return;
  }

  await p.evaluate((id) => {
    const key = "neuralagent.ui";
    const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
    cur.state = { ...cur.state, workspace: id };
    localStorage.setItem(key, JSON.stringify(cur));
  }, ws);
  await p.reload();
  await sleep(2500);
  const btn = p.getByRole("button", { name: "Files", exact: true }).first();
  if (!(await btn.count())) return console.log("files: no Files button (old daemon?)");
  await btn.click();
  await sleep(1500);
  const row = (name) => p.locator("[data-row]", { hasText: name }).first();
  // The pane keeps its place in the layout: start from the project folder.
  const top = async () => {
    await p.getByRole("navigation", { name: "Folder path" }).getByRole("button").first().click();
    await sleep(900);
  };
  await top();
  if (want("folder")) await shot("01-pane");
  if (want("code")) {
    await row("src").click();
    await sleep(900);
    await row("files.rs").click();
    await sleep(1800);
    await shot("02-code");
    await top();
  }
  if (want("md")) { await row("README.md").click(); await sleep(1400); await shot("03-markdown"); }
  if (want("big")) { await row("logs.txt").click(); await sleep(2200); await shot("04-big"); }
  if (want("image") || want("binary")) {
    await row("assets").click();
    await sleep(900);
    if (want("image")) { await row("cover.png").click(); await sleep(1400); await shot("05-image"); }
    if (want("binary")) { await row("blob.bin").click(); await sleep(1400); await shot("06-binary"); }
    await top();
  }
  if (want("search")) {
    await p.getByPlaceholder("Filter or search").fill("model");
    await sleep(1200);
    await shot("07-search");
    await p.getByPlaceholder("Filter or search").fill("");
  }
};
