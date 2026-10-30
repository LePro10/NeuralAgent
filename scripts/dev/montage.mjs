// One labelled contact sheet from many screenshots (cheaper to review than many images).
//   node scripts/dev/montage.mjs out.png [--tile 240] a.png b.png …
import { parseArgs } from "node:util";
import { montage } from "./lib.mjs";
const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { tile: { type: "string", default: "240" } } });
const [out, ...files] = positionals;
if (!out || !files.length) {
  console.error("usage: node scripts/dev/montage.mjs out.png [--tile 240] a.png b.png …");
  process.exit(2);
}
console.log(await montage(out, files, Number(o.tile)));
