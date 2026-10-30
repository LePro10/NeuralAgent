// Synthetic call against the daemon: streams 16 kHz wavs as a microphone would (real time),
// plays nothing but keeps a playback clock, and measures what the caller would hear.
// Usage: NEURALAGENT_HOME=… node scripts/dev/call-test.mjs a.wav b.wav@barge=1200 c.wav@wait=ms …
// Clips: 16 kHz mono wavs, e.g. `say -o q.wav --data-format=LEI16@16000 "What are my agents doing?"`.
// The daemon needs a Neural model (real key: NEURALAGENT_LLM_KEY from the keychain) and the
// voice models in $NEURALAGENT_HOME/models. HOLD=<ms> keeps the call open at the end.
// Env: NOISE=<amplitude 0..1> adds white noise to everything sent; ECHO=<0..1> leaks Neural's
// audio back into the microphone (imperfect echo cancellation); OUT=<dir> saves what Neural said.
import { readFileSync, writeFileSync } from "node:fs";
import { daemonInfo, testHome } from "./lib.mjs";
const home = testHome();
const info = daemonInfo(home);
const NOISE = Number(process.env.NOISE ?? 0);
const ECHO = Number(process.env.ECHO ?? 0);
const OUT = process.env.OUT;
const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readWav(path) {
  const b = readFileSync(path);
  let i = 12;
  while (i < b.length) {
    const id = b.toString("ascii", i, i + 4), len = b.readUInt32LE(i + 4);
    if (id === "data") return new Int16Array(b.buffer.slice(b.byteOffset + i + 8, b.byteOffset + i + 8 + len));
    i += 8 + len + (len & 1);
  }
  throw new Error("no data chunk in " + path);
}
function writeWav(path, pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length * 2, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length * 2, 40);
  writeFileSync(path, Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)]));
}

// Neural's audio as the caller hears it.
let playEnd = 0; // ms timestamp when queued audio finishes
let firstAudioAt = null;
let received = []; // Int16Array chunks of the current turn
let echoQueue = []; // 16 kHz samples to leak back
const log = [];
let state = "";
let heardN = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t !== "call") return;
  const ev = m.ev, now = Date.now();
  if (ev.k === "audio") {
    const buf = Buffer.from(ev.d, "base64");
    const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    if (firstAudioAt === null) firstAudioAt = now;
    received.push(pcm);
    playEnd = Math.max(playEnd, now) + (pcm.length / ev.rate) * 1000;
    if (ECHO > 0) for (let i = 0; i < pcm.length; i += ev.rate / 16000) echoQueue.push(pcm[Math.floor(i)] * ECHO);
  } else if (ev.k === "flush") {
    playEnd = now; echoQueue = [];
    log.push(`  ⏹ flush (barge-in)`);
  } else if (ev.k === "state") {
    state = ev.state;
    if (ev.error) log.push(`  state ${ev.state}: ${ev.error}`);
  } else if (ev.k === "heard") {
    // A new answer starts: what came before belonged to the previous one.
    firstAudioAt = null; received = []; heardN++;
    log.push(`  heard: ${ev.text}`);
  }
  else if (ev.k === "say") log.push(`  say: ${ev.text}`);
  else if (ev.k === "latency") log.push(`  latency (daemon): first ${ev.first_ms} ms${ev.filler ? " (acknowledgment)" : ""}, answer ${ev.answer_ms} ms`);
};
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ t: "hello", v: 1, client: { kind: "desktop", name: "call-test" } }));
ws.send(JSON.stringify({ t: "call_start" }));

// The microphone: 20 ms frames in real time; speech from the queue, else silence.
let mic = [];
let micEnd = 0; // when the last queued speech sample is sent
const FRAME = 320;
let running = true;
(async () => {
  let next = Date.now();
  while (running) {
    const f = new Int16Array(FRAME);
    for (let i = 0; i < FRAME; i++) {
      let v = mic.length ? mic.shift() : 0;
      if (echoQueue.length) v += echoQueue.shift();
      if (NOISE) v += (Math.random() * 2 - 1) * NOISE * 32767;
      f[i] = Math.max(-32768, Math.min(32767, v));
    }
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: "call_audio", d: Buffer.from(f.buffer).toString("base64") }));
    next += 20;
    await sleep(Math.max(0, next - Date.now()));
  }
})();

const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await sleep(20); return cond(); };
if (!(await waitFor(() => state === "listening", 60000))) { console.log("never listening:", log.join("\n")); process.exit(1); }

const results = [];
let n = 0;
const args = process.argv.slice(2);
for (const [ai, arg] of args.entries()) {
  const [file, opt] = arg.split("@");
  const pcm = readWav(file);
  // Last loud sample = end of speech.
  let last = pcm.length - 1;
  while (last > 0 && Math.abs(pcm[last]) < 600) last--;
  if (opt?.startsWith("barge=")) {
    // Talk over Neural: wait until it has been speaking for a while.
    await waitFor(() => firstAudioAt !== null, 30000);
    await sleep(Number(opt.slice(6)));
  }
  received = []; firstAudioAt = null; state = "";
  log.push(`▶ ${file.split("/").pop()}`);
  const h0 = heardN;
  mic.push(...pcm);
  const speechEnd = Date.now() + (last / 16000) * 1000;
  await waitFor(() => heardN > h0, 30000);
  await waitFor(() => firstAudioAt !== null, 30000);
  const first = firstAudioAt ? firstAudioAt - speechEnd : null;
  log.push(`  heard back after ${first} ms (client clock, end of speech → first audio)`);
  // Wait for the answer to finish playing (and a pause with nothing new), unless the next
  // sentence talks over it.
  if (!args[ai + 1]?.includes("@barge")) await waitFor(() => Date.now() > playEnd + 800 && state === "listening", 60000);
  if (OUT) writeWav(`${OUT}/answer-${++n}.wav`, Int16Array.from(received.flatMap((c) => Array.from(c))), 24000);
  results.push(first);
  // Stay on the line: Neural may report on agents by itself.
  if (opt?.startsWith("wait=")) await sleep(Number(opt.slice(5)));
}
// HOLD=<ms>: stay on the line without talking (news about agents).
if (process.env.HOLD) await sleep(Number(process.env.HOLD));
running = false;
ws.send(JSON.stringify({ t: "call_end" }));
await sleep(300);
console.log(log.join("\n"));
console.log("first audio ms:", results.join(", "));
process.exit(0);
