import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileEntry } from "@neuralagent/protocol";
import { highlight } from "../components/files/highlight.ts";
import { hashOf, parseHash, validNav } from "./phoneRoute.ts";
import { b64ToBytes, bytesToB64, chunksOf, crumbsOf, decodeChecked, decodeText, dirOf, filterEntries, formatSize, kindOf, langOf, relPath, sortEntries, termToken } from "../components/files/model.ts";

const e = (name: string, dir = false, size = 0, mtime = 0): FileEntry => ({ name, path: `/w/${name}`, dir, size, mtime, link: false, protected: false });

test("folders first, names like Finder, other keys", () => {
  const list = [e("file10.txt", false, 5, 3), e("file2.txt", false, 50, 1), e("src", true), e("B.md", false, 1, 2)];
  assert.deepEqual(sortEntries(list, { key: "name" }).map((x) => x.name), ["src", "B.md", "file2.txt", "file10.txt"]);
  assert.deepEqual(sortEntries(list, { key: "date" }).map((x) => x.name), ["src", "file10.txt", "B.md", "file2.txt"]);
  assert.deepEqual(sortEntries(list, { key: "size" }).map((x) => x.name), ["src", "file2.txt", "file10.txt", "B.md"]);
  assert.deepEqual(sortEntries(list, { key: "size", desc: true }).map((x) => x.name), ["src", "B.md", "file10.txt", "file2.txt"]);
  assert.deepEqual(filterEntries(list, " FILE1").map((x) => x.name), ["file10.txt"]);
});

test("breadcrumbs from the root down", () => {
  assert.deepEqual(crumbsOf("/u/code/app/src/ui", "/u/code/app", "app").map((c) => c.name), ["app", "src", "ui"]);
  assert.equal(crumbsOf("/u/code/app/src/ui", "/u/code/app", "app")[1]!.path, "/u/code/app/src");
  assert.deepEqual(crumbsOf("/u/code/app", "/u/code/app/", "app").length, 1);
  // A sibling with the same prefix is not inside.
  assert.deepEqual(crumbsOf("/u/code/app2/x", "/u/code/app", "app").length, 1);
  assert.equal(dirOf("/a/b/c.txt"), "/a/b");
  assert.equal(dirOf("/a"), "/");
  assert.equal(relPath("/w/app/src/x.ts", "/w/app"), "src/x.ts");
  assert.equal(relPath("/elsewhere/x", "/w/app"), "/elsewhere/x");
});

test("file kinds and languages", () => {
  assert.equal(kindOf("README.md", "text/markdown", true), "markdown");
  assert.equal(kindOf("App.tsx", "text/plain", true), "code");
  assert.equal(kindOf("notes.txt", "text/plain", true), "text");
  assert.equal(kindOf("logo.svg", "image/svg+xml", true), "image");
  assert.equal(kindOf("a.pdf", "application/pdf", false), "pdf");
  assert.equal(kindOf("blob.bin", "application/octet-stream", false), "binary");
  assert.equal(langOf("Dockerfile"), "sh");
  assert.equal(langOf(".env.local"), "sh");
  assert.equal(langOf("main.rs"), "rust");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(30 * 1024 * 1024), "30 MB");
});

test("pieces cover the file exactly; base64 survives big buffers", () => {
  assert.deepEqual(chunksOf(0), []);
  assert.deepEqual(chunksOf(10, 4), [[0, 4], [4, 4], [8, 2]]);
  const big = new Uint8Array(300_000).map((_, i) => i % 251);
  assert.deepEqual(b64ToBytes(bytesToB64(big)), big);
  // A character cut between two pieces decodes once they are joined.
  const bytes = new TextEncoder().encode("héllo");
  assert.equal(decodeText(new Uint8Array([...bytes.subarray(0, 2), ...bytes.subarray(2)])), "héllo");
});

