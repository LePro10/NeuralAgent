// Entry of /demo/. The isolation comes first: the demo shares the site's origin with the real web
// remote and must never read or write its storage. Everything else loads after it.
import "./isolate.ts";
import "./demo.css";

const q = new URLSearchParams(location.search);

const done = () => document.getElementById("root")?.removeAttribute("aria-busy");

if (q.get("embed") === "1") void import("./frame.tsx").then((m) => m.bootFrame(q)).then(done);
else void import("./stage.tsx").then((m) => (m.bootStage(q), done()));
