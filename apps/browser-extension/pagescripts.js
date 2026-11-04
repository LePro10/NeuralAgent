// Functions injected into pages with chrome.scripting.executeScript. Each one must be fully
// self-contained: it is serialised and runs in the page, so it cannot use anything from this file.

export function readPage(max) {
  const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title, url: location.href, text: text.length > max ? text.slice(0, max) + "\n[clipped]" : text };
}

export function listLinks(limit) {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const r = a.getBoundingClientRect();
    const style = getComputedStyle(a);
    if (style.visibility === "hidden" || style.display === "none" || (r.width === 0 && r.height === 0)) continue;
    const text = (a.innerText || a.getAttribute("aria-label") || a.title || "").replace(/\s+/g, " ").trim();
    const href = a.href;
    if (!/^https?:/.test(href) || seen.has(href + text)) continue;
    seen.add(href + text);
    out.push({ text: text.slice(0, 160), href });
    if (out.length >= limit) break;
  }
  return out;
}

export function clickElement(selector, text) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  let el = null;
  if (selector) {
    try {
      el = [...document.querySelectorAll(selector)].find(visible) ?? null;
    } catch {
      return { error: `"${selector}" is not a valid selector.` };
    }
  } else if (text) {
    const want = String(text).trim().toLowerCase();
    const label = (e) => (e.innerText || e.value || e.getAttribute("aria-label") || e.title || "").replace(/\s+/g, " ").trim().toLowerCase();
    const cands = [...document.querySelectorAll("a, button, summary, [role=button], [role=link], [role=tab], [role=menuitem], input[type=submit], input[type=button], label")].filter(visible);
    el = cands.find((e) => label(e) === want) ?? cands.find((e) => label(e).includes(want)) ?? null;
  }
  if (!el) return { error: selector ? `Nothing visible matches "${selector}".` : `No visible link or button says "${text}".` };
  el.scrollIntoView({ block: "center", inline: "center" });
  const what = (el.innerText || el.value || el.getAttribute("aria-label") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 80);
  el.click();
  return { clicked: what, tag: el.tagName.toLowerCase() };
}

export function typeInto(selector, value, submit) {
  let el;
  try {
    el = document.querySelector(selector);
  } catch {
    return { error: `"${selector}" is not a valid selector.` };
  }
  if (!el) return { error: `Nothing matches "${selector}".` };
  el.scrollIntoView({ block: "center" });
  el.focus();
  if (el.isContentEditable) {
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, value);
  } else if ("value" in el) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    return { error: "That element cannot take text." };
  }
  if (submit) {
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    if (el.form && typeof el.form.requestSubmit === "function") el.form.requestSubmit();
  }
  return { typed: String(value).length, submitted: !!submit };
}

export function scrollPage(how) {
  const doc = document.scrollingElement || document.documentElement;
  const h = window.innerHeight;
  if (how === "top") window.scrollTo(0, 0);
  else if (how === "bottom") window.scrollTo(0, doc.scrollHeight);
  else if (how === "up") window.scrollBy(0, -Math.round(h * 0.8));
  else window.scrollBy(0, Math.round(h * 0.8));
  return { y: Math.round(window.scrollY), max: Math.max(0, doc.scrollHeight - h) };
}
