const $ = (id) => document.getElementById(id);

const TEXT = {
  connected: ["Connected", "NeuralAgent can use this browser."],
  connecting: ["Connecting…", "Reaching the NeuralAgent app on this computer."],
  offline: ["Paired, app not reachable", "Start NeuralAgent. This reconnects on its own."],
  unpaired: ["Not paired", "Pair this browser with the NeuralAgent app."],
};

function render(s) {
  const status = s.status && TEXT[s.status] ? s.status : "unpaired";
  const [title, detail] = TEXT[status];
  $("title").textContent = title;
  $("detail").textContent = status === "unpaired" && s.detail ? s.detail : detail;
  $("dot").className = "dot " + status;
  $("pair").hidden = status !== "unpaired";
  $("actions").hidden = status === "unpaired";
  $("retry").hidden = status !== "offline";
}

async function load() {
  render(await chrome.storage.local.get(["status", "detail"]));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.status || changes.detail)) void load();
});

$("pair").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("pairBtn");
  btn.disabled = true;
  btn.textContent = "Pairing…";
  $("error").hidden = true;
  const r = await chrome.runtime.sendMessage({ t: "pair", code: $("code").value });
  btn.disabled = false;
  btn.textContent = "Pair";
  if (!r?.ok) {
    $("error").textContent = r?.error || "Pairing failed.";
    $("error").hidden = false;
  } else {
    $("code").value = "";
  }
});

$("unpair").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ t: "unpair" });
  void load();
});
$("retry").addEventListener("click", () => void chrome.runtime.sendMessage({ t: "retry" }));

void load();
