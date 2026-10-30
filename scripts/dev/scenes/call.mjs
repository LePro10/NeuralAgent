// Call Neural in the browser with a fake microphone and log the call states.
// Needs a Neural model (env.mjs up --llm, or a real key in the test daemon) and Chromium with
// --fake-mic. Usage: node scripts/dev/shot.mjs call --devices phone --schemes dark --fake-mic q.wav
export default async ({ p, shot, sleep, go }) => {
  await sleep(2500);
  await go("Neural");
  await shot("01-neural");
  await p.locator("button:visible", { hasText: "Call Neural" }).first().click();
  const t0 = Date.now();
  let last = "";
  let shotSpeaking = false;
  let shotListening = false;
  while (Date.now() - t0 < 30000) {
    const txt = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    const st = (txt.match(/(Connecting|Listening|Thinking|Speaking|Connection lost)/i) ?? [""])[0];
    if (st !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${st}`); last = st; }
    if (st.toLowerCase() === "listening" && !shotListening) { await shot("02-listening"); shotListening = true; }
    if (st.toLowerCase() === "speaking" && !shotSpeaking) { await sleep(1200); await shot("03-speaking"); shotSpeaking = true; }
    await sleep(150);
  }
};
