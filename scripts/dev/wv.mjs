// Evaluate JS in the Android app's WebView over raw CDP and print the result + recent console.
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>   (pid: adb shell pidof dev.neuralhub.neuralagent)
//   node scripts/dev/wv.mjs '<expr>' [waitMs]          env CDP_PORT (default 9333)
const list = await fetch(`http://localhost:${process.env.CDP_PORT ?? 9333}/json`).then((r) => r.json());
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pend.get(m.id)?.(m);
  else if (m.method === "Runtime.consoleAPICalled") logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  else if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const r = await send("Runtime.evaluate", { expression: process.argv[2], awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r));
await new Promise((res) => setTimeout(res, Number(process.argv[3] ?? 0)));
if (logs.length) console.log(logs.slice(-12).join("\n"));
process.exit(0);
