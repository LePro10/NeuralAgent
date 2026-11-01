// The three competing takes on one goal ("a wishlist for the shop"), one per engine. Each works in
// its own copy of the project (a worktree), so their edits never collide.

import type { Beat } from "./run.ts";


export const RACE_GOAL = "Add a wishlist: a heart on every product card that remembers what you saved.";

export function raceBeats(variant: number, check: Beat): Beat[] {
  if (variant === 0)
    return [
      { k: "say", text: "Plan: a tiny wishlist store in localStorage, a heart on the product card, and a test for the store." },
      { k: "read", path: "src/components/ProductCard.tsx" },
      {
        k: "write",
        path: "src/lib/wishlist.ts",
        text: [
          "const KEY = \"shop.wishlist\";",
          "",
          "function load(): string[] {",
          "  try {",
          "    return JSON.parse(localStorage.getItem(KEY) ?? \"[]\") as string[];",
          "  } catch {",
          "    return [];",
          "  }",
          "}",
          "",
          "export const has = (id: string) => load().includes(id);",
          "",
          "export function toggle(id: string): boolean {",
          "  const list = load();",
          "  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];",
          "  localStorage.setItem(KEY, JSON.stringify(next));",
          "  return next.includes(id);",
          "}",
          "",
        ].join("\n"),
      },
      { k: "edit", path: "src/components/ProductCard.tsx", old: 'import type { Product } from "../data/products";\n', new: 'import type { Product } from "../data/products";\nimport { has, toggle } from "../lib/wishlist";\n' },
      { k: "edit", path: "src/components/ProductCard.tsx", old: "      <button onClick={onAdd}>Add to cart</button>", new: '      <button onClick={onAdd}>Add to cart</button>\n      <button aria-label="Save for later" aria-pressed={has(product.id)} onClick={() => toggle(product.id)}>\n        {has(product.id) ? "♥" : "♡"}\n      </button>' },
      {
        k: "write",
        path: "src/lib/wishlist.test.ts",
        text: ['import { describe, expect, it } from "vitest";', 'import { has, toggle } from "./wishlist";', "", 'describe("wishlist", () => {', '  it("remembers a saved product", () => {', '    toggle("p1");', '    expect(has("p1")).toBe(true);', "  });", "});", ""].join("\n"),
      },
      check,
      { k: "say", text: "Done: hearts on every card, saved in localStorage so they survive a reload, with a test for the store." },
    ];
  if (variant === 1)
    return [
      { k: "say", text: "I'll keep the wishlist in React state at the top of the shop and persist it with a small hook." },
      { k: "read", path: "src/Shop.tsx" },
      {
        k: "write",
        path: "src/hooks/useWishlist.ts",
        text: [
          'import { useEffect, useState } from "react";',
          "",
          "export function useWishlist() {",
          "  const [ids, setIds] = useState<string[]>(() => JSON.parse(localStorage.getItem(\"wishlist\") ?? \"[]\"));",
          "  useEffect(() => localStorage.setItem(\"wishlist\", JSON.stringify(ids)), [ids]);",
          "  const toggle = (id: string) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));",
          "  return { ids, toggle };",
          "}",
          "",
        ].join("\n"),
      },
      { k: "edit", path: "src/Shop.tsx", old: 'import { addLine, type Line } from "./lib/cart";\n', new: 'import { addLine, type Line } from "./lib/cart";\nimport { useWishlist } from "./hooks/useWishlist";\n' },
      { k: "edit", path: "src/Shop.tsx", old: "  const [lines, setLines] = useState<Line[]>([]);", new: "  const [lines, setLines] = useState<Line[]>([]);\n  const wish = useWishlist();" },
      check,
      { k: "say", text: "The shop now owns a persisted wishlist through `useWishlist`. The heart button is the next step and needs the ProductCard props extended." },
    ];
  return [
    { k: "say", text: "Smallest thing that works: a heart toggle inside the product card, no persistence yet." },
    { k: "read", path: "src/components/ProductCard.tsx" },
    { k: "edit", path: "src/components/ProductCard.tsx", old: "      <button onClick={onAdd}>Add to cart</button>", new: '      <button onClick={onAdd}>Add to cart</button>\n      <button aria-label="Save for later">♡</button>' },
    check,
    { k: "say", text: "Added the heart button. It does not remember anything across reloads yet, that would be the follow-up." },
  ];
}

/** What Neural says about each finished attempt of the race (shown in its message; the attempt chips only know approved or changes). */
export const verdicts = ["the most complete, it saves the hearts and has a test", "half way, the hook exists but the button is missing", "the smallest diff, but nothing is saved"];