test("highlighting keeps the text and colours the obvious parts", () => {
  const src = 'const a = "x"; // note\nfunction go(n: Number) { return 42 }\n/* a\nb */';
  const lines = highlight(src, "ts");
  assert.equal(lines.map((l) => l.map((t) => t.s).join("")).join("\n"), src);
  const cls = (line: number, s: string) => lines[line]!.find((t) => t.s.includes(s))?.c;
  assert.equal(cls(0, "const"), "kw");
  assert.equal(cls(0, '"x"'), "str");
  assert.equal(cls(0, "// note"), "com");
  assert.equal(cls(1, "go"), "fn");
  assert.equal(cls(1, "Number"), "type");
  assert.equal(cls(1, "42"), "num");
  assert.equal(cls(3, "b */"), "com");
  const json = highlight('{"a": 1, "b": true}', "json");
  assert.equal(json[0]!.find((t) => t.s === '"a"')?.c, "prop");
  assert.equal(json[0]!.find((t) => t.s === "true")?.c, "lit");
  const html = highlight('<a href="x">hi</a>', "html");
  assert.equal(html[0]!.map((t) => t.s).join(""), '<a href="x">hi</a>');
  assert.equal(html[0]!.find((t) => t.s === "href")?.c, "attr");
  assert.deepEqual(highlight("a\n\nb", "nope"), [[{ s: "a" }], [], [{ s: "b" }]]);
});

test("phone routes for folders and files print and parse back", () => {
  const file = parseHash(hashOf({ tab: "projects", stack: [{ k: "file", ws: "w1", path: "/Users/me/my app/src/a b.ts" }] }))!;
  assert.deepEqual(file.stack, [
    { k: "project", id: "w1" },
    { k: "files", ws: "w1", path: "/Users/me/my app/src" },
    { k: "file", ws: "w1", path: "/Users/me/my app/src/a b.ts" },
  ]);
  assert.equal(hashOf({ tab: "projects", stack: [{ k: "files", ws: "w1" }] }), "#/files/w1");
  assert.deepEqual(parseHash("#/files/w1")!.stack.at(-1), { k: "files", ws: "w1" });
  assert.equal(parseHash("#/file/w1"), null);
  // The home folder (opened from the Projects list) has no project page underneath.
  assert.deepEqual(parseHash(hashOf({ tab: "projects", stack: [{ k: "files", ws: "home", path: "~" }] }))!.stack, [{ k: "files", ws: "home", path: "~" }]);
  assert.equal(parseHash("#/file/home/%2FUsers%2Fme%2Fa.txt")!.stack.length, 2);
  assert.ok(validNav({ tab: "projects", stack: [{ k: "files", ws: "w1", path: "/x" }] }));
  assert.equal(validNav({ tab: "projects", stack: [{ k: "file", ws: "w1" }] }), null);
});

test("paths typed into a terminal never run anything", () => {
  assert.equal(termToken("/Users/me/app/src/main.rs"), "/Users/me/app/src/main.rs");
  assert.equal(termToken("/a/my file.txt"), "'/a/my file.txt'");
  assert.equal(termToken("/a/$(rm -rf ~)"), "'/a/$(rm -rf ~)'");
  assert.equal(termToken("/a/it's"), "'/a/it'\\''s'");
  assert.equal(termToken("/a/x\nrm -rf ~\n"), "'/a/x?rm -rf ~?'");
  assert.ok(!/[\r\n\u001b]/.test(termToken("/a/\u001b[2Jb\r")));
});

test("text that is not UTF-8 is marked so it is never saved back", () => {
  const u = new TextEncoder().encode("héllo");
  assert.deepEqual(decodeChecked(u, true), { text: "héllo", lossy: false });
  assert.equal(decodeChecked(u.subarray(0, 2), false).lossy, false, "a character cut at the end of a part is fine");
  assert.equal(decodeChecked(new Uint8Array([0x68, 0xe9, 0x6c]), true).lossy, true, "Latin-1");
  assert.equal(decodeChecked(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), true).text, "\ufeffa", "the BOM is kept");
  assert.deepEqual(decodeChecked(new Uint8Array([0x68, 0xe9, 0x6c]), true), { text: "hél", lossy: true, encoding: "Latin-1" });
  const le = new Uint8Array([0xff, 0xfe, 0x68, 0, 0xe9, 0, 0x6c, 0]);
  assert.deepEqual(decodeChecked(le, true), { text: "hél", lossy: true, encoding: "UTF-16LE" }, "UTF-16 with a mark");
  assert.equal(decodeChecked(le.subarray(2), true).text, "hél", "UTF-16 without a mark");
  assert.equal(decodeChecked(new Uint8Array([0, 0x68, 0, 0x69, 0, 0x21]), true).encoding, "UTF-16BE");
});
