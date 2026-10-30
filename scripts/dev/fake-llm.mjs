// Fake OpenAI-compatible streaming chat endpoint, so Neural answers without a real model.
// Env: FAKE_LLM_PORT (default 11499), ANSWER (the text it streams back).
import http from "node:http";
const PORT = Number(process.env.FAKE_LLM_PORT ?? 11499);
const ANSWER =
  process.env.ANSWER ??
  "Three agents are busy right now. **Builder** in landing-site is changing the greeting, the **Reviewer** waits for it, and Codex in api-server needs your OK to run the tests. Want me to approve it?";
http
  .createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", async () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const w of ANSWER.split(/(?<= )/)) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: w } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 15));
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fake LLM on http://127.0.0.1:${PORT}/v1`));