// ── build + review: a builder and a reviewer loop until the reviewer approves ────────────────────

export const REVIEW_GOAL = "Show how much is missing for free shipping in the cart (free from 50.00 EUR).";

const SHIPPING_FLOAT = [
  "export const FREE_SHIPPING_FROM = 50; // EUR",
  "",
  "export function shippingNote(lines: Line[]): string {",
  "  const euros = lines.reduce((sum, l) => sum + (l.product.price / 100) * l.quantity, 0);",
  "  const missing = FREE_SHIPPING_FROM - euros;",
  "  return missing > 0 ? `${missing.toFixed(2)} EUR to free shipping` : \"Free shipping\";",
  "}",
].join("\n");

const SHIPPING_MINOR = [
  "export const FREE_SHIPPING_MINOR = 5000;",
  "",
  "export function shippingNote(lines: Line[]): string {",
  "  const minor = lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0);",
  "  const missing = FREE_SHIPPING_MINOR - minor;",
  "  return missing > 0 ? `${(missing / 100).toFixed(2)} EUR to free shipping` : \"Free shipping\";",
  "}",
].join("\n");

const TOTAL_HEAD = "export function total(lines: Line[]): string {";

export function buildRound1(check: Beat): Beat[] {
  return [
    { k: "say", text: "I'll add a `shippingNote` helper next to `total` and show it under the total in the cart." },
    { k: "read", path: "src/lib/cart.ts" },
    { k: "edit", path: "src/lib/cart.ts", old: TOTAL_HEAD, new: `${SHIPPING_FLOAT}\n\n${TOTAL_HEAD}` },
    { k: "edit", path: "src/components/Cart.tsx", old: 'import { total, setQuantity, type Line } from "../lib/cart";', new: 'import { total, setQuantity, shippingNote, type Line } from "../lib/cart";' },
    { k: "edit", path: "src/components/Cart.tsx", old: "      <p>Total: {total(lines)}</p>", new: "      <p>Total: {total(lines)}</p>\n      <p className=\"note\">{shippingNote(lines)}</p>" },
    check,
    { k: "say", text: "The cart now shows how much is missing for free shipping, and says \"Free shipping\" from 50.00 EUR. Ready for review." },
  ];
}

export function reviewRound1(stat: () => string[]): Beat[] {
  return [
    { k: "say", text: "Reading the builder's diff." },
    { k: "run", cmd: "git diff --stat", ms: 700, out: stat },
    { k: "read", path: "src/lib/cart.ts" },
    {
      k: "say",
      text: [
        "Changes asked, one blocking point and one small one.",
        "",
        "1. `shippingNote` adds up euros as floats (`price / 100 * quantity`). Every other helper in this repo stays in minor units and formats once at the end, like `total` does. A float sum is what the money rule forbids. Compare in minor units: `FREE_SHIPPING_MINOR = 5000`.",
        "2. There is no test for the threshold. Add one for below, exactly at, and above 50.00 EUR.",
      ].join("\n"),
    },
  ];
}

export function buildRound2(check: Beat): Beat[] {
  return [
    { k: "say", text: "Fair point on both. I'll compare in minor units, format once like `total`, and add the threshold test." },
    { k: "read", path: "src/lib/cart.ts" },
    { k: "edit", path: "src/lib/cart.ts", old: SHIPPING_FLOAT, new: SHIPPING_MINOR },
    {
      k: "write",
      path: "src/lib/shipping.test.ts",
      text: [
        'import { describe, expect, it } from "vitest";',
        'import { addLine, shippingNote } from "./cart";',
        'import { PRODUCTS } from "../data/products";',
        "",
        'describe("shippingNote", () => {',
        '  it("says what is missing below the threshold", () => {',
        '    expect(shippingNote(addLine([], PRODUCTS[0]!))).toBe("32.00 EUR to free shipping");',
        "  });",
        "",
        '  it("is free from 50.00 EUR on", () => {',
        "    const lamp = addLine([], PRODUCTS[2]!);",
        '    expect(shippingNote(lamp)).toBe("Free shipping");',
        "  });",
        "});",
        "",
      ].join("\n"),
    },
    check,
    { k: "say", text: "Now compared in minor units with one format call at the end, and `src/lib/shipping.test.ts` covers below and above the threshold." },
  ];
}

export function reviewRound2(stat: () => string[]): Beat[] {
  return [
    { k: "say", text: "Looking at the second version." },
    { k: "run", cmd: "git diff --stat", ms: 700, out: stat },
    { k: "read", path: "src/lib/shipping.test.ts" },
    { k: "say", text: "Approved. Minor units from start to end, a single format call, and the test pins the threshold on both sides. Nothing else to ask for." },
  ];
}
